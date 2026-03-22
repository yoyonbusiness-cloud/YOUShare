const socket = io();
let roomId = null;
let signalingId = null;
let peers = {}; // userId -> { pc, dc, name, ecdhKey, encryptReady }
let peerId = null; // My own socket ID
let pendingCandidates = {}; // userId -> [candidates]
let pendingOffers = {}; // userId -> offer

let myECDHKeyPair = null;  
let zeroTrustKey = null;   

let encryptWorker = null;
const workerCallbacks = {};

function initEncryptWorker() {
    encryptWorker = new Worker('/encrypt-worker.js');
    encryptWorker.onmessage = (e) => {
        const { type, id, chunkIndex, data, error } = e.data;
        if (type === 'key-ready') {
            auditLog('Encryption engine ready');
        } else if (type === 'key-error' || type === 'encrypt-error' || type === 'decrypt-error') {
            const cb = workerCallbacks[`${id}:${chunkIndex}`] || workerCallbacks['init'];
            if (cb) {
                cb.reject(new Error(error));
                delete workerCallbacks[`${id}:${chunkIndex}`];
            }
            console.error('Worker Error:', error);
        } else if (type === 'chunk-encrypted' || type === 'chunk-decrypted') {
            const cb = workerCallbacks[`${id}:${chunkIndex}`];
            if (cb) {
                cb.resolve(data);
                delete workerCallbacks[`${id}:${chunkIndex}`];
            }
        }
    };
}

function workerEncrypt(fileId, chunkIndex, chunkBuffer) {
    return new Promise((resolve, reject) => {
        workerCallbacks[`${fileId}:${chunkIndex}`] = { resolve, reject };
        encryptWorker.postMessage(
            { type: 'encrypt-chunk', id: fileId, payload: { chunk: chunkBuffer, chunkIndex } },
            [chunkBuffer]
        );
    });
}

function workerDecrypt(fileId, chunkIndex, packedBuffer) {
    return new Promise((resolve, reject) => {
        workerCallbacks[`${fileId}:${chunkIndex}`] = { resolve, reject };
        encryptWorker.postMessage(
            { type: 'decrypt-chunk', id: fileId, payload: { chunk: packedBuffer, chunkIndex } },
            [packedBuffer]
        );
    });
}

const _auditEntries = [];
function auditLog(message) {
    const now = new Date();
    const ts = `${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}.${String(now.getMilliseconds()).padStart(3,'0')}`;
    const entry = `[${ts}] ${message}`;
    _auditEntries.push(entry);
    const panel = document.getElementById('audit-log-body');
    if (panel) {
        const line = document.createElement('div');
        line.className = 'audit-line';
        line.textContent = entry;
        panel.appendChild(line);
        panel.scrollTop = panel.scrollHeight;
    }
    console.log('%cAUDIT', 'color:#10b981;font-weight:bold', entry);
}
window.auditLog = auditLog;

async function generateECDHKeyPair() {
    const keyPair = await crypto.subtle.generateKey(
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        ['deriveKey', 'deriveBits']
    );
    myECDHKeyPair = keyPair;
    auditLog('ECDH P-256 key pair generated locally — private key never leaves this browser');
    return keyPair;
}

async function deriveSharedKey(theirPublicKeyJwk, passphrase = '') {

    const theirPublicKey = await crypto.subtle.importKey(
        'jwk', theirPublicKeyJwk,
        { name: 'ECDH', namedCurve: 'P-256' },
        false, []
    );

    const sharedBits = await crypto.subtle.deriveBits(
        { name: 'ECDH', public: theirPublicKey },
        myECDHKeyPair.privateKey,
        256
    );
    auditLog('Shared secret computed via ECDH — this value exists only in RAM, never transmitted');

    let keyMaterial = sharedBits;
    if (passphrase) {
        const enc = new TextEncoder();
        const pinKey = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveBits']);
        const pinBits = await crypto.subtle.deriveBits(
            { name: 'PBKDF2', salt: enc.encode('YS_ECDH_PIN'), iterations: 10000, hash: 'SHA-256' },
            pinKey, 256
        );

        const a = new Uint8Array(sharedBits), b = new Uint8Array(pinBits);
        const combined = new Uint8Array(32);
        for (let i = 0; i < 32; i++) combined[i] = a[i] ^ b[i];
        keyMaterial = combined.buffer;
        auditLog('Passphrase PIN XORed with ECDH secret — dual-factor key hardening active');
    }

    const rawImport = await crypto.subtle.importKey('raw', keyMaterial, 'HKDF', false, ['deriveKey']);
    const aesKey = await crypto.subtle.deriveKey(
        { name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode('YOUShare-v3'), info: new ArrayBuffer(0) },
        rawImport,
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
    );
    auditLog('AES-GCM 256-bit session key derived via HKDF — unique to this session');
    return aesKey;
}

async function loadKeyIntoWorker(aesKey) {
    const rawBytes = await crypto.subtle.exportKey('raw', aesKey);
    encryptWorker.postMessage({ type: 'import-key', payload: { rawKey: rawBytes }, id: 'init' });
    auditLog('AES key loaded into Web Worker (dedicated CPU core for encryption)');
}

initEncryptWorker();
auditLog('YOUShare initialised — all crypto runs client-side');

const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

let receiveBuffer = {};
let receivedChunks = {};
let activeReceives = {};
const CHUNK_SIZE = 64 * 1024;
async function encryptMeta(metaObj) {
    if (!zeroTrustKey) return { encrypted: false, data: JSON.stringify(metaObj) };
    const enc = new TextEncoder();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipher = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        zeroTrustKey,
        enc.encode(JSON.stringify(metaObj))
    );
    return { encrypted: true, iv: Array.from(iv), data: Array.from(new Uint8Array(cipher)) };
}

