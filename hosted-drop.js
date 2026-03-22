
const DROP_MAX_BYTES = 512 * 1024 * 1024; 

async function generateDropKey() {
    return await crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        true, 
        ['encrypt', 'decrypt']
    );
}

async function exportDropKey(key) {
    const raw = await crypto.subtle.exportKey('raw', key);
    return btoa(String.fromCharCode(...new Uint8Array(raw)));
}

async function importDropKey(b64) {
    const raw = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    return await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
}

async function hostedDrop(file, onProgress) {
    if (file.size > DROP_MAX_BYTES) {
        throw new Error(`File too large for hosted drop (max 512 MB). Use P2P for large files.`);
    }

    const key = await generateDropKey();
    const keyB64 = await exportDropKey(key);

    onProgress?.('encrypting', 0);
    if (window.auditLog) auditLog(`🔒 Generating drop key for "${file.name}"`);

    const iv = crypto.getRandomValues(new Uint8Array(12));
    const buf = await file.arrayBuffer();
    const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, buf);

    const packed = new Uint8Array(12 + cipher.byteLength);
    packed.set(iv, 0);
    packed.set(new Uint8Array(cipher), 12);

    onProgress?.('uploading', 0);
    if (window.auditLog) auditLog(`📤 Uploading encrypted drop (${(packed.byteLength / 1e6).toFixed(1)} MB) — server sees only ciphertext`);

    const token = await new Promise((resolve, reject) => {
        const fd = new FormData();
        fd.append('file', new Blob([packed.buffer]), file.name + '.enc');
        fd.append('name', file.name);

        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/upload');
        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) onProgress?.('uploading', (e.loaded / e.total) * 100);
        };
        xhr.onload = () => {
            if (xhr.status === 200) {
                const data = JSON.parse(xhr.responseText);
                resolve(data.token);
            } else {
                reject(new Error('Upload failed: ' + xhr.statusText));
            }
        };
        xhr.onerror = () => reject(new Error('Network error during upload'));
        xhr.send(fd);
    });

    if (window.auditLog) auditLog(`✅ Drop stored. Token: ${token} — key never sent to server`);

    const url = `${window.location.origin}/drop.html?t=${token}#key=${encodeURIComponent(keyB64)}`;
    return { url, token, keyB64, expires: Date.now() + 60 * 60 * 1000 };
}

async function receiveHostedDrop() {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('t');
    const hash = window.location.hash;

    if (!token || !hash.startsWith('#key=')) return false;
    const keyB64 = decodeURIComponent(hash.slice(5));

    let meta;
    try {
        const r = await fetch(`/drop-info/${token}`);
        if (!r.ok) throw new Error('expired');
        meta = await r.json();
    } catch {
        document.getElementById('drop-status').textContent = '❌ This drop has expired or was never created.';
        return true;
    }

    const statusEl = document.getElementById('drop-status');
    const downloadBtn = document.getElementById('drop-download-btn');
    const filenameEl = document.getElementById('drop-filename');
    const sizeEl = document.getElementById('drop-size');

    const expiresIn = Math.round((meta.expires - Date.now()) / 60000);
    if (filenameEl) filenameEl.textContent = meta.filename;
    if (sizeEl) sizeEl.textContent = `${(meta.size / 1e6).toFixed(2)} MB · expires in ${expiresIn} min`;
    if (statusEl) statusEl.textContent = 'Ready to download — decryption happens in your browser.';

    downloadBtn?.addEventListener('click', async () => {
        downloadBtn.disabled = true;
        downloadBtn.textContent = 'Downloading...';

        const resp = await fetch(`/download/${token}`);
        const packedBuf = await resp.arrayBuffer();

        downloadBtn.textContent = 'Decrypting...';
        const key = await importDropKey(keyB64);
        const iv = new Uint8Array(packedBuf, 0, 12);
        const cipher = packedBuf.slice(12);
        let plain;
        try {
            plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
        } catch {
            downloadBtn.textContent = 'Decryption failed — wrong link?';
            return;
        }

        const blob = new Blob([plain]);
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = meta.filename;
        a.click();
        downloadBtn.textContent = '✓ Downloaded';
    });

    return true;
}

window.hostedDrop = hostedDrop;
window.receiveHostedDrop = receiveHostedDrop;
