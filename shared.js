

if (window.location.hostname === '0.0.0.0') {
    window.location.hostname = 'localhost';
}

const CustomDialog = {
    _createOverlay() {
        const overlay = document.createElement('div');
        overlay.className = 'drop-modal-overlay';
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.8);backdrop-filter:blur(10px);display:flex;align-items:center;justify-content:center;z-index:10000;opacity:0;transition:opacity 0.3s ease;';
        return overlay;
    },
    _createModal(title, message, isPrompt = false, defaultValue = '') {
        const modal = document.createElement('div');
        modal.className = 'drop-modal';
        modal.style.cssText = 'background:var(--bg-base);border:1px solid var(--card-border);border-radius:24px;padding:2.5rem;max-width:400px;width:90%;text-align:center;box-shadow:0 40px 80px rgba(0,0,0,0.8);transform:translateY(20px);transition:transform 0.3s ease;';
        
        let inputHtml = '';
        if (isPrompt) {
            inputHtml = `<input type="text" id="custom-dialog-input" class="form-input text-center" value="${defaultValue}" style="margin-top:1.5rem;width:100%;background:rgba(0,0,0,0.3);border-color:var(--card-border);" autocomplete="off">`;
        }

        modal.innerHTML = `
            <h2 style="font-size:1.5rem;font-weight:800;margin-bottom:1rem;color:var(--text-pure);">${title}</h2>
            <p style="color:var(--text-secondary);line-height:1.6;margin-bottom:2rem;">${message}</p>
            ${inputHtml}
            <div style="display:flex;gap:1rem;margin-top:2rem;">
                <button id="custom-dialog-cancel" class="btn-pill btn-ghost" style="flex:1;border-color:var(--btn-ghost-border);color:var(--text-primary);">CANCEL</button>
                <button id="custom-dialog-ok" class="btn-pill btn-white" style="flex:1;background:var(--btn-white-bg);color:var(--btn-white-text);font-weight:bold;">OK</button>
            </div>
        `;
        return modal;
    },
    confirm(title, message) {
        return new Promise((resolve) => {
            const overlay = this._createOverlay();
            const modal = this._createModal(title, message);
            overlay.appendChild(modal);
            document.body.appendChild(overlay);
            
            requestAnimationFrame(() => {
                overlay.style.opacity = '1';
                modal.style.transform = 'translateY(0)';
            });

            let settled = false;
            const cleanup = (result) => {
                if (settled) return;
                settled = true;
                resolve(result);
                modal.classList.add('vanish-sand');
                overlay.style.opacity = '0';
                setTimeout(() => {
                    overlay.remove();
                }, 800);
            };

            overlay.querySelector('#custom-dialog-ok').onclick = () => cleanup(true);
            overlay.querySelector('#custom-dialog-cancel').onclick = () => cleanup(false);
            overlay.onclick = (e) => { if(e.target === overlay) cleanup(false); };
        });
    },
    alert(title, message) {
        return new Promise((resolve) => {
            const overlay = this._createOverlay();
            const modal = this._createModal(title, message);
            const cancelBtn = modal.querySelector('#custom-dialog-cancel');
            if (cancelBtn) cancelBtn.remove();
            overlay.appendChild(modal);
            document.body.appendChild(overlay);
            
            requestAnimationFrame(() => {
                overlay.style.opacity = '1';
                modal.style.transform = 'translateY(0)';
            });

            let settled = false;
            const cleanup = () => {
                if (settled) return;
                settled = true;
                resolve();
                modal.classList.add('vanish-sand');
                overlay.style.opacity = '0';
                setTimeout(() => {
                    overlay.remove();
                }, 800);
            };

            overlay.querySelector('#custom-dialog-ok').onclick = cleanup;
            overlay.onclick = (e) => { if(e.target === overlay) cleanup(); };
        });
    },
    prompt(title, message, defaultValue = '') {
        return new Promise((resolve) => {
            const overlay = this._createOverlay();
            const modal = this._createModal(title, message, true, defaultValue);
            overlay.appendChild(modal);
            document.body.appendChild(overlay);
            
            const input = modal.querySelector('#custom-dialog-input');
            
            requestAnimationFrame(() => {
                overlay.style.opacity = '1';
                modal.style.transform = 'translateY(0)';
                if(input) { input.focus(); input.select(); }
            });

            const cleanup = (result) => {
                modal.classList.add('vanish-sand');
                overlay.style.opacity = '0';
                setTimeout(() => {
                    overlay.remove();
                    resolve(result);
                }, 800);
            };

            overlay.querySelector('#custom-dialog-ok').onclick = () => cleanup(input.value);
            overlay.querySelector('#custom-dialog-cancel').onclick = () => cleanup(null);
            input.onkeydown = (e) => {
                if(e.key === 'Enter') cleanup(input.value);
                if(e.key === 'Escape') cleanup(null);
            };
            overlay.onclick = (e) => { if(e.target === overlay) cleanup(null); };
        });
    }
};

