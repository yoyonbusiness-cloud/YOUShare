
window.ui = {
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
        showHosted: document.getElementById('show-hosted-btn'),
        finalJoinGenerated: document.getElementById('final-join-generated-btn'),
        destroy: document.getElementById('destroy-btn'),
        leaveCancel: document.getElementById('leave-cancel-btn'),
        leaveConfirm: document.getElementById('leave-confirm-btn'),
        destroyCancel: document.getElementById('destroy-cancel-btn'),
        destroyConfirm: document.getElementById('destroy-confirm-btn'),
        destroyInstant: document.getElementById('destroy-instant-btn'),
        logo: document.querySelector('.logo'),
        browseFolder: document.getElementById('browse-folder-btn'),
        promptSecretCancel: document.getElementById('prompt-secret-cancel'),
        promptSecretSubmit: document.getElementById('prompt-secret-submit'),
        shortcutsBtn: document.getElementById('shortcuts-toggle-btn'),
        settingsBtn: document.getElementById('settings-toggle-btn'),
        patchNotesBtn: document.getElementById('patch-notes-toggle-btn')
    },
    inputs: {
        roomId: document.getElementById('room-id-input'),
        file: document.getElementById('file-input'),
        folderInput: document.getElementById('folder-input'),
        shareUrl: document.getElementById('share-url'),
        customWord: document.getElementById('custom-word-input'),
        joinSecret: document.getElementById('join-secret-input'),
        includeSecretCheckbox: document.getElementById('include-secret-checkbox'),
        promptSecret: document.getElementById('prompt-secret-input')
    },
    panels: {
        actionSelection: document.getElementById('action-selection-panel'),
        share: document.getElementById('share-workspace-panel'),
        join: document.getElementById('join-workspace-panel'),
        leaveModal: document.getElementById('leave-modal'),
        destroyModal: document.getElementById('destroy-modal'),
        inactivityModal: document.getElementById('inactivity-modal'),
        secretPromptModal: document.getElementById('secret-prompt-modal'),
        shortcutsModal: document.getElementById('shortcuts-modal'),
        patchNotesModal: document.getElementById('patch-notes-modal'),
        settingsModal: document.getElementById('settings-modal'),
        auditConsole: document.getElementById('audit-console')
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
    },
    shortcutsModal: document.getElementById('shortcuts-modal')
};


window.addEventListener('DOMContentLoaded', () => {
    if (typeof ActivityTracker !== 'undefined' && ui.panels.actionSelection) {
        ActivityTracker.init(ui.panels.actionSelection);
    }
});


function loadPublicRooms() {
    if (typeof socket !== 'undefined' && socket.emit) {
        socket.emit('list-public-rooms');
    }
}

let _cachedPublicRooms = [];
window._cachedPublicRooms = _cachedPublicRooms;

function renderPublicRoomsList(rooms) {
    const container = document.getElementById('tracker-public-rooms-list');
    const searchInput = document.getElementById('tracker-discovery-search');
    if (!container) return;

    const list = (rooms && rooms.length) ? rooms : (window._cachedPublicRooms || []);
    const query = (searchInput ? searchInput.value.trim().toLowerCase() : '');
    const scheduleConfig = JSON.parse(localStorage.getItem('ys_rooms_schedule') || '{}');
    const filtered = list.filter(r => {
        const rId = r.roomId || r.id;
        const config = scheduleConfig[rId] || (r.scheduleOpen && r.scheduleClose ? { open: r.scheduleOpen, close: r.scheduleClose } : null);
        if (config && typeof isCurrentTimeInSchedule === 'function') {
            if (!isCurrentTimeInSchedule(config.open, config.close)) return false;
        }
        if (!query) return true;
        return (r.name || '').toLowerCase().includes(query) ||
            (r.roomId || '').toLowerCase().includes(query) ||
            (r.desc || '').toLowerCase().includes(query);
    });

    if (!filtered.length) {
        container.innerHTML = '<p style="color:var(--text-muted); font-size:0.85rem;">No public rooms found.</p>';
        return;
    }

    container.innerHTML = filtered.map(r => {
        const scheduleConfig = JSON.parse(localStorage.getItem('ys_rooms_schedule') || '{}');
        const sched = r.schedule || (scheduleConfig[r.roomId || r.id] ? `${scheduleConfig[r.roomId || r.id].open} - ${scheduleConfig[r.roomId || r.id].close}` : null);
        const schedDisplay = sched ? `<div style="font-size:0.7rem; color:var(--accent-warning); margin-top:0.1rem; display:flex; align-items:center; gap:0.3rem;"><i class="fa-solid fa-clock" style="font-size:0.65rem;"></i> Active: ${sched}</div>` : '';
        return `
        <div style="
            display:flex; align-items:center; justify-content:space-between; gap:0.75rem;
            background:var(--card-elevated); border:1px solid var(--card-border);
            border-radius:12px; padding:0.65rem 0.9rem; cursor:pointer;
            transition: border-color 0.15s;
        " data-roomid="${r.roomId || r.id || ''}"
            onmouseenter="this.style.borderColor='var(--accent-emerald)'"
            onmouseleave="this.style.borderColor='var(--card-border)'">
            <div style="min-width:0; flex:1;">
                <div style="font-weight:700; font-size:0.88rem; color:var(--text-pure); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${r.name || 'Unnamed Room'}</div>
                <div style="font-size:0.75rem; color:var(--text-muted); margin-top:0.1rem;">${r.desc || ''}</div>
                ${schedDisplay}
            </div>
            <div style="display:flex; align-items:center; gap:0.6rem; flex-shrink:0;">
                <span style="font-size:0.75rem; color:var(--accent-emerald);">
                    <i class="fa-solid fa-circle" style="font-size:0.45rem; vertical-align:middle;"></i>
                    ${r.peerCount || 0} online
                </span>
                <button class="btn-pill btn-sm" style="font-size:0.75rem; padding:0.3rem 0.75rem; background:var(--accent-emerald); color:#000; font-weight:700; border:none;"
                    onclick="event.stopPropagation(); joinPublicRoom('${r.roomId || r.id || ''}')">Join</button>
            </div>
        </div>
    `}).join('');
}

function joinPublicRoom(roomId) {
    if (!roomId) return;
    if (ui.inputs.roomId) ui.inputs.roomId.value = roomId;
    if (ui.panels.actionSelection) ui.panels.actionSelection.style.display = 'none';
    if (ui.panels.join) ui.panels.join.style.display = 'flex';
}

window.joinPublicRoom = joinPublicRoom;

document.addEventListener('DOMContentLoaded', () => {
    const trackerTab = document.getElementById('activity-tab-tracker');
    const discoveryTab = document.getElementById('activity-tab-discovery');
    const trackerBody = document.getElementById('activity-tracker-body');
    const discoveryBody = document.getElementById('activity-discovery-body');
    const searchInput = document.getElementById('tracker-discovery-search');
    const browseBtn = document.getElementById('browse-public-rooms-btn');

    if (trackerTab && discoveryTab) {
        trackerTab.addEventListener('click', () => {
            trackerTab.classList.add('active');
            trackerTab.style.borderBottom = '2px solid var(--accent-emerald)';
            trackerTab.style.color = '';
            discoveryTab.classList.remove('active');
            discoveryTab.style.borderBottom = '';
            discoveryTab.style.color = 'var(--text-secondary)';
            if (trackerBody) trackerBody.style.display = '';
            if (discoveryBody) discoveryBody.style.display = 'none';
        });

        discoveryTab.addEventListener('click', () => {
            discoveryTab.classList.add('active');
            discoveryTab.style.borderBottom = '2px solid var(--accent-emerald)';
            discoveryTab.style.color = '';
            trackerTab.classList.remove('active');
            trackerTab.style.borderBottom = '';
            trackerTab.style.color = 'var(--text-secondary)';
            if (discoveryBody) discoveryBody.style.display = '';
            if (trackerBody) trackerBody.style.display = 'none';
            loadPublicRooms();
            renderPublicRoomsList(window._cachedPublicRooms || []);
        });
    }

    if (searchInput) {
        searchInput.addEventListener('input', () => renderPublicRoomsList(window._cachedPublicRooms || []));
    }

    if (browseBtn) {
        browseBtn.addEventListener('click', () => {
            if (discoveryTab) discoveryTab.click();
            if (ui.panels.join) ui.panels.join.style.display = 'none';
            if (ui.panels.actionSelection) ui.panels.actionSelection.style.display = '';
        });
    }

    const publicCheckbox = document.getElementById('public-room-checkbox');
    const publicDetails = document.getElementById('public-room-details');
    if (publicCheckbox && publicDetails) {
        publicCheckbox.addEventListener('change', () => {
            publicDetails.style.display = publicCheckbox.checked ? 'block' : 'none';
        });
    }
});

function getVisiblePeerCount() {
    const peerItems = document.querySelectorAll('#peer-list .peer-item:not(.local-user)');
    return peerItems ? peerItems.length : 0;
}

function hasConnectedPeers() {
    if (typeof peers !== 'undefined' && peers && Object.keys(peers).length > 0) {
        return true;
    }
    return getVisiblePeerCount() > 0;
}

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
    if (audioCtx.state === 'suspended') audioCtx.resume();
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


const savedThemeOnInit = localStorage.getItem('emit-theme') || 'dark';
document.documentElement.setAttribute('data-theme', savedThemeOnInit);

window.addEventListener('DOMContentLoaded', () => {
    const savedName = localStorage.getItem('ys_persistent_name');
    if (savedName) {
        const nameInput = document.getElementById('settings-user-name');
        if (nameInput) nameInput.value = savedName;
    }
});
document.body.classList.remove('compact-mode');
localStorage.removeItem('emit-compact-mode');

function updateConnectionStatus(state, message, peerCount = 0) {
    ui.status.dot.className = `status-dot ${state}`;
    const badge = document.querySelector('.e2e-badge');
    if (badge) badge.classList.toggle('is-waiting', state === 'waiting' || state === 'connecting');

    let niceMessage = message;
    if (state === "connected") {
        niceMessage = peerCount > 0
            ? `Workspace Joined | ${peerCount} ${peerCount === 1 ? 'Peer' : 'Peers'}`
            : "Workspace Connected";
    }
    if (state === "connecting") niceMessage = "Establishing Link...";
    if (state === "waiting") niceMessage = "Active • Ready for Peers";
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

    return `${result.slice(0, 4)}-${result.slice(4, 8)}`;
}

ui.inputs.roomId.addEventListener('input', (e) => {
    if (e.target.value.includes('?workspace=')) return;

    let val = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (val.length > 4) {
        val = val.slice(0, 4) + '-' + val.slice(4, 8);
    }
    e.target.value = val;
});

window.copyToClipboard = function (text) {
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

let filePickerKeepAliveInterval = null;

function startFilePickerKeepAlive() {
    if (filePickerKeepAliveInterval) return;
    if (typeof socket === 'undefined' || !socket || !socket.emit) return;
    socket.emit('reset-inactivity');
    filePickerKeepAliveInterval = setInterval(() => {
        if (typeof socket !== 'undefined' && socket && socket.connected) {
            socket.emit('reset-inactivity');
        }
    }, 5000);
}

function stopFilePickerKeepAlive() {
    if (!filePickerKeepAliveInterval) return;
    clearInterval(filePickerKeepAliveInterval);
    filePickerKeepAliveInterval = null;
    if (typeof socket !== 'undefined' && socket && socket.connected) {
        socket.emit('reset-inactivity');
    }
}

window.addEventListener('focus', stopFilePickerKeepAlive);
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        stopFilePickerKeepAlive();
    }
});

let hostedModalSelectedFiles = [];

function createHostedClientToken() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

function getHostedModalElements() {
    return {
        modal: document.getElementById('drop-modal'),
        form: document.getElementById('drop-modal-form'),
        trigger: document.getElementById('drop-modal-file-trigger'),
        fileInput: document.getElementById('drop-modal-file-input'),
        filename: document.getElementById('drop-modal-filename'),
        progress: document.getElementById('drop-modal-progress'),
        result: document.getElementById('drop-modal-result'),
        resultUrl: document.getElementById('drop-result-url'),
        copyBtn: document.getElementById('drop-copy-btn'),
        copyActionBtn: document.getElementById('copy-drop-btn'),
        waitBtn: document.getElementById('drop-modal-wait'),
        closeResultBtn: document.getElementById('hosted-wait-btn'),
        progressLabel: document.getElementById('drop-progress-label'),
        pctDisplay: document.getElementById('drop-progress-pct-display'),
        ring: document.getElementById('portal-progress-ring'),
        progressBarFill: document.getElementById('portal-progress-bar-fill'),
        progressFile: document.getElementById('drop-progress-filename-display'),
        zipCheckbox: document.getElementById('zip-bundle-checkbox'),
        zipNameArea: document.getElementById('zip-name-area'),
        zipNameInput: document.getElementById('drop-name-input'),
        hoursInput: document.getElementById('drop-hours'),
        minutesInput: document.getElementById('drop-minutes'),
        nicknameInput: document.getElementById('drop-nickname-input')
    };
}

function formatHostedSelection(files) {
    if (!files.length) return 'Nothing selected yet.';
    const totalBytes = files.reduce((sum, file) => sum + (file.size || 0), 0);
    const totalLabel = typeof ActivityTracker !== 'undefined' && typeof ActivityTracker.formatBytes === 'function'
        ? ActivityTracker.formatBytes(totalBytes)
        : `${(totalBytes / (1024 * 1024)).toFixed(2)} MB`;
    if (files.length === 1) return `${files[0].name} • ${totalLabel}`;
    return `${files.length} files selected • ${totalLabel}`;
}

function setHostedModalCopyHandlers(url) {
    const { copyBtn, copyActionBtn } = getHostedModalElements();
    const copy = () => window.copyToClipboard(url).then(() => showToast('Copied', 'Hosted link copied.', 'success'));
    if (copyBtn) copyBtn.onclick = copy;
    if (copyActionBtn) copyActionBtn.onclick = copy;
}

window.__activeHostedUpload = null;

function getActiveHostedUploadState(token = null) {
    const activeUpload = window.__activeHostedUpload;
    if (!activeUpload) return null;
    if (token && activeUpload.token !== token) return null;
    return activeUpload;
}

function setActiveHostedUploadState(nextState) {
    if (!nextState) {
        window.__activeHostedUpload = null;
        return null;
    }
    window.__activeHostedUpload = {
        ...(window.__activeHostedUpload || {}),
        ...nextState
    };
    return window.__activeHostedUpload;
}

function syncHostedLiveUploadModal({ reveal = false, token = null } = {}) {
    const activeUpload = getActiveHostedUploadState(token);
    if (!activeUpload) return false;

    const { modal, form, progress, result, progressLabel, pctDisplay, ring, progressBarFill, progressFile } = getHostedModalElements();
    const rawPct = Math.max(0, Math.min(100, Number(activeUpload.pct) || 0));
    const roundedPct = rawPct > 0 && rawPct < 1 ? 1 : Math.round(rawPct);
    const phaseLabelMap = {
        resuming: 'Resuming upload...',
        uploading: 'Uploading securely...',
        finalizing: 'Finalizing hosted link...'
    };

    if (reveal && modal) modal.style.display = 'flex';
    if (modal) {
        modal.classList.add('hosted-upload-passive');
        modal.classList.add('drop-modal--in-progress');
        modal.classList.remove('drop-modal--in-result');
    }
    if (form) form.style.display = 'none';
    if (result) result.style.display = 'none';
    if (progress) progress.style.display = 'block';
    if (progressLabel) progressLabel.textContent = phaseLabelMap[activeUpload.phase] || 'Uploading securely...';
    if (pctDisplay) pctDisplay.textContent = `${roundedPct}%`;
    if (ring) ring.setAttribute('stroke-dasharray', `${roundedPct}, 100`);
    if (progressBarFill) progressBarFill.style.width = `${roundedPct}%`;
    if (progressFile) progressFile.textContent = activeUpload.fileName || 'Waiting for file...';
    return true;
}

