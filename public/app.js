
const ui = {
    screens: {
        room: document.getElementById('screen-room'),
        transfer: document.getElementById('screen-transfer')
    },
    buttons: {
        join: document.getElementById('join-btn'),
        leave: document.getElementById('leave-btn'),
        browse: document.getElementById('browse-btn'),
        btnCopyCodeHome: document.getElementById('btn-copy-code-home'),
        btnCopyCode: document.getElementById('btn-copy-code'),
        btnCopyLink: document.getElementById('btn-copy-link'),
        cancelShare: document.getElementById('cancel-share-btn'),
        cancelJoin: document.getElementById('cancel-join-btn'),
        showGenerate: document.getElementById('show-generate-btn'),
        showJoin: document.getElementById('show-join-btn'),
        finalJoinGenerated: document.getElementById('final-join-generated-btn'),
        destroy: document.getElementById('destroy-btn'),
        leaveCancel: document.getElementById('leave-cancel-btn'),
        leaveConfirm: document.getElementById('leave-confirm-btn'),
        destroyCancel: document.getElementById('destroy-cancel-btn'),
        destroyConfirm: document.getElementById('destroy-confirm-btn'),
        logo: document.querySelector('.logo'),
        browseFolder: document.getElementById('browse-folder-btn')
    },
    inputs: {
        roomId: document.getElementById('room-id-input'),
        file: document.getElementById('file-input'),
        folderInput: document.getElementById('folder-input'),
        shareUrl: document.getElementById('share-url'),
        customWord: document.getElementById('custom-word-input'),
        joinSecret: document.getElementById('join-secret-input')
    },
    panels: {
        actionSelection: document.getElementById('action-selection-panel'),
        share: document.getElementById('share-workspace-panel'),
        join: document.getElementById('join-workspace-panel'),
        leaveModal: document.getElementById('leave-modal'),
        destroyModal: document.getElementById('destroy-modal')
    },
    qrContainer: document.getElementById('qrcode'),
    text: {
        currentRoom: document.getElementById('current-room-display'),
        displayRoomCode: document.getElementById('display-room-code'),
        displayRoomCodeHome: document.getElementById('display-room-code-home')
    },
    dropZone: document.getElementById('drop-zone'),
    transfersContainer: document.getElementById('transfers-container'),
    toastContainer: document.getElementById('toast-container'),
    status: {
        dot: document.querySelector('.status-dot'),
        text: document.querySelector('.status-text')
    }
};

function showScreen(screenName) {
    Object.values(ui.screens).forEach(screen => {
        screen.classList.remove('active');
    });
    ui.screens[screenName].classList.add('active');
}

const auditConsole = document.getElementById('audit-console');
const auditToggleBtn = document.getElementById('audit-toggle-btn');
const auditCloseBtn = document.getElementById('audit-close-btn');

if (auditToggleBtn) {
    auditToggleBtn.addEventListener('click', () => {
        auditConsole.classList.toggle('open');
        auditToggleBtn.classList.toggle('active', auditConsole.classList.contains('open'));
    });
}
if (auditCloseBtn) {
    auditCloseBtn.addEventListener('click', () => {
        auditConsole.classList.remove('open');
        auditToggleBtn.classList.remove('active');
    });
}


const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
function playProceduralSound(type) {
    if(audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    
    if (type === 'pop') {
       
        osc.type = 'sine';
        osc.frequency.setValueAtTime(800, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(1200, audioCtx.currentTime + 0.05);
        gainNode.gain.setValueAtTime(0.3, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.1);
    } else if (type === 'chime') {
       
        osc.type = 'sine';
        osc.frequency.setValueAtTime(523.25, audioCtx.currentTime);
        osc.frequency.setValueAtTime(659.25, audioCtx.currentTime + 0.1);
        gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
        gainNode.gain.linearRampToValueAtTime(0.2, audioCtx.currentTime + 0.05);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.6);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.6);
    }
}

