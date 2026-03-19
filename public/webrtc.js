const socket = io();
let roomId = null;
let signalingId = null;
let peerConnection = null;
let dataChannel = null;
let peerId = null;

let myECDHKeyPair = null;  
let zeroTrustKey = null;   

let encryptWorker = null;
const workerCallbacks = {};

function initEncryptWorker() {
    encryptWorker = new Worker('/encrypt-worker.js');
    encryptWorker.onmessage = (e) => {
        const { type, id, chunkIndex, data, error } = e.data;
        if (type === 'key-ready') {
            auditLog('🔑 Web Worker ready — AES key imported to dedicated CPU core');
        } else if (type === 'chunk-encrypted' || type === 'chunk-decrypted') {
            const cb = workerCallbacks[`${id}:${chunkIndex}`];
            if (cb) { cb.resolve(data); delete workerCallbacks[`${id}:${chunkIndex}`]; }
        } else if (type === 'decrypt-error') {
            const cb = workerCallbacks[`${id}:${chunkIndex}`];
            if (cb) { cb.reject(new Error(error)); delete workerCallbacks[`${id}:${chunkIndex}`]; }
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
    console.log('%c⚡ AUDIT', 'color:#10b981;font-weight:bold', entry);
}
window.auditLog = auditLog;

async function generateECDHKeyPair() {
    const keyPair = await crypto.subtle.generateKey(
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        ['deriveKey', 'deriveBits']
    );
    myECDHKeyPair = keyPair;
    auditLog('🔑 ECDH P-256 key pair generated locally — private key never leaves this browser');
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
    auditLog('🤝 Shared secret computed via ECDH — this value exists only in RAM, never transmitted');

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
        auditLog('🔐 Passphrase PIN XORed with ECDH secret — dual-factor key hardening active');
    }

    const rawImport = await crypto.subtle.importKey('raw', keyMaterial, 'HKDF', false, ['deriveKey']);
    const aesKey = await crypto.subtle.deriveKey(
        { name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode('emit-v3'), info: new ArrayBuffer(0) },
        rawImport,
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
    );
    auditLog('🔒 AES-GCM 256-bit session key derived via HKDF — unique to this session');
    return aesKey;
}

async function loadKeyIntoWorker(aesKey) {
    const rawBytes = await crypto.subtle.exportKey('raw', aesKey);
    encryptWorker.postMessage({ type: 'import-key', payload: { rawKey: rawBytes }, id: 'init' });
    auditLog('⚡ AES key loaded into Web Worker (dedicated CPU core for encryption)');
}

initEncryptWorker();
auditLog('🚀 emit initialised — all crypto runs client-side');

const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

let receiveBuffer = {};
let receivedChunks = {};
let currentFileMeta = null;

const CHUNK_SIZE = 1024 * 1024;

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

ui.buttons.destroyConfirm.addEventListener('click', () => {
    socket.emit('peer-destroy-request', signalingId);
    ui.panels.destroyModal.style.display = 'none';
    showToast('Request Sent', 'Waiting for peer to agree to destruction...', 'info');
});

socket.on('peer-destroy-request', () => {

    const textEl = document.getElementById('destroy-request-text');
    if (textEl) textEl.textContent = "Your peer has requested to destroy this workspace permanently. Do you agree?";
    ui.buttons.destroyConfirm.textContent = "Agree & Destroy";
    ui.panels.destroyModal.style.display = 'flex';

    const originalListener = ui.buttons.destroyConfirm.onclick; 
    ui.buttons.destroyConfirm.onclick = () => {
        performWipe();
        socket.emit('destroy-room', signalingId);
    };
});

function performWipe() {
    if (peerConnection) {
        try { peerConnection.close(); } catch(e) {}
        peerConnection = null;
    }
    dataChannel = null;
    roomId = null;
    peerId = null;
    receiveBuffer = {};
    activeSends = {};
    localStorage.removeItem('ys_workspace');
    localStorage.removeItem('ys_guard');
    document.getElementById('transfers-container').innerHTML = '';
    ui.panels.destroyModal.style.display = 'none';
    ui.panels.leaveModal.style.display = 'none';

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
        socket.emit('leave-room', signalingId);
    } else if (strategy === 'peer') {
        showToast('Standby Mode', 'Connection closed, but files will stay hosted until peer exits.', 'info');
        if (peerConnection) peerConnection.close();
        socket.emit('leave-room', signalingId, { strategy: 'on-peer-exit' });
        showScreen('room');
    } else if (strategy === 'timer') {
        showToast('Self-Destruct Armed', `This workspace will wipe in ${timerMin} minutes.`, 'warning');
        if (peerConnection) peerConnection.close();
        socket.emit('leave-room', signalingId, { strategy: 'timer', duration: timerMin * 60 * 1000 });
        showScreen('room');
    }
});

