
let aesKeyResolve = null;
let aesKeyPromise = new Promise(r => aesKeyResolve = r);

self.onmessage = async (e) => {
    const { type, payload, id } = e.data;

    switch (type) {
        case 'import-key': {
            try {
                const rawKeyBytes = new Uint8Array(payload.rawKey);
                const key = await crypto.subtle.importKey(
                    'raw',
                    rawKeyBytes,
                    { name: 'AES-GCM', length: 256 },
                    false,
                    ['encrypt', 'decrypt']
                );
                
                // Allow resetting the key for new rooms/sessions in the same tab
                aesKeyPromise = Promise.resolve(key);
                if (aesKeyResolve) aesKeyResolve(key);

                self.postMessage({ type: 'key-ready', id });
            } catch (err) {
                self.postMessage({ type: 'key-error', id, error: err.message });
            }
            break;
        }

        case 'encrypt-chunk': {
            try {
                const key = await aesKeyPromise;
                const iv = crypto.getRandomValues(new Uint8Array(12));
                const encrypted = await crypto.subtle.encrypt(
                    { name: 'AES-GCM', iv },
                    key,
                    payload.chunk
                );

                const packed = new Uint8Array(12 + encrypted.byteLength);
                packed.set(iv, 0);
                packed.set(new Uint8Array(encrypted), 12);

                self.postMessage(
                    { type: 'chunk-encrypted', id, chunkIndex: payload.chunkIndex, data: packed.buffer },
                    [packed.buffer]
                );
            } catch (err) {
                self.postMessage({ type: 'encrypt-error', id, chunkIndex: payload.chunkIndex, error: err.message });
            }
            break;
        }

        case 'decrypt-chunk': {
            try {
                const key = await aesKeyPromise;
                const buf = payload.chunk;
                const iv = new Uint8Array(buf, 0, 12);
                const cipher = buf.slice(12);
                const plain = await crypto.subtle.decrypt(
                    { name: 'AES-GCM', iv },
                    key,
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