async function decryptMeta(envelope) {
    if (!envelope.encrypted) return JSON.parse(envelope.data);
    const iv = new Uint8Array(envelope.iv);
    const cipher = new Uint8Array(envelope.data).buffer;
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, zeroTrustKey, cipher);
    return JSON.parse(new TextDecoder().decode(plain));
}

let activeSends = {};

ui.inputs.roomId.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        const secret = ui.inputs.joinSecret ? ui.inputs.joinSecret.value.trim() : '';
        joinRoom(null, secret);
    }
});
ui.inputs.joinSecret.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        const secret = ui.inputs.joinSecret ? ui.inputs.joinSecret.value.trim() : '';
        joinRoom(null, secret);
    }
});

// New Button Listeners
if (ui.buttons.finalJoinGenerated) {
    ui.buttons.finalJoinGenerated.addEventListener('click', () => {
        const secret = document.getElementById('custom-word-input').value.trim();
        joinRoom(currentGeneratedCode, secret, true);
    });
}

if (ui.buttons.join) {
    ui.buttons.join.addEventListener('click', () => {
        const secret = ui.inputs.joinSecret ? ui.inputs.joinSecret.value.trim() : '';
        joinRoom(null, secret, false);
    });
}

function sendDestroyRequest() {
    socket.YOUShare('peer-destroy-request', signalingId);
    ui.panels.destroyModal.style.display = 'none';
    showToast('Request Sent', 'Waiting for peer to agree to destruction...', 'info');
}

ui.buttons.destroyConfirm.onclick = sendDestroyRequest;

socket.on('peer-destroy-request', () => {
    if (typeof playProceduralSound === 'function') playProceduralSound('chime');
    showToast('Destruction Requested', 'Your peer is asking to destroy the workspace.', 'warning');
    const textEl = document.getElementById('destroy-request-text');
    if (textEl) textEl.textContent = "Your peer has requested to destroy this workspace permanently. Do you agree?";
    ui.buttons.destroyConfirm.textContent = "Agree & Destroy";
    ui.buttons.destroyCancel.textContent = "Refuse";
    ui.panels.destroyModal.style.display = 'flex';

    ui.buttons.destroyConfirm.onclick = () => {
        performWipe();
        socket.YOUShare('destroy-room', signalingId);
    };

    ui.buttons.destroyCancel.onclick = () => {
        socket.YOUShare('peer-destroy-reject', signalingId);
        ui.panels.destroyModal.style.display = 'none';
        
        ui.buttons.destroyCancel.textContent = "Cancel";
        ui.buttons.destroyConfirm.textContent = "Request Destruction";
        if (textEl) textEl.textContent = "This will instantly wipe all encryption keys and files for BOTH users. Your peer must agree to proceed.";
        
        ui.buttons.destroyCancel.onclick = null;
        ui.buttons.destroyConfirm.onclick = null;
    };
});

socket.on('peer-destroy-reject', () => {
    if (typeof playProceduralSound === 'function') playProceduralSound('pop');
    showToast('Vault Intact', 'Your peer declined the request to destroy the workspace.', 'error');
});

function animateVanishAndClear() {
    return new Promise((resolve) => {
        const container = document.getElementById('transfers-container');
        if (!container) return resolve();
        const items = Array.from(container.querySelectorAll('.transfer-item'));
        if (items.length === 0) {
            container.innerHTML = '';
            return resolve();
        }

        if (!document.getElementById('vanish-style')) {
            const style = document.createElement('style');
            style.id = 'vanish-style';
            style.textContent = `
                @keyframes sandVanish {
                    0% { opacity: 1; transform: scale(1) translateY(0); filter: blur(0px); }
                    100% { opacity: 0; transform: scale(0.8) translateY(20px); filter: blur(8px) sepia(60%) contrast(150%); }
                }
                .vanish-sand {
                    animation: sandVanish 1.2s cubic-bezier(0.25, 1, 0.5, 1) forwards;
                    pointer-events: none !important;
                }
                .sand-particle {
                    position: fixed; width: 4px; height: 4px; background: #a6a6a6;
                    pointer-events: none; z-index: 9999;
                    animation: sandFall 1.2s ease-in forwards;
                    box-shadow: 0 0 4px #fff;
                }
                @keyframes sandFall {
                    0% { transform: translate(0, 0) rotate(0deg) scale(1); opacity: 1; }
                    100% { transform: translate(var(--tx), var(--ty)) rotate(var(--rot)) scale(0); opacity: 0; }
                }
            `;
            document.head.appendChild(style);
        }

        items.forEach(item => {
            item.classList.add('vanish-sand');
            const rect = item.getBoundingClientRect();
            for(let i=0; i<25; i++) {
                const p = document.createElement('div');
                p.className = 'sand-particle';
                p.style.left = (rect.left + Math.random() * rect.width) + 'px';
                p.style.top = (rect.top + Math.random() * rect.height) + 'px';
                p.style.setProperty('--tx', ((Math.random()-0.5)*150) + 'px');
                p.style.setProperty('--ty', (Math.random()*150 + 50) + 'px');
                p.style.setProperty('--rot', (Math.random()*360) + 'deg');
                document.body.appendChild(p);
                setTimeout(() => p.remove(), 1200);
            }
        });

        setTimeout(() => {
            container.innerHTML = '';
            resolve();
        }, 1200);
    });
}