function updateConnectionStatus(state, message) {
    ui.status.dot.className = `status-dot ${state}`;
    const badge = document.querySelector('.e2e-badge');
    if (badge) badge.classList.toggle('is-waiting', state === 'waiting' || state === 'connecting');

    let niceMessage = message;
    if (state === "connected") niceMessage = "Workspace Connected";
    if (state === "connecting") niceMessage = "Establishing Link...";
    if (state === "waiting") niceMessage = "Active • Waiting for peer";
    if (state === "disconnected") niceMessage = "Workspace Offline";
    
    ui.status.text.textContent = niceMessage;
}

function showToast(title, message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    let iconClass = 'fa-circle-info';
    if (type === 'success') iconClass = 'fa-circle-check';
    if (type === 'error') iconClass = 'fa-circle-exclamation';

    toast.innerHTML = `
        <i class="fa-solid ${iconClass} toast-icon"></i>
        <div class="toast-content">
            <h4 class="toast-title">${title}</h4>
            <div class="toast-message">${message}</div>
        </div>
    `;
    
    ui.toastContainer.appendChild(toast);
    
   
    setTimeout(() => toast.classList.add('show'), 10);
    
   
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

function generateSecureWorkspaceId() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    const randomArray = new Uint8Array(8);
    window.crypto.getRandomValues(randomArray);
    
    for (let i = 0; i < 8; i++) {
        result += chars[randomArray[i] % chars.length];
    }
    
    return `${result.slice(0,4)}-${result.slice(4,8)}`;
}

ui.inputs.roomId.addEventListener('input', (e) => {
   
    if (e.target.value.includes('?workspace=')) return;
    
    let val = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (val.length > 4) {
        val = val.slice(0,4) + '-' + val.slice(4,8);
    }
    e.target.value = val;
});

window.copyToClipboard = function(text) {
    if (navigator.clipboard && window.isSecureContext) {
        return navigator.clipboard.writeText(text);
    } else {
        return new Promise((resolve, reject) => {
            let textArea = document.createElement("textarea");
            textArea.value = text;
            textArea.style.position = "fixed";
            textArea.style.left = "-999999px";
            textArea.style.top = "-999999px";
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            try {
                document.execCommand('copy');
                textArea.remove();
                resolve();
            } catch (err) {
                textArea.remove();
                reject(err);
            }
        });
    }
};


let currentGeneratedCode = null;

ui.buttons.showGenerate.addEventListener('click', () => {
   
    ui.panels.actionSelection.style.display = 'none';
    ui.panels.join.style.display = 'none';
    ui.panels.share.style.display = 'block';
    
   
    currentGeneratedCode = generateSecureWorkspaceId();
    ui.text.displayRoomCodeHome.textContent = currentGeneratedCode;
    
    showToast('Vault Generated', 'Secure code created locally.', 'success');
});

ui.buttons.showJoin.addEventListener('click', () => {
   
    ui.panels.actionSelection.style.display = 'none';
    ui.panels.share.style.display = 'none';
    ui.panels.join.style.display = 'block';
});

ui.buttons.cancelShare.addEventListener('click', () => {
    ui.panels.share.style.display = 'none';
    ui.panels.actionSelection.style.display = 'flex';
    currentGeneratedCode = null;
});

ui.buttons.cancelJoin.addEventListener('click', () => {
    ui.panels.join.style.display = 'none';
    ui.panels.actionSelection.style.display = 'flex';
});

if (ui.buttons.logo) {
    ui.buttons.logo.addEventListener('click', () => {
        window.location.href = '/';
    });
}

if (ui.buttons.browseFolder) {
    ui.buttons.browseFolder.addEventListener('click', () => {
        if (ui.inputs.folderInput) ui.inputs.folderInput.click();
    });
}

