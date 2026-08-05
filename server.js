const fs = require('fs');
const path = require('path');
const os = require('os');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');
const multer = require('multer');

const LEGACY_DROP_MAX_BYTES = 1024 * 1024 * 1024;
const CHUNKED_DROP_MAX_BYTES = 50 * 1024 * 1024 * 1024;
const HOSTED_CHUNK_SIZE_BYTES = 128 * 1024 * 1024;
const MAX_HOSTED_EXPIRY_MS = 48 * 3600000;
const ABANDONED_UPLOAD_TTL_MS = 30 * 60 * 1000;

function startServer(port = 3000) {
    const DROPS_DIR = path.join(os.tmpdir(), 'drops');
    if (!fs.existsSync(DROPS_DIR)) fs.mkdirSync(DROPS_DIR, { recursive: true });
    const FOREVER_FILES_DIR = path.join(os.tmpdir(), 'forever_files');
    if (!fs.existsSync(FOREVER_FILES_DIR)) fs.mkdirSync(FOREVER_FILES_DIR, { recursive: true });
    const DROP_TTL_MS = 60 * 60 * 1000;
    const dropMeta = new Map();
    const uploadSessions = new Map();

    const storage = multer.diskStorage({
        destination: (req, file, cb) => cb(null, DROPS_DIR),
        filename: (req, file, cb) => {
            const token = crypto.randomBytes(16).toString('hex');
            req._dropToken = token;
            cb(null, token);
        }
    });
    const upload = multer({ storage, limits: { fileSize: LEGACY_DROP_MAX_BYTES } });

    function safeParseInt(val) {
        const n = parseInt(val, 10);
        return Number.isFinite(n) ? n : null;
    }

    function getLegacyMetaPath(token) {
        return path.join(DROPS_DIR, `${token}.meta.json`);
    }

    function readJsonFile(filePath) {
        try {
            if (!fs.existsSync(filePath)) return null;
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        } catch {
            return null;
        }
    }

    function persistLegacyDropMeta(token, meta) {
        try {
            fs.writeFileSync(getLegacyMetaPath(token), JSON.stringify({ ...meta, mode: 'legacy' }));
        } catch {
        }
    }

    function cleanupDropOnDisk(token) {
        const basePath = path.join(DROPS_DIR, token);
        const legacyMetaPath = getLegacyMetaPath(token);
        try {
            if (fs.existsSync(basePath)) {
                const stat = fs.lstatSync(basePath);
                if (stat.isDirectory()) fs.rmSync(basePath, { recursive: true, force: true });
                else fs.unlinkSync(basePath);
            }
        } catch {
        }
        try {
            if (fs.existsSync(legacyMetaPath)) fs.unlinkSync(legacyMetaPath);
        } catch {
        }
    }

    function hydrateHostedDropsFromDisk() {
        let entries = [];
        try {
            entries = fs.readdirSync(DROPS_DIR);
        } catch {
            return;
        }

        const now = Date.now();
        for (const entry of entries) {
            const entryPath = path.join(DROPS_DIR, entry);
            let stat;
            try {
                stat = fs.lstatSync(entryPath);
            } catch {
                continue;
            }

            if (stat.isDirectory()) {
                if (entry.startsWith('preparing-')) {
                    if (now > stat.mtimeMs + ABANDONED_UPLOAD_TTL_MS) {
                        fs.rmSync(entryPath, { recursive: true, force: true });
                    }
                    continue;
                }

                const manifest = readJsonFile(path.join(entryPath, 'manifest.json'));
                if (manifest) {
                    if (manifest.expires && now <= manifest.expires) {
                        dropMeta.set(entry, { ...manifest, mode: 'chunked' });
                    } else {
                        cleanupDropOnDisk(entry);
                    }
                    continue;
                }

                if (now > stat.mtimeMs + ABANDONED_UPLOAD_TTL_MS) {
                    cleanupDropOnDisk(entry);
                }
                continue;
            }

            if (!stat.isFile() || entry.endsWith('.meta.json')) continue;

            const legacyMeta = readJsonFile(getLegacyMetaPath(entry));
            if (legacyMeta && legacyMeta.expires && now <= legacyMeta.expires) {
                dropMeta.set(entry, { ...legacyMeta, mode: 'legacy' });
                continue;
            }

            const hasExpiredMeta = !!(legacyMeta && legacyMeta.expires && now > legacyMeta.expires);
            const isStaleOrphan = now > stat.mtimeMs + MAX_HOSTED_EXPIRY_MS;
            if (hasExpiredMeta || isStaleOrphan) {
                cleanupDropOnDisk(entry);
            }
        }
    }

    function hydrateForeverDrops() {
        if (!fs.existsSync(FOREVER_FILES_DIR)) return;
        try {
            const entries = fs.readdirSync(FOREVER_FILES_DIR);
            for (const entry of entries) {
                const entryPath = path.join(FOREVER_FILES_DIR, entry);
                let stat;
                try { stat = fs.lstatSync(entryPath); } catch { continue; }
                if (stat.isDirectory()) {
                    const manifest = readJsonFile(path.join(entryPath, 'manifest.json'));
                    if (manifest) {
                        dropMeta.set(entry, { ...manifest, mode: 'chunked', expires: null });
                    }
                } else if (stat.isFile() && !entry.endsWith('.meta.json')) {
                    const legacyMetaPath = path.join(FOREVER_FILES_DIR, `${entry}.meta.json`);
                    const legacyMeta = readJsonFile(legacyMetaPath);
                    if (legacyMeta) {
                        dropMeta.set(entry, { ...legacyMeta, mode: 'legacy', expires: null });
                    }
                }
            }
        } catch (e) {
        }
    }

    hydrateHostedDropsFromDisk();
    hydrateForeverDrops();

    setInterval(() => {
        const now = Date.now();
        for (const [token, meta] of dropMeta) {
            if (now > meta.expires) {
                cleanupDropOnDisk(token);
                dropMeta.delete(token);
            }
        }

        for (const [token, session] of uploadSessions) {
            if (now > session.createdAt + ABANDONED_UPLOAD_TTL_MS) {
                cleanupDropOnDisk(token);
                uploadSessions.delete(token);
            }
        }
    }, 60 * 1000);

    const SERVER_SALT = crypto.randomBytes(32).toString('hex');

    function hashId(rawId) {
        if (!rawId) return null;
        return crypto.createHash('sha256').update(rawId + SERVER_SALT).digest('hex');
    }

    function getVisiblePeers(room) {
        return Object.values(room?.peers || {}).filter(peer => !peer.isShadowTab);
    }

    function getDestroyVoteState(room) {
        const visiblePeers = getVisiblePeers(room);
        const acceptedNames = visiblePeers.filter(peer => room.destructionVotes?.has(peer.id)).map(peer => peer.name);
        const pendingNames = visiblePeers.filter(peer => !room.destructionVotes?.has(peer.id)).map(peer => peer.name);
        return {
            requiredVotes: Math.max(1, visiblePeers.length),
            acceptedNames,
            pendingNames
        };
    }

    const app = express();
    let server;
    const isAzure = !!(process.env.WEBSITE_SITE_NAME || process.env.WEBSITE_INSTANCE_ID);
    if (!isAzure && fs.existsSync(path.join(__dirname, 'server.pfx'))) {
        server = require('https').createServer({
            pfx: fs.readFileSync(path.join(__dirname, 'server.pfx')),
            passphrase: 'password'
        }, app);
    } else {
        server = http.createServer(app);
    }
    const io = new Server(server, {
        cors: {
            origin: "*",
            methods: ["GET", "POST"]
        },
        transports: ['websocket', 'polling'],
        pingTimeout: 60000,
        pingInterval: 25000,
        maxHttpBufferSize: 1e8
    });

    const activeRooms = new Map();
    const ROOM_TIMEOUT_MS = 60 * 60 * 1000;
    const DISCONNECT_GRACE_MS = 60000;
    const INACTIVITY_IDLE_TRIGGER_MS = 2 * 60 * 1000;

    function broadcastPublicRooms() {
        const publicList = [];
        for (const [, r] of activeRooms.entries()) {
            if (r.isPublic) {
                publicList.push({
                    id: r.publicRoomId,
                    roomId: r.publicRoomId,
                    name: r.publicRoomName || '',
                    desc: r.publicRoomDesc || '',
                    peerCount: r.participants || 0,
                    scheduleOpen: r.scheduleOpen || null,
                    scheduleClose: r.scheduleClose || null
                });
            }
        }
        io.emit('public-rooms-list', publicList);
    }

    function emitRoomMetadata(room, privateHash) {
        if (!room || !privateHash) return;
        let inactivityWarningAt = null;
        let inactivityExpiresAt = null;
        if (room.inactivityTimeoutMs > 0 && room.lastInactivityResetAt) {
            inactivityWarningAt = room.lastInactivityResetAt + INACTIVITY_IDLE_TRIGGER_MS;
            inactivityExpiresAt = inactivityWarningAt + room.inactivityTimeoutMs;
        }
        io.to(privateHash).emit('room-metadata', {
            expiresAt: room.expiresAt,
            inactivityWarningAt,
            inactivityExpiresAt,
            isSafetyTimer: !!room.isSafetyTimer,
            serverTime: Date.now()
        });
    }

    function resetInactivityTimer(room, publicHash, privateHash) {
        if (!room.inactivityTimeoutMs || room.inactivityTimeoutMs <= 0) return;
        if (room.inactivityTimerId) clearTimeout(room.inactivityTimerId);
        if (room.inactivityWarningId) clearTimeout(room.inactivityWarningId);

        room.lastInactivityResetAt = Date.now();
        emitRoomMetadata(room, privateHash);

        room.inactivityWarningId = setTimeout(() => {
            if (activeRooms.has(privateHash)) {
                io.to(privateHash).emit('inactivity-warning', room.inactivityTimeoutMs);
                emitRoomMetadata(room, privateHash);
            }
        }, INACTIVITY_IDLE_TRIGGER_MS);

        room.inactivityTimerId = setTimeout(() => {
            if (activeRooms.has(privateHash)) {
                io.to(privateHash).emit('peer-destroyed-room');
                activeRooms.delete(privateHash);
                broadcastPublicRooms();
            }
        }, INACTIVITY_IDLE_TRIGGER_MS + room.inactivityTimeoutMs);
    }

    let globalStats = {
        bytesTransferred: 0,
        filesTransferred: 0
    };

    app.use(express.json({ limit: '10mb' }));
    app.use(express.urlencoded({ extended: true, limit: '10mb' }));
    app.use(express.static(__dirname));

    app.post('/upload', upload.single('file'), (req, res) => {
        if (!req.file || !req._dropToken) return res.status(400).json({ error: 'No file' });
        const token = req._dropToken;
        const originalName = req.body.name || 'file';

        let durationMs = DROP_TTL_MS;
        if (req.body.expiry) {
            const requested = parseInt(req.body.expiry);
            if (!isNaN(requested) && requested >= 60000 && requested <= MAX_HOSTED_EXPIRY_MS) {
                durationMs = requested;
            }
        }

        const expires = Date.now() + durationMs;
        const meta = { filename: originalName, expires, size: req.file.size, mode: 'legacy' };
        dropMeta.set(token, meta);
        persistLegacyDropMeta(token, meta);
        res.json({ token, expires, maxBytes: LEGACY_DROP_MAX_BYTES });
    });

    app.post('/upload-session', multer().none(), (req, res) => {
        const originalName = req.body.name || 'file';
        const size = safeParseInt(req.body.size);
        const expiryMs = safeParseInt(req.body.expiry);

        if (!size || size <= 0) return res.status(400).json({ error: 'Invalid size' });
        if (size > CHUNKED_DROP_MAX_BYTES) return res.status(400).json({ error: 'File too large for hosted drop (chunked)' });
        if (!expiryMs || expiryMs < 60000 || expiryMs > MAX_HOSTED_EXPIRY_MS) return res.status(400).json({ error: 'Invalid expiry' });

        let token = req.body.token;
        if (!token) {
            token = crypto.randomBytes(16).toString('hex');
            while (uploadSessions.has(token) || dropMeta.has(token)) {
                token = crypto.randomBytes(16).toString('hex');
            }
        }
        const chunkSize = HOSTED_CHUNK_SIZE_BYTES;
        const chunkCount = Math.ceil(size / chunkSize);

        const basePath = path.join(DROPS_DIR, token);
        const partsDir = path.join(basePath, 'parts');
        fs.mkdirSync(partsDir, { recursive: true });

        const partsReceived = new Set();
        if (req.body.token) {
            try {
                if (fs.existsSync(partsDir)) {
                    const files = fs.readdirSync(partsDir);
                    files.forEach(f => {
                        const idx = parseInt(f);
                        if (!isNaN(idx)) partsReceived.add(idx);
                    });
                }
            } catch (e) { console.error('Error scanning existing chunks', e); }
        }

        uploadSessions.set(token, {
            filename: originalName,
            expiryMs,
            size,
            chunkSize,
            chunkCount,
            createdAt: Date.now(),
            partsReceived: partsReceived
        });

        res.json({
            token,
            expires: null,
            maxBytes: CHUNKED_DROP_MAX_BYTES,
            chunkSize,
            chunkCount,
            partsReceived: Array.from(partsReceived)
        });
    });

    const chunkStorage = multer.diskStorage({
        destination: (req, file, cb) => {
            const token = req.body.token;
            const basePath = path.join(DROPS_DIR, token);
            const partsDir = path.join(basePath, 'parts');
            fs.mkdirSync(partsDir, { recursive: true });
            cb(null, partsDir);
        },
        filename: (req, file, cb) => {
            const index = safeParseInt(req.body.index);
            cb(null, String(index));
        }
    });

    const chunkUpload = multer({ storage: chunkStorage, limits: { fileSize: HOSTED_CHUNK_SIZE_BYTES + 1024 * 1024 } });

    app.post('/upload-chunk', chunkUpload.single('chunk'), (req, res) => {
        const token = req.body.token;
        const index = safeParseInt(req.body.index);

        if (!token || index === null) return res.status(400).json({ error: 'Invalid token/index' });
        const session = uploadSessions.get(token);
        if (!session) return res.status(404).json({ error: 'Upload session not found' });
        if (index < 0 || index >= session.chunkCount) return res.status(400).json({ error: 'Chunk index out of range' });
        if (!req.file) return res.status(400).json({ error: 'No chunk file' });
        if (nowExpired(session)) return res.status(410).json({ error: 'Session expired' });

        const isLast = index === session.chunkCount - 1;
        const plainSize = isLast ? (session.size - (session.chunkSize * (session.chunkCount - 1))) : session.chunkSize;
        const expectedCipherSize = plainSize + 16;

        if (typeof expectedCipherSize === 'number' && req.file.size !== expectedCipherSize) {
            return res.status(400).json({ error: 'Chunk size mismatch' });
        }

        session.partsReceived.add(index);
        res.json({ ok: true });
    });

    function nowExpired(session) {
        return !!session.expires && Date.now() > session.expires;
    }

    app.post('/upload-finalize', multer().none(), (req, res) => {
        const token = req.body.token;
        if (!token) return res.status(400).json({ error: 'Missing token' });

        const session = uploadSessions.get(token);
        if (!session) return res.status(404).json({ error: 'Upload session not found' });
        if (nowExpired(session)) return res.status(410).json({ error: 'Session expired' });

        const basePath = path.join(DROPS_DIR, token);
        const partsDir = path.join(basePath, 'parts');

        for (let i = 0; i < session.chunkCount; i++) {
            const partPath = path.join(partsDir, String(i));
            if (!fs.existsSync(partPath)) return res.status(400).json({ error: `Missing chunk ${i}` });
        }

        const expires = session.expires || (Date.now() + session.expiryMs);
        const isCollection = req.body.isCollection === 'true' || req.body.isCollection === true;
        const manifest = {
            mode: 'chunked',
            filename: session.filename,
            size: session.size,
            expires,
            chunkSize: session.chunkSize,
            chunkCount: session.chunkCount,
            isCollection: isCollection
        };

        fs.writeFileSync(path.join(basePath, 'manifest.json'), JSON.stringify(manifest));

        dropMeta.set(token, { ...manifest });
        uploadSessions.delete(token);
        broadcastLiveStats();

        res.json({ ok: true, token, expires });
    });

    app.post('/drop-cancel', multer().none(), (req, res) => {
        const token = req.body.token;
        if (!token) return res.status(400).json({ error: 'Missing token' });

        if (dropMeta.has(token)) {
            dropMeta.delete(token);
        }
        if (uploadSessions.has(token)) {
            uploadSessions.delete(token);
        }

        cleanupDropOnDisk(token);

        io.to(`drop:${token}`).emit('drop-cancelled', token);
        broadcastLiveStats();
        res.json({ ok: true });
    });

    app.get('/drop-info/:token', (req, res) => {
        let meta = dropMeta.get(req.params.token);
        if (!meta) {
            const session = uploadSessions.get(req.params.token);
            if (session) {
                return res.json({
                    filename: session.filename,
                    size: session.size,
                    expires: session.expires || null,
                    mode: 'chunked',
                    status: 'uploading',
                    chunkCount: session.chunkCount,
                    chunkSize: session.chunkSize
                });
            }
            return res.status(404).json({ error: 'Drop token not found', token: req.params.token });
        }
        if (Date.now() > meta.expires) return res.status(410).json({ error: 'Drop expired', token: req.params.token });
        if (meta.mode === 'chunked') {
            res.json({
                mode: 'chunked',
                status: 'ready',
                filename: meta.filename,
                size: meta.size,
                expires: meta.expires,
                chunkSize: meta.chunkSize,
                chunkCount: meta.chunkCount,
                isCollection: !!meta.isCollection || (meta.filename && meta.filename.endsWith('.json'))
            });
            return;
        }
        res.json({ filename: meta.filename, size: meta.size, expires: meta.expires, mode: meta.mode || 'legacy', status: 'ready' });
    });

    app.get('/download-chunk/:token/:index', (req, res) => {
        const meta = dropMeta.get(req.params.token);
        if (!meta) return res.status(404).send(`Drop token not found: ${req.params.token}`);
        if (meta.expires && Date.now() > meta.expires) return res.status(410).send(`Drop expired: ${req.params.token}`);
        if (meta.mode !== 'chunked') return res.status(400).send('Not a chunked drop');

        const index = safeParseInt(req.params.index);
        if (index === null || index < 0 || index >= meta.chunkCount) return res.status(400).send(`Chunk index out of range: ${req.params.index}`);

        let partPath = path.join(DROPS_DIR, req.params.token, 'parts', String(index));
        if (!fs.existsSync(partPath)) {
            partPath = path.join(FOREVER_FILES_DIR, req.params.token, 'parts', String(index));
        }
        if (!fs.existsSync(partPath)) return res.status(404).send(`Chunk file missing: ${partPath}`);

        const stat = fs.statSync(partPath);
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Length', stat.size);
        fs.createReadStream(partPath).pipe(res);
    });

    app.get('/download/:token', (req, res) => {
        const meta = dropMeta.get(req.params.token);
        if (!meta || (meta.expires && Date.now() > meta.expires)) return res.status(404).send('Drop expired or not found');
        if (meta.mode === 'chunked') return res.status(400).send('Chunked drop: use /download-chunk');
        let fpath = path.join(DROPS_DIR, req.params.token);
        if (!fs.existsSync(fpath)) {
            fpath = path.join(FOREVER_FILES_DIR, req.params.token);
        }
        if (!fs.existsSync(fpath)) return res.status(404).send('File missing');
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(meta.filename)}.enc"`);
        res.setHeader('Content-Length', meta.size);
        fs.createReadStream(fpath).pipe(res);
    });

    function broadcastLiveStats() {
        const connectedUsers = io.sockets.sockets.size;
        const activeHostedLinks = dropMeta.size;
        io.emit('live-stats-updated', { connectedUsers, activeHostedLinks });
    }

    io.on('connection', (socket) => {
        socket.on('join-drop-room', (token) => {
            socket.join(`drop:${token}`);
        });

        socket.on('cancel-drop', (token) => {
            io.to(`drop:${token}`).emit('drop-cancelled', token);
        });

        socket.emit('global-stats-updated', globalStats);
        socket.emit('live-stats-updated', { connectedUsers: io.sockets.sockets.size, activeHostedLinks: dropMeta.size });
        broadcastLiveStats();

        const initPublicList = [];
        for (const [, r] of activeRooms.entries()) {
            if (r.isPublic) {
                initPublicList.push({
                    id: r.publicRoomId,
                    roomId: r.publicRoomId,
                    name: r.publicRoomName || '',
                    desc: r.publicRoomDesc || '',
                    peerCount: r.participants || 0
                });
            }
        }
        socket.emit('public-rooms-list', initPublicList);

        socket.on('create-room', (rawId) => {
            const hashedId = hashId(rawId);
            const expiresAt = Date.now() + ROOM_TIMEOUT_MS;
            const timeout = setTimeout(() => {
                if (activeRooms.has(hashedId)) {
                    io.to(hashedId).emit('peer-destroyed-room');
                    activeRooms.delete(hashedId);
                    broadcastPublicRooms();
                }
            }, ROOM_TIMEOUT_MS);

            activeRooms.set(hashedId, {
                timeoutId: timeout,
                expiresAt,
                locked: false,
                participants: 0,
                signalingId: hashedId,
                peers: {},
                inactivityTimeoutMs: 0
            });
            socket.join(hashedId);
            socket.publicHash = hashedId;
            socket.privateHash = hashedId;
        });

        socket.on('join-room', async (signalingId, isCreator, userData) => {
            const publicCode = signalingId.split(':')[0];
            const privateHash = hashId(signalingId);

            let existingRoomEntry = null;
            for (const [hash, r] of activeRooms.entries()) {
                if (r.publicRoomId === publicCode) {
                    existingRoomEntry = { hash, room: r };
                    break;
                }
            }

            let room;
            if (existingRoomEntry) {
                if (existingRoomEntry.hash !== privateHash) {
                    if (!isCreator) {
                        socket.emit('secret-mismatch');
                    } else {
                        socket.emit('room-locked');
                    }
                    return;
                }
                room = existingRoomEntry.room;
            } else {
                if (!isCreator) {
                    socket.emit('room-not-found');
                    return;
                }
                const expiresAt = Date.now() + ROOM_TIMEOUT_MS;
                const timeout = setTimeout(() => {
                    if (activeRooms.has(privateHash)) {
                        io.to(privateHash).emit('peer-destroyed-room');
                        activeRooms.delete(privateHash);
                        broadcastPublicRooms();
                    }
                }, ROOM_TIMEOUT_MS);
                room = {
                    timeoutId: timeout,
                    expiresAt,
                    locked: false,
                    participants: 0,
                    signalingId: privateHash,
                    peers: {},
                    chatHistory: [],
                    inactivityTimeoutMs: (userData && userData.inactivity) ? (parseInt(userData.inactivity) * 60 * 1000) : 0,
                    isPublic: !!(userData && userData.isPublic),
                    publicRoomId: publicCode,
                    publicRoomName: (userData && userData.roomName) ? userData.roomName.substring(0, 30) : '',
                    publicRoomDesc: (userData && userData.roomDesc) ? userData.roomDesc.substring(0, 100) : '',
                    scheduleOpen: (userData && userData.scheduleOpen) ? userData.scheduleOpen : null,
                    scheduleClose: (userData && userData.scheduleClose) ? userData.scheduleClose : null,
                    forceSpectatorOnly: !!(userData && userData.forceSpectator)
                };
                if (room.inactivityTimeoutMs > 0) resetInactivityTimer(room, privateHash, privateHash);
                activeRooms.set(privateHash, room);

                if (room.isPublic) {
                    broadcastPublicRooms();
                }
            }

            if (socket.privateHash && socket.privateHash !== privateHash) {
                const oldRoom = activeRooms.get(socket.privateHash);
                if (oldRoom) {
                    oldRoom.participants = Math.max(0, oldRoom.participants - 1);
                    delete oldRoom.peers[socket.id];
                    socket.leave(socket.privateHash);
                    io.to(socket.privateHash).emit('user-left', socket.id);
                }
            }

            let isReconnect = false;
            let existingId = null;
            let isDuplicateTab = false;
            if (userData && userData.persistentId) {
                if (room.disconnectTimeouts && room.disconnectTimeouts.has(userData.persistentId)) {
                    clearTimeout(room.disconnectTimeouts.get(userData.persistentId));
                    room.disconnectTimeouts.delete(userData.persistentId);
                }
                existingId = Object.keys(room.peers).find(pid => {
                    const peer = room.peers[pid];
                    if (!peer || peer.persistentId !== userData.persistentId) return false;
                    if (!userData.tabSessionId || !peer.tabSessionId) return false;
                    return peer.tabSessionId === userData.tabSessionId;
                });
                if (existingId && existingId !== socket.id) {
                    isReconnect = true;
                    const existingPeer = room.peers[existingId];
                    const existingSocket = io.sockets.sockets.get(existingId);
                    isDuplicateTab = !!existingSocket && existingSocket.connected;
                    if (!isDuplicateTab) {
                        room.participants = Math.max(0, room.participants - 1);
                        delete room.peers[existingId];
                        io.to(privateHash).emit('user-left', existingId, 'reconnect');
                    }
                    if (isDuplicateTab && existingPeer) {
                        socket.emit('duplicate-tab-joined', {
                            name: existingPeer.name,
                            persistentId: existingPeer.persistentId,
                            primarySocketId: existingId
                        });
                    }
                }
            }

            const isSpectator = !!(userData && userData.isSpectator);

            if (!room.peers[socket.id]) {
                if (isSpectator) {
                    const spectatorCount = Object.values(room.peers).filter(p => p.isSpectator).length;
                    if (spectatorCount >= 5) {
                        socket.emit('room-locked');
                        return;
                    }
                } else {
                    if (room.participants >= 5) {
                        socket.emit('room-locked');
                        return;
                    }
                    room.participants += 1;
                }
            }

            if (!room.isSafetyTimer) {
                clearTimeout(room.timeoutId);
                room.expiresAt = null;
            }

            const metadata = {
                id: socket.id,
                name: userData ? userData.name : `User ${socket.id.substring(0, 4)}`,
                persistentId: userData ? userData.persistentId : null,
                tabSessionId: userData ? userData.tabSessionId : null,
                isReconnect: isReconnect,
                isShadowTab: isDuplicateTab,
                primarySocketId: isDuplicateTab ? existingId : null,
                isSpectator: isSpectator
            };
            socket.isSpectator = isSpectator;
            socket.isCreator = !!isCreator;
            room.peers[socket.id] = metadata;

            activeRooms.set(privateHash, room);
            await socket.join(privateHash);
            socket.publicHash = publicCode;
            socket.privateHash = privateHash;
            socket.persistentId = userData ? userData.persistentId : null;

            socket.userName = metadata.name;

            const currentExpiresAt = room.expiresAt;
            let inactivityWarningAt = null;
            let inactivityExpiresAt = null;
            if (room.inactivityTimeoutMs > 0 && room.lastInactivityResetAt) {
                inactivityWarningAt = room.lastInactivityResetAt + INACTIVITY_IDLE_TRIGGER_MS;
                inactivityExpiresAt = inactivityWarningAt + room.inactivityTimeoutMs;
            }

            io.to(privateHash).emit('room-metadata', {
                expiresAt: currentExpiresAt,
                inactivityWarningAt,
                inactivityExpiresAt,
                isSafetyTimer: !!room.isSafetyTimer,
                serverTime: Date.now()
            });

            if (room.inactivityTimeoutMs > 0) resetInactivityTimer(room, privateHash, privateHash);

            if (!metadata.isShadowTab) {
                socket.to(privateHash).emit('user-joined', metadata);
            }
            io.to(privateHash).emit('peer-list', getVisiblePeers(room));

            if (room.chatHistory.length > 0) {
                socket.emit('chat-history', room.chatHistory);
            }

            if (room.isPublic) {
                broadcastPublicRooms();
            }

            if (isCreator) {
                socket.emit('room-settings', {
                    forceSpectatorOnly: !!room.forceSpectatorOnly
                });
            } else if (room.forceSpectatorOnly && !isSpectator) {
                socket.emit('force-spectator-mode');
            }
        });

        socket.on('name-change', (newName) => {
            if (!newName || typeof newName !== 'string') return;
            const privateHash = socket.privateHash;
            if (privateHash && activeRooms.has(privateHash)) {
                const room = activeRooms.get(privateHash);
                if (room.peers[socket.id]) {
                    room.peers[socket.id].name = newName;
                    socket.userName = newName;
                    if (room.inactivityTimeoutMs > 0) {
                        resetInactivityTimer(room, privateHash, privateHash);
                    }
                    io.to(privateHash).emit('peer-list', getVisiblePeers(room));
                }
            }
        });

        socket.on('offer', (offer, rawId, targetId) => {
            if (targetId) {
                io.to(targetId).emit('offer', offer, socket.id, socket.userName);
            } else {
                socket.to(hashId(rawId)).emit('offer', offer, socket.id, socket.userName);
            }
        });

        socket.on('answer', (answer, rawId, targetId) => {
            if (targetId) {
                io.to(targetId).emit('answer', answer, socket.id);
            } else {
                socket.to(hashId(rawId)).emit('answer', answer, socket.id);
            }
        });

        socket.on('ice-candidate', (candidate, rawId, targetId) => {
            const privateHash = socket.privateHash;
            if (privateHash && activeRooms.has(privateHash)) {
                resetInactivityTimer(activeRooms.get(privateHash), privateHash, privateHash);
            }
            if (targetId) {
                io.to(targetId).emit('ice-candidate', candidate, socket.id);
            } else {
                socket.to(hashId(rawId)).emit('ice-candidate', candidate, socket.id);
            }
        });

        socket.on('chat-envelope', (payload, rawId, targetId) => {
            if (socket.isSpectator) return;
            const privateHash = socket.privateHash;
            if (privateHash && activeRooms.has(privateHash)) {
                resetInactivityTimer(activeRooms.get(privateHash), privateHash, privateHash);
            }
            if (targetId) {
                io.to(targetId).emit('chat-envelope', payload, socket.id);
            } else {
                socket.to(hashId(rawId)).emit('chat-envelope', payload, socket.id);
            }
        });

        socket.on('transfer-complete', (data) => {
            if (data && typeof data.bytes === 'number') {
                globalStats.bytesTransferred += data.bytes;
                globalStats.filesTransferred += 1;
                const privateHash = socket.privateHash;
                if (privateHash && activeRooms.has(privateHash)) {
                    resetInactivityTimer(activeRooms.get(privateHash), privateHash, privateHash);
                }
                io.emit('global-stats-updated', globalStats);
            }
        });

        socket.on('record-stat', (data) => {
            if (data && typeof data.bytes === 'number') {
                globalStats.bytesTransferred += data.bytes;
                globalStats.filesTransferred += 1;
                const privateHash = socket.privateHash;
                if (privateHash && activeRooms.has(privateHash)) {
                    resetInactivityTimer(activeRooms.get(privateHash), privateHash, privateHash);
                }
                io.emit('global-stats-updated', globalStats);
            }
        });

        socket.on('peer-destroy-request', (rawId) => {
            socket.to(hashId(rawId)).emit('peer-destroy-request');
        });

        socket.on('reset-inactivity', () => {
            const privateHash = socket.privateHash;
            if (privateHash && activeRooms.has(privateHash)) {
                const room = activeRooms.get(privateHash);
                if (room.inactivityTimeoutMs > 0) {
                    resetInactivityTimer(room, privateHash, privateHash);
                }
            }
        });

        socket.on('list-public-rooms', () => {
            const list = [];
            for (const [hash, r] of activeRooms.entries()) {
                if (r.isPublic) {
                    list.push({
                        id: r.publicRoomId,
                        roomId: r.publicRoomId,
                        name: r.publicRoomName || '',
                        desc: r.publicRoomDesc || '',
                        peerCount: r.participants || 0
                    });
                }
            }
            socket.emit('public-rooms-list', list);
        });

        socket.on('request-destruction', (persistentId) => {
            const privateHash = socket.privateHash;
            if (privateHash && activeRooms.has(privateHash)) {
                const room = activeRooms.get(privateHash);
                room.destructionVotes = new Set([socket.id]);
                room.destructionRequesterPersistentId = persistentId;
                room.destructionRequesterName = socket.userName;
                const { requiredVotes, acceptedNames, pendingNames } = getDestroyVoteState(room);
                io.to(privateHash).emit('destruction-requested', socket.userName, persistentId);
                io.to(privateHash).emit('destruction-vote-update', {
                    accepted: room.destructionVotes.size,
                    required: requiredVotes,
                    requesterName: socket.userName,
                    acceptedNames,
                    pendingNames
                });
            }
        });

        socket.on('peer-destroy-accept', (rawId) => {
            const privateHash = socket.privateHash || (rawId ? hashId(rawId) : null);
            if (privateHash && activeRooms.has(privateHash)) {
                const room = activeRooms.get(privateHash);
                if (!room.destructionVotes) room.destructionVotes = new Set();
                if (room.peers[socket.id]?.isShadowTab) return;

                room.destructionVotes.add(socket.id);

                const { requiredVotes, acceptedNames, pendingNames } = getDestroyVoteState(room);
                io.to(privateHash).emit('destruction-vote-update', {
                    accepted: room.destructionVotes.size,
                    required: requiredVotes,
                    requesterName: room.destructionRequesterName || socket.userName,
                    acceptedNames,
                    pendingNames
                });

                if (room.destructionVotes.size >= requiredVotes) {
                    clearTimeout(room.timeoutId);
                    activeRooms.delete(privateHash);
                    io.to(privateHash).emit('peer-destroyed-room');
                    broadcastPublicRooms();
                    io.emit('global-stats-updated', globalStats);
                }
            }
        });

        socket.on('peer-destroy-reject', () => {
            const privateHash = socket.privateHash;
            if (privateHash && activeRooms.has(privateHash)) {
                const room = activeRooms.get(privateHash);
                room.destructionVotes = null;
                room.destructionRequesterName = null;
                io.to(privateHash).emit('peer-destroy-reject', socket.userName);
            }
        });

        socket.on('chat-message', (msg) => {
            if (socket.isSpectator) return;
            const privateHash = socket.privateHash;
            if (privateHash && activeRooms.has(privateHash)) {
                const room = activeRooms.get(privateHash);
                const chatMsg = {
                    senderId: socket.id,
                    senderName: socket.userName,
                    text: msg.text,
                    timestamp: Date.now(),
                    ephemeral: !!msg.ephemeral,
                    msgId: msg.msgId || null
                };
                if (!msg.ephemeral) {
                    room.chatHistory.push(chatMsg);
                    if (room.chatHistory.length > 50) room.chatHistory.shift();
                }
                if (room.inactivityTimeoutMs > 0) {
                    resetInactivityTimer(room, privateHash, privateHash);
                }
                socket.to(privateHash).emit('chat-message', chatMsg);
            }
        });

        socket.on('message-read', (msgId) => {
            const privateHash = socket.privateHash;
            if (privateHash) {
                socket.to(privateHash).emit('message-read', msgId);
            }
        });

        socket.on('typing-start', () => {
            const privateHash = socket.privateHash;
            if (socket.isSpectator || !privateHash) return;
            socket.to(privateHash).emit('typing-start', socket.id, socket.userName);
        });

        socket.on('typing-stop', () => {
            const privateHash = socket.privateHash;
            if (!privateHash) return;
            socket.to(privateHash).emit('typing-stop', socket.id);
        });

        socket.on('destroy-room', (signalingId) => {
            const privateHash = hashId(signalingId);
            if (activeRooms.has(privateHash)) {
                const room = activeRooms.get(privateHash);
                clearTimeout(room.timeoutId);
                activeRooms.delete(privateHash);
                io.to(privateHash).emit('peer-destroyed-room');
                broadcastPublicRooms();
            }
        });

        socket.on('set-force-spectator', (enabled) => {
            const privateHash = socket.privateHash;
            if (privateHash && activeRooms.has(privateHash) && socket.isCreator) {
                const room = activeRooms.get(privateHash);
                room.forceSpectatorOnly = !!enabled;
                io.to(privateHash).emit('room-settings-update', { forceSpectatorOnly: room.forceSpectatorOnly });
                if (room.isPublic) broadcastPublicRooms();
            }
        });

        socket.on('leave-room', (signalingId, options = {}) => {
            const privateHash = hashId(signalingId);
            const room = activeRooms.get(privateHash);
            if (!room) return;

            if (room.peers && room.peers[socket.id]) {
                if (!room.peers[socket.id].isShadowTab) {
                    room.participants = Math.max(0, room.participants - 1);
                }
                delete room.peers[socket.id];
            }

            if (options.reason === 'kicked') socket.wasKicked = true;

            io.to(privateHash).emit('user-left', socket.id, options.reason);
            io.to(privateHash).emit('peer-list', getVisiblePeers(room));

            socket.publicHash = null;
            socket.privateHash = null;
            if (options.strategy === 'immediate') {
                clearTimeout(room.timeoutId);
                activeRooms.delete(privateHash);
                io.to(privateHash).emit('peer-destroyed-room');
                broadcastPublicRooms();
            } else if (options.strategy === 'on-peer-exit') {
                clearTimeout(room.timeoutId);
                room.expiresAt = null;
                room.isSafetyTimer = false;
                activeRooms.set(privateHash, room);
                io.to(privateHash).emit('room-metadata', { expiresAt: null, isSafetyTimer: false, serverTime: Date.now() });
            } else if (options.strategy === 'timer' && options.duration) {
                clearTimeout(room.timeoutId);
                const expiresAt = Date.now() + options.duration;
                room.expiresAt = expiresAt;
                room.isSafetyTimer = true;
                room.timeoutId = setTimeout(() => {
                    if (activeRooms.has(privateHash)) {
                        io.to(privateHash).emit('peer-destroyed-room');
                        activeRooms.delete(privateHash);
                        broadcastPublicRooms();
                    }
                }, options.duration);
                activeRooms.set(privateHash, room);
                io.to(privateHash).emit('room-metadata', { expiresAt, isSafetyTimer: true, serverTime: Date.now() });
            } else if (room.participants === 0) {
                if (!room.isSafetyTimer) {
                    clearTimeout(room.timeoutId);
                    room.timeoutId = setTimeout(() => {
                        if (activeRooms.has(privateHash) && activeRooms.get(privateHash).participants === 0) {
                            activeRooms.delete(privateHash);
                        }
                    }, ROOM_TIMEOUT_MS);
                }
            }

            socket.leave(privateHash);
        });

        socket.on('ecdh-public-key', (jwkPublicKey, rawId, targetId) => {
            if (targetId) {
                io.to(targetId).emit('ecdh-public-key', jwkPublicKey, socket.id);
            } else {
                socket.to(hashId(rawId)).emit('ecdh-public-key', jwkPublicKey, socket.id);
            }
        });

        socket.on('disconnect', () => {
            if (socket.privateHash && activeRooms.has(socket.privateHash)) {
                const privateHash = socket.privateHash;
                const room = activeRooms.get(privateHash);
                const persistentId = socket.persistentId;

                if (persistentId) {
                    room.disconnectTimeouts = room.disconnectTimeouts || new Map();
                    if (room.disconnectTimeouts.has(persistentId)) {
                        clearTimeout(room.disconnectTimeouts.get(persistentId));
                    }
                    if (room.peers[socket.id]) {
                        room.peers[socket.id].reconnecting = true;
                    }
                    io.to(privateHash).emit('peer-list', getVisiblePeers(room));
                    const timeoutId = setTimeout(() => {
                        room.disconnectTimeouts.delete(persistentId);
                        if (room.peers[socket.id]) {
                            if (!room.peers[socket.id].isShadowTab) {
                                room.participants = Math.max(0, room.participants - 1);
                            }
                            delete room.peers[socket.id];
                        }
                        io.to(privateHash).emit('user-left', socket.id);
                        io.to(privateHash).emit('peer-list', getVisiblePeers(room));

                        if (room.participants === 0) {
                            clearTimeout(room.timeoutId);
                            room.timeoutId = setTimeout(() => {
                                if (activeRooms.has(privateHash) && activeRooms.get(privateHash).participants === 0) {
                                    activeRooms.delete(privateHash);
                                }
                            }, ROOM_TIMEOUT_MS);
                        }
                    }, 15000);
                    room.disconnectTimeouts.set(persistentId, timeoutId);
                } else {
                    if (!room.peers[socket.id]?.isShadowTab) {
                        room.participants = Math.max(0, room.participants - 1);
                    }
                    if (room.peers) delete room.peers[socket.id];

                    const reason = socket.wasKicked ? 'kicked' : null;
                    io.to(privateHash).emit('user-left', socket.id, reason);
                    io.to(privateHash).emit('peer-list', getVisiblePeers(room));

                    if (room.participants === 0) {
                        clearTimeout(room.timeoutId);
                        room.timeoutId = setTimeout(() => {
                            if (activeRooms.has(privateHash) && activeRooms.get(privateHash).participants === 0) {
                                activeRooms.delete(privateHash);
                            }
                        }, ROOM_TIMEOUT_MS);
                    }
                }
            }
            broadcastLiveStats();
        });
    });

    function makeForever(fileToken) {
        const srcPath = path.join(DROPS_DIR, fileToken);
        const destPath = path.join(FOREVER_FILES_DIR, fileToken);
        if (fs.existsSync(srcPath)) {
            fs.cpSync(srcPath, destPath, { recursive: true });
            try {
                const stat = fs.lstatSync(srcPath);
                if (stat.isDirectory()) fs.rmSync(srcPath, { recursive: true, force: true });
                else fs.unlinkSync(srcPath);
            } catch (e) {}
        }
        const srcMeta = getLegacyMetaPath(fileToken);
        const destMeta = path.join(FOREVER_FILES_DIR, `${fileToken}.meta.json`);
        if (fs.existsSync(srcMeta)) {
            fs.cpSync(srcMeta, destMeta);
            try { fs.unlinkSync(srcMeta); } catch (e) {}
        }
    }

    app.get('/@:username', (req, res) => {
        res.status(404).send('Not found');
    });

    app.get('/drop.html', (req, res) => {
        res.sendFile(path.join(__dirname, 'drop.html'));
    });

    app.get(/.*/, (req, res) => {
        res.sendFile(path.join(__dirname, 'index.html'));
    });

    if (isNaN(port)) {
        server.listen(port, () => {
            const protocol = fs.existsSync(path.join(__dirname, 'server.pfx')) ? 'https' : 'http';
            console.log(`Server running on ${protocol} pipe ${port}`);
        });
    } else {
        server.listen(port, '0.0.0.0', () => {
            const protocol = fs.existsSync(path.join(__dirname, 'server.pfx')) ? 'https' : 'http';
            console.log(`Server running on ${protocol}://localhost:${port}`);
        });
    }

    return server;
}

startServer(process.env.PORT || 8080);

module.exports = { startServer };