async function joinRoom(idParam, secretParam) {
    performWipe();

    let id = typeof idParam === 'string' ? idParam : null;

    if (!id && ui.inputs.roomId) {
        id = ui.inputs.roomId.value.trim();
    }

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

    if (!isSecure) {
        showToast('Dev Mode (HTTP)', 'Encryption disabled due to insecure context (HTTP). Direct data transfer only.', 'warning');
        auditLog('⚠️ INSECURE CONTEXT: Web Crypto API is unavailable. Proceeding with plaintext handshake for dev/local testing.');
    } else {

        try {
            await generateECDHKeyPair();
        } catch (err) {
            console.error('ECDH Generation Failed:', err);
            showToast('Encryption Error', 'Failed to generate secure keys. Connection aborted.', 'error');
            return;
        }
    }

    roomId = rawId; 
    signalingId = finalId;
    ui.text.currentRoom.textContent = roomId;
    if (ui.text.displayRoomCode) ui.text.displayRoomCode.textContent = roomId;

    const myPublicJwk = isSecure ? await crypto.subtle.exportKey('jwk', myECDHKeyPair.publicKey) : { insecure: true };

    window._pendingPassphrase = secret || '';

    const inviteSuffix = secret ? `&guard=${encodeURIComponent(secret)}` : '';
    const inviteUrl = `${window.location.origin}${window.location.pathname}?workspace=${roomId}${inviteSuffix}`;
    if (ui.inputs.shareUrl) ui.inputs.shareUrl.value = inviteUrl;

    if (typeof QRCode !== 'undefined' && ui.qrContainer) {
        ui.qrContainer.innerHTML = '';
        new QRCode(ui.qrContainer, { text: inviteUrl, width: 140, height: 140 });
    }

    if (window.history && window.history.pushState) {
        window.history.pushState({ workspace: roomId, guard: secret }, '', inviteUrl);
    }
    localStorage.setItem('ys_workspace', roomId);
    if (secret) localStorage.setItem('ys_guard', secret);

    socket.emit('join-room', signalingId);
    socket.emit('ecdh-public-key', myPublicJwk, signalingId);

    showScreen('transfer');
    updateConnectionStatus('waiting');
}

socket.on('room-locked', () => {
    showToast('Workspace Locked', 'This secure workspace is already in use by two peers, or has expired.', 'error');
    roomId = null;
    showScreen('room');
    updateConnectionStatus('disconnected', 'Offline');
});

socket.on('room-expired', () => {
    if (roomId) {
        showToast('Workspace Expired', 'This workspace auto-destroyed due to 5 minutes of inactivity.', 'warning');
        if (peerConnection) peerConnection.close();
        roomId = null;
        showScreen('room');
        updateConnectionStatus('disconnected', 'Offline');
        if (window.history && window.history.pushState) {
            window.history.pushState({}, '', window.location.pathname);
        }
    }
});

socket.on('secret-mismatch', () => {
    showToast('Incorrect Secret', 'The secret word for this workspace is incorrect. Please try again.', 'error');
    roomId = null;
    showScreen('room');
    updateConnectionStatus('disconnected');
});