if (ui.inputs.folderInput) {
    ui.inputs.folderInput.addEventListener('change', async (e) => {
        const files = Array.from(e.target.files);
        if (!files.length) return;
        if (typeof JSZip === 'undefined') { showToast('Error', 'JSZip not loaded.', 'error'); return; }
        const folderName = files[0].webkitRelativePath.split('/')[0] || 'folder';
        showToast('Zipping Folder...', `"${folderName}" is being compressed...`, 'info');
        const zip = new JSZip();
        files.forEach(f => zip.file(f.webkitRelativePath || f.name, f));
        const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 1 } });
        if (typeof handleFiles === 'function') handleFiles([new File([blob], folderName + '.zip', { type: 'application/zip' })]);
        e.target.value = '';
    });
}


ui.buttons.destroy.addEventListener('click', () => {
    if (typeof peerConnection !== 'undefined' && peerConnection && peerConnection.connectionState === 'connected') {
        ui.panels.destroyModal.style.display = 'flex';
    } else {
        if (typeof performWipe === 'function') performWipe();
        socket.emit('destroy-room', signalingId);
        showToast('Workspace Destroyed', 'Sole user session terminated instantly.', 'success');
    }
});

ui.buttons.destroyCancel.addEventListener('click', () => {
    ui.panels.destroyModal.style.display = 'none';
});

ui.buttons.leave.addEventListener('click', () => {
    ui.panels.leaveModal.style.display = 'flex';
});

ui.buttons.leaveCancel.addEventListener('click', () => {
    ui.panels.leaveModal.style.display = 'none';
});

ui.buttons.finalJoinGenerated.addEventListener('click', (e) => {
    e.preventDefault();
    const secret = ui.inputs.customWord ? ui.inputs.customWord.value.trim() : '';
    if (currentGeneratedCode && typeof joinRoom === 'function') {
        joinRoom(currentGeneratedCode, secret);
    }
});

ui.buttons.btnCopyCodeHome.addEventListener('click', () => {
    if (currentGeneratedCode) {
        window.copyToClipboard(currentGeneratedCode).then(() => {
            showToast('Code Copied', 'Secure code copied to clipboard.', 'success');
        }).catch(() => showToast('Error', 'Failed to copy code on mobile.', 'error'));
    }
});

let qrcodeObj = null;

ui.buttons.join.addEventListener('click', () => {
    const val = ui.inputs.roomId.value;
    const secret = ui.inputs.joinSecret ? ui.inputs.joinSecret.value.trim() : '';
    if (typeof joinRoom === 'function') {
        joinRoom(val, secret);
    }
});

ui.buttons.btnCopyCode.addEventListener('click', () => {
    let code = '';
    if (ui.text.displayRoomCode && ui.text.displayRoomCode.textContent !== '----') {
        code = ui.text.displayRoomCode.textContent;
    } else {
        code = ui.inputs.roomId.value;
    }
    window.copyToClipboard(code).then(() => {
        showToast('Code Copied', `Secure code copied to clipboard.`, 'success');
    }).catch(() => showToast('Error', 'Failed to copy code.', 'error'));
});

ui.buttons.btnCopyLink.addEventListener('click', () => {
    const val = ui.inputs.shareUrl ? ui.inputs.shareUrl.value : '';
    window.copyToClipboard(val)
        .then(() => showToast('Link Copied', 'Direct link copied to clipboard.', 'info'))
        .catch(() => showToast('Error', 'Failed to copy link.', 'error'));
});

['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    ui.dropZone.addEventListener(eventName, preventDefaults, false);
});

function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
}

['dragenter', 'dragover'].forEach(eventName => {
    ui.dropZone.addEventListener(eventName, () => ui.dropZone.classList.add('dragover'), false);
});

['dragleave', 'drop'].forEach(eventName => {
    ui.dropZone.addEventListener(eventName, () => ui.dropZone.classList.remove('dragover'), false);
});