async function performWipe() {
    for (const id in peers) {
        if (peers[id].pc) {
            try { peers[id].pc.close(); } catch(e) {}
        }
    }
    peers = {};
    roomId = null;
    peerId = null;
    pendingCandidates = {};
    receiveBuffer = {};
    receivedChunks = {};
    activeReceives = {};
    activeSends = {};
    p2pTransferQueue = [];
    activeP2PCount = 0;
    
    // UI Cleanup
    const peerList = document.getElementById('peer-list');
    if (peerList) peerList.innerHTML = '<div class="empty-peers">Waiting for peers to join...</div>';
    
    localStorage.removeItem('ys_workspace');
    localStorage.removeItem('ys_guard');
    const textEl = document.getElementById('destroy-request-text');
    if (textEl) textEl.textContent = "This will instantly wipe all encryption keys and files for BOTH users. Your peer must agree to proceed.";
    if (ui.buttons.destroyConfirm) {
        ui.buttons.destroyConfirm.textContent = "Request Destruction";
        ui.buttons.destroyConfirm.onclick = typeof sendDestroyRequest !== 'undefined' ? sendDestroyRequest : null;
    }
    if (ui.buttons.destroyCancel) {
        ui.buttons.destroyCancel.textContent = "Cancel";
        ui.buttons.destroyCancel.onclick = null;
    }

    await animateVanishAndClear();
    ui.panels.destroyModal.style.display = 'none';
    ui.panels.leaveModal.style.display = 'none';

    if (window.history && window.history.pushState) {
        window.history.pushState({}, '', window.location.pathname);
    }
    showScreen('room');
    updateConnectionStatus('disconnected', 'Offline');
}

socket.on('peer-destroyed-room', () => {
    performWipe();
    showToast('Workspace Destroyed', 'The peer permanently destroyed this secure tunnel.', 'error');
});

ui.buttons.leaveConfirm.addEventListener('click', () => {
    const strategy = document.querySelector('input[name="exit-strategy"]:checked').value;
    const timerMin = parseInt(document.getElementById('leave-timer-min').value) || 5;

    ui.panels.leaveModal.style.display = 'none';

    if (strategy === 'immediate') {
        performWipe();
        socket.YOUShare('leave-room', signalingId, { strategy: 'immediate' });
    } else if (strategy === 'peer') {
        showToast('Standby Mode', 'Connection closed, but files will stay hosted until peer exits.', 'info');
        socket.YOUShare('leave-room', signalingId, { strategy: 'on-peer-exit' });
        performWipe();
    } else if (strategy === 'timer') {
        showToast('Self-Destruct Armed', `This workspace will wipe in ${timerMin} minutes.`, 'warning');
        socket.YOUShare('leave-room', signalingId, { strategy: 'timer', duration: timerMin * 60 * 1000 });
        performWipe();
    }
});

async function joinRoom(idParam, secretParam, isCreator = false) {
    performWipe();

    let id = typeof idParam === 'string' ? idParam : null;
    if (!id && ui.inputs.roomId) id = ui.inputs.roomId.value.trim();
    if (!id || id === "") {
        const urlParams = new URLSearchParams(window.location.search);
        id = urlParams.get('workspace');
    }
    if (!id || id === "") {
        showToast('Required', 'Please enter a Workspace Code to join.', 'info');
        return;
    }

    let secret = secretParam;
    if (secret === undefined && ui.inputs.joinSecret) {
        secret = ui.inputs.joinSecret.value.trim();
    }

    const rawId = id;
    const finalId = id + (secret ? ":" + secret : "");

    id = id.toUpperCase().replace(/[^A-Z0-9-]/g, '');
    if (id.length === 8 && !id.includes('-')) {
        id = id.slice(0, 4) + '-' + id.slice(4, 8);
    }

    if (id.length < 9) {
        showToast('Invalid Code', 'Code is too short (e.g. A8B2-X9M4).', 'error');
        return;
    }

    const isSecure = window.isSecureContext && window.crypto && window.crypto.subtle;
    if (isSecure) {
        try {
            await generateECDHKeyPair();
        } catch (err) {
            console.error('ECDH Generation Failed:', err);
            showToast('Encryption Error', 'Failed to generate secure keys.', 'error');
            return;
        }
    }

    roomId = rawId; 
    signalingId = finalId;
    ui.text.currentRoom.textContent = roomId;
    if (ui.text.displayRoomCode) ui.text.displayRoomCode.textContent = roomId;

    const myPublicJwk = isSecure ? await crypto.subtle.exportKey('jwk', myECDHKeyPair.publicKey) : { insecure: true };

    window._pendingPassphrase = secret || '';
    window._pendingIsCreator = isCreator;

    const inviteUrl = `${window.location.origin}${window.location.pathname}?workspace=${roomId}`;
    if (ui.inputs.shareUrl) ui.inputs.shareUrl.value = inviteUrl;

    if (typeof QRCode !== 'undefined' && ui.qrContainer) {
        ui.qrContainer.innerHTML = '';
        new QRCode(ui.qrContainer, { text: inviteUrl, width: 140, height: 140 });
    }

    if (window.history && window.history.pushState) {
        window.history.pushState({ workspace: roomId, guard: secret }, '', inviteUrl);
    }
    localStorage.setItem('ys_workspace', roomId);
    localStorage.setItem('ys_is_creator', isCreator ? 'true' : 'false');
    if (secret) localStorage.setItem('ys_guard', secret);

    peerId = socket.id;
    socket.YOUShare('join-room', signalingId, isCreator);
    
    showScreen('transfer');
    updateConnectionStatus('waiting');
}

socket.on('room-locked', () => {
    showToast('Workspace Full', 'This secure workspace has reached its participant limit (2).', 'error');
    roomId = null;
    showScreen('room');
    updateConnectionStatus('disconnected', 'Offline');
});

socket.on('room-not-found', () => {
    showToast('Vault Not Found', 'Invalid code or the creator has not joined yet.', 'error');
    roomId = null;
    showScreen('room');
    updateConnectionStatus('disconnected', 'Offline');
});