socket.on('peer-destroyed-room', () => {
    performWipe();
    if (window.history && window.history.pushState) {
        window.history.pushState({}, '', window.location.pathname);
    }
});

socket.on('ecdh-public-key', async (theirPublicJwk) => {
    if (!myECDHKeyPair) return;
    auditLog('📩 Peer ECDH public key received — computing shared secret locally');

    const passphrase = window._pendingPassphrase || '';
    zeroTrustKey = await deriveSharedKey(theirPublicJwk, passphrase);
    window._pendingPassphrase = null;

    await loadKeyIntoWorker(zeroTrustKey);

    const badge = document.getElementById('e2e-badge');
    if (badge) {
        badge.style.display = 'flex';
        badge.title = 'End-to-End Encrypted via ECDH P-256 + AES-GCM 256';
    }
    showToast('🔐 E2E Encrypted', 'ECDH key exchange complete. Transfer secured.', 'success');
});

window.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const workspaceId = urlParams.get('workspace');
    if (workspaceId) joinRoom(workspaceId);
});

socket.on('user-joined', async (userId) => {

    console.log('Peer joined, creating offer');
    setupPeerConnection();

    try {

        setupDataChannel(peerConnection.createDataChannel('fileTransfer'));

        let offer = await peerConnection.createOffer();
        offer = { type: offer.type, sdp: mangleSDP(offer.sdp) };
        await peerConnection.setLocalDescription(offer);
        socket.emit('offer', offer, signalingId);
    } catch (e) {
        console.error('Error creating offer', e);
    }
});

socket.on('offer', async (offer, userId) => {
    console.log('Received offer, creating answer');
    setupPeerConnection();

    try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        let answer = await peerConnection.createAnswer();
        answer = { type: answer.type, sdp: mangleSDP(answer.sdp) };
        await peerConnection.setLocalDescription(answer);
        socket.emit('answer', answer, signalingId);
    } catch (e) {
        console.error('Error creating answer', e);
    }
});

socket.on('answer', async (answer, userId) => {
    console.log('Received answer');
    try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
    } catch (e) {
        console.error('Error setting remote desc', e);
    }
});

socket.on('ice-candidate', async (candidate, userId) => {
    try {
        if (peerConnection && peerConnection.remoteDescription) {
            await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        }
    } catch (e) {
        console.error('Error adding ICE candidate', e);
    }
});

function setupPeerConnection() {
    if (peerConnection) peerConnection.close();

    peerConnection = new RTCPeerConnection(configuration);

    peerConnection.onicecandidate = (e) => {
        if (e.candidate) {
            socket.emit('ice-candidate', e.candidate, signalingId);
        }
    };

    peerConnection.onconnectionstatechange = () => {
        const state = peerConnection.connectionState;
        auditLog(`🔗 WebRTC connection state → ${state}`);
        if (state === 'connected') {
            updateConnectionStatus('connected');
            showToast('Peer Connected', 'Secure P2P tunnel established.', 'success');
            if (typeof playProceduralSound === 'function') playProceduralSound('chime');

            if (myECDHKeyPair) {
                crypto.subtle.exportKey('jwk', myECDHKeyPair.publicKey).then(jwk => {
                    socket.emit('ecdh-public-key', jwk, signalingId);
                });
            }
        } else if (state === 'disconnected' || state === 'failed') {
            updateConnectionStatus('disconnected');
            showToast('Peer Disconnected', 'The other device left the workspace.', 'error');
        }
    };

    peerConnection.ondatachannel = (e) => {
        setupDataChannel(e.channel);
    };
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
    let mangled = sdp.replace(/x-google-max-bitrate=\d+/g, 'x-google-max-bitrate=1000000');
    mangled = mangled.replace(/x-google-min-bitrate=\d+/g, 'x-google-min-bitrate=1000000');
    mangled = mangled.replace(/x-google-start-bitrate=\d+/g, 'x-google-start-bitrate=1000000');
    if (mangled.indexOf('a=mid:data') !== -1 || mangled.indexOf('m=application') !== -1) {
        mangled = mangled.replace(/(a=mid:data\r?\n)/g, '$1a=b=AS:1000000\r\na=b=TIAS:1000000000\r\n');
        mangled = mangled.replace(/(m=application.*\r?\n)/g, '$1b=AS:1000000\r\nb=TIAS:1000000000\r\n');
    }
    return mangled;
}