window.getActiveHostedUploadState = getActiveHostedUploadState;
window.showHostedLiveUploadModal = (token) => syncHostedLiveUploadModal({ reveal: true, token });
window.handleHostedModalClose = function () {
    closeHostedModal({ reset: true, clearActiveState: true });
};

function closeHostedModal({ reset = true, clearActiveState = false } = {}) {
    const { modal, form, progress, result, fileInput, filename, resultUrl, waitBtn, closeResultBtn, progressLabel, pctDisplay, ring, progressBarFill, progressFile, zipCheckbox, zipNameArea, zipNameInput } = getHostedModalElements();
    if (modal) {
        modal.style.display = 'none';
        modal.classList.remove('hosted-upload-passive');
        modal.classList.remove('drop-modal--in-progress');
        modal.classList.remove('drop-modal--in-result');
    }
    if (clearActiveState) {
        setActiveHostedUploadState(null);
        localStorage.removeItem('emit-active-hosted-token');
        localStorage.removeItem('emit-active-hosted-state');
        localStorage.removeItem('emit-active-hosted-url');
        localStorage.removeItem('emit-active-hosted-filenames');
    }
    if (!reset) return;
    hostedModalSelectedFiles = [];
    if (form) form.style.display = 'block';
    if (progress) progress.style.display = 'none';
    if (result) result.style.display = 'none';
    if (fileInput) fileInput.value = '';
    if (filename) filename.textContent = 'Nothing selected yet.';
    if (resultUrl) resultUrl.value = '';
    if (waitBtn) {
        waitBtn.disabled = false;
        waitBtn.textContent = 'Cancel';
        waitBtn.onclick = () => closeHostedModal();
    }
    if (closeResultBtn) {
        closeResultBtn.textContent = 'Close';
        closeResultBtn.onclick = () => closeHostedModal();
    }
    if (pctDisplay) pctDisplay.textContent = '0%';
    if (ring) ring.setAttribute('stroke-dasharray', '0, 100');
    if (progressBarFill) progressBarFill.style.width = '0%';
    if (progressFile) progressFile.textContent = 'Waiting for file...';
    if (zipCheckbox) zipCheckbox.checked = false;
    if (zipNameArea) zipNameArea.style.display = 'none';
    if (zipNameInput) zipNameInput.value = '';
}

function openHostedModal() {
    const { modal } = getHostedModalElements();
    localStorage.removeItem('emit-active-hosted-token');
    localStorage.removeItem('emit-active-hosted-state');
    localStorage.removeItem('emit-active-hosted-url');
    localStorage.removeItem('emit-active-hosted-filenames');
    closeHostedModal({ reset: true, clearActiveState: true });
    if (modal) {
        modal.classList.remove('hosted-upload-passive');
        modal.style.display = 'flex';
    }
}

function updateHostedModalSelection(files) {
    hostedModalSelectedFiles = files;
    const { filename } = getHostedModalElements();
    if (filename) filename.textContent = formatHostedSelection(files);
}

async function buildHostedUploadFile(files) {
    const { zipCheckbox, zipNameInput } = getHostedModalElements();
    const shouldZip = !!zipCheckbox?.checked;
    if (files.length === 1) {
        return {
            uploadFile: files[0],
            persistedNames: [files[0].name],
            totalSize: files[0].size,
            isCollection: false
        };
    }
    if (shouldZip) {
        if (typeof JSZip === 'undefined') {
            throw new Error('JSZip is not loaded.');
        }
        const zip = new JSZip();
        for (const file of files) {
            zip.file(file.webkitRelativePath || file.name, file);
        }
        let bundleName = (zipNameInput?.value || '').trim() || 'shared-files';
        if (!bundleName.toLowerCase().endsWith('.zip')) bundleName += '.zip';
        const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 1 } });
        return {
            uploadFile: new File([blob], bundleName, { type: 'application/zip' }),
            persistedNames: [bundleName],
            totalSize: files.reduce((sum, file) => sum + (file.size || 0), 0),
            isCollection: false
        };
    } else {
        return {
            files: files,
            persistedNames: files.map(f => f.name),
            isCollection: true,
            totalSize: files.reduce((sum, file) => sum + (file.size || 0), 0)
        };
    }
}

async function startHostedUpload(files) {
    if (!files.length) {
        showToast('No Files', 'Choose at least one file first.', 'warning');
        return;
    }

    const { modal, form, progress, result, resultUrl, waitBtn, closeResultBtn, progressLabel, pctDisplay, ring, progressFile, hoursInput, minutesInput, nicknameInput } = getHostedModalElements();
    const hours = Math.max(0, Math.min(48, parseInt(hoursInput?.value || '0', 10) || 0));
    const minutes = Math.max(0, Math.min(59, parseInt(minutesInput?.value || '0', 10) || 0));
    const expiryMs = ((hours * 60) + minutes) * 60 * 1000;
    if (expiryMs < 60000) {
        showToast('Invalid Expiry', 'Hosted links must last at least 1 minute.', 'warning');
        return;
    }

    const nickname = (nicknameInput?.value || '').trim();

    const token = createHostedClientToken();
    const initialNames = files.map(file => file?.name).filter(Boolean);
    const initialLabel = formatHostedSelection(files);
    const initialSize = files.reduce((sum, file) => sum + (file?.size || 0), 0);

    localStorage.setItem('emit-active-hosted-token', token);
    localStorage.setItem('emit-active-hosted-state', 'active');
    localStorage.removeItem('emit-active-hosted-url');
    localStorage.setItem('emit-active-hosted-filenames', JSON.stringify(initialNames));

    if (window.cacheHostedFile && files[0]) {
        window.cacheHostedFile(token, files[0]).catch((error) => {
            console.warn('Early hosted cache failed', error);
        });
    }

    if (typeof ActivityTracker !== 'undefined') {
        ActivityTracker.addHostedLink(token, {
            name: initialLabel,
            nickname: nickname,
            size: initialSize,
            durationMs: expiryMs,
            progress: 0,
            status: 'preparing'
        });
    }

    setActiveHostedUploadState({
        token,
        fileName: initialLabel,
        pct: 0,
        phase: 'preparing'
    });
    if (modal) {
        modal.style.display = 'flex';
    }
    syncHostedLiveUploadModal({ token });
    if (waitBtn) {
        waitBtn.disabled = true;
        waitBtn.textContent = 'Preparing...';
    }

    try {
        const prepared = await buildHostedUploadFile(files);
        localStorage.setItem('emit-active-hosted-filenames', JSON.stringify(prepared.persistedNames));
        if (window.cacheHostedFile && prepared.uploadFile) {
            await window.cacheHostedFile(token, prepared.uploadFile).catch((error) => {
                console.warn('Hosted cache failed', error);
            });
        }
        if (typeof ActivityTracker !== 'undefined' && ActivityTracker.state?.hostedLinks?.[token]) {
            ActivityTracker.state.hostedLinks[token].name = prepared.isCollection ? (nickname || 'Shared Workspace') : prepared.uploadFile.name;
            ActivityTracker.state.hostedLinks[token].size = prepared.totalSize || prepared.uploadFile.size;
            ActivityTracker.state.hostedLinks[token].status = 'preparing';
            ActivityTracker.notifyUpdate();
            ActivityTracker.saveImmediate();
        }
        setActiveHostedUploadState({
            token,
            fileName: prepared.isCollection ? (nickname || 'Shared Workspace') : prepared.uploadFile.name,
            pct: 0,
            phase: 'preparing'
        });
        syncHostedLiveUploadModal({ token });

        let resultData;
        if (prepared.isCollection) {
            const uploadedFiles = [];
            const fileCount = prepared.files.length;
            const fileProgresses = new Array(fileCount).fill(0);

            for (let i = 0; i < fileCount; i++) {
                const file = prepared.files[i];
                setActiveHostedUploadState({
                    token,
                    fileName: `[${i + 1}/${fileCount}] ${file.name}`,
                    pct: 0,
                    phase: 'uploading'
                });
                syncHostedLiveUploadModal({ token });

                const fileResult = await window.hostedDrop(file, (phase, pct) => {
                    fileProgresses[i] = pct;
                    const totalUploadedPct = fileProgresses.reduce((s, p) => s + p, 0) / fileCount;
                    setActiveHostedUploadState({
                        token,
                        fileName: `[${i + 1}/${fileCount}] ${file.name}`,
                        pct: totalUploadedPct,
                        phase: 'uploading'
                    });
                    syncHostedLiveUploadModal({ token });
                    if (typeof ActivityTracker !== 'undefined') {
                        ActivityTracker.updateHostedLinkProgress(token, totalUploadedPct);
                    }
                }, expiryMs, '', { skipActivity: true });

                uploadedFiles.push({
                    name: file.name,
                    size: file.size,
                    url: fileResult.url
                });
            }

            const collectionMeta = {
                name: nickname || 'Shared Workspace',
                files: uploadedFiles
            };
            const collectionBlob = new Blob([JSON.stringify(collectionMeta)], { type: 'application/json' });
            const collectionFile = new File([collectionBlob], `${nickname || 'collection'}.json`, { type: 'application/json' });

            setActiveHostedUploadState({
                token,
                fileName: 'Finalizing collection...',
                pct: 99,
                phase: 'finalizing'
            });
            syncHostedLiveUploadModal({ token });

            if (window.cacheHostedFile) {
                window.cacheHostedFile(token, collectionFile).catch((error) => {
                    console.warn('Hosted collection cache failed', error);
                });
            }

            resultData = await window.hostedDrop(collectionFile, (phase, pct) => {
            }, expiryMs, nickname, {
                token,
                totalSize: prepared.totalSize,
                isCollection: true,
                skipActivity: true
            });
        } else {
            if (window.cacheHostedFile) {
                window.cacheHostedFile(token, prepared.uploadFile).catch((error) => {
                    console.warn('Hosted cache failed', error);
                });
            }

            resultData = await window.hostedDrop(prepared.uploadFile, (phase, pct) => {
                setActiveHostedUploadState({
                    token,
                    fileName: prepared.uploadFile.name,
                    pct,
                    phase
                });
                syncHostedLiveUploadModal({ token });
            }, expiryMs, nickname, {
                token,
                totalSize: prepared.totalSize,
                isCollection: prepared.isCollection,
                skipActivity: true
            });
        }

        setActiveHostedUploadState(null);
        if (modal) {
            modal.classList.remove('hosted-upload-passive');
            modal.classList.remove('drop-modal--in-progress');
            modal.classList.add('drop-modal--in-result');
        }
        if (progress) progress.style.display = 'none';
        if (result) result.style.display = 'block';
        if (resultUrl) resultUrl.value = resultData.url;
        localStorage.setItem('emit-active-hosted-state', 'finished');
        localStorage.setItem('emit-active-hosted-url', resultData.url);
        setHostedModalCopyHandlers(resultData.url);
        const closeHandler = () => closeHostedModal({ reset: true, clearActiveState: true });
        if (waitBtn) {
            waitBtn.disabled = false;
            waitBtn.textContent = 'Close';
            waitBtn.onclick = closeHandler;
        }
        if (closeResultBtn) closeResultBtn.onclick = closeHandler;
    } catch (error) {
        console.error('Hosted upload failed', error);
        setActiveHostedUploadState(null);
        if (modal) modal.classList.remove('hosted-upload-passive');
        if (progressLabel) progressLabel.textContent = 'Upload interrupted. Resume it from Activity Tracker.';
        if (waitBtn) {
            waitBtn.disabled = false;
            waitBtn.textContent = 'Close';
            waitBtn.onclick = () => closeHostedModal({ reset: false, clearActiveState: false });
        }
        if (closeResultBtn) closeResultBtn.onclick = () => closeHostedModal({ reset: false, clearActiveState: false });
        showToast('Hosted Upload Paused', error.message || 'The upload was interrupted.', 'error');
    }
}

console.log('EmitHub app.js initializing...');

if (ui.buttons.showGenerate) {
    ui.buttons.showGenerate.addEventListener('click', () => {
        if (ui.panels.actionSelection) ui.panels.actionSelection.style.display = 'none';
        if (ui.panels.join) ui.panels.join.style.display = 'none';
        if (document.getElementById('public-rooms-panel')) document.getElementById('public-rooms-panel').style.display = 'none';
        if (ui.panels.share) ui.panels.share.style.display = 'block';
        document.querySelector('.hero-split').classList.add('view-active');

        currentGeneratedCode = generateSecureWorkspaceId();
        if (ui.text.displayRoomCodeHome) ui.text.displayRoomCodeHome.textContent = currentGeneratedCode;

        showToast('Vault Generated', 'Secure encryption keys created locally.', 'success');
    });
}

if (ui.buttons.showJoin) {
    ui.buttons.showJoin.addEventListener('click', () => {
        if (ui.panels.actionSelection) ui.panels.actionSelection.style.display = 'none';
        if (ui.panels.share) ui.panels.share.style.display = 'none';
        if (document.getElementById('public-rooms-panel')) document.getElementById('public-rooms-panel').style.display = 'none';
        if (ui.panels.join) ui.panels.join.style.display = 'block';
        document.querySelector('.hero-split').classList.add('view-active');
    });
}

if (ui.buttons.showHosted) {
    ui.buttons.showHosted.addEventListener('click', () => {
        openHostedModal();
    });
}

if (ui.buttons.cancelShare) {
    ui.buttons.cancelShare.addEventListener('click', () => {
        if (ui.panels.share) ui.panels.share.style.display = 'none';
        if (ui.panels.actionSelection) {
            ui.panels.actionSelection.style.display = '';
            // Trigger a refresh of the public room lists
            if (typeof socket !== 'undefined' && socket.emit) {
                socket.emit('list-public-rooms');
            }
        }
        document.querySelector('.hero-split').classList.remove('view-active');
        currentGeneratedCode = null;
    });
}

if (ui.buttons.cancelJoin) {
    ui.buttons.cancelJoin.addEventListener('click', () => {
        if (ui.panels.join) ui.panels.join.style.display = 'none';
        if (ui.panels.actionSelection) {
            ui.panels.actionSelection.style.display = '';
            // Trigger a refresh of the public room lists
            if (typeof socket !== 'undefined' && socket.emit) {
                socket.emit('list-public-rooms');
            }
        }
        document.querySelector('.hero-split').classList.remove('view-active');
    });
}

if (ui.buttons.logo) {
    ui.buttons.logo.addEventListener('click', () => {
        window.location.href = '/';
    });
}

if (ui.buttons.browseFolder) {
    ui.buttons.browseFolder.addEventListener('click', () => {
        startFilePickerKeepAlive();
        if (ui.inputs.folderInput) ui.inputs.folderInput.click();
    });
}