socket.on('room-expired', () => {
    if (roomId) {
        showToast('Workspace Expired', 'This workspace was destroyed automatically.', 'warning');
        performWipe();
    }
});

socket.on('secret-mismatch', () => {
    if (typeof ui !== 'undefined' && ui.panels.secretPromptModal) {
        window._pendingWorkspaceId = roomId ? roomId : window._pendingWorkspaceId;
        roomId = null;
        updateConnectionStatus('disconnected');
        ui.panels.secretPromptModal.style.display = 'flex';
        if (ui.inputs.promptSecret) {
            ui.inputs.promptSecret.value = '';
            ui.inputs.promptSecret.focus();
        }
    } else {
        showToast('Incorrect Secret', 'The secret word for this workspace is incorrect. Please try again.', 'error');
        roomId = null;
        showScreen('room');
        updateConnectionStatus('disconnected');
    }
});

socket.on('peer-destroyed-room', () => {
    performWipe();
    if (window.history && window.history.pushState) {
        window.history.pushState({}, '', window.location.pathname);
    }
});

socket.on('ecdh-public-key', async (theirPublicJwk, senderId) => {
    if (!myECDHKeyPair || !peers[senderId]) return;
    auditLog(`ECDH public key from ${peers[senderId].name} received — computing shared secret`);

    const passphrase = window._pendingPassphrase || '';
    const sharedKey = await deriveSharedKey(theirPublicJwk, passphrase);
    peers[senderId].ecdhKey = sharedKey;

    // Load into worker if needed, or handle per-peer worker? Or just use crypto.subtle directly for now for simplicity in multi-peer
    // For now, let's keep it simple and use a per-peer shared key in RAM
    peers[senderId].encryptReady = true;

    const statusEl = document.getElementById(`peer-status-${senderId}`);
    if (statusEl) {
        statusEl.textContent = 'Encrypted';
        statusEl.classList.add('active-text');
    }
    
    showToast('🔐 Secured', `Private link with ${peers[senderId].name} ready.`, 'success');
});

// Redundant DOM load join removed to prevent double-connect lockouts

socket.on('peer-list', async (peerList) => {
    peerList.forEach(p => {
        if (!peers[p.id]) {
            peers[p.id] = { id: p.id, name: p.name, pc: null, dc: null };
            updatePeerListUI();
        }
    });

    // New joiner initiates offers to all existing peers
    for (const p of peerList) {
        await initiateMeshOffer(p.id);
    }
});

socket.on('user-joined', async (peerData) => {
    if (!peers[peerData.id]) {
        peers[peerData.id] = { id: peerData.id, name: peerData.name, pc: null, dc: null };
        updatePeerListUI();
        showToast('Peer Joined', `${peerData.name} entered the workspace.`, 'success');
        if (typeof playProceduralSound === 'function') playProceduralSound('chime');
    }
});

socket.on('user-left', (leftPeerId) => {
    if (peers[leftPeerId]) {
        console.log(`Peer left: ${leftPeerId}`);
        showToast('Peer Left', `${peers[leftPeerId].name} left the workspace.`, 'info');
        if (peers[leftPeerId].pc) {
            try { peers[leftPeerId].pc.close(); } catch(e) {}
        }
        delete peers[leftPeerId];
        updatePeerListUI();

        for (const [fId, meta] of Object.entries(activeReceives)) {
            if (meta.senderId === leftPeerId) {
                delete activeReceives[fId];
                delete receiveBuffer[fId];
                delete receivedChunks[fId];
                const item = document.getElementById(`item-${fId}`);
                if (item) item.remove();
            }
        }
        for (const [fId, sendState] of Object.entries(activeSends)) {
            if (sendState.targetId === leftPeerId) {
                delete activeSends[fId];
                const item = document.getElementById(`item-${fId}`);
                if (item) item.remove();
            }
        }
    }
});

async function initiateMeshOffer(targetId) {
    const pc = setupPeerConnection(targetId);
    peers[targetId].pc = pc;

    const dc = pc.createDataChannel('fileTransfer');
    setupDataChannel(dc, targetId);
    peers[targetId].dc = dc;

    try {
        let offer = await pc.createOffer();
        offer = { type: offer.type, sdp: mangleSDP(offer.sdp) };
        await pc.setLocalDescription(offer);
        socket.YOUShare('offer', offer, signalingId, targetId);
    } catch (e) {
        console.error(`Error creating offer for ${targetId}`, e);
    }
}

socket.on('offer', async (offer, senderId, senderName) => {
    if (!peers[senderId]) {
        peers[senderId] = { id: senderId, name: senderName, pc: null, dc: null };
        updatePeerListUI();
    }

    const pc = setupPeerConnection(senderId);
    peers[senderId].pc = pc;

    try {
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        
        const candidates = pendingCandidates[senderId] || [];
        for (const c of candidates) {
            await pc.addIceCandidate(new RTCIceCandidate(c));
        }
        delete pendingCandidates[senderId];

        let answer = await pc.createAnswer();
        answer = { type: answer.type, sdp: mangleSDP(answer.sdp) };
        await pc.setLocalDescription(answer);
        socket.YOUShare('answer', answer, signalingId, senderId);
    } catch (e) {
        console.error(`Error handling offer from ${senderId}`, e);
    }
});

socket.on('answer', async (answer, senderId) => {
    const peer = peers[senderId];
    if (peer && peer.pc) {
        try {
            await peer.pc.setRemoteDescription(new RTCSessionDescription(answer));
            const candidates = pendingCandidates[senderId] || [];
            for (const c of candidates) {
                await peer.pc.addIceCandidate(new RTCIceCandidate(c));
            }
            delete pendingCandidates[senderId];
        } catch (e) {
            console.error(`Error handling answer from ${senderId}`, e);
        }
    }
});