function setupDataChannel(channel) {
    dataChannel = channel;

    dataChannel.binaryType = 'arraybuffer';

    dataChannel.onopen = () => {
        console.log('Data channel open');
    };

    dataChannel.onclose = () => {
        console.log('Data channel closed');
    };

    let pendingChunkHeader = null;

    dataChannel.onmessage = async (e) => {
        if (typeof e.data === 'string') {
            const msg = JSON.parse(e.data);

            if (msg.type === 'file-meta-envelope') {

                try {
                    const meta = await decryptMeta(msg.payload);
                    currentFileMeta = meta;
                    receiveBuffer[meta.id] = [];
                    receivedChunks[meta.id] = new Set();
                    currentSpeedStats = { startTime: Date.now(), lastBytes: 0, lastTime: Date.now(), received: 0 };
                    createTransferElement(meta.id, meta.name, meta.size, true);
                    updateTransferProgress(meta.id, 0, 'Receiving...', '0 B/s', '--:--');
                } catch (err) {
                    console.error('Meta decryption failed', err);
                    showToast('Decryption Error', 'Could not decrypt file metadata. Wrong password?', 'error');
                }
            } else if (msg.type === 'chunk-header') {

                pendingChunkHeader = msg;
            } else if (msg.type === 'file-done') {
                finalizeDownload(msg.id);
            }
        } else {

            if (!pendingChunkHeader || !currentFileMeta) return;
            const { fileId, chunkIndex } = pendingChunkHeader;
            pendingChunkHeader = null;

            if (receivedChunks[fileId] && receivedChunks[fileId].has(chunkIndex)) return;

            let chunkData = e.data;

            if (zeroTrustKey) {
                try {

                    const buf = e.data instanceof ArrayBuffer ? e.data : await e.data.arrayBuffer();
                    const iv = new Uint8Array(buf, 0, 12);
                    const cipher = buf.slice(12);
                    chunkData = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, zeroTrustKey, cipher);
                } catch (err) {
                    console.error('Chunk decryption failed', err);
                    updateTransferProgress(currentFileMeta.id, 0, 'DECRYPTION FAILED', '', '');
                    return;
                }
            }

            if (!receiveBuffer[fileId]) receiveBuffer[fileId] = [];
            receiveBuffer[fileId][chunkIndex] = chunkData;
            receivedChunks[fileId].add(chunkIndex);

            const receivedBytes = (receivedChunks[fileId].size) * CHUNK_SIZE;
            const now = Date.now();
            const timeDiff = (now - currentSpeedStats.lastTime) / 1000;
            if (timeDiff >= 0.25) {
                const bytesDiff = receivedBytes - currentSpeedStats.lastBytes;
                const speed = bytesDiff / timeDiff;
                const remaining = Math.max(currentFileMeta.size - receivedBytes, 0);
                updateTransferProgress(
                    currentFileMeta.id,
                    Math.min((receivedBytes / currentFileMeta.size) * 100, 99),
                    'Receiving...',
                    formatSpeed(speed),
                    formatETA(remaining / speed)
                );
                currentSpeedStats.lastTime = now;
                currentSpeedStats.lastBytes = receivedBytes;
            }
        }
    };
}

ui.inputs.file.addEventListener('change', (e) => {
    if (e.target.files.length > 0) handleFiles(e.target.files);
});

if (ui.buttons.browse) {
    ui.buttons.browse.addEventListener('click', () => ui.inputs.file.click());
}