if (ui.inputs.folderInput) {
    ui.inputs.folderInput.addEventListener('change', async (e) => {
        stopFilePickerKeepAlive();
        const files = Array.from(e.target.files);
        if (!files.length) return;
        if (typeof JSZip === 'undefined') { showToast('Error', 'JSZip not loaded.', 'error'); return; }
        const folderName = files[0].webkitRelativePath.split('/')[0] || 'folder';
        showToast('Gathering Folder...', `"${folderName}" is being prepared for travel...`, 'info');
        const zip = new JSZip();
        files.forEach(f => zip.file(f.webkitRelativePath || f.name, f));
        const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 1 } });
        if (typeof handleFiles === 'function') handleFiles([new File([blob], folderName + '.zip', { type: 'application/zip' })]);
        e.target.value = '';
    });
}

if (ui.buttons.browse) {
    ui.buttons.browse.addEventListener('click', () => {
        startFilePickerKeepAlive();
        if (ui.inputs.file) ui.inputs.file.click();
    });
}

if (ui.inputs.file) {
    ui.inputs.file.addEventListener('change', (e) => {
        stopFilePickerKeepAlive();
        if (e.target.files.length > 0 && typeof handleFiles === 'function') {
            handleFiles(Array.from(e.target.files));
        }
        e.target.value = '';
    });
}

const hostedModalFileTrigger = document.getElementById('drop-modal-file-trigger');
const hostedModalFileInput = document.getElementById('drop-modal-file-input');
if (hostedModalFileTrigger && hostedModalFileInput) {
    hostedModalFileTrigger.addEventListener('click', () => {
        hostedModalFileInput.click();
    });
    hostedModalFileTrigger.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            hostedModalFileInput.click();
        }
    });
    hostedModalFileInput.addEventListener('change', (e) => {
        updateHostedModalSelection(Array.from(e.target.files || []));
    });
}

const hostedModalForm = document.getElementById('drop-modal-form');
if (hostedModalForm) {
    hostedModalForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        await startHostedUpload(hostedModalSelectedFiles);
    });
}

const hostedModalWaitBtn = document.getElementById('drop-modal-wait');
if (hostedModalWaitBtn) {
    hostedModalWaitBtn.addEventListener('click', () => {
        window.handleHostedModalClose();
    });
}

const hostedModalCloseResultBtn = document.getElementById('hosted-wait-btn');
if (hostedModalCloseResultBtn) {
    hostedModalCloseResultBtn.addEventListener('click', () => {
        window.handleHostedModalClose();
    });
}

if (ui.buttons.destroy) {
    ui.buttons.destroy.addEventListener('click', () => {
        if (!hasConnectedPeers()) {
            if (typeof performWipe === 'function' && typeof signalingId !== 'undefined' && typeof socket !== 'undefined') {
                socket.emit('destroy-room', signalingId);
                if (typeof animateVanishAndClear === 'function') {
                    animateVanishAndClear(true).then(() => {
                        if (typeof roomId !== 'undefined' && roomId && typeof ActivityTracker !== 'undefined') {
                            ActivityTracker.handleRoomClose(roomId);
                        } else {
                            performWipe(true);
                        }
                    });
                } else {
                    if (typeof roomId !== 'undefined' && roomId && typeof ActivityTracker !== 'undefined') {
                        ActivityTracker.handleRoomClose(roomId);
                    } else {
                        performWipe(true);
                    }
                }
                return;
            }
        }
        if (ui.panels.destroyModal) ui.panels.destroyModal.style.display = 'flex';
    });
}

if (ui.buttons.destroyCancel) {
    ui.buttons.destroyCancel.addEventListener('click', () => {
        if (ui.panels.destroyModal) ui.panels.destroyModal.style.display = 'none';
    });
}

if (ui.buttons.settingsBtn) {
    ui.buttons.settingsBtn.addEventListener('click', () => {
        if (ui.panels.settingsModal) ui.panels.settingsModal.style.display = 'flex';
    });
}

const settingsClose = document.getElementById('settings-close');
if (settingsClose) {
    settingsClose.addEventListener('click', () => {
        if (ui.panels.settingsModal) ui.panels.settingsModal.style.display = 'none';
    });
}

const settingsSave = document.getElementById('settings-save');
if (settingsSave) {
    settingsSave.addEventListener('click', () => {
        const stealthEl = document.getElementById('settings-stealth-mode');
        const audioEl = document.getElementById('settings-audio');
        const detailedEl = document.getElementById('settings-detailed-timer');
        const inactivityEl = document.getElementById('settings-inactivity-time');

        const stealth = stealthEl ? stealthEl.checked : (localStorage.getItem('ys_stealth') === 'true');
        const audio = audioEl ? audioEl.checked : (localStorage.getItem('ys_audio') !== 'false');
        const detailed = detailedEl ? detailedEl.checked : (localStorage.getItem('ys_detailed_timer') === 'true');
        const inactivityMins = inactivityEl ? inactivityEl.value : (localStorage.getItem('ys_inactivity_mins') || '0');

        localStorage.setItem('ys_stealth', stealth ? 'true' : 'false');
        localStorage.setItem('ys_audio', audio ? 'true' : 'false');
        localStorage.setItem('ys_detailed_timer', detailed ? 'true' : 'false');
        localStorage.setItem('emit-detailed-timer', detailed ? 'true' : 'false');
        localStorage.setItem('ys_inactivity_mins', inactivityMins);
        localStorage.removeItem('ys_inactivity_wipe');
        window.emitDetailedTimer = detailed;

        if (ui.panels.settingsModal) ui.panels.settingsModal.style.display = 'none';
        showToast('Settings Saved', 'Your preferences have been updated.', 'success');

        const stealthCheck = document.getElementById('stealth-mode-checkbox');
        if (stealthCheck) stealthCheck.checked = stealth;

        if (ActivityTracker && typeof ActivityTracker.tickTimers === 'function') {
            ActivityTracker.tickTimers();
        }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    const stealth = localStorage.getItem('ys_stealth') === 'true';
    const audio = localStorage.getItem('ys_audio') !== 'false';
    const storedDetailed = localStorage.getItem('ys_detailed_timer');
    const legacyDetailed = localStorage.getItem('emit-detailed-timer');
    const detailed = storedDetailed === 'true' || (storedDetailed === null && legacyDetailed === 'true');
    window.emitDetailedTimer = detailed;
    localStorage.setItem('emit-detailed-timer', detailed ? 'true' : 'false');
    localStorage.setItem('ys_detailed_timer', detailed ? 'true' : 'false');

    if (document.getElementById('settings-stealth-mode')) {
        document.getElementById('settings-stealth-mode').checked = stealth;
    }
    const detailedCheckEl = document.getElementById('settings-detailed-timer');
    if (detailedCheckEl) {
        detailedCheckEl.checked = detailed;
        detailedCheckEl.addEventListener('change', () => {
            window.emitDetailedTimer = detailedCheckEl.checked;
            localStorage.setItem('ys_detailed_timer', detailedCheckEl.checked ? 'true' : 'false');
            localStorage.setItem('emit-detailed-timer', detailedCheckEl.checked ? 'true' : 'false');
            if (ActivityTracker && typeof ActivityTracker.tickTimers === 'function') {
                ActivityTracker.tickTimers();
            }
        });
    }
    if (document.getElementById('settings-inactivity-wipe')) {
        document.getElementById('settings-inactivity-wipe').checked = localStorage.getItem('ys_inactivity_wipe') === 'true';
    }
    if (document.getElementById('settings-inactivity-time')) {
        const settingsInactivityEl = document.getElementById('settings-inactivity-time');
        const allowedInactivityValues = new Set(['0', '5', '10', '15', '30', '60']);
        const savedInactivityMins = localStorage.getItem('ys_inactivity_mins') || '0';
        settingsInactivityEl.value = allowedInactivityValues.has(savedInactivityMins) ? savedInactivityMins : '0';
    }
    const inactivitySelect = document.getElementById('inactivity-timer-select');
    if (inactivitySelect) {
        const allowedInactivityValues = new Set(['0', '5', '10', '15', '30', '60']);
        const savedInactivityMins = localStorage.getItem('ys_inactivity_mins') || '0';
        inactivitySelect.value = allowedInactivityValues.has(savedInactivityMins) ? savedInactivityMins : '0';
    }
    const stealthCheck = document.getElementById('stealth-mode-checkbox');
    if (stealthCheck) stealthCheck.checked = stealth;

    const hoursInput = document.getElementById('drop-hours');
    const minsInput = document.getElementById('drop-minutes');
    if (hoursInput && minsInput) {
        hoursInput.addEventListener('input', () => {
            if (parseInt(hoursInput.value) > 48) {
                hoursInput.value = 48;
                minsInput.value = 0;
            }
            if (parseInt(hoursInput.value) === 48) minsInput.value = 0;
        });
        minsInput.addEventListener('input', () => {
            if (parseInt(hoursInput.value) >= 48) minsInput.value = 0;
            if (parseInt(minsInput.value) > 59) minsInput.value = 59;
        });
    }

    let inactivityTimer = null;
    let sensingTimer = null;

    function resetInactivityTimer() {
        if (inactivityTimer) clearTimeout(inactivityTimer);
        if (sensingTimer) clearTimeout(sensingTimer);

        const inactivityWipeEnabled = localStorage.getItem('ys_inactivity_wipe') === 'true';
        const mins = inactivityWipeEnabled ? parseInt(localStorage.getItem('ys_inactivity_mins') || '0') : 0;
        if (mins <= 0) return;

        sensingTimer = setTimeout(() => {
            if (typeof auditLog === 'function') {
                auditLog('[SECURITY] Inactivity detected. Self-destruct sequence armed.');
            }
        }, 2 * 60 * 1000);

        inactivityTimer = setTimeout(() => {
            if (typeof performWipe === 'function' && typeof animateVanishAndClear === 'function') {
                auditLog(`Inactivity limit (${mins}m) reached. Self-destructing workspace...`);
                animateVanishAndClear(true).then(() => performWipe(true));
            }
        }, mins * 60 * 1000);
    }

    const currentInactivityMins = localStorage.getItem('ys_inactivity_wipe') === 'true'
        ? parseInt(localStorage.getItem('ys_inactivity_mins') || '0')
        : 0;
    if (currentInactivityMins > 0) {
        ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart'].forEach(name => {
            document.addEventListener(name, resetInactivityTimer, true);
        });
        resetInactivityTimer();
    }
});

if (ui.buttons.leave) {
    ui.buttons.leave.addEventListener('click', () => {
        if (ui.panels.leaveModal) ui.panels.leaveModal.style.display = 'flex';
    });
}

if (ui.buttons.leaveCancel) {
    ui.buttons.leaveCancel.addEventListener('click', () => {
        if (ui.panels.leaveModal) ui.panels.leaveModal.style.display = 'none';
    });
}

