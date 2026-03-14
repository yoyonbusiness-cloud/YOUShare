const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');

const DROPS_DIR = path.join(__dirname, 'drops');
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

app.use(express.static(path.join(__dirname, 'public')));


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
   
    socket.emit('global-stats-updated', globalStats);

    socket.on('create-room', (rawId) => {
        const hashedId = hashId(rawId);
        
        const timeout = setTimeout(() => {
            if (activeRooms.has(hashedId)) {
                io.to(hashedId).emit('room-expired');
                activeRooms.delete(hashedId);
            }
        }, ROOM_TIMEOUT_MS);

        activeRooms.set(hashedId, {
            timeoutId: timeout,
            locked: false,
            participants: 1
        });

        socket.join(hashedId);
    });

    socket.on('join-room', (signalingId) => {
        const publicCode = signalingId.split(':')[0];
        const publicHash = hashId(publicCode);
        const privateHash = hashId(signalingId);

        let room = activeRooms.get(publicHash);

        if (!room) {
            const timeout = setTimeout(() => {
                if (activeRooms.has(publicHash)) {
                    io.to(activeRooms.get(publicHash).signalingId).emit('room-expired');
                    activeRooms.delete(publicHash);
                }
            }, ROOM_TIMEOUT_MS);

            activeRooms.set(publicHash, {
                timeoutId: timeout,
                locked: false,
                participants: 1,
                signalingId: privateHash
            });
            socket.join(privateHash);
            return;
        }

        if (room.signalingId !== privateHash) {
            socket.emit('secret-mismatch');
            return;
        }

        if (room.locked || room.participants >= 2) {
            socket.emit('room-locked');
            return;
        }

        clearTimeout(room.timeoutId);
        room.locked = true;
        room.participants += 1;
        activeRooms.set(publicHash, room);

        socket.join(privateHash);
        socket.to(privateHash).emit('user-joined', socket.id);
    });

    socket.on('offer', (offer, rawId) => {
        socket.to(hashId(rawId)).emit('offer', offer, socket.id);
    });

    socket.on('answer', (answer, rawId) => {
        socket.to(hashId(rawId)).emit('answer', answer, socket.id);
    });

    socket.on('ice-candidate', (candidate, rawId) => {
        socket.to(hashId(rawId)).emit('ice-candidate', candidate, socket.id);
    });

   
    socket.on('record-stat', (data) => {
        if (data && typeof data.bytes === 'number') {
            globalStats.bytesTransferred += data.bytes;
            globalStats.filesTransferred += 1;
            io.emit('global-stats-updated', globalStats);
        }
    });

   
    socket.on('peer-destroy-request', (rawId) => {
        socket.to(hashId(rawId)).emit('peer-destroy-request');
    });

    socket.on('destroy-room', (signalingId) => {
        const publicHash = hashId(signalingId.split(':')[0]);
        const privateHash = hashId(signalingId);
        
        if (activeRooms.has(publicHash)) {
            const room = activeRooms.get(publicHash);
            clearTimeout(room.timeoutId);
            activeRooms.delete(publicHash);
            io.to(privateHash).emit('peer-destroyed-room');
        }
    });

    socket.on('leave-room', (signalingId, options = {}) => {
        const publicHash = hashId(signalingId.split(':')[0]);
        const privateHash = hashId(signalingId);
        const room = activeRooms.get(publicHash);
        if (!room) return;

        room.participants -= 1;
        socket.leave(privateHash);

        if (options.strategy === 'timer' && options.duration) {
            clearTimeout(room.timeoutId);
            room.timeoutId = setTimeout(() => {
                if (activeRooms.has(publicHash)) {
                    io.to(privateHash).emit('room-expired');
                    activeRooms.delete(publicHash);
                }
            }, options.duration);
            activeRooms.set(publicHash, room);
        } else if (room.participants <= 0 || options.strategy === 'immediate') {
            clearTimeout(room.timeoutId);
            activeRooms.delete(publicHash);
            io.to(privateHash).emit('peer-destroyed-room');
        }
    });

   
    socket.on('ecdh-public-key', (jwkPublicKey, rawId) => {
        socket.to(hashId(rawId)).emit('ecdh-public-key', jwkPublicKey);
    });

    socket.on('disconnect', () => {
       
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on port ${PORT}`);
    console.log(`Access locally at: http://localhost:${PORT}`);
   
    const { networkInterfaces } = require('os');
    const nets = networkInterfaces();
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family === 'IPv4' && !net.internal) {
                console.log(`Access on network at: http://${net.address}:${PORT}`);
            }
        }
    }
});