socket.on('ice-candidate', async (candidate, senderId) => {
    const peer = peers[senderId];
    if (peer && peer.pc && peer.pc.remoteDescription) {
        try {
            await peer.pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) {
            console.error(`Error adding ICE candidate from ${senderId}`, e);
        }
    } else {
        if (!pendingCandidates[senderId]) pendingCandidates[senderId] = [];
        pendingCandidates[senderId].push(candidate);
    }
});

async function updatePeerListUI() {
    const container = document.getElementById('peer-list');
    if (!container) return;

    const peerArray = Object.values(peers);
    if (peerArray.length === 0) {
        container.innerHTML = '<div class="empty-peers">Waiting for peers to join...</div>';
        return;
    }

    container.innerHTML = peerArray.map(p => `
        <div class="peer-item" id="peer-item-${p.id}">
            <div class="peer-avatar">${p.name.charAt(0).toUpperCase()}</div>
            <div class="peer-info">
                <div class="peer-name">${p.name}</div>
                <div class="peer-status" id="peer-status-${p.id}">Connecting...</div>
            </div>
            <div class="peer-checkbox-wrapper">
                <input type="checkbox" class="peer-checkbox" data-peer-id="${p.id}" checked>
            </div>
        </div>
    `).join('');

    updateConnectionStatus('connected', null, Object.keys(peers).length);
}

function setupPeerConnection(targetId) {
    const pc = new RTCPeerConnection(configuration);

    pc.onicecandidate = (e) => {
        if (e.candidate) {
            socket.YOUShare('ice-candidate', e.candidate, signalingId, targetId);
        }
    };

    pc.onconnectionstatechange = () => {
        const state = pc.connectionState;
        const peerName = peers[targetId].name || 'Unknown Peer';
        auditLog(`Connection with ${peerName} → ${state}`);
        const statusEl = document.getElementById(`peer-status-${targetId}`);
        if (statusEl) statusEl.textContent = state.charAt(0).toUpperCase() + state.slice(1);

        if (state === 'connected') {
            updateConnectionStatus('connected');
            if (myECDHKeyPair) {
                crypto.subtle.exportKey('jwk', myECDHKeyPair.publicKey).then(jwk => {
                    socket.YOUShare('ecdh-public-key', jwk, signalingId, targetId);
                });
            }
        }
    };

    pc.ondatachannel = (e) => {
        setupDataChannel(e.channel, targetId);
    };

    return pc;
}

let currentSpeedStats = null;