function createTransferElement(fileId, name, size, isReceiving, dataBlob = null) {
    const container = document.getElementById('transfers-container');
    const sizeFormatted = (size / (1024 * 1024)).toFixed(2) + ' MB';

    let iconClass = 'fa-file';
    const ext = name.split('.').pop().toLowerCase();
    if (['jpg','jpeg','png','gif','svg','webp'].includes(ext)) iconClass = 'fa-file-image';
    else if (['mp4','mov','avi','mkv','webm'].includes(ext)) iconClass = 'fa-file-video';
    else if (['pdf'].includes(ext)) iconClass = 'fa-file-pdf';
    else if (['zip','rar','7z'].includes(ext)) iconClass = 'fa-file-zipper';
    else if (['txt','md','doc','docx'].includes(ext)) iconClass = 'fa-file-lines';

    const directionLabel = isReceiving ? 'Receiving' : 'Sending';
    const directionIcon = isReceiving ? 'fa-arrow-down' : 'fa-arrow-up';

    let thumbnail = '';
    if (dataBlob && ['jpg','jpeg','png','gif','webp'].includes(ext)) {
        const url = URL.createObjectURL(dataBlob);
        thumbnail = `<img src="${url}" style="width:48px;height:48px;border-radius:12px;object-fit:cover;">`;
    } else if (dataBlob && ['mp4','webm'].includes(ext)) {
        const url = URL.createObjectURL(dataBlob);
        thumbnail = `<video src="${url}" style="width:48px;height:48px;border-radius:12px;object-fit:cover;" autoplay muted loop></video>`;
    } else {
        thumbnail = `<i class="fa-solid ${iconClass}" style="font-size:1.4rem;color:var(--text-secondary);"></i>`;
    }

    const li = document.createElement('li');
    li.className = 'transfer-item';
    li.id = `item-${fileId}`;
    li.innerHTML = `
        <div class="transfer-icon" id="thumb-${fileId}">${thumbnail}</div>
        <div class="transfer-details">
            <span class="transfer-name" title="${name}">${name}</span>
            <span class="transfer-info-text">${sizeFormatted} &bull; <i class="fa-solid ${directionIcon}"></i> ${directionLabel}</span>
        </div>
        <div class="transfer-progress-container" id="progress-area-${fileId}">
            <div class="progress-bar-bg">
                <div class="progress-bar-fill" id="fill-${fileId}"></div>
            </div>
            <div class="transfer-info-text" id="stats-${fileId}" style="display:flex;justify-content:space-between;margin-top:4px;">
                <span id="status-${fileId}">Preparing...</span>
                <span id="pct-${fileId}">0%</span>
            </div>
        </div>
        <div class="transfer-actions" style="display:flex; gap: 8px; align-items: center;">
            <a class="btn-download" id="download-btn-${fileId}" style="pointer-events: ${isReceiving ? 'none' : 'auto'}; opacity: ${isReceiving ? '0.4' : '1'};"><i class="fa-solid fa-download"></i> Save</a>
            <button class="action-icon" id="cancel-transfer-${fileId}" title="Cancel"><i class="fa-solid fa-xmark"></i></button>
        </div>
    `;
    container.prepend(li);
}

function updateTransferProgress(fileId, percent, statusText, speedStr, etaStr) {
    const bar = document.getElementById(`fill-${fileId}`);
    const pct = document.getElementById(`pct-${fileId}`);
    const stat = document.getElementById(`status-${fileId}`);
    const item = document.getElementById(`item-${fileId}`);
    
    if (bar) bar.style.width = `${percent}%`;
    if (pct) pct.textContent = `${Math.round(percent)}%`;
    if (stat) stat.textContent = statusText;
    
    if (percent === 100 && item) {
        item.classList.add('completed');
        const fill = item.querySelector('.progress-bar-fill');
        if (fill) fill.style.background = 'var(--accent-emerald)';
        
       
        const statsArea = document.getElementById(`stats-${fileId}`);
        if (statsArea) {
             statsArea.innerHTML = `<span class="status-label ${statusText.toLowerCase().includes('complete') ? 'received' : 'sent'}">${statusText}</span>`;
        }
    }
}

window.ui = ui;
window.showScreen = showScreen;
window.updateConnectionStatus = updateConnectionStatus;
window.createTransferElement = createTransferElement;
window.updateTransferProgress = updateTransferProgress;
window.showToast = showToast;