ui.dropZone.addEventListener('drop', async (e) => {
    e.preventDefault();
    const items = e.dataTransfer.items;
    if (items && items.length > 0) {
        let directFiles = [];
        let folderItems = [];
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item.kind === 'file') {
                const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
                if (entry && entry.isDirectory) {
                    folderItems.push(entry);
                } else {
                    directFiles.push(item.getAsFile());
                }
            }
        }
        if (directFiles.length > 0) handleFiles(directFiles);
        for (const folder of folderItems) {
            showToast('Zipping Folder...', `"${folder.name}" is being compressed on your device...`, 'info');
            const zip = new JSZip();
            const flatFiles = [];
            await scanFiles(folder, flatFiles);
            flatFiles.forEach(f => zip.file(f.path, f.file));
            const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 1 } });
            handleFiles([new File([blob], folder.name + '.zip', { type: 'application/zip' })]);
        }
    } else if (e.dataTransfer.files.length > 0) {
        handleFiles(e.dataTransfer.files);
    }
});

function handleFiles(files) {
    if (!dataChannel || dataChannel.readyState !== 'open') {

        const file = files[0];
        const allFiles = Array.from(files);
        const modal = document.getElementById('drop-modal');
        const filenameEl = document.getElementById('drop-modal-filename');
        const waitBtn = document.getElementById('drop-modal-wait');
        const uploadBtn = document.getElementById('drop-modal-upload');
        const progressSection = document.getElementById('drop-modal-progress');
        const progressFill = document.getElementById('drop-progress-fill');
        const progressLabel = document.getElementById('drop-progress-label');
        const resultSection = document.getElementById('drop-modal-result');
        const resultUrl = document.getElementById('drop-result-url');
        const copyBtn = document.getElementById('drop-copy-btn');

        filenameEl.textContent = allFiles.map(f => f.name).join(', ');
        modal.style.display = 'flex';
        progressSection.style.display = 'none';
        resultSection.style.display = 'none';

        waitBtn.onclick = () => { modal.style.display = 'none'; };

        uploadBtn.onclick = async () => {
            console.log('[HostedDrop] Button clicked. hostedDrop=', typeof window.hostedDrop);
            progressSection.style.display = 'block';
            progressFill.style.width = '0%';
            progressLabel.textContent = 'Starting...';
            uploadBtn.disabled = true;
            waitBtn.disabled = true;

            if (!window.hostedDrop) {
                progressLabel.textContent = '❌ Error: hosted-drop.js not loaded. Refresh the page.';
                uploadBtn.disabled = false;
                waitBtn.disabled = false;
                return;
            }

            try {
                const result = await window.hostedDrop(file, (phase, pct) => {
                    console.log('[HostedDrop] Progress:', phase, pct);
                    progressLabel.textContent = phase === 'encrypting'
                        ? 'Encrypting locally...'
                        : `Uploading... ${Math.round(pct)}%`;
                    progressFill.style.width = Math.round(pct) + '%';
                });
                console.log('[HostedDrop] Done. URL=', result.url);
                progressSection.style.display = 'none';
                resultSection.style.display = 'block';
                resultUrl.value = result.url;

                copyBtn.onclick = () => {
                    window.copyToClipboard(result.url).then(() => {
                        copyBtn.innerHTML = '<i class="fa-solid fa-check"></i>';
                        setTimeout(() => copyBtn.innerHTML = '<i class="fa-solid fa-copy"></i>', 2000);
                    }).catch(err => {
                        console.error('Clipboard copy failed:', err);
                        alert('Failed to copy. ' + err.message);
                    });
                };
            } catch (err) {
                console.error('[HostedDrop] Error:', err);
                progressFill.style.width = '0%';
                progressLabel.textContent = `❌ ${err.message}`;
                uploadBtn.disabled = false;
                waitBtn.disabled = false;
            }
        };

        modal.onclick = (e) => { if (e.target === modal) modal.style.display = 'none'; };
        return;
    }

    for (const file of files) {
        sendFile(file);

    }
}

