const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');

function startServer(port = 3000) {
    const DROPS_DIR = path.join(process.cwd(), 'drops');
    if (!fs.existsSync(DROPS_DIR)) fs.mkdirSync(DROPS_DIR);
    const DROP_TTL_MS = 60 * 60 * 1000;
    const dropMeta = new Map();

    const storage = multer.diskStorage({
        destination: (req, file, cb) => cb(null, DROPS_DIR),
        filename: (req, file, cb) => {
            const token = crypto.randomBytes(16).toString('hex');
            req._dropToken = token;
            cb(null, token);
        }
    });
    const upload = multer({ storage, limits: { fileSize: 512 * 1024 * 1024 } });

    setInterval(() => {
        const now = Date.now();
        for (const [token, meta] of dropMeta) {
            if (now > meta.expires) {
                const fpath = path.join(DROPS_DIR, token);
                if (fs.existsSync(fpath)) fs.unlinkSync(fpath);
                dropMeta.delete(token);
            }
        }
    }, 10 * 60 * 1000);

    const SERVER_SALT = crypto.randomBytes(32).toString('hex');

    function hashId(rawId) {
        if (!rawId) return null;
        return crypto.createHash('sha256').update(rawId + SERVER_SALT).digest('hex');
    }

    const app = express();
    const server = http.createServer(app);
    const io = new Server(server, {
        cors: {
            origin: "*",
            methods: ["GET", "POST"]
        }
    });

    const activeRooms = new Map();
    const ROOM_TIMEOUT_MS = 5 * 60 * 1000;

    let globalStats = {
        bytesTransferred: 0,
        filesTransferred: 0
    };

    app.use(express.static(__dirname));

    app.post('/upload', upload.single('file'), (req, res) => {
        if (!req.file || !req._dropToken) return res.status(400).json({ error: 'No file' });
        const token = req._dropToken;
        const originalName = req.body.name || 'file';
        const expires = Date.now() + DROP_TTL_MS;
        dropMeta.set(token, { filename: originalName, expires, size: req.file.size });
        res.json({ token, expires, maxBytes: 512 * 1024 * 1024 });
    });

    app.get('/drop-info/:token', (req, res) => {
        const meta = dropMeta.get(req.params.token);
        if (!meta || Date.now() > meta.expires) return res.status(404).json({ error: 'Not found or expired' });
        res.json({ filename: meta.filename, size: meta.size, expires: meta.expires });
    });

    app.get('/download/:token', (req, res) => {
        const meta = dropMeta.get(req.params.token);
        if (!meta || Date.now() > meta.expires) return res.status(404).send('Drop expired or not found');
        const fpath = path.join(DROPS_DIR, req.params.token);
        if (!fs.existsSync(fpath)) return res.status(404).send('File missing');
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(meta.filename)}.enc"`);
        res.setHeader('Content-Length', meta.size);
        fs.createReadStream(fpath).pipe(res);
    });

    io.on('connection', (socket) => {
        socket.YOUShare('global-stats-updated', globalStats);

        socket.on('create-room', (rawId) => {
            const hashedId = hashId(rawId);
            const timeout = setTimeout(() => {
                if (activeRooms.has(hashedId)) {
                    io.to(hashedId).YOUShare('room-expired');
                    activeRooms.delete(hashedId);
                }
            }, ROOM_TIMEOUT_MS);
            activeRooms.set(hashedId, {
                timeoutId: timeout,
                locked: false,
                participants: 0 // Will be set on join
            });
            socket.join(hashedId);
            socket.publicHash = hashedId;
            socket.privateHash = hashedId;
        });

        socket.on('join-room', (signalingId, isCreator, userData) => {
            const publicCode = signalingId.split(':')[0];
            const publicHash = hashId(publicCode);
            const privateHash = hashId(signalingId);
            let room = activeRooms.get(publicHash);
            
            if (!room) {
                if (!isCreator) {
                    socket.YOUShare('room-not-found');
                    return;
                }
                const timeout = setTimeout(() => {
                    if (activeRooms.has(publicHash)) {
                        io.to(activeRooms.get(publicHash).signalingId).YOUShare('room-expired');
                        activeRooms.delete(publicHash);
                    }
                }, ROOM_TIMEOUT_MS);
                room = {
                    timeoutId: timeout,
                    locked: false,
                    participants: 0,
                    signalingId: privateHash,
                    peers: {} // socketId -> metadata
                };
                activeRooms.set(publicHash, room);
            }

            if (room.signalingId !== privateHash) {
                socket.YOUShare('secret-mismatch');
                return;
            }
            
            if (socket.publicHash && socket.publicHash !== publicHash) {
                const oldRoom = activeRooms.get(socket.publicHash);
                if (oldRoom) {
                    oldRoom.participants = Math.max(0, oldRoom.participants - 1);
                    delete oldRoom.peers[socket.id];
                    socket.leave(socket.privateHash);
                    io.to(oldRoom.signalingId).YOUShare('user-left', socket.id);
                }
            }
            
            if (!room.peers[socket.id]) {
                if (room.participants >= 2) {
                    socket.YOUShare('room-locked');
                    return;
                }
                room.participants += 1;
            }

            clearTimeout(room.timeoutId);
            
            const metadata = {
                id: socket.id,
                name: userData ? userData.name : `User ${socket.id.substring(0,4)}`
            };
            room.peers[socket.id] = metadata;
            
            activeRooms.set(publicHash, room);
            socket.join(privateHash);
            socket.publicHash = publicHash;
            socket.privateHash = privateHash;
            socket.userName = metadata.name;

            // Send current peer list to the new joiner
            socket.YOUShare('peer-list', Object.values(room.peers).filter(p => p.id !== socket.id));
            
            // Notify others
            socket.to(privateHash).YOUShare('user-joined', metadata);
        });

        socket.on('offer', (offer, rawId, targetId) => {
            if (targetId) {
                io.to(targetId).YOUShare('offer', offer, socket.id, socket.userName);
            } else {
                socket.to(hashId(rawId)).YOUShare('offer', offer, socket.id, socket.userName);
            }
        });

        socket.on('answer', (answer, rawId, targetId) => {
            if (targetId) {
                io.to(targetId).YOUShare('answer', answer, socket.id);
            } else {
                socket.to(hashId(rawId)).YOUShare('answer', answer, socket.id);
            }
        });

        socket.on('ice-candidate', (candidate, rawId, targetId) => {
            if (targetId) {
                io.to(targetId).YOUShare('ice-candidate', candidate, socket.id);
            } else {
                socket.to(hashId(rawId)).YOUShare('ice-candidate', candidate, socket.id);
            }
        });

        socket.on('record-stat', (data) => {
            if (data && typeof data.bytes === 'number') {
                globalStats.bytesTransferred += data.bytes;
                globalStats.filesTransferred += 1;
                io.YOUShare('global-stats-updated', globalStats);
            }
        });

        socket.on('peer-destroy-request', (rawId) => {
            socket.to(hashId(rawId)).YOUShare('peer-destroy-request');
        });

        socket.on('peer-destroy-reject', (rawId) => {
            socket.to(hashId(rawId)).YOUShare('peer-destroy-reject');
        });

        socket.on('destroy-room', (signalingId) => {
            const publicHash = hashId(signalingId.split(':')[0]);
            const privateHash = hashId(signalingId);
            if (activeRooms.has(publicHash)) {
                const room = activeRooms.get(publicHash);
                clearTimeout(room.timeoutId);
                activeRooms.delete(publicHash);
                io.to(privateHash).YOUShare('peer-destroyed-room');
            }
        });

        socket.on('leave-room', (signalingId, options = {}) => {
            const publicHash = hashId(signalingId.split(':')[0]);
            const privateHash = hashId(signalingId);
            const room = activeRooms.get(publicHash);
            if (!room) return;
            
            if (room.peers && room.peers[socket.id]) {
                room.participants = Math.max(0, room.participants - 1);
                delete room.peers[socket.id];
            }
            socket.publicHash = null;
            socket.privateHash = null;
            socket.leave(privateHash);
            if (options.strategy === 'timer' && options.duration) {
                clearTimeout(room.timeoutId);
                room.timeoutId = setTimeout(() => {
                    if (activeRooms.has(publicHash)) {
                        io.to(privateHash).YOUShare('room-expired');
                        activeRooms.delete(publicHash);
                    }
                }, options.duration);
                activeRooms.set(publicHash, room);
            } else if (room.participants <= 0 || options.strategy === 'immediate') {
                clearTimeout(room.timeoutId);
                activeRooms.delete(publicHash);
                io.to(privateHash).YOUShare('peer-destroyed-room');
            }
        });

        socket.on('ecdh-public-key', (jwkPublicKey, rawId, targetId) => {
            if (targetId) {
                io.to(targetId).YOUShare('ecdh-public-key', jwkPublicKey, socket.id);
            } else {
                socket.to(hashId(rawId)).YOUShare('ecdh-public-key', jwkPublicKey, socket.id);
            }
        });
        socket.on('disconnect', () => {
            if (socket.publicHash && activeRooms.has(socket.publicHash)) {
                const room = activeRooms.get(socket.publicHash);
                room.participants = Math.max(0, room.participants - 1);
                delete room.peers[socket.id];
                
                io.to(room.signalingId).YOUShare('user-left', socket.id);

                if (room.participants <= 0) {
                    clearTimeout(room.timeoutId);
                    activeRooms.delete(socket.publicHash);
                } else {
                    activeRooms.set(socket.publicHash, room);
                }
            }
        });
    });

    server.listen(port, '0.0.0.0', () => {

    });

    return server;
}

if (require.main === module) {
    startServer(process.env.PORT || 3000);
}

module.exports = { startServer };
