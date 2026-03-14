// encrypt-worker.js — Web Worker for AES-GCM encryption/decryption off the main thread
// Runs on a dedicated CPU core, keeping the UI completely smooth during heavy transfers.

// Import the AES key into this worker's context
let aesKey = null;

self.onmessage = async (e) => {
    const { type, payload, id } = e.data;

    switch (type) {
        case 'import-key': {
            // Receive the raw key bytes from the main thread and import into Worker's SubtleCrypto
            const rawKeyBytes = new Uint8Array(payload.rawKey);
            aesKey = await crypto.subtle.importKey(
                'raw',
                rawKeyBytes,
                { name: 'AES-GCM', length: 256 },
                false,
                ['encrypt', 'decrypt']
            );
            self.postMessage({ type: 'key-ready', id });
            break;
        }

        case 'encrypt-chunk': {
            // payload: { chunk: ArrayBuffer, chunkIndex: number }
            const iv = crypto.getRandomValues(new Uint8Array(12));
            const encrypted = await crypto.subtle.encrypt(
                { name: 'AES-GCM', iv },
                aesKey,
                payload.chunk
            );
            // Pack [12-byte IV | ciphertext]
            const packed = new Uint8Array(12 + encrypted.byteLength);
            packed.set(iv, 0);
            packed.set(new Uint8Array(encrypted), 12);
            // Transfer the packed buffer back to main thread (zero-copy)
            self.postMessage(
                { type: 'chunk-encrypted', id, chunkIndex: payload.chunkIndex, data: packed.buffer },
                [packed.buffer]
            );
            break;
        }

        case 'decrypt-chunk': {
            // payload: { chunk: ArrayBuffer (packed: 12-byte IV + ciphertext) }
            const buf = payload.chunk;
            const iv = new Uint8Array(buf, 0, 12);
            const cipher = buf.slice(12);
            try {
                const plain = await crypto.subtle.decrypt(
                    { name: 'AES-GCM', iv },
                    aesKey,
                    cipher
                );
                self.postMessage(
                    { type: 'chunk-decrypted', id, chunkIndex: payload.chunkIndex, data: plain },
                    [plain]
                );
            } catch (err) {
                self.postMessage({ type: 'decrypt-error', id, chunkIndex: payload.chunkIndex, error: err.message });
            }
            break;
        }
    }
};