function formatSpeed(bytesPerSec) {
    if (bytesPerSec === 0) return '0 B/s';
    const k = 1024;
    const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
    const i = Math.floor(Math.log(bytesPerSec) / Math.log(k));
    return parseFloat((bytesPerSec / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatETA(seconds) {
    if (!isFinite(seconds) || seconds < 0) return '--:--';
    if (seconds < 1) return '< 1s';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
}

function mangleSDP(sdp) {
    return sdp;
}

function setupDataChannel(channel, targetId) {
    const peer = peers[targetId];
    if (!peer) return;
    peer.dc = channel;

    channel.binaryType = 'arraybuffer';

    channel.onopen = () => {
        console.log(`Data channel to ${peer.name} open`);
        const statusEl = document.getElementById(`peer-status-${targetId}`);
        if (statusEl) statusEl.textContent = 'Connected';
    };

    channel.onclose = () => {
        console.log(`Data channel to ${peer.name} closed`);
    };

    let pendingChunkHeader = null;
    let incomingMessageQueue = [];
    let isProcessingQueue = false;

    channel.onmessage = (e) => {
        incomingMessageQueue.push(e);
        processIncomingQueue();
    };

    async function processIncomingQueue() {
        if (isProcessingQueue) return;
        isProcessingQueue = true;

        while (incomingMessageQueue.length > 0) {
            const e = incomingMessageQueue.shift();
            
            if (typeof e.data === 'string') {
                const msg = JSON.parse(e.data);

                if (msg.type === 'file-meta-envelope') {
                    try {
                        const meta = await decryptMeta(msg.payload, peer.ecdhKey);
                        activeReceives[meta.id] = { ...meta, senderId: targetId };
                        receiveBuffer[meta.id] = [];
                        receivedChunks[meta.id] = new Set();
                        
                        // Per-transfer stats
                        peer.currentSpeedStats = { startTime: Date.now(), lastBytes: 0, lastTime: Date.now(), received: 0 };
                        
                        createTransferElement(meta.id, meta.name, meta.size, true);
                        updateTransferProgress(meta.id, 0, `From ${peer.name}`, '0 B/s', '--:--');

                        const cancelBtn = document.getElementById(`cancel-transfer-${meta.id}`);
                        if (cancelBtn) {
                            cancelBtn.onclick = () => {
                                delete activeReceives[meta.id];
                                delete receiveBuffer[meta.id];
                                delete receivedChunks[meta.id];
                                const item = document.getElementById(`item-${meta.id}`);
                                if (item) item.remove();
                                auditLog(`Incoming transfer "${meta.name}" from ${peer.name} cancelled.`);
                                if (peer.dc && peer.dc.readyState === 'open') {
                                    peer.dc.send(JSON.stringify({ type: 'cancel-transfer', fileId: meta.id }));
                                }
                            };
                        }
                    } catch (err) {
                        console.error('Meta decryption failed', err);
                        showToast('Decryption Error', 'Could not decrypt file metadata.', 'error');
                    }
                } else if (msg.type === 'chunk-header') {
                    pendingChunkHeader = msg;
                } else if (msg.type === 'file-done') {
                    finalizeDownload(msg.id);
                } else if (msg.type === 'cancel-transfer') {
                    const cancelId = msg.fileId;
                    if (activeReceives[cancelId]) {
                        delete activeReceives[cancelId];
                        delete receiveBuffer[cancelId];
                        delete receivedChunks[cancelId];
                        const item = document.getElementById(`item-${cancelId}`);
                        if (item) item.remove();
                        auditLog('Incoming transfer cancelled by sender.');
                        showToast('Transfer Cancelled', 'The sender cancelled the file transfer.', 'warning');
                    }
                    if (activeSends[cancelId]) {
                        delete activeSends[cancelId];
                        const item = document.getElementById(`item-${cancelId}`);
                        if (item) item.remove();
                        auditLog('Outgoing transfer cancelled by receiver.');
                        showToast('Transfer Cancelled', 'The receiver cancelled the file transfer.', 'warning');
                    }
                }
            } else {
                if (!pendingChunkHeader) continue;
                const { fileId, chunkIndex } = pendingChunkHeader;
                pendingChunkHeader = null;
                
                const meta = activeReceives[fileId];
                if (!meta) continue;

                if (receivedChunks[fileId] && receivedChunks[fileId].has(chunkIndex)) continue;

                let chunkData = e.data;

                if (peer.ecdhKey) {
                    try {
                        const buf = e.data instanceof ArrayBuffer ? e.data : await e.data.arrayBuffer();
                        const iv = new Uint8Array(buf, 0, 12);
                        const cipher = buf.slice(12);
                        chunkData = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, peer.ecdhKey, cipher);
                    } catch (err) {
                        console.error('Chunk decryption failed', err);
                        updateTransferProgress(meta.id, 0, 'DECRYPTION FAILED', '', '');
                        continue;
                    }
                }

                if (!receiveBuffer[fileId]) receiveBuffer[fileId] = [];
                receiveBuffer[fileId][chunkIndex] = chunkData;
                receivedChunks[fileId].add(chunkIndex);

                const receivedBytes = (receivedChunks[fileId].size) * CHUNK_SIZE;
                const now = Date.now();
                
                const speedStats = peer.currentSpeedStats;
                if (speedStats) {
                    const timeDiff = (now - speedStats.lastTime) / 1000;
                    if (timeDiff >= 0.25 || receivedBytes === meta.size) {
                        const bytesDiff = receivedBytes - speedStats.lastBytes;
                        const speed = bytesDiff / timeDiff;
                        const remaining = Math.max(meta.size - receivedBytes, 0);
                        updateTransferProgress(
                            meta.id,
                            Math.min((receivedBytes / meta.size) * 100, 100),
                            `Receiving from ${peer.name}`,
                            formatSpeed(speed),
                            formatETA(remaining / speed)
                        );
                        speedStats.lastTime = now;
                        speedStats.lastBytes = receivedBytes;
                    }
                }
            }
        }
        isProcessingQueue = false;
    }
}

async function decryptMeta(envelope, key) {
    if (!envelope.encrypted) return JSON.parse(envelope.data);
    if (!key) throw new Error('No decryption key for peer');
    const iv = new Uint8Array(envelope.iv);
    const cipher = new Uint8Array(envelope.data).buffer;
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
    return JSON.parse(new TextDecoder().decode(plain));
}

async function encryptMeta(metaObj, key) {
    if (!key) return { encrypted: false, data: JSON.stringify(metaObj) };
    const enc = new TextEncoder();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipher = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        enc.encode(JSON.stringify(metaObj))
    );
    return { encrypted: true, iv: Array.from(iv), data: Array.from(new Uint8Array(cipher)) };
}

let p2pTransferQueue = [];
let activeP2PCount = 0;
const MAX_CONCURRENT_P2P = 5;

function processP2PQueue() {
    while (activeP2PCount < MAX_CONCURRENT_P2P && p2pTransferQueue.length > 0) {
        const item = p2pTransferQueue.shift();
        activeP2PCount++;
        sendFile(item.file, item.targetId).finally(() => {
            activeP2PCount--;
            processP2PQueue();
        });
    }
}

function handleFiles(files) {
    const peerArray = Object.values(peers);
    if (peerArray.length === 0) {
        showToast('No Peers', 'Wait for someone to join before sending P2P.', 'info');
        // Still show modal for Hosted Drop option
        showDropModal(files);
        return;
    }

    if (peerArray.length > 1) {
        showDropModal(files, true);
    } else {
        // Only 1 peer, auto-queue
        const targetId = peerArray[0].id;
        for (const f of files) {
            p2pTransferQueue.push({ file: f, targetId });
        }
        processP2PQueue();
        showToast('Sending...', `Transmitting ${files.length} file(s) to ${peerArray[0].name}`, 'info');
    }
}

function showDropModal(files, showRecipients = false) {
    const modal = document.getElementById('drop-modal');
    const filenameEl = document.getElementById('drop-modal-filename');
    const waitBtn = document.getElementById('drop-modal-wait');
    const uploadBtn = document.getElementById('drop-modal-upload');
    const recipientSelector = document.getElementById('recipient-selector');
    const recipientList = document.getElementById('recipient-list');

    filenameEl.textContent = Array.from(files).map(f => f.name).join(', ');
    modal.style.display = 'flex';
    
    // Hide progress/result if open from previous
    document.getElementById('drop-modal-progress').style.display = 'none';
    document.getElementById('drop-modal-result').style.display = 'none';
    uploadBtn.disabled = false;
    waitBtn.disabled = false;

    if (showRecipients) {
        recipientSelector.style.display = 'block';
        recipientList.innerHTML = Object.values(peers).map(p => `
            <label class="recipient-item">
                <input type="checkbox" class="recipient-checkbox" value="${p.id}" checked>
                <span>${p.name}</span>
            </label>
        `).join('');
    } else {
        recipientSelector.style.display = 'none';
    }

    waitBtn.onclick = () => {
        let targets = [];
        if (showRecipients) {
            const checked = recipientList.querySelectorAll('.recipient-checkbox:checked');
            targets = Array.from(checked).map(cb => cb.value);
        } else {
            const peerArray = Object.values(peers);
            if (peerArray.length > 0) targets = [peerArray[0].id];
        }

        if (targets.length === 0) {
            showToast('No Recipient', 'Please select at least one person.', 'warning');
            return;
        }

        modal.style.display = 'none';
        for (const f of files) {
            for (const tId of targets) {
                p2pTransferQueue.push({ file: f, targetId: tId });
            }
        }
        processP2PQueue();
    };

    uploadBtn.onclick = async () => {
        // ... (Hosted upload logic remains same as before) ...
        const progressSection = document.getElementById('drop-modal-progress');
        const progressFill = document.getElementById('drop-progress-fill');
        const progressLabel = document.getElementById('drop-progress-label');
        const resultSection = document.getElementById('drop-modal-result');
        const resultUrl = document.getElementById('drop-result-url');
        const copyBtn = document.getElementById('drop-copy-btn');
        
        progressSection.style.display = 'block';
        uploadBtn.disabled = true;
        waitBtn.disabled = true;

        const file = files[0]; // Hosted drop only supports 1 file usually in this UI
        try {
            const result = await window.hostedDrop(file, (phase, pct) => {
                progressLabel.textContent = phase === 'encrypting' ? 'Encrypting...' : `Uploading... ${Math.round(pct)}%`;
                progressFill.style.width = Math.round(pct) + '%';
            });
            progressSection.style.display = 'none';
            resultSection.style.display = 'block';
            resultUrl.value = result.url;
            copyBtn.onclick = () => window.copyToClipboard(result.url).then(() => showToast('Copied', 'URL Copied', 'success'));
        } catch (e) {
            progressLabel.textContent = 'Error: ' + e.message;
            uploadBtn.disabled = false;
            waitBtn.disabled = false;
        }
    };

    modal.onclick = (e) => { if (e.target === modal) modal.style.display = 'none'; };
}

function sendFile(file, targetId) {
    return new Promise(async (resolve) => {
        const peer = peers[targetId];
        if (!peer || !peer.dc || peer.dc.readyState !== 'open') {
            showToast('Transfer Failed', `Connection to ${peer ? peer.name : 'peer'} lost.`, 'error');
            return resolve();
        }

        const fileId = Math.random().toString(36).substring(7);
        const processedFile = file;

        const rawMeta = {
            type: 'file-meta',
            id: fileId,
            name: processedFile.name,
            size: processedFile.size,
            mime: processedFile.type,
            totalChunks: Math.ceil(processedFile.size / CHUNK_SIZE)
        };
        const metaEnvelope = await encryptMeta(rawMeta, peer.ecdhKey);
        
        try {
            peer.dc.send(JSON.stringify({ type: 'file-meta-envelope', payload: metaEnvelope }));
        } catch (err) {
            showToast('Transfer Failed', `Failed to initiate send to ${peer.name}.`, 'error');
            return resolve();
        }

        createTransferElement(fileId, processedFile.name, processedFile.size, false, processedFile);
        const statusEl = document.getElementById(`status-${fileId}`);
        if (statusEl) statusEl.textContent = `To ${peer.name}`;

        const cancelBtn = document.getElementById(`cancel-transfer-${fileId}`);
        if (cancelBtn) {
            cancelBtn.onclick = () => {
                delete activeSends[fileId];
                const item = document.getElementById(`item-${fileId}`);
                if (item) item.remove();
                auditLog(`Outgoing transfer to ${peer.name} cancelled.`);
                if (peer.dc && peer.dc.readyState === 'open') {
                    peer.dc.send(JSON.stringify({ type: 'cancel-transfer', fileId }));
                }
                resolve();
            };
        }

        activeSends[fileId] = { file: processedFile, chunkIndex: 0, paused: false, fileId, targetId };
        let sendStats = { lastTime: Date.now(), lastBytes: 0 };
        let pipeline = [];
        const MAX_PIPELINE = 32;

        peer.dc.bufferedAmountLowThreshold = 1024 * 1024;

        const pumpPipeline = async () => {
            const state = activeSends[fileId];
            if (!state || state.paused) return;
            const totalChunks = Math.ceil(state.file.size / CHUNK_SIZE);

            while (pipeline.length < MAX_PIPELINE && state.chunkIndex < totalChunks) {
                const idx = state.chunkIndex++;
                const start = idx * CHUNK_SIZE;
                const end = Math.min(start + CHUNK_SIZE, state.file.size);
                const blobChunk = state.file.slice(start, end);
                const rawChunk = await blobChunk.arrayBuffer();
                pipeline.push(Promise.resolve({ idx, p: rawChunk }));
            }
        };

        const sendNextChunk = async () => {
            try {
                const state = activeSends[fileId];
                if (!state || state.paused) return resolve();
                const totalChunks = Math.ceil(state.file.size / CHUNK_SIZE);

                await pumpPipeline();

                while (pipeline.length > 0) {
                    if (peer.dc.bufferedAmount > peer.dc.bufferedAmountLowThreshold) {
                        await new Promise((res, rej) => {
                            let isResolved = false;
                            const checkBuffer = () => {
                                if (isResolved) return;
                                if (peer.dc.readyState !== 'open') {
                                    isResolved = true;
                                    peer.dc.onbufferedamountlow = null;
                                    rej(new Error('Channel closed.'));
                                    return;
                                }
                                if (peer.dc.bufferedAmount <= peer.dc.bufferedAmountLowThreshold) {
                                    isResolved = true;
                                    peer.dc.onbufferedamountlow = null;
                                    res();
                                } else {
                                    setTimeout(checkBuffer, 50);
                                }
                            };
                            peer.dc.onbufferedamountlow = checkBuffer;
                            setTimeout(checkBuffer, 50);
                        });
                    }

                    const { idx, p } = await pipeline.shift();
                    if (peer.dc.readyState !== 'open') throw new Error('Channel closed.');
                    
                    let dataToSend = p;
                    if (peer.ecdhKey) {
                        const iv = crypto.getRandomValues(new Uint8Array(12));
                        const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, peer.ecdhKey, p);
                        const combined = new Uint8Array(iv.length + cipher.byteLength);
                        combined.set(iv);
                        combined.set(new Uint8Array(cipher), iv.length);
                        dataToSend = combined;
                    }

                    peer.dc.send(JSON.stringify({ type: 'chunk-header', fileId, chunkIndex: idx }));
                    peer.dc.send(dataToSend);
                    await pumpPipeline();

                    const now = Date.now();
                    const elapsed = (now - sendStats.lastTime) / 1000;
                    if (elapsed >= 0.5 || idx + 1 === totalChunks) {
                        const bytesDone = (idx + 1) * CHUNK_SIZE;
                        const speed = (bytesDone - sendStats.lastBytes) / elapsed;
                        const remaining = state.file.size - bytesDone;
                        updateTransferProgress(fileId, Math.min((bytesDone / state.file.size) * 100, 100), `Sending to ${peer.name}`, formatSpeed(speed), formatETA(remaining / speed));
                        sendStats.lastTime = now;
                        sendStats.lastBytes = bytesDone;
                    }

                    if (idx + 1 === totalChunks) {
                        if (peer.dc.readyState !== 'open') throw new Error('Channel closed.');
                        peer.dc.send(JSON.stringify({ type: 'file-done', id: fileId }));
                        updateTransferProgress(fileId, 100, `Sent to ${peer.name}`, '', '');
                        delete activeSends[fileId];
                        return resolve();
                    }
                }
            } catch (err) {
                console.error('Send Error:', err);
                updateTransferProgress(fileId, 0, `FAILED: ${err.message}`, '', '');
                resolve();
            }
        };

        sendNextChunk();
    });
}