async function stripMetadata(file) {
    if (!(file.type === 'image/jpeg' || file.name.toLowerCase().endsWith('.jpg') || file.name.toLowerCase().endsWith('.jpeg'))) {
        return file;
    }
    const buffer = await file.arrayBuffer();
    const arr = new Uint8Array(buffer);
    
    if (file.type === 'image/jpeg' || file.name.toLowerCase().endsWith('.jpg') || file.name.toLowerCase().endsWith('.jpeg')) {
        let newArr = [];
        if (arr[0] === 0xFF && arr[1] === 0xD8) {
            newArr.push(0xFF, 0xD8);
            let i = 2;
            while (i < arr.length - 1) {
                if (arr[i] === 0xFF) {
                    const marker = arr[i+1];
                    if (marker === 0x00) {
                        newArr.push(0xFF, 0x00);
                        i += 2;
                        continue;
                    }
                    if (marker >= 0xD0 && marker <= 0xD7) {
                        newArr.push(0xFF, marker);
                        i += 2;
                        continue;
                    }
                    if (marker === 0xD9) {
                        newArr.push(0xFF, 0xD9);
                        break;
                    }
                    const length = (arr[i+2] << 8) | arr[i+3];
                    const isAppSegment = marker >= 0xE0 && marker <= 0xEF;
                    const isComment = marker === 0xFE;
                    
                    if (!isAppSegment && !isComment) {
                        for (let j = 0; j < length + 2; j++) {
                            newArr.push(arr[i + j]);
                        }
                    }
                    i += length + 2;
                } else {
                    newArr.push(arr[i]);
                    i++;
                }
            }
            return new File([new Uint8Array(newArr)], file.name, { type: file.type });
        }
    } else if (file.type === 'image/png' || file.name.toLowerCase().endsWith('.png')) {
        let newArr = [];
        const sig = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
        newArr.push(...sig);
        let i = 8;
        while (i < arr.length - 8) {
            const length = (arr[i] << 24) | (arr[i+1] << 16) | (arr[i+2] << 8) | arr[i+3];
            const type = String.fromCharCode(arr[i+4], arr[i+5], arr[i+6], arr[i+7]);
            if (type === 'IHDR' || type === 'IDAT' || type === 'IEND' || type === 'PLTE' || type === 'tRNS') {
                for (let j = 0; j < length + 12; j++) {
                    newArr.push(arr[i + j]);
                }
            }
            i += length + 12;
        }
        return new File([new Uint8Array(newArr)], file.name, { type: file.type });
    }
    return file;
}

function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return (bytes / Math.pow(k, i)).toFixed(2) + ' ' + sizes[i];
}

function formatExpiryCountdown(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return 'Expired';
    const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    const isMobile = /Mobi|Android/i.test(navigator.userAgent);
    const isDetailed = isMobile || localStorage.getItem('emit-detailed-timer') === 'true';

    if (isDetailed) {
        const totalMinutes = Math.floor(totalSeconds / 60);
        if (totalMinutes > 0) {
            return `${totalMinutes} min${s > 0 ? ` ${s} sec` : ''}`;
        }
        return `${s} sec`;
    }

    if (h > 0) {
        if (m > 0) {
            return `${h} hr ${m} min`;
        }
        return `${h} hr`;
    }
    if (m > 0) {
        if (s > 0) {
            return `${m} min ${s} sec`;
        }
        return `${m} min`;
    }
    return `${s} sec`;
}

window.uiShared = { CustomDialog, stripMetadata, formatBytes, formatExpiryCountdown };