if (ui.buttons.finalJoinGenerated) {
    ui.buttons.finalJoinGenerated.addEventListener('click', (e) => {
        e.preventDefault();
        const secret = ui.inputs.customWord ? ui.inputs.customWord.value.trim() : '';
        const inactivityMins = document.getElementById('inactivity-timer-select').value;
        localStorage.setItem('ys_inactivity_mins', inactivityMins);

        const openTime = document.getElementById('recurring-open-time') ? document.getElementById('recurring-open-time').value : '';
        const closeTime = document.getElementById('recurring-close-time') ? document.getElementById('recurring-close-time').value : '';

        if (openTime && closeTime) {
            const now = new Date();
            const currentMins = now.getHours() * 60 + now.getMinutes();
            const [openH, openM] = openTime.split(':').map(Number);
            const openMins = openH * 60 + openM;

            if (openMins < currentMins) {
                showToast('Invalid Start Time', 'The start time cannot be earlier than current time.', 'warning');
                return;
            }

            const scheduleConfig = JSON.parse(localStorage.getItem('ys_rooms_schedule') || '{}');
            scheduleConfig[currentGeneratedCode] = { open: openTime, close: closeTime };
            localStorage.setItem('ys_rooms_schedule', JSON.stringify(scheduleConfig));

            if (typeof ActivityTracker !== 'undefined') {
                ActivityTracker.addP2PRoom(currentGeneratedCode, { name: 'Scheduled: ' + currentGeneratedCode });
                if (typeof ActivityTracker.renderPanel === 'function') ActivityTracker.renderPanel();
            }

            const shareUrl = `${window.location.origin}/?workspace=${currentGeneratedCode}&open=${encodeURIComponent(openTime)}&close=${encodeURIComponent(closeTime)}`;
            window.copyToClipboard(shareUrl).then(() => {
                if (window.uiShared?.CustomDialog?.alert) {
                    window.uiShared.CustomDialog.alert('Workspace Scheduled', `Workspace ${currentGeneratedCode} has been scheduled for daily access (${openTime} - ${closeTime}).\n\nThe invite link has been copied to your clipboard. Send it to peers so they can join when active!`);
                } else {
                    alert(`Workspace ${currentGeneratedCode} has been scheduled for daily access (${openTime} - ${closeTime}).\n\nInvite link copied to clipboard.`);
                }
            });

            if (ui.panels.share) ui.panels.share.style.display = 'none';
            if (ui.panels.actionSelection) ui.panels.actionSelection.style.display = '';
            document.querySelector('.hero-split').classList.remove('view-active');

            document.getElementById('recurring-open-time').value = '';
            document.getElementById('recurring-close-time').value = '';

            const finalJoinBtn = document.getElementById('final-join-generated-btn');
            if (finalJoinBtn) finalJoinBtn.innerHTML = 'Join <i class="fa-solid fa-arrow-right"></i>';
            return;
        }

        const isPublic = document.getElementById('public-room-checkbox')?.checked;
        let roomName = '';
        let roomDesc = '';

        if (isPublic) {
            roomName = (document.getElementById('public-room-name')?.value || '').trim();
            roomDesc = (document.getElementById('public-room-desc')?.value || '').trim();

            if (!roomName) {
                showToast('Name Required', 'Please provide a room name to list this room publicly.', 'warning');
                return;
            }

            if (!roomDesc) {
                showToast('Description Required', 'Please provide a description to list this room publicly.', 'warning');
                return;
            }

            const lowerName = roomName.toLowerCase();
            const lowerDesc = roomDesc.toLowerCase();

            const hasBannedName = BANNED_WORDS.some(word => lowerName.includes(word)) || BANNED_EMOJIS.some(emoji => roomName.includes(emoji));
            const hasBannedDesc = BANNED_WORDS.some(word => lowerDesc.includes(word)) || BANNED_EMOJIS.some(emoji => roomDesc.includes(emoji));

            if (hasBannedName || hasBannedDesc) {
                showToast('Inappropriate Content', 'Your public room name or description contains restricted content.', 'error');
                return;
            }
        }

        window._pendingPublicRoom = isPublic ? { roomName, roomDesc } : null;

        const forceSpectatorChecked = !!document.getElementById('force-spectator-checkbox')?.checked;
        window._pendingForceSpectator = forceSpectatorChecked;

        if (currentGeneratedCode && typeof joinRoom === 'function') {
            joinRoom(currentGeneratedCode, secret, true);
        }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    const publicCheckbox = document.getElementById('public-room-checkbox');
    const publicDetails = document.getElementById('public-room-details');
    const publicCheckboxLabel = publicCheckbox?.closest('label');

    if (publicCheckbox && publicDetails) {
        publicCheckbox.addEventListener('change', (e) => {
            publicDetails.style.display = e.target.checked ? 'block' : 'none';
        });
    }

    const openTimeInput = document.getElementById('recurring-open-time');
    const closeTimeInput = document.getElementById('recurring-close-time');
    const finalJoinBtn = document.getElementById('final-join-generated-btn');

    if (openTimeInput && closeTimeInput && finalJoinBtn) {
        const updateScheduleBtn = () => {
            const hasSchedule = (openTimeInput.value || closeTimeInput.value);
            if (hasSchedule) {
                finalJoinBtn.innerHTML = 'Schedule Workspace <i class="fa-solid fa-calendar-days"></i>';
                if (publicCheckboxLabel) publicCheckboxLabel.style.display = 'none';
                if (publicCheckbox) publicCheckbox.checked = false;
                if (publicDetails) publicDetails.style.display = 'none';
            } else {
                finalJoinBtn.innerHTML = 'Join <i class="fa-solid fa-arrow-right"></i>';
                if (publicCheckboxLabel) publicCheckboxLabel.style.display = 'flex';
            }
        };
        openTimeInput.addEventListener('input', updateScheduleBtn);
        closeTimeInput.addEventListener('input', updateScheduleBtn);
        openTimeInput.addEventListener('change', updateScheduleBtn);
        closeTimeInput.addEventListener('change', updateScheduleBtn);
    }
});

if (ui.buttons.btnCopyCodeHome) {
    ui.buttons.btnCopyCodeHome.addEventListener('click', () => {
        if (currentGeneratedCode) {
            window.copyToClipboard(currentGeneratedCode).then(() => {
                showToast('Code Copied', 'Secure code copied to clipboard.', 'success');
            }).catch(() => showToast('Error', 'Failed to copy code on mobile.', 'error'));
        }
    });
}

let qrcodeObj = null;

if (ui.buttons.join) {
    ui.buttons.join.addEventListener('click', () => {
        const val = ui.inputs.roomId ? ui.inputs.roomId.value : '';
        const secret = ui.inputs.joinSecret ? ui.inputs.joinSecret.value.trim() : '';
        const isSpectator = document.getElementById('spectator-mode-checkbox') && document.getElementById('spectator-mode-checkbox').checked;
        window.isSpectator = !!isSpectator;
        window._secretPromptAttempted = !!secret;
        if (typeof joinRoom === 'function') {
            joinRoom(val, secret, false);
        }
    });
}

if (ui.buttons.btnCopyCode) {
    ui.buttons.btnCopyCode.addEventListener('click', () => {
        let code = '';
        if (ui.text.displayRoomCode && ui.text.displayRoomCode.textContent !== '----') {
            code = ui.text.displayRoomCode.textContent;
        } else {
            code = ui.inputs.roomId ? ui.inputs.roomId.value : '';
        }
        window.copyToClipboard(code).then(() => {
            showToast('Code Copied', `Secure code copied to clipboard.`, 'success');
        }).catch(() => showToast('Error', 'Failed to copy code.', 'error'));
    });
}

if (ui.buttons.btnCopyLink) {
    ui.buttons.btnCopyLink.addEventListener('click', () => {
        const val = ui.inputs.shareUrl ? ui.inputs.shareUrl.value : '';
        window.copyToClipboard(val)
            .then(() => showToast('Link Copied', 'Direct link copied to clipboard.', 'info'))
            .catch(() => showToast('Error', 'Failed to copy link.', 'error'));
    });
}

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

function createTransferElement(fileId, name, size, isReceiving, dataBlob = null, nickname = '') {
    const container = document.getElementById('transfers-container');
    const sizeFormatted = typeof ActivityTracker !== 'undefined' ? ActivityTracker.formatBytes(size) : (size / (1024 * 1024)).toFixed(2) + ' MB';

    let iconClass = 'fa-file';
    const ext = name.split('.').pop().toLowerCase();
    if (['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp'].includes(ext)) iconClass = 'fa-file-image';
    else if (['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext)) iconClass = 'fa-file-video';
    else if (['pdf'].includes(ext)) iconClass = 'fa-file-pdf';
    else if (['zip', 'rar', '7z'].includes(ext)) iconClass = 'fa-file-zipper';
    else if (['txt', 'md', 'doc', 'docx'].includes(ext)) iconClass = 'fa-file-lines';

    const directionLabel = isReceiving ? 'Receiving' : 'Sending';
    const directionIcon = isReceiving ? 'fa-arrow-down' : 'fa-arrow-up';

    let thumbnail = '';
    if (dataBlob && ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) {
        const url = URL.createObjectURL(dataBlob);
        thumbnail = `<img src="${url}" style="width:48px;height:48px;border-radius:12px;object-fit:cover;">`;
    } else if (dataBlob && ['mp4', 'webm'].includes(ext)) {
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
            <span class="transfer-name" title="${name}">${nickname ? `${nickname} (${name})` : name}</span>
            <span class="transfer-info-text">${sizeFormatted} | <i class="fa-solid ${directionIcon}"></i> ${directionLabel}</span>
        </div>
        <div class="transfer-progress-container" id="progress-area-${fileId}">
            <div id="graph-${fileId}" class="speed-graph"></div>
            <div class="progress-bar-bg">
                <div class="progress-bar-fill" id="fill-${fileId}"></div>
            </div>
            <div class="transfer-info-text" id="stats-${fileId}" style="display:flex;justify-content:space-between;margin-top:4px;">
                <span id="status-${fileId}">Preparing...</span>
                <span id="pct-${fileId}">0%</span>
            </div>
        </div>
        <div class="transfer-actions" style="display:flex; gap: 8px; align-items: center;">
            <button class="btn-download" id="resume-btn-${fileId}" style="display:none;"><i class="fa-solid fa-rotate-right"></i> Resume</button>
            <a class="btn-download" id="download-btn-${fileId}" style="pointer-events: ${isReceiving ? 'none' : 'auto'}; opacity: ${isReceiving ? '0.4' : '1'};"><i class="fa-solid fa-download"></i> Save</a>
            <button class="action-icon" id="cancel-transfer-${fileId}" title="Cancel"><i class="fa-solid fa-xmark"></i></button>
        </div>
    `;
    container.prepend(li);
    if (container) container.style.display = 'flex';
    const cancelBtn = li.querySelector(`#cancel-transfer-${fileId}`);
    if (cancelBtn) {
        cancelBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            window.dispatchEvent(new CustomEvent('cancel-transfer', { detail: { fileId } }));
            li.remove();
        });
    }
}

function updateTransferProgress(fileId, percent, statusText, speedStr, etaStr, currentSpeedBytes = 0) {
    const bar = document.getElementById(`fill-${fileId}`);
    const pct = document.getElementById(`pct-${fileId}`);
    const stat = document.getElementById(`status-${fileId}`);
    const item = document.getElementById(`item-${fileId}`);
    const normalizedStatus = (statusText || '').toLowerCase();

    if (bar) bar.style.width = `${percent}%`;
    const displayPct = percent >= 10 || percent === 0 ? Math.round(percent) : percent.toFixed(1);
    if (pct) pct.textContent = `${displayPct}%`;
    if (stat) {
        if (percent > 0 && percent < 100 && speedStr === '0 B/s') {
            stat.textContent = `Resuming transfer... ${displayPct}%`;
            stat.style.color = 'var(--accent-warning)';
        } else if (speedStr && etaStr) {
            stat.textContent = `${statusText} • ${speedStr} • ETA ${etaStr}`;
            stat.style.color = '';
        } else {
            stat.textContent = statusText;
            stat.style.color = '';
        }
    }

    if (item) {
        item.classList.toggle('paused-transfer', normalizedStatus.includes('paused') || normalizedStatus.includes('waiting to resume') || normalizedStatus.includes('waiting for') || normalizedStatus.includes('interrupted'));
    }

    if (currentSpeedBytes > 0) {
        updateTransferGraph(fileId, currentSpeedBytes);
    }

    if (percent === 100 && item) {
        item.classList.add('completed');
        const fill = item.querySelector('.progress-bar-fill');
        if (fill) fill.style.background = 'var(--accent-emerald)';
        const cancelBtn = document.getElementById(`cancel-transfer-${fileId}`);
        if (cancelBtn) cancelBtn.style.display = 'inline-flex';

        if (typeof ActivityTracker !== 'undefined') {
            const completedDirection = normalizedStatus.includes('ready to save') || normalizedStatus.includes('received') || normalizedStatus.includes('receiving')
                ? 'download'
                : 'upload';
            ActivityTracker.updateTransfer(fileId, {
                progress: 100,
                direction: completedDirection,
                paused: false,
                pausedLabel: ''
            });
        }

        const statsArea = document.getElementById(`stats-${fileId}`);
        if (statsArea) {
            statsArea.innerHTML = `<span class="status-label ${statusText.toLowerCase().includes('complete') ? 'received' : 'sent'}">${statusText}</span>`;
        }
    }
}

const transferHistory = {};
function updateTransferGraph(fileId, speed) {
    if (!transferHistory[fileId]) transferHistory[fileId] = new Array(24).fill(0);

    const lastVal = transferHistory[fileId][transferHistory[fileId].length - 1];
    const smoothedVal = (speed * 0.4) + (lastVal * 0.6);

    transferHistory[fileId].push(smoothedVal);
    if (transferHistory[fileId].length > 24) transferHistory[fileId].shift();

    const graph = document.getElementById(`graph-${fileId}`);
    if (!graph) return;

    const max = Math.max(...transferHistory[fileId], 1024 * 1024);
    graph.innerHTML = transferHistory[fileId].map(val => {
        const height = Math.max((val / max) * 100, 4);
        return `<div class="speed-bar" style="height: ${height}%; flex: 1;"></div>`;
    }).join('');
}

window.ui = ui;
window.showScreen = showScreen;
window.updateConnectionStatus = updateConnectionStatus;
window.createTransferElement = createTransferElement;
window.updateTransferProgress = updateTransferProgress;
window.showToast = showToast;

let dragCounter = 0;
const dropOverlay = document.getElementById('fullscreen-drop-overlay');

window.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragCounter++;
    if (dragCounter === 1 && ui.screens.transfer && ui.screens.transfer.classList.contains('active')) {
        if (dropOverlay) dropOverlay.classList.add('active');
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

    if (ui.screens.transfer.classList.contains('active')) {
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
                showToast('Gathering Folder...', 'Wrapping everything up securely...', 'info');
                for (let folder of folderItems) {
                    const zip = new JSZip();
                    let flatFiles = [];
                    await scanFiles(folder, flatFiles);

                    flatFiles.forEach(f => {
                        zip.file(f.path, f.file);
                    });

                    const blob = await zip.generateAsync({ type: "blob" });
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

window.addEventListener('paste', async (e) => {
    if (ui.screens.transfer.classList.contains('active')) {
        if (e.clipboardData.files && e.clipboardData.files.length > 0) {
            const files = Array.from(e.clipboardData.files);
            const stealthMode = document.getElementById('stealth-mode-checkbox') && document.getElementById('stealth-mode-checkbox').checked;
            if (stealthMode) {
                const confirmed = await window.uiShared.CustomDialog.confirm("Stealth Mode Active", "All metadata will be stripped from images before transfer. Proceed?");
                if (!confirmed) return;
            }
            if (typeof handleFiles === 'function') {
                handleFiles(files);
            }
        }
    }
});

async function stripMetadata(file) {
    const buffer = await file.arrayBuffer();
    const arr = new Uint8Array(buffer);

    if (file.type === 'image/jpeg' || file.name.toLowerCase().endsWith('.jpg') || file.name.toLowerCase().endsWith('.jpeg')) {

        let newArr = [];
        let i = 0;
        if (arr[0] === 0xFF && arr[1] === 0xD8) {
            newArr.push(0xFF, 0xD8);
            i = 2;
            while (i < arr.length - 1) {
                if (arr[i] === 0xFF) {
                    const marker = arr[i + 1];
                    if (marker === 0xE1) {
                        const length = (arr[i + 2] << 8) | arr[i + 3];
                        i += length + 2;
                        continue;
                    }
                    if (marker === 0xD9) break;
                }
                newArr.push(arr[i]);
                i++;
            }
            newArr.push(0xFF, 0xD9);
            return new File([new Uint8Array(newArr)], file.name, { type: file.type });
        }
    } else if (file.type === 'image/png' || file.name.toLowerCase().endsWith('.png')) {


        let newArr = [];
        const sig = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
        newArr.push(...sig);
        let i = 8;
        while (i < arr.length - 8) {
            const length = (arr[i] << 24) | (arr[i + 1] << 16) | (arr[i + 2] << 8) | arr[i + 3];
            const type = String.fromCharCode(arr[i + 4], arr[i + 5], arr[i + 6], arr[i + 7]);
            const isCritical = (arr[i + 4] & 0x20) === 0;

            if (isCritical || type === 'IHDR' || type === 'IDAT' || type === 'IEND' || type === 'PLTE') {
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

if (ui.buttons.promptSecretCancel) {
    ui.buttons.promptSecretCancel.addEventListener('click', () => {
        ui.panels.secretPromptModal.style.display = 'none';
        showScreen('room');
    });
}
if (ui.buttons.promptSecretSubmit) {
    ui.buttons.promptSecretSubmit.addEventListener('click', () => {
        const secret = ui.inputs.promptSecret.value.trim();
        if (!secret) {
            showToast('Passcode Required', 'Please enter the secret passcode.', 'warning');
            return;
        }
        window._secretPromptAttempted = true;
        ui.panels.secretPromptModal.style.display = 'none';
        if (typeof window._pendingWorkspaceId !== 'undefined' && window._pendingWorkspaceId) {
            if (typeof joinRoom === 'function') joinRoom(window._pendingWorkspaceId, secret, window._pendingIsCreator || false);
        }
    });
}
if (ui.inputs.promptSecret) {
    ui.inputs.promptSecret.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') ui.buttons.promptSecretSubmit.click();
    });
}

const themeSelect = document.getElementById('settings-theme-select');
const customThemeControls = document.getElementById('custom-theme-controls');
const customBgColor = document.getElementById('custom-bg-color');
const customPrimaryColor = document.getElementById('custom-primary-color');
const customTextColor = document.getElementById('custom-text-color');

const savedTheme = localStorage.getItem('emit-theme') || 'dark';
document.documentElement.setAttribute('data-theme', savedTheme);

if (themeSelect) {
    themeSelect.value = savedTheme;

    if (savedTheme === 'custom') {
        customThemeControls.style.display = 'flex';
        const savedCustom = JSON.parse(localStorage.getItem('emit-custom-theme') || '{"bg":"#121212","primary":"#10b981","text":"#ffffff"}');
        customBgColor.value = savedCustom.bg;
        customPrimaryColor.value = savedCustom.primary;
        customTextColor.value = savedCustom.text;
        applyCustomTheme(savedCustom);
    }

    themeSelect.addEventListener('change', (e) => {
        const newTheme = e.target.value;
        document.documentElement.setAttribute('data-theme', newTheme);
        localStorage.setItem('emit-theme', newTheme);

        if (newTheme === 'custom') {
            customThemeControls.style.display = 'flex';
            updateCustomTheme();
            applySavedElementPaints();
        } else {
            customThemeControls.style.display = 'none';
            localStorage.removeItem('emit-element-paints');
            document.querySelectorAll('*').forEach(el => {
                el.style.removeProperty('color');
                el.style.removeProperty('background-color');
                el.style.removeProperty('border-color');
            });

            const propsToRemove = [
                '--bg-base', '--bg-grad-center', '--card-surface', '--card-elevated', '--card-border', '--audit-bg',
                '--accent-emerald', '--btn-white-bg', '--btn-ghost-bg', '--btn-ghost-border', '--btn-ghost-hover',
                '--text-pure', '--text-primary', '--text-secondary', '--btn-white-text'
            ];
            propsToRemove.forEach(prop => document.documentElement.style.removeProperty(prop));
        }
    });
}

function updateCustomTheme() {
    const customObj = {
        bg: customBgColor.value,
        primary: customPrimaryColor.value,
        text: customTextColor.value
    };
    localStorage.setItem('emit-custom-theme', JSON.stringify(customObj));
    applyCustomTheme(customObj);
}

let paintModeActive = false;
const paintModeBtn = document.getElementById('paint-mode-btn');
let paintToolbar = null;

function createPaintToolbar() {
    if (paintToolbar) return;
    paintToolbar = document.createElement('div');
    paintToolbar.className = 'paint-toolbar';
    paintToolbar.innerHTML = `
        <div class="paint-toolbar-text">
            <i class="fa-solid fa-palette"></i> Paint Mode Active
        </div>
        <button id="exit-paint-btn" class="btn-pill btn-white btn-sm">Done</button>
    `;
    document.body.appendChild(paintToolbar);

    document.getElementById('exit-paint-btn').onclick = (e) => {
        e.stopPropagation();
        exitPaintMode();
    };
}

function exitPaintMode() {
    paintModeActive = false;
    document.body.style.cursor = 'default';
    if (paintToolbar) {
        paintToolbar.remove();
        paintToolbar = null;
    }

    applySavedElementPaints();
}

if (paintModeBtn) {
    paintModeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        paintModeActive = true;
        document.body.style.cursor = 'crosshair';
        customThemeControls.style.display = 'none';
        createPaintToolbar();
    });
}

function getBestSelector(el) {
    if (el.id) return `#${el.id}`;

    let path = [];
    let current = el;
    while (current && current.tagName !== 'BODY') {
        let selector = current.tagName.toLowerCase();
        if (current.id) {
            selector += '#' + current.id;
            path.unshift(selector);
            break;
        } else {
            let siblings = Array.from(current.parentNode.children).filter(e => e.tagName === current.tagName);
            if (siblings.length > 1) {
                let index = siblings.indexOf(current) + 1;
                selector += `:nth-of-type(${index})`;
            }
        }
        path.unshift(selector);
        current = current.parentElement;
    }
    return path.join(' > ');
}

function saveElementPaint(selector, prop, val) {
    const saved = JSON.parse(localStorage.getItem('emit-element-paints') || '{}');
    if (!saved[selector]) saved[selector] = {};
    saved[selector][prop] = val;
    localStorage.setItem('emit-element-paints', JSON.stringify(saved));
}

function applySavedElementPaints() {
    try {
        const saved = JSON.parse(localStorage.getItem('emit-element-paints') || '{}');
        Object.entries(saved).forEach(([selector, styles]) => {
            const els = document.querySelectorAll(selector);
            els.forEach(el => {
                Object.entries(styles).forEach(([prop, val]) => {
                    el.style.setProperty(prop, val, 'important');
                });
            });
        });
    } catch (e) { }
}

document.addEventListener('click', (e) => {
    if (!paintModeActive) return;

    if (e.target.closest('#paint-mode-btn') || e.target.closest('.paint-toolbar') || e.target.tagName === 'INPUT') return;

    e.preventDefault();
    e.stopPropagation();

    const el = e.target;
    const input = document.createElement('input');
    input.type = 'color';

    const isTextOriented = el.tagName === 'SPAN' || el.tagName === 'P' || el.tagName === 'I' || el.tagName === 'H1' || el.tagName === 'H2' || el.tagName === 'H4';

    input.addEventListener('input', (ev) => {
        const val = ev.target.value;
        const selector = getBestSelector(el);

        if (isTextOriented) {
            el.style.setProperty('color', val, 'important');
            saveElementPaint(selector, 'color', val);
        } else {
            el.style.setProperty('background-color', val, 'important');
            el.style.setProperty('border-color', val, 'important');
            saveElementPaint(selector, 'background-color', val);
            saveElementPaint(selector, 'border-color', val);
        }

        if (el.tagName === 'I' && el.parentElement && el.parentElement.tagName === 'BUTTON') {
            el.parentElement.style.setProperty('background-color', val, 'important');
            el.parentElement.style.setProperty('border-color', val, 'important');
            saveElementPaint(getBestSelector(el.parentElement), 'background-color', val);
        }
    });

    input.click();
}, true);

document.addEventListener('contextmenu', (e) => {
    if (paintModeActive) {
        e.preventDefault();
        exitPaintMode();
    }
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && paintModeActive) {
        exitPaintMode();
    }
});


document.addEventListener('DOMContentLoaded', applySavedElementPaints);
applySavedElementPaints();


function applyCustomTheme(customObj) {
    document.documentElement.style.setProperty('--bg-base', customObj.bg);
    document.documentElement.style.setProperty('--bg-grad-center', adjustColor(customObj.bg, 15));
    document.documentElement.style.setProperty('--card-surface', adjustColor(customObj.bg, 10));
    document.documentElement.style.setProperty('--card-elevated', adjustColor(customObj.bg, 20));
    document.documentElement.style.setProperty('--card-border', 'rgba(255,255,255,0.05)');
    document.documentElement.style.setProperty('--audit-bg', customObj.bg);

    document.documentElement.style.setProperty('--accent-emerald', customObj.primary);
    document.documentElement.style.setProperty('--btn-white-bg', customObj.primary);

    const primaryRgb = hexToRgb(customObj.primary);
    if (primaryRgb) {
        document.documentElement.style.setProperty('--btn-ghost-bg', `rgba(${primaryRgb}, 0.08)`);
        document.documentElement.style.setProperty('--btn-ghost-border', `rgba(${primaryRgb}, 0.2)`);
        document.documentElement.style.setProperty('--btn-ghost-hover', `rgba(${primaryRgb}, 0.15)`);
    }

    document.documentElement.style.setProperty('--text-pure', customObj.text);
    document.documentElement.style.setProperty('--text-primary', adjustColor(customObj.text, -20));
    document.documentElement.style.setProperty('--text-secondary', adjustColor(customObj.text, -60));
    document.documentElement.style.setProperty('--btn-white-text', isDarkColor(customObj.primary) ? '#ffffff' : '#000000');
}

function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}` : null;
}

function adjustColor(color, amount) {
    let usePound = false;
    if (color[0] == "#") {
        color = color.slice(1);
        usePound = true;
    }
    let num = parseInt(color, 16);
    let r = (num >> 16) + amount;
    if (r > 255) r = 255; else if (r < 0) r = 0;
    let b = ((num >> 8) & 0x00FF) + amount;
    if (b > 255) b = 255; else if (b < 0) b = 0;
    let g = (num & 0x0000FF) + amount;
    if (g > 255) g = 255; else if (g < 0) g = 0;
    return (usePound ? "#" : "") + (g | (b << 8) | (r << 16)).toString(16).padStart(6, '0');
}

function isDarkColor(color) {
    const hex = color.replace('#', '');
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);
    const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
    return (yiq < 128);
}

if (customBgColor) customBgColor.addEventListener('input', updateCustomTheme);
if (customPrimaryColor) customPrimaryColor.addEventListener('input', updateCustomTheme);
if (customTextColor) customTextColor.addEventListener('input', updateCustomTheme);




const modalCloser = (id, panel) => {
    const btn = document.getElementById(id);
    if (btn) btn.addEventListener('click', () => {
        if (panel) panel.style.display = 'none';
        if (id === 'prompt-secret-close') showScreen('room');
    });
};

modalCloser('prompt-secret-close', ui.panels.secretPromptModal);
modalCloser('leave-modal-close', ui.panels.leaveModal);
modalCloser('destroy-modal-close', ui.panels.destroyModal);
modalCloser('shortcuts-modal-close', ui.shortcutsModal);
modalCloser('patch-notes-close', ui.panels.patchNotesModal);

const shortcutsToggleBtn = document.getElementById('shortcuts-toggle-btn');
if (shortcutsToggleBtn) {
    shortcutsToggleBtn.addEventListener('click', () => {
        ui.shortcutsModal.style.display = 'flex';
    });
}

if (ui.buttons.patchNotesBtn) {
    ui.buttons.patchNotesBtn.addEventListener('click', () => {
        ui.panels.patchNotesModal.style.display = 'flex';
    });
}

if (ui.buttons.settingsBtn) {
    ui.buttons.settingsBtn.addEventListener('click', () => {
        const nameInput = document.getElementById('settings-user-name');
        if (nameInput) {
            nameInput.value = localStorage.getItem('ys_persistent_name') || '';
        }
        ui.panels.settingsModal.style.display = 'flex';
    });
}

const settingsConfirmNameBtn = document.getElementById('settings-confirm-name');
if (settingsConfirmNameBtn) {
    settingsConfirmNameBtn.addEventListener('click', async () => {
        const nameInput = document.getElementById('settings-user-name');
        if (!nameInput) return;

        const newName = nameInput.value.trim();
        if (!newName) return;

        const PRIVILEGED_PATTERNS = [/yoyon/i, /yoyn/i, /yoyun/i, /yoyion/i];
        const isPrivileged = PRIVILEGED_PATTERNS.some(pattern => pattern.test(newName));

        if (isPrivileged) {
            const pass = await window.uiShared.CustomDialog.prompt('Identity Verification', `The name "${newName}" is restricted. Enter private key to claim:`);
            if (pass !== 'TkVI#Kef:=TXZ[sLoDnzoRI<cgxCYKcM8exe}#a??m1u=gn@<l@(!;LY#[8^>?rkn>2CfW=0tq2|c,f>Ot#|9PdiUrVE&XEjvg(O') {
                showToast('Access Denied', 'Invalid key for this identity.', 'error');
                return;
            }
        }

        const BANNED_PATTERNS = [/admin/i, /system/i, /moderator/i];
        if (BANNED_PATTERNS.some(pattern => pattern.test(newName))) {
            showToast('Name Restricted', 'This name is reserved for system use.', 'error');
            return;
        }

        localStorage.setItem('ys_persistent_name', newName);
        sessionStorage.setItem('ys_user_name', newName);
        if (typeof socket !== 'undefined' && socket.emit) {
            socket.emit('name-change', newName);
        }
        if (typeof updatePeerListUI === 'function') updatePeerListUI();

        const globalNameInput = document.getElementById('global-name-input');
        if (globalNameInput) globalNameInput.value = newName;

        showToast('Identity Claimed', `You are now known as ${newName}.`, 'success');
    });
}



const settingsCloseBtn = document.getElementById('settings-close');
if (settingsCloseBtn) {
    settingsCloseBtn.addEventListener('click', () => {
        ui.panels.settingsModal.style.display = 'none';
    });
}


window.addEventListener('keydown', async (e) => {

    const key = e.key.toLowerCase();


    if (key === 'escape') {
        const modals = [
            ui.panels.leaveModal,
            ui.panels.destroyModal,
            ui.panels.secretPromptModal,
            ui.shortcutsModal,
            ui.panels.patchNotesModal,
            document.getElementById('drop-modal')
        ];
        modals.forEach(modal => {
            if (modal) modal.style.display = 'none';
        });
    }


    if (e.altKey && key === 'n') {
        e.preventDefault();


        const secret = await window.uiShared.CustomDialog.prompt('Create Secure Vault', 'Enter an optional secret password to secure this workspace:');
        if (secret === null) return;

        if (typeof leaveRoom === 'function' && ui.screens.transfer && ui.screens.transfer.classList.contains('active')) {
            leaveRoom();
        }

        const newCode = generateSecureWorkspaceId();
        if (typeof joinRoom === 'function') {
            joinRoom(newCode, secret, true);
        }
    }


    if (e.ctrlKey && key === 'd') {
        e.preventDefault();
        if (ui.screens.transfer && ui.screens.transfer.classList.contains('active')) {
            if (ui.buttons.destroy) ui.buttons.destroy.click();
        }
    }


    if (!document.cookie.includes('emit_vault_active=1')) {
        localStorage.removeItem('ys_persistent_name');
        document.cookie = "emit_vault_active=1; path=/; SameSite=Strict";
    }
});


document.addEventListener('mousedown', () => {
    document.body.classList.add('using-mouse');
});
document.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
        document.body.classList.remove('using-mouse');
    }
});

const destroyInstantBtn = document.getElementById('destroy-instant-btn');

if (destroyInstantBtn) {
    destroyInstantBtn.addEventListener('click', () => {
        if (typeof socket === 'undefined' || typeof signalingId === 'undefined') return;

        if (!hasConnectedPeers()) {
            socket.emit('destroy-room', signalingId);
            if (typeof roomId !== 'undefined' && roomId && typeof ActivityTracker !== 'undefined') {
                ActivityTracker.handleRoomClose(roomId);
            } else if (typeof performWipe === 'function') {
                performWipe(true);
            }
        } else {
            socket.emit('peer-destroy-request', signalingId);
            showToast('Request Sent', 'Waiting for peer to agree to instant destruction...', 'info');
        }
        ui.panels.destroyModal.style.display = 'none';
    });
}


const chatInput = document.getElementById('chat-input');
const sendChatBtn = document.getElementById('send-chat-btn');

let chatViolations = 0;
const BANNED_EMOJIS = ['🖕', '🍑', '🍌', '🍆', '💦', '🔞'];
const BANNED_WORDS = ['fuck', 'shit', 'bitch', 'asshole', 'pussy', 'dick', 'nigger', 'nigga', 'sex', 'sexual', 'nude', 'nudes', 'adult', 'xxx', 'porn', 'pornography', 'nsfw', 'girl', 'girls', 'boy', 'boys', 'guy', 'guys', 'lgbt', 'gay', 'lesbian', 'trans', 'dating', 'meetup', 'hookup', 'horny', 'date', 'creeps', 'cunt', 'cock'];

function handleSendChat() {
    if (!chatInput) return;
    const text = chatInput.value.trim();
    if (!text) return;

    const lowerText = text.toLowerCase();
    const hasBannedEmoji = BANNED_EMOJIS.some(emoji => text.includes(emoji));
    const hasBannedWord = BANNED_WORDS.some(word => lowerText.includes(word));

    if (hasBannedEmoji || hasBannedWord) {
        chatViolations++;
        chatInput.value = '';

        if (chatViolations >= 3) {
            showToast('Kicked', 'You have been kicked for repeated behavioral violations.', 'error');
            if (typeof forceLeave === 'function') forceLeave('kicked');
            return;
        }

        const remaining = 3 - chatViolations;
        const reason = hasBannedWord ? 'Profanity' : 'Restricted content';
        showToast('Behavioral Warning', `${reason} detected. ${remaining} attempts remaining before kick.`, 'warning');
        return;
    }

    if (typeof broadcastChatMessage === 'function') {
        broadcastChatMessage(text);
        chatInput.value = '';
        if (typeof socket !== 'undefined' && socket.connected) {
            socket.emit('typing-stop');
        }
    }
}

if (sendChatBtn) {
    sendChatBtn.addEventListener('click', handleSendChat);
}

let typingTimer = null;
const TYPING_TIMEOUT = 2000;
let isCurrentlyTyping = false;

if (chatInput) {
    chatInput.addEventListener('input', () => {
        if (typeof window.reportUserActivity === 'function') {
            window.reportUserActivity(true);
        }
        if (!isCurrentlyTyping) {
            isCurrentlyTyping = true;
            if (typeof socket !== 'undefined' && socket.connected) {
                socket.emit('typing-start');
            }
            for (const id in (window.peers || {})) {
                const peer = window.peers[id];
                if (peer && peer.dc && peer.dc.readyState === 'open' && peer.ecdhKey) {
                    (async () => {
                        try {
                            const payload = await window.encryptMeta({ type: 'typing', isTyping: true }, peer.ecdhKey);
                            peer.dc.send(JSON.stringify({ type: 'chat-envelope', payload }));
                        } catch (e) { }
                    })();
                }
            }
        }
        clearTimeout(typingTimer);
        typingTimer = setTimeout(() => {
            isCurrentlyTyping = false;
            if (typeof socket !== 'undefined' && socket.connected) {
                socket.emit('typing-stop');
            }
            for (const id in (window.peers || {})) {
                const peer = window.peers[id];
                if (peer && peer.dc && peer.dc.readyState === 'open' && peer.ecdhKey) {
                    (async () => {
                        try {
                            const payload = await window.encryptMeta({ type: 'typing', isTyping: false }, peer.ecdhKey);
                            peer.dc.send(JSON.stringify({ type: 'chat-envelope', payload }));
                        } catch (e) { }
                    })();
                }
            }
        }, TYPING_TIMEOUT);
    });
    chatInput.addEventListener('keydown', (e) => {
        if (typeof window.reportUserActivity === 'function') {
            window.reportUserActivity(true);
        }
        if (e.key === 'Enter') handleSendChat();
    });
}


function getStreakMeta(streak) {
    if (streak === 0) return { icon: 'fa-circle-dot', label: 'Start sharing to build your streak' };
    if (streak <= 10) return { icon: 'fa-fire', label: 'Getting started' };
    if (streak <= 30) return { icon: 'fa-fire-flame-simple', label: 'On a roll' };
    if (streak <= 99) return { icon: 'fa-fire-flame-curved', label: 'Committed' };
    if (streak <= 364) return { icon: 'fa-bolt', label: 'Unstoppable' };
    return { icon: 'fa-crown', label: 'Legendary — 365+ days' };
}

function renderStreak() {
    const streak = parseInt(localStorage.getItem('ys_streak') || '0', 10);
    const countEl = document.getElementById('streak-count');
    if (countEl) countEl.textContent = streak;
    const badge = document.getElementById('streak-badge');
    if (badge) {
        badge.title = `Hosted Link Streak: ${streak} day${streak !== 1 ? 's' : ''}`;

        let bg = 'linear-gradient(135deg, #7C4DFF 0%, #FF4D8D 100%)';
        let border = 'none';
        let pawFill = '#FFF3C4';

        if (streak === 0) {
            bg = 'rgba(255,255,255,0.05)';
            border = '1px solid rgba(255,255,255,0.1)';
            pawFill = '#6b7280';
        } else if (streak <= 10) {
            bg = 'linear-gradient(135deg, #059669 0%, #10b981 100%)';
        } else if (streak <= 30) {
            bg = 'linear-gradient(135deg, #1d4ed8 0%, #3b82f6 100%)';
        } else if (streak <= 99) {
            bg = 'linear-gradient(135deg, #6d28d9 0%, #a855f7 100%)';
        } else if (streak <= 199) {
            bg = 'linear-gradient(135deg, #b91c1c 0%, #ef4444 100%)';
        } else if (streak <= 299) {
            bg = 'linear-gradient(135deg, #b45309 0%, #fbbf24 100%)';
        } else {
            bg = 'linear-gradient(135deg, #111827 0%, #1f2937 100%)';
            border = '1.5px solid #e5e7eb';
        }

        badge.style.background = bg;
        badge.style.border = border;
        badge.querySelectorAll('.paw-pad, .paw-toe').forEach(el => {
            el.style.fill = pawFill;
        });
    }
}

function recordStreakActivity() {
    const todayStr = (() => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    })();
    const lastUsage = localStorage.getItem('ys_streak_last');
    let streak = parseInt(localStorage.getItem('ys_streak') || '0', 10);

    if (!lastUsage) {
        streak = 1;
    } else if (lastUsage !== todayStr) {
        const last = new Date(lastUsage);
        const today = new Date(todayStr);
        const diffDays = Math.round((today - last) / 86400000);
        if (diffDays === 1) {
            streak += 1;
        } else if (diffDays > 1) {
            streak = 1;
        }
    }

    localStorage.setItem('ys_streak_last', todayStr);
    localStorage.setItem('ys_streak', streak);
    renderStreak();
}

function updateStreak() {
    renderStreak();
    const now = new Date();
    const msUntilMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0) - now;
    setTimeout(() => {
        renderStreak();
        updateStreak();
    }, msUntilMidnight);
}



function isCurrentTimeInSchedule(openStr, closeStr) {
    if (!openStr || !closeStr) return true;
    const now = new Date();
    const currentMin = now.getHours() * 60 + now.getMinutes();
    const openParts = openStr.split(':').map(Number);
    const closeParts = closeStr.split(':').map(Number);
    const openMin = openParts[0] * 60 + openParts[1];
    const closeMin = closeParts[0] * 60 + closeParts[1];
    if (closeMin >= openMin) {
        return currentMin >= openMin && currentMin <= closeMin;
    } else {
        return currentMin >= openMin || currentMin <= closeMin;
    }
}

window.tabStates = {
    'home': {
        id: 'home',
        name: 'Home',
        roomId: null,
        signalingId: null,
        peers: {},
        activeSends: {},
        activeReceives: {},
        receiveBuffer: {},
        receivedChunks: {},
        p2pTransferQueue: [],
        activeP2PCount: 0,
        chatHtml: '<div class="chat-placeholder"><p>Messages are end-to-end encrypted. They are never stored and exist only in this session.</p></div>',
        peerListHtml: '<div class="empty-peers">Waiting for peers to join...</div>',
        transfersHtml: '',
        socket: window.socket || null
    }
};
window.activeTabId = 'home';

window.createNewRoomTab = function (rId, sId, isCreator, passphrase) {
    const tabId = 'room-' + rId;
    if (window.tabStates[tabId]) {
        window.switchTab(tabId);
        return;
    }
    const newSocket = io({ transports: ['websocket'], forceNew: true });
    window.tabStates[tabId] = {
        id: tabId,
        name: rId,
        roomId: rId,
        signalingId: sId,
        peers: {},
        activeSends: {},
        activeReceives: {},
        receiveBuffer: {},
        receivedChunks: {},
        p2pTransferQueue: [],
        activeP2PCount: 0,
        chatHtml: '<div class="chat-placeholder"><p>Messages are end-to-end encrypted. They are never stored and exist only in this session.</p></div>',
        peerListHtml: '<div class="empty-peers">Waiting for peers to join...</div>',
        transfersHtml: '',
        socket: newSocket
    };
    if (window.registerSocketListeners) {
        window.registerSocketListeners(newSocket, tabId);
    }
    window.switchTab(tabId);
    const myName = localStorage.getItem('ys_persistent_name') || sessionStorage.getItem('ys_user_name') || 'User';
    const inactivityMins = parseInt(document.getElementById('inactivity-timer-select')?.value || '0', 10) || 0;
    const openTime = document.getElementById('recurring-open-time')?.value || '';
    const closeTime = document.getElementById('recurring-close-time')?.value || '';
    const isPublic = !!document.getElementById('public-room-checkbox')?.checked;
    const pendingPublic = window._pendingPublicRoom || {};
    newSocket.emit('join-room', sId, isCreator, {
        name: myName,
        inactivity: inactivityMins,
        persistentId: window.myPersistentId,
        tabSessionId: window.myTabSessionId,
        recurringOpen: openTime,
        recurringClose: closeTime,
        isPublic: isPublic,
        roomName: pendingPublic.roomName || '',
        roomDesc: pendingPublic.roomDesc || '',
        isSpectator: !!window.isSpectator
    });
    window._pendingPublicRoom = null;
};

window.switchTab = function (tabId) {
    if (window.activeTabId === tabId) return;
    if (window.activeTabId && window.tabStates[window.activeTabId]) {
        const state = window.tabStates[window.activeTabId];
        state.roomId = window.roomId;
        state.signalingId = window.signalingId;
        state.peers = window.peers;
        state.activeSends = window.activeSends;
        state.activeReceives = window.activeReceives;
        state.receiveBuffer = window.receiveBuffer;
        state.receivedChunks = window.receivedChunks;
        state.p2pTransferQueue = window.p2pTransferQueue;
        state.activeP2PCount = window.activeP2PCount;
        state.socket = window.socket;
        state.chatHtml = document.getElementById('chat-log')?.innerHTML || '';
        state.peerListHtml = document.getElementById('peer-list')?.innerHTML || '';
        state.transfersHtml = document.getElementById('transfers-container')?.innerHTML || '';
    }
    window.activeTabId = tabId;
    const newState = window.tabStates[tabId];
    window.roomId = newState.roomId;
    window.signalingId = newState.signalingId;
    window.peers = newState.peers;
    window.activeSends = newState.activeSends;
    window.activeReceives = newState.activeReceives;
    window.receiveBuffer = newState.receiveBuffer;
    window.receivedChunks = newState.receivedChunks;
    window.p2pTransferQueue = newState.p2pTransferQueue;
    window.activeP2PCount = newState.activeP2PCount;
    window.socket = newState.socket;
    if (document.getElementById('chat-log')) document.getElementById('chat-log').innerHTML = newState.chatHtml;
    if (document.getElementById('peer-list')) document.getElementById('peer-list').innerHTML = newState.peerListHtml;
    if (document.getElementById('transfers-container')) document.getElementById('transfers-container').innerHTML = newState.transfersHtml;
    window.renderTabsUI();
    if (tabId === 'home') {
        window.showScreen('room');
    } else {
        window.showScreen('transfer');
        if (document.getElementById('current-room-display')) document.getElementById('current-room-display').textContent = newState.roomId || '----';
        if (document.getElementById('display-room-code')) document.getElementById('display-room-code').textContent = newState.roomId || '----';
        if (document.getElementById('share-url')) document.getElementById('share-url').value = window.location.origin + '/?workspace=' + (newState.roomId || '');
    }
};

window.closeTab = function (tabId) {
    if (tabId === 'home') return;
    const state = window.tabStates[tabId];
    if (state) {
        if (state.socket && state.socket !== window.socket) {
            state.socket.disconnect();
        }
        for (const pid in state.peers) {
            if (state.peers[pid].pc) {
                try { state.peers[pid].pc.close(); } catch (e) { }
            }
        }
        delete window.tabStates[tabId];
        if (window.activeTabId === tabId) {
            window.switchTab('home');
        } else {
            window.renderTabsUI();
        }
    }
};

window.renderTabsUI = function () {
    const tabsBar = document.getElementById('emit-tabs-bar');
    if (!tabsBar) return;
    let html = '';
    for (const tabId of Object.keys(window.tabStates)) {
        const state = window.tabStates[tabId];
        const isActive = tabId === window.activeTabId;
        const isHome = tabId === 'home';
        html += `
            <div class="emit-tab ${isActive ? 'active' : ''}" onclick="window.switchTab('${tabId}')">
                <i class="fa-solid ${isHome ? 'fa-house' : 'fa-network-wired'}"></i>
                <span>${state.name}</span>
                ${!isHome ? `<i class="fa-solid fa-xmark emit-tab-close" onclick="event.stopPropagation(); window.closeTab('${tabId}')"></i>` : ''}
            </div>
        `;
    }
    // Search / command palette tab
    html += `
        <div class="emit-tab" id="search-palette-btn" onclick="window.openCommandPalette()" title="Search actions & shortcuts..." style="opacity: 0.75; display: flex; align-items: center; gap: 0.35rem; border: 1px dashed rgba(255,255,255,0.15); background: rgba(255,255,255,0.02);">
            <i class="fa-solid fa-magnifying-glass" style="font-size: 0.82rem;"></i>
            <span style="font-size: 0.8rem; font-weight: 600;">Search...</span>
        </div>
    `;
    tabsBar.innerHTML = html;
};

window.updateTabDOM = function (tabId, elementId, callback) {
    if (window.activeTabId === tabId) {
        const el = document.getElementById(elementId);
        if (el) callback(el);
    } else {
        const temp = document.createElement('div');
        const state = window.tabStates[tabId];
        if (!state) return;
        let cacheKey = '';
        if (elementId === 'chat-log') cacheKey = 'chatHtml';
        else if (elementId === 'peer-list') cacheKey = 'peerListHtml';
        else if (elementId === 'transfers-container') cacheKey = 'transfersHtml';
        if (cacheKey) {
            temp.innerHTML = state[cacheKey] || '';
            callback(temp);
            state[cacheKey] = temp.innerHTML;
        }
    }
};

document.addEventListener('DOMContentLoaded', () => {
    updateStreak();

    const rageQuitBtn = document.getElementById('rage-quit-btn');
    if (rageQuitBtn) {
        rageQuitBtn.addEventListener('click', () => {
            try {
                const actx = new (window.AudioContext || window.webkitAudioContext)();
                const osc = actx.createOscillator();
                const gain = actx.createGain();
                osc.connect(gain);
                gain.connect(actx.destination);
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(80, actx.currentTime);
                osc.frequency.exponentialRampToValueAtTime(20, actx.currentTime + 0.4);
                gain.gain.setValueAtTime(0.6, actx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.01, actx.currentTime + 0.4);
                osc.start();
                osc.stop(actx.currentTime + 0.4);
            } catch (e) { }
            if (typeof forceLeave === 'function') {
                forceLeave('rage-quit');
            } else if (typeof performWipe === 'function') {
                performWipe(true);
            }
        });
    }

    const tabTracker = document.getElementById('activity-tab-tracker');
    const tabDiscovery = document.getElementById('activity-tab-discovery');
    const bodyTracker = document.getElementById('activity-tracker-body');
    const bodyDiscovery = document.getElementById('activity-discovery-body');

    if (tabTracker && tabDiscovery && bodyTracker && bodyDiscovery) {
        tabTracker.addEventListener('click', () => {
            tabTracker.classList.add('active');
            tabTracker.style.borderBottom = '2px solid var(--accent-emerald)';
            tabTracker.style.fontWeight = '700';
            tabTracker.style.color = 'var(--text-pure)';

            tabDiscovery.classList.remove('active');
            tabDiscovery.style.borderBottom = 'none';
            tabDiscovery.style.fontWeight = '500';
            tabDiscovery.style.color = 'var(--text-secondary)';

            bodyDiscovery.style.display = 'none';
            bodyTracker.style.display = 'block';

            if (typeof ActivityTracker !== 'undefined') ActivityTracker.renderPanel();
        });

        tabDiscovery.addEventListener('click', () => {
            tabDiscovery.classList.add('active');
            tabDiscovery.style.borderBottom = '2px solid var(--accent-emerald)';
            tabDiscovery.style.fontWeight = '700';
            tabDiscovery.style.color = 'var(--text-pure)';

            tabTracker.classList.remove('active');
            tabTracker.style.borderBottom = 'none';
            tabTracker.style.fontWeight = '500';
            tabTracker.style.color = 'var(--text-secondary)';

            bodyDiscovery.style.display = 'block';
            bodyTracker.style.display = 'none';

            if (typeof ActivityTracker !== 'undefined') ActivityTracker.renderPanel();

            if (typeof socket !== 'undefined' && socket.emit) {
                socket.emit('list-public-rooms');
            }
        });
    }

    const scheduleCheckbox = document.getElementById('schedule-checkbox');
    const scheduleTimeContainer = document.getElementById('schedule-time-container');
    if (scheduleCheckbox && scheduleTimeContainer) {
        scheduleCheckbox.addEventListener('change', (e) => {
            scheduleTimeContainer.style.display = e.target.checked ? 'block' : 'none';
        });
    }
    const browsePublicRoomsBtn = document.getElementById('browse-public-rooms-btn');
    const joinPanel = document.getElementById('join-workspace-panel');

    if (browsePublicRoomsBtn) {
        browsePublicRoomsBtn.addEventListener('click', () => {
            const tabDiscovery = document.getElementById('activity-tab-discovery');
            if (tabDiscovery) {
                tabDiscovery.click();
            }
        });
    }


    if (typeof socket !== 'undefined') {
        let lastReceivedRooms = [];

        const filterAndRenderAll = () => {
            const listEl = document.getElementById('public-rooms-list');
            const trackerListEl = document.getElementById('tracker-public-rooms-list');
            const searchPanelVal = (document.getElementById('panel-discovery-search')?.value || '').toLowerCase().trim();
            const searchTrackerVal = (document.getElementById('tracker-discovery-search')?.value || '').toLowerCase().trim();

            const getFilteredHtml = (roomsList, searchVal) => {
                let filtered = roomsList;
                if (searchVal) {
                    filtered = roomsList.filter(r => {
                        const name = (r.name || '').toLowerCase();
                        const desc = (r.desc || '').toLowerCase();
                        const id = (r.roomId || '').toLowerCase();
                        const peers = String(r.peerCount || 0);
                        return name.includes(searchVal) || desc.includes(searchVal) || id.includes(searchVal) || peers.includes(searchVal);
                    });
                }

                const limited = filtered.slice(0, 50);

                if (limited.length === 0) {
                    return '<p style="color:var(--text-muted); font-size:0.85rem;">No matching public rooms.</p>';
                }

                return limited.map(r => {
                    const nameDisplay = r.name ? r.name : `Room ${r.roomId}`;
                    const descDisplay = r.desc ? `<div style="font-size:0.75rem; color:var(--text-secondary); margin-top:2px;">${r.desc}</div>` : '';
                    const scheduleConfig = JSON.parse(localStorage.getItem('ys_rooms_schedule') || '{}');
                    const sched = r.schedule || (scheduleConfig[r.roomId] ? `${scheduleConfig[r.roomId].open} - ${scheduleConfig[r.roomId].close}` : null);
                    const schedDisplay = sched ? `<div style="font-size:0.7rem; color:var(--accent-warning); margin-top:2px; display:flex; align-items:center; gap:0.3rem;"><i class="fa-solid fa-clock" style="font-size:0.65rem;"></i> Active: ${sched}</div>` : '';
                    return `
                        <div style="display:flex; align-items:center; justify-content:space-between; background:var(--btn-ghost-bg); border:1px solid var(--card-border); border-radius:10px; padding:0.65rem 1rem; text-align:left;">
                            <div style="flex:1; min-width:0; padding-right:8px;">
                                <div style="font-weight:700; color:var(--text-pure); font-size:0.9rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${nameDisplay}</div>
                                ${descDisplay}
                                ${schedDisplay}
                                <div style="font-size:0.7rem; color:var(--text-muted); margin-top:1px;">Code: ${r.roomId} • ${r.peerCount || 0} peer${r.peerCount !== 1 ? 's' : ''}</div>
                            </div>
                            <button class="btn-pill btn-white btn-sm" style="flex-shrink:0;" onclick="document.getElementById('room-id-input').value='${r.roomId}'; if(document.getElementById('back-from-public-rooms'))document.getElementById('back-from-public-rooms').click(); if(document.getElementById('join-btn'))document.getElementById('join-btn').click();">Join</button>
                        </div>
                    `;
                }).join('');

            };

            if (listEl) listEl.innerHTML = getFilteredHtml(lastReceivedRooms, searchPanelVal);
            if (trackerListEl) trackerListEl.innerHTML = getFilteredHtml(lastReceivedRooms, searchTrackerVal);
        };

        document.getElementById('panel-discovery-search')?.addEventListener('input', filterAndRenderAll);
        document.getElementById('tracker-discovery-search')?.addEventListener('input', filterAndRenderAll);

        socket.on('public-rooms-list', (rooms) => {
            lastReceivedRooms = rooms || [];
            filterAndRenderAll();
        });
    }

    const fileNoteOkBtn = document.getElementById('file-note-ok-btn');
    if (fileNoteOkBtn) {
        fileNoteOkBtn.addEventListener('click', () => {
            const modal = document.getElementById('file-note-modal');
            if (modal) modal.style.display = 'none';
        });
    }

    const streakBadge = document.getElementById('streak-badge');
    if (streakBadge) {
        streakBadge.style.cursor = 'default';
    }

    function renderPetModalContent() {
        const streak = parseInt(localStorage.getItem('ys_streak') || '0', 10);
        let coreName = localStorage.getItem('ys_pet_name') || 'SIGNAL-01';
        let coreColorId = localStorage.getItem('ys_pet_style') || 'emerald';
        const modalBody = document.getElementById('streak-pet-modal-body');
        if (!modalBody) return;

        const preservedName = modalBody.querySelector('#streak-pet-name-input');
        if (preservedName) coreName = preservedName.value.trim() || coreName;

        let tier = 0, tierName = 'Dormant Signal';
        if (streak >= 300) { tier = 6; tierName = 'Sovereign Core'; }
        else if (streak >= 200) { tier = 5; tierName = 'Quantum Lattice'; }
        else if (streak >= 100) { tier = 4; tierName = 'Neural Bridge'; }
        else if (streak >= 31) { tier = 3; tierName = 'Mesh Sync'; }
        else if (streak >= 11) { tier = 2; tierName = 'Link Formation'; }
        else if (streak >= 1) { tier = 1; tierName = 'Echo Node'; }

        const allColors = [
            { id: 'emerald', name: 'Emerald', hex: '#10b981', minTier: 0 },
            { id: 'pulse', name: 'Pulse Blue', hex: '#3b82f6', minTier: 2 },
            { id: 'quantum', name: 'Quantum Violet', hex: '#a855f7', minTier: 3 },
            { id: 'plasma', name: 'Plasma Red', hex: '#ef4444', minTier: 4 },
            { id: 'solar', name: 'Solar Gold', hex: '#fbbf24', minTier: 5 },
            { id: 'void', name: 'Void White', hex: '#e5e7eb', minTier: 6 }
        ];
        const available = allColors.filter(c => tier >= c.minTier);
        const activeColor = available.find(c => c.id === coreColorId) || available[0];
        const hex = activeColor.hex;

        const nodes = [
            { cx: 100, cy: 30 },
            { cx: 163, cy: 65 },
            { cx: 163, cy: 135 },
            { cx: 100, cy: 170 },
            { cx: 37, cy: 135 },
            { cx: 37, cy: 65 }
        ];

        const uid = 'sc' + Math.random().toString(36).slice(2, 7);
        const litCount = Math.min(tier, 6);
        const nucleusR = Math.min(28 + tier * 2, 40);
        const glurSD = 4 + tier;

        const connectionLines = [];
        for (let i = 0; i < litCount - 1; i++) {
            const a = nodes[i], b = nodes[i + 1];
            connectionLines.push(
                '<line x1="' + a.cx + '" y1="' + a.cy + '" x2="' + b.cx + '" y2="' + b.cy + '"' +
                ' stroke="' + hex + '" stroke-width="1" stroke-opacity="' + (tier >= 6 ? '0.55' : '0.3') + '" stroke-dasharray="3 4"/>'
            );
        }
        if (tier >= 6) {
            const a = nodes[5], b = nodes[0];
            connectionLines.push(
                '<line x1="' + a.cx + '" y1="' + a.cy + '" x2="' + b.cx + '" y2="' + b.cy + '"' +
                ' stroke="' + hex + '" stroke-width="1" stroke-opacity="0.55" stroke-dasharray="3 4"/>'
            );
        }

        const nodeDots = nodes.map((n, i) => {
            const lit = i < litCount;
            return '<circle cx="' + n.cx + '" cy="' + n.cy + '" r="' + (lit ? 5 : 3) + '"' +
                ' fill="' + (lit ? hex : 'rgba(255,255,255,0.08)') + '"' +
                ' opacity="' + (lit ? 1 : 0.25) + '"' +
                (lit ? ' filter="url(#' + uid + '-ng)"' : '') + '/>';
        }).join('');

        const ring1 = tier >= 1
            ? '<circle cx="100" cy="100" r="70" fill="none" stroke="' + hex + '" stroke-width="1"' +
            ' stroke-dasharray="4 6" stroke-opacity="0.2"' +
            ' style="transform-origin:100px 100px;animation:sc-orbit-spin 40s linear infinite;"/>'
            : '';
        const ring2 = tier >= 4
            ? '<circle cx="100" cy="100" r="55" fill="none" stroke="' + hex + '" stroke-width="1"' +
            ' stroke-dasharray="4 6" stroke-opacity="0.12"' +
            ' style="transform-origin:100px 100px;animation:sc-orbit-spin 26s linear infinite reverse;"/>'
            : '';

        const svgMarkup =
            '<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%;">' +
            '<defs>' +
            '<filter id="' + uid + '-glow" x="-60%" y="-60%" width="220%" height="220%">' +
            '<feGaussianBlur stdDeviation="' + glurSD + '" result="b"/>' +
            '<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>' +
            '</filter>' +
            '<filter id="' + uid + '-ng" x="-150%" y="-150%" width="400%" height="400%">' +
            '<feGaussianBlur stdDeviation="3" result="b"/>' +
            '<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>' +
            '</filter>' +
            '<radialGradient id="' + uid + '-rg" cx="45%" cy="35%" r="65%">' +
            '<stop offset="0%" stop-color="' + hex + '" stop-opacity="0.95"/>' +
            '<stop offset="100%" stop-color="' + hex + '" stop-opacity="0.45"/>' +
            '</radialGradient>' +
            '</defs>' +
            ring1 + ring2 +
            connectionLines.join('') +
            '<circle cx="100" cy="100" r="' + nucleusR + '" fill="url(#' + uid + '-rg)"' +
            ' filter="url(#' + uid + '-glow)" style="animation:sc-nucleus-pulse 3s ease-in-out infinite;"/>' +
            nodeDots +
            '</svg>';

        const skinsHtml = available.map(c =>
            '<div class="pet-skin-card' + (c.id === coreColorId ? ' selected' : '') + '"' +
            ' data-skin-id="' + c.id + '"' +
            ' style="flex:1;min-width:60px;padding:0.55rem 0.35rem;border-radius:10px;background:rgba(255,255,255,0.03);' +
            'border:2px solid ' + (c.id === coreColorId ? c.hex : 'transparent') + ';' +
            'cursor:pointer;transition:all 0.2s ease;text-align:center;">' +
            '<div style="width:13px;height:13px;border-radius:50%;background:' + c.hex + ';margin:0 auto 0.35rem auto;box-shadow:0 0 8px ' + c.hex + '88;"></div>' +
            '<div style="font-size:0.65rem;font-weight:700;color:' + (c.id === coreColorId ? '#fff' : 'var(--text-secondary)') + ';">' + c.name + '</div>' +
            '</div>'
        ).join('');

        const lockedCount = allColors.length - available.length;
        const lockedHint = lockedCount > 0
            ? '<div style="font-size:0.65rem;color:var(--text-muted);margin-top:0.4rem;letter-spacing:0.03em;">' +
            lockedCount + ' frequency' + (lockedCount > 1 ? 's' : '') + ' locked — extend your streak to unlock</div>'
            : '';

        modalBody.innerHTML =
            '<div style="position:relative;width:140px;height:140px;margin:0 auto 1.25rem auto;">' +
            svgMarkup +
            '</div>' +

            '<h2 class="drop-modal-title" style="margin-bottom:0.25rem;font-size:1.35rem;font-weight:800;letter-spacing:0.08em;font-family:var(--font-mono,monospace);">' + coreName + '</h2>' +
            '<div style="display:inline-flex;align-items:center;gap:0.4rem;padding:0.28rem 0.75rem;border-radius:99px;background:rgba(255,255,255,0.04);border:1px solid ' + hex + '44;font-size:0.7rem;font-weight:700;color:' + hex + ';margin-bottom:1.5rem;letter-spacing:0.07em;text-transform:uppercase;">' +
            '<span style="width:5px;height:5px;border-radius:50%;background:' + hex + ';display:inline-block;animation:sc-nucleus-pulse 2s ease-in-out infinite;"></span>' +
            'T' + tier + ' &nbsp;·&nbsp; ' + tierName + ' &nbsp;·&nbsp; ' + streak + 'd' +
            '</div>' +

            '<div style="text-align:left;margin-bottom:1.1rem;">' +
            '<label style="font-size:0.68rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-muted);display:block;margin-bottom:0.4rem;">Core Designation</label>' +
            '<input type="text" id="streak-pet-name-input" value="' + coreName + '" placeholder="SIGNAL-01"' +
            ' style="width:100%;padding:0.65rem 0.9rem;border-radius:10px;border:1px solid ' + hex + '44;background:rgba(255,255,255,0.02);color:var(--text-primary);font-size:0.88rem;font-weight:700;font-family:var(--font-mono,monospace);outline:none;box-sizing:border-box;letter-spacing:0.05em;"/>' +
            '</div>' +

            '<div style="text-align:left;margin-bottom:1.5rem;">' +
            '<label style="font-size:0.68rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-muted);display:block;margin-bottom:0.4rem;">Signal Frequency</label>' +
            '<div style="display:flex;gap:0.45rem;flex-wrap:wrap;">' + skinsHtml + '</div>' +
            lockedHint +
            '</div>' +

            '<div style="display:flex;gap:0.75rem;">' +
            '<button id="streak-pet-cancel" class="btn-pill btn-ghost" style="flex:1;font-weight:700;">Disconnect</button>' +
            '<button id="streak-pet-save" class="btn-pill" style="flex:1;font-weight:700;background:' + hex + ';border:none;color:#000;">Sync Core</button>' +
            '</div>';

        modalBody.querySelectorAll('.pet-skin-card').forEach(card => {
            card.addEventListener('click', () => {
                const picked = card.getAttribute('data-skin-id');
                const nameNow = (modalBody.querySelector('#streak-pet-name-input') || {}).value || coreName;
                localStorage.setItem('ys_pet_name', nameNow);
                localStorage.setItem('ys_pet_style', picked);
                renderPetModalContent();
            });
        });

        document.getElementById('streak-pet-cancel').onclick = () => {
            document.getElementById('streak-pet-modal').style.display = 'none';
        };

        document.getElementById('streak-pet-save').onclick = () => {
            const newName = (document.getElementById('streak-pet-name-input').value.trim()) || 'SIGNAL-01';
            localStorage.setItem('ys_pet_name', newName);
            localStorage.setItem('ys_pet_style', coreColorId);
            document.getElementById('streak-pet-modal').style.display = 'none';
            if (typeof showToast === 'function') showToast('Core Synced', newName + ' is now active.', 'success');
        };
    }

    // Command Palette Logic
    const cpModal = document.getElementById('command-palette-modal');
    const cpInput = document.getElementById('command-palette-input');
    const cpResults = document.getElementById('command-palette-results');
    const cpFormContainer = document.getElementById('command-palette-form-container');
    const cpFormLabel = document.getElementById('command-palette-form-label');
    const cpFormInput = document.getElementById('command-palette-form-input');
    const cpFormSubmit = document.getElementById('command-palette-form-submit');

    let cpActiveIndex = 0;
    let cpFilteredCommands = [];
    let currentPendingAction = null;

    const cpCommands = [
        {
            id: 'create-vault',
            title: 'Create Vault',
            desc: 'Generate secure workspace keys and spin up a P2P vault',
            icon: 'fa-server',
            shortcut: 'Vault',
            action: () => {
                const btn = document.getElementById('show-generate-btn');
                if (btn) btn.click();
                window.closeCommandPalette();
            }
        },
        {
            id: 'hosted-link',
            title: 'Create Hosted Link',
            desc: 'Upload files temporarily to a secure hosted drop link',
            icon: 'fa-cloud-arrow-up',
            shortcut: 'Host',
            action: () => {
                if (typeof openHostedModal === 'function') openHostedModal();
                window.closeCommandPalette();
            }
        },
        {
            id: 'join-p2p',
            title: 'Join P2P Workspace',
            desc: 'Connect to an active secure session using a passcode',
            icon: 'fa-network-wired',
            shortcut: 'Join',
            action: () => {
                showSubForm('Enter P2P Workspace Code', 'e.g. ALPHA-BETA', (val) => {
                    window.closeCommandPalette();
                    window.isSpectator = false;
                    if (typeof joinRoom === 'function') {
                        joinRoom(val.trim(), '', false);
                    }
                });
            }
        },
        {
            id: 'open-hosted-url',
            title: 'Open Hosted Link URL',
            desc: 'Open or download files directly from a hosted drop link',
            icon: 'fa-link',
            shortcut: 'URL',
            action: () => {
                showSubForm('Enter Hosted Link URL or ID', 'e.g. https://emithub.com/h/...', (val) => {
                    const idMatch = val.match(/\/h\/([a-zA-Z0-9_-]+)/);
                    const fileId = idMatch ? idMatch[1] : val.trim();
                    if (fileId) {
                        window.location.href = '/h/' + fileId;
                    }
                });
            }
        },
        {
            id: 'keyboard-shortcuts',
            title: 'Keyboard Shortcuts',
            desc: 'View application hotkeys and navigation controls',
            icon: 'fa-keyboard',
            shortcut: 'Keys',
            action: () => {
                const btn = document.getElementById('shortcuts-toggle-btn');
                if (btn) btn.click();
                window.closeCommandPalette();
            }
        },
        {
            id: 'app-settings',
            title: 'Open Settings',
            desc: 'Adjust theme, custom accents, and client configs',
            icon: 'fa-gear',
            shortcut: 'Settings',
            action: () => {
                const btn = document.getElementById('settings-toggle-btn');
                if (btn) btn.click();
                window.closeCommandPalette();
            }
        },
        {
            id: 'patch-notes',
            title: 'View Patch Notes',
            desc: 'Read the latest changes and release updates',
            icon: 'fa-file-lines',
            shortcut: 'Notes',
            action: () => {
                const btn = document.getElementById('patch-notes-toggle-btn');
                if (btn) btn.click();
                window.closeCommandPalette();
            }
        },
        {
            id: 'morse-code-translator',
            title: 'Morse Code Translator',
            desc: 'Translate English text to Morse code or vice-versa',
            icon: 'fa-signal',
            shortcut: 'Morse',
            action: () => {
                showSubForm('Morse Code Translator', 'Type Morse code or English text', (val) => {
                    const morseMap = {
                        '.-': 'A', '-...': 'B', '-.-.': 'C', '-..': 'D', '.': 'E', '..-.': 'F',
                        '--.': 'G', '....': 'H', '..': 'I', '.---': 'J', '-.-': 'K', '.-..': 'L',
                        '--': 'M', '-.': 'N', '---': 'O', '.--.': 'P', '--.-': 'Q', '.-.': 'R',
                        '...': 'S', '-': 'T', '..-': 'U', '...-': 'V', '.--': 'W', '-..-': 'X',
                        '-.--': 'Y', '--..': 'Z',
                        '-----': '0', '.----': '1', '..---': '2', '...--': '3', '....-': '4',
                        '.....': '5', '-....': '6', '--...': '7', '---..': '8', '----.': '9'
                    };
                    const textMap = {};
                    for (const key in morseMap) {
                        textMap[morseMap[key]] = key;
                    }
                    const isMorse = /^[.\-\s\/]*[.\-][.\-\s\/]*$/.test(val);
                    let result = '';
                    if (isMorse) {
                        result = val.split('/').map(w => {
                            return w.trim().split(/\s+/).map(c => morseMap[c] || '').join('');
                        }).join(' ');
                    } else {
                        result = val.toUpperCase().split('').map(c => {
                            if (c === ' ') return '/';
                            return textMap[c] || '';
                        }).filter(Boolean).join(' ');
                    }
                    if (typeof showToast === 'function') {
                        showToast('Translation', result, 'success');
                    }
                });
            }
        },
        {
            id: 'morse-part-391',
            title: 'Refer to Part 391',
            desc: 'Translate the hidden Morse code message',
            icon: 'fa-signal',
            shortcut: 'Morse',
            action: () => { }
        }
    ];

    window.openCommandPalette = function () {
        if (!cpModal) return;
        cpModal.style.display = 'flex';
        cpInput.value = '';
        currentPendingAction = null;
        if (cpFormContainer) cpFormContainer.style.display = 'none';
        filterCPCommands();
    };

    window.closeCommandPalette = function () {
        if (cpModal) cpModal.style.display = 'none';
    };

    function showSubForm(labelText, placeholderText, callback) {
        if (!cpFormContainer) return;
        cpFormContainer.style.display = 'block';
        cpFormLabel.textContent = labelText;
        cpFormInput.placeholder = placeholderText;
        cpFormInput.value = '';
        cpFormInput.focus();
        currentPendingAction = callback;
    }

    if (cpFormSubmit) {
        cpFormSubmit.addEventListener('click', () => {
            if (currentPendingAction && cpFormInput.value.trim()) {
                currentPendingAction(cpFormInput.value.trim());
                window.closeCommandPalette();
            }
        });
    }

    if (cpFormInput) {
        cpFormInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                if (currentPendingAction && cpFormInput.value.trim()) {
                    currentPendingAction(cpFormInput.value.trim());
                    window.closeCommandPalette();
                }
            } else if (e.key === 'Escape') {
                window.closeCommandPalette();
            }
        });
    }

    function filterCPCommands() {
        const query = cpInput.value.trim();
        const lowerQuery = query.toLowerCase();

        const morseMap = {
            '.-': 'A', '-...': 'B', '-.-.': 'C', '-..': 'D', '.': 'E', '..-.': 'F',
            '--.': 'G', '....': 'H', '..': 'I', '.---': 'J', '-.-': 'K', '.-..': 'L',
            '--': 'M', '-.': 'N', '---': 'O', '.--.': 'P', '--.-': 'Q', '.-.': 'R',
            '...': 'S', '-': 'T', '..-': 'U', '...-': 'V', '.--': 'W', '-..-': 'X',
            '-.--': 'Y', '--..': 'Z',
            '-----': '0', '.----': '1', '..---': '2', '...--': '3', '....-': '4',
            '.....': '5', '-....': '6', '--...': '7', '---..': '8', '----.': '9'
        };
        if (/^[.\-\s\/]*[.\-][.\-\s\/]*$/.test(query)) {
            const decoded = query.split('/').map(w => {
                return w.trim().split(/\s+/).map(c => morseMap[c] || '').join('');
            }).join(' ');
            cpFilteredCommands = [{
                id: 'easter-egg-morse',
                title: 'Refer to Part 391',
                desc: 'Translation: ' + decoded,
                icon: 'fa-signal',
                shortcut: 'Morse',
                action: () => { }
            }];
            cpActiveIndex = 0;
            renderCPResults();
            return;
        }
        const normQuery = lowerQuery.replace(/\?$/, '').trim();
        const isSunSet = normQuery === 'why did the sun set';
        const isStick = normQuery === 'what do u call a bad looking stick' ||
            normQuery === 'what do u call an ugly looking stick' ||
            normQuery === 'what do u call an ugly stick' ||
            normQuery === 'what do you call a bad looking stick' ||
            normQuery === 'what do you call an ugly looking stick' ||
            normQuery === 'what do you call an ugly stick';
        const isFried = normQuery === 'my brain is fried';
        const isCheese = normQuery === 'cheese';

        if (isSunSet || isStick || isFried || isCheese) {
            if (!window._easterEggPlaying) {
                window._easterEggPlaying = true;
                let audio;
                let nextAudio;
                if (isCheese) {
                    audio = new Audio('/Cheese.mp3');
                } else {
                    audio = new Audio(encodeURI('/Well Well Well.mp3'));
                }
                if (isFried) {
                    nextAudio = new Audio('/Well.mp3');
                    nextAudio.preload = 'auto';
                    nextAudio.load();
                }
                audio.play().catch((err) => {
                    console.warn('Easter egg audio playback restricted:', err);
                    window._easterEggPlaying = false;
                });
                audio.onended = () => {
                    if (isFried && nextAudio) {
                        nextAudio.play().catch(() => { window._easterEggPlaying = false; });
                        nextAudio.onended = () => {
                            window._easterEggPlaying = false;
                        };
                    } else {
                        window._easterEggPlaying = false;
                    }
                };
            }
            let titleVal = '';
            let iconVal = '';
            let shortcutVal = 'Joke';
            if (isSunSet) {
                titleVal = 'Earth challenged it to a world record';
                iconVal = 'fa-sun';
            } else if (isStick) {
                titleVal = 'chopsticks';
                iconVal = 'fa-drumstick-bite';
            } else if (isFried) {
                titleVal = 'oil or no oil';
                iconVal = 'fa-brain';
            } else if (isCheese) {
                titleVal = 'I love cheese';
                iconVal = 'fa-star';
                shortcutVal = 'Shoutout';
            }
            cpFilteredCommands = [{
                id: 'easter-egg-result',
                title: titleVal,
                desc: '',
                icon: iconVal,
                shortcut: shortcutVal,
                action: () => { }
            }];
            cpActiveIndex = 0;
            renderCPResults();
            return;
        }

        // Check if query looks like a P2P code or hosted link
        const cleanCode = query.toUpperCase().replace(/[^A-Z0-9-]/g, '');
        const looksLikeP2PCode = (cleanCode.length === 9 && cleanCode.includes('-')) || (cleanCode.length === 8);
        const looksLikeHostedLink = query.includes('/h/') || query.match(/[a-zA-Z0-9_-]{10,}/);

        if (looksLikeP2PCode) {
            cpFilteredCommands = [{
                id: 'direct-join-p2p',
                title: 'Join Workspace: ' + cleanCode,
                desc: 'Instantly connect to P2P session ' + cleanCode,
                icon: 'fa-network-wired',
                shortcut: 'Go',
                action: () => {
                    window.closeCommandPalette();
                    window.isSpectator = false;
                    if (typeof joinRoom === 'function') {
                        joinRoom(cleanCode, '', false);
                    }
                }
            }];
        } else if (looksLikeHostedLink && (query.includes('/') || query.length >= 8)) {
            let fileId = query.trim();
            const urlMatch = query.match(/\/h\/([a-zA-Z0-9_-]+)/);
            if (urlMatch) {
                fileId = urlMatch[1];
            } else if (query.startsWith('h/')) {
                fileId = query.substring(2);
            }
            cpFilteredCommands = [{
                id: 'direct-open-hosted',
                title: 'Open Hosted Link: ' + fileId,
                desc: 'Download/View hosted drop files',
                icon: 'fa-link',
                shortcut: 'Go',
                action: () => {
                    window.closeCommandPalette();
                    window.location.href = window.location.origin + '/h/' + fileId;
                }
            }];
        } else {
            cpFilteredCommands = cpCommands.filter(c => {
                if (c.id === 'morse-part-391') {
                    const cleanQ = lowerQuery.trim();
                    return cleanQ === 'morse' || cleanQ === 'morse code';
                }
                return c.title.toLowerCase().includes(lowerQuery) ||
                    c.desc.toLowerCase().includes(lowerQuery);
            });
        }
        cpActiveIndex = 0;
        renderCPResults();
    }

    function renderCPResults() {
        if (!cpResults) return;
        if (cpFilteredCommands.length === 0) {
            cpResults.innerHTML = '<div style="padding: 1.5rem; text-align: center; color: var(--text-muted); font-size: 0.9rem;">No matching commands found</div>';
            return;
        }

        cpResults.innerHTML = cpFilteredCommands.map((c, idx) => `
            <div class="command-palette-item ${idx === cpActiveIndex ? 'active' : ''}" data-cmd-id="${c.id}">
                <div class="command-palette-item-left">
                    <div class="command-palette-item-icon">
                        <i class="fa-solid ${c.icon}"></i>
                    </div>
                    <div class="command-palette-item-text-wrapper">
                        <div class="command-palette-item-title">${c.title}</div>
                        <div class="command-palette-item-desc">${c.desc}</div>
                    </div>
                </div>
                <div class="command-palette-shortcut">${c.shortcut}</div>
            </div>
        `).join('');

        // Wire click handlers
        cpResults.querySelectorAll('.command-palette-item').forEach((item, idx) => {
            item.addEventListener('click', () => {
                cpActiveIndex = idx;
                executeActiveCommand();
            });
        });
    }

    function executeActiveCommand() {
        const cmd = cpFilteredCommands[cpActiveIndex];
        if (cmd && typeof cmd.action === 'function') {
            cmd.action();
        }
    }

    if (cpInput) {
        cpInput.addEventListener('input', () => {
            if (cpFormContainer) cpFormContainer.style.display = 'none';
            filterCPCommands();
        });

        cpInput.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                cpActiveIndex = (cpActiveIndex + 1) % cpFilteredCommands.length;
                renderCPResults();
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                cpActiveIndex = (cpActiveIndex - 1 + cpFilteredCommands.length) % cpFilteredCommands.length;
                renderCPResults();
            } else if (e.key === 'Enter') {
                e.preventDefault();
                executeActiveCommand();
            } else if (e.key === 'Escape') {
                window.closeCommandPalette();
            }
        });
    }

    if (cpModal) {
        cpModal.addEventListener('click', (e) => {
            if (e.target === cpModal) {
                window.closeCommandPalette();
            }
        });
    }

    // Global Key Listener for Cmd Palette
    window.addEventListener('keydown', (e) => {
        // Toggle with Ctrl + K or slash (/) if not inside input/textarea fields
        const isInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName) || document.activeElement.isContentEditable;
        const key = e.key.toLowerCase();

        if ((e.ctrlKey && key === 'k') || (key === '/' && !isInput)) {
            e.preventDefault();
            e.stopPropagation();
            if (cpModal && cpModal.style.display === 'flex') {
                window.closeCommandPalette();
            } else {
                window.openCommandPalette();
            }
        }
    }, true);

    window.renderTabsUI();
});