async function sendFile(file) {
    const fileId = Math.random().toString(36).substring(7);
    const useEncryption = !!zeroTrustKey;

    const processedFile = file;

    const rawMeta = {
        type: 'file-meta',
        id: fileId,
        name: processedFile.name,
        size: processedFile.size,
        mime: processedFile.type,
        totalChunks: Math.ceil(processedFile.size / CHUNK_SIZE)
    };
    const metaEnvelope = await encryptMeta(rawMeta);
    dataChannel.send(JSON.stringify({ type: 'file-meta-envelope', payload: metaEnvelope }));
    createTransferElement(fileId, processedFile.name, processedFile.size, false, processedFile);

    activeSends[fileId] = { file: processedFile, chunkIndex: 0, paused: false, fileId };
    let sendStats = { lastTime: Date.now(), lastBytes: 0 };
    let pipeline = [];
    const MAX_PIPELINE = 4;

    dataChannel.bufferedAmountLowThreshold = 64 * 1024 * 1024;

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

            if (useEncryption && encryptWorker) {
                pipeline.push(workerEncrypt(fileId, idx, rawChunk).then(p => ({ idx, p })));
            } else {
                pipeline.push(Promise.resolve({ idx, p: rawChunk }));
            }
        }
    };

    const sendNextChunk = async () => {
        const state = activeSends[fileId];
        if (!state || state.paused) return;
        const totalChunks = Math.ceil(state.file.size / CHUNK_SIZE);

        await pumpPipeline();

        while (pipeline.length > 0) {
            if (dataChannel.bufferedAmount > dataChannel.bufferedAmountLowThreshold) {
                dataChannel.onbufferedamountlow = () => {
                    dataChannel.onbufferedamountlow = null;
                    sendNextChunk();
                };
                return;
            }

            const { idx, p } = await pipeline.shift();
            dataChannel.send(JSON.stringify({ type: 'chunk-header', fileId, chunkIndex: idx }));
            dataChannel.send(p);
            await pumpPipeline();

            const now = Date.now();
            const elapsed = (now - sendStats.lastTime) / 1000;
            if (elapsed >= 0.5 || idx + 1 === totalChunks) {
                const bytesDone = (idx + 1) * CHUNK_SIZE;
                const speed = (bytesDone - sendStats.lastBytes) / elapsed;
                const remaining = state.file.size - bytesDone;
                updateTransferProgress(fileId, Math.min((bytesDone / state.file.size) * 100, 100), useEncryption ? 'Encrypting...' : 'Sending...', formatSpeed(speed), formatETA(remaining / speed));
                sendStats.lastTime = now;
                sendStats.lastBytes = bytesDone;
            }

            if (idx + 1 === totalChunks) {
                dataChannel.send(JSON.stringify({ type: 'file-done', id: fileId }));
                updateTransferProgress(fileId, 100, 'Sent Successfully', '', '');
                auditLog(`✅ "${processedFile.name}" transferred via Hyper-Speed Engine`);
                delete activeSends[fileId];
                if (typeof playProceduralSound === 'function') playProceduralSound('pop');
                return;
            }
        }
    };

    sendNextChunk();
}

function finalizeDownload(fileId) {
    const meta = currentFileMeta;
    if (!meta || meta.id !== fileId) return;

    socket.emit('record-stat', { bytes: meta.size });

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
        downloadBtn.onclick = () => showToast('Saving File', `Downloading ${meta.name}...`, 'info');
    }

    updateTransferProgress(meta.id, 100, 'Ready to Save', '', '');
    showToast('File Received', `${meta.name} is ready to save.`, 'success');

    delete receiveBuffer[fileId];
    delete receivedChunks[fileId];
    currentFileMeta = null;
}

const urlParams = new URL(window.location.href).searchParams;
let workspaceId = urlParams.get('workspace');
let guard = urlParams.get('guard');

if (!workspaceId) {
    workspaceId = localStorage.getItem('ys_workspace');
    guard = localStorage.getItem('ys_guard');
}

if (workspaceId) {
    if (socket.connected) {
        joinRoom(workspaceId, guard);
    } else {
        socket.on('connect', () => joinRoom(workspaceId, guard));
    }
}
