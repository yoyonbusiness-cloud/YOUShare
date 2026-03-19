
let aesKey = null;

self.onmessage = async (e) => {
    const { type, payload, id } = e.data;

    switch (type) {
        case 'import-key': {

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

            const iv = crypto.getRandomValues(new Uint8Array(12));
            const encrypted = await crypto.subtle.encrypt(
                { name: 'AES-GCM', iv },
                aesKey,
                payload.chunk
            );

            const packed = new Uint8Array(12 + encrypted.byteLength);
            packed.set(iv, 0);
            packed.set(new Uint8Array(encrypted), 12);

            self.postMessage(
                { type: 'chunk-encrypted', id, chunkIndex: payload.chunkIndex, data: packed.buffer },
                [packed.buffer]
            );
            break;
        }

        case 'decrypt-chunk': {

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