socket.on('global-stats-updated', (stats) => {
    const gb = (stats.bytesTransferred / (1024 * 1024 * 1024)).toFixed(3);
    const count = stats.filesTransferred;
    
    const globalBytesEl = document.getElementById('global-bytes');
    const globalCountEl = document.getElementById('global-count');
    
    if (globalBytesEl) globalBytesEl.textContent = `${gb} GB`;
    if (globalCountEl) globalCountEl.textContent = count;
});

let dragCounter = 0;
const dropOverlay = document.getElementById('fullscreen-drop-overlay');

window.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragCounter++;
    if (dragCounter === 1 && document.getElementById('screen-transfer').classList.contains('active')) {
        dropOverlay.classList.add('active');
    }
});

window.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dragCounter--;
    if (dragCounter === 0) {
        dropOverlay.classList.remove('active');
    }
});

window.addEventListener('dragover', (e) => {
    e.preventDefault();
});

async function scanFiles(item, container, path = '') {
    if (item.isFile) {
        return new Promise((resolve) => {
            item.file((file) => {
                container.push({ path: path + file.name, file: file });
                resolve();
            });
        });
    } else if (item.isDirectory) {
        const dirReader = item.createReader();
        const readAllEntries = () => new Promise((resolve) => {
            const allEntries = [];
            const readBatch = () => {
                dirReader.readEntries(async (batch) => {
                    if (batch.length === 0) {
                        resolve(allEntries);
                    } else {
                        allEntries.push(...batch);
                        readBatch();
                    }
                });
            };
            readBatch();
        });
        const entries = await readAllEntries();
        const promises = entries.map(entry => scanFiles(entry, container, path + item.name + '/'));
        await Promise.all(promises);
    }
}

window.addEventListener('drop', async (e) => {
    e.preventDefault();
    dragCounter = 0;
    dropOverlay.classList.remove('active');
    
    if (document.getElementById('screen-transfer').classList.contains('active')) {
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

           
            if (directFiles.length > 0 && typeof handleFiles === 'function') {
                handleFiles(directFiles);
            }

           
            if (folderItems.length > 0 && typeof JSZip !== 'undefined') {
                showToast('Zipping Folder...', 'Compressing securely on your device...', 'info');
                for (let folder of folderItems) {
                    const zip = new JSZip();
                    let flatFiles = [];
                    await scanFiles(folder, flatFiles);
                    
                    flatFiles.forEach(f => {
                        zip.file(f.path, f.file);
                    });
                    
                    const blob = await zip.generateAsync({type:"blob"});
                    const zipFile = new File([blob], folder.name + ".zip", { type: "application/zip" });
                    
                    if (typeof handleFiles === 'function') {
                        handleFiles([zipFile]);
                    }
                }
            }
        }
    }
});

let lastMove = 0;
document.addEventListener('mousemove', (e) => {
    const now = Date.now();
    if (now - lastMove < 30) return;
    lastMove = now;

    const cards = document.querySelectorAll('.sleek-card');
    cards.forEach(card => {
        if (card.closest('.screen') && card.closest('.screen').classList.contains('active')) {
            const rect = card.getBoundingClientRect();
            const x = e.clientX - rect.left - rect.width / 2;
            const y = e.clientY - rect.top - rect.height / 2;
            const rx = -(y / rect.height) * 4;
            const ry = (x / rect.width) * 4;
            card.style.transform = `perspective(1200px) rotateX(${rx}deg) rotateY(${ry}deg) translateZ(0)`;
        }
    });
});

document.addEventListener('mouseleave', () => {
    document.querySelectorAll('.sleek-card').forEach(card => {
        card.style.transform = 'perspective(1200px) rotateX(0deg) rotateY(0deg) translateZ(0)';
    });
});

window.addEventListener('paste', (e) => {
    if (document.getElementById('screen-transfer').classList.contains('active')) {
        if (e.clipboardData.files && e.clipboardData.files.length > 0) {
            if (typeof handleFiles === 'function') {
                handleFiles(e.clipboardData.files);
            }
        }
    }
});