function finalizeDownload(fileId) {
    const meta = activeReceives[fileId];
    if (!meta) return;

    socket.YOUShare('record-stat', { bytes: meta.size });

    const orderedChunks = receiveBuffer[fileId].filter(Boolean);
    const blob = new Blob(orderedChunks, { type: meta.mime || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);

    if (typeof playProceduralSound === 'function') playProceduralSound('pop');

    const thumbEl = document.getElementById(`thumb-${meta.id}`);
    if (thumbEl) {
        const ext = meta.name.split('.').pop().toLowerCase();
        if (['jpg','jpeg','png','gif','webp'].includes(ext)) {
            thumbEl.innerHTML = `<img src="${url}" style="width:48px;height:48px;border-radius:12px;object-fit:cover;">`;
        } else if (['mp4','webm'].includes(ext)) {
            thumbEl.innerHTML = `<video src="${url}" style="width:48px;height:48px;border-radius:12px;object-fit:cover;" autoplay muted loop></video>`;
        }
    }

    const downloadBtn = document.getElementById(`download-btn-${fileId}`);
    if (downloadBtn) {
        downloadBtn.href = url;
        downloadBtn.download = meta.name;
        downloadBtn.setAttribute('role', 'button');
        downloadBtn.style.pointerEvents = 'auto';
        downloadBtn.style.opacity = '1';
        downloadBtn.onclick = () => showToast('Saving File', `Downloading ${meta.name}...`, 'info');
    }

    updateTransferProgress(meta.id, 100, 'Ready to Save', '', '');
    showToast('File Received', `${meta.name} is ready to save.`, 'success');

    delete receiveBuffer[fileId];
    delete receivedChunks[fileId];
    delete activeReceives[fileId];
}

let hasAutoJoined = false;
function triggerAutoJoin() {
    if (hasAutoJoined) return;
    hasAutoJoined = true;
    
    const urlParams = new URL(window.location.href).searchParams;
    let autoWorkspaceId = urlParams.get('workspace');
    let autoGuard = urlParams.get('guard');

    if (!autoWorkspaceId) {
        autoWorkspaceId = localStorage.getItem('ys_workspace');
        autoGuard = localStorage.getItem('ys_guard');
    }

    if (autoWorkspaceId) {
        let isCreatorFlag = localStorage.getItem('ys_is_creator') === 'true';
        joinRoom(autoWorkspaceId, autoGuard, isCreatorFlag);
    }
}

if (socket.connected) {
    triggerAutoJoin();
} else {
    socket.once('connect', triggerAutoJoin);
}

socket.on('global-stats-updated', (stats) => {
    const gb = (stats.bytesTransferred / (1024 * 1024 * 1024)).toFixed(3);
    const count = stats.filesTransferred;

    if (typeof ui !== 'undefined' && document) {
        const globalBytesEl = document.getElementById('global-bytes');
        const globalCountEl = document.getElementById('global-count');

        if (globalBytesEl) globalBytesEl.textContent = `${gb} GB`;
        if (globalCountEl) globalCountEl.textContent = count;
    }
});

window.addEventListener('beforeunload', () => {
    if (typeof signalingId !== 'undefined' && signalingId && typeof socket !== 'undefined') {
        socket.YOUShare('leave-room', signalingId, { strategy: 'immediate' });
    }
});
