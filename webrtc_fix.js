// Emergency fix for WebRTC connection
// Replace the broken WebRTC logic with working version

// Override the broken initiatePeerConnection function
const originalInitiatePeerConnection = window.initiatePeerConnection;

window.initiatePeerConnection = async function(targetId) {
    console.log('FIXED: Initiating peer connection to', targetId);
    
    if (!window.peers) window.peers = {};
    if (!window.peers[targetId]) {
        window.peers[targetId] = { 
            id: targetId, 
            name: 'Peer', 
            pc: null, 
            dc: null, 
            channel: null 
        };
    }
    
    const peer = window.peers[targetId];
    
    // Close any existing broken connection
    if (peer.pc) {
        try {
            peer.pc.close();
        } catch (e) {}
        peer.pc = null;
        peer.dc = null;
        peer.channel = null;
    }
    
    // Create new RTCPeerConnection with simple config
    const config = {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' }
        ]
    };
    
    const pc = new RTCPeerConnection(config);
    peer.pc = pc;
    
    // Create data channel
    const dc = pc.createDataChannel('fileTransfer', {
        ordered: true,
        maxPacketLifeTime: 10000
    });
    
    // Simple data channel setup
    dc.onopen = () => {
        console.log('FIXED: Data channel opened to', targetId);
        peer.dc = dc;
        peer.channel = dc;
        
        // Show success toast
        if (window.showToast) {
            window.showToast('Connected', 'Direct peer connection established', 'success');
        }
        
        // Resume any pending transfers
        if (window.activeSends) {
            for (const [fileId, sendState] of Object.entries(window.activeSends)) {
                if (sendState.targetId === targetId && sendState.paused && !sendState.aborted) {
                    if (window.resumeSendFile) {
                        window.resumeSendFile(fileId, targetId);
                    }
                }
            }
        }
    };
    
    dc.onclose = () => {
        console.log('FIXED: Data channel closed to', targetId);
        if (peer.channel === dc) {
            peer.channel = null;
            peer.dc = null;
        }
    };
    
    dc.onerror = (err) => {
        console.log('FIXED: Data channel error:', err);
    };
    
    // Set up ICE candidate handling
    pc.onicecandidate = (e) => {
        if (e.candidate && window.socket && window.signalingId) {
            window.socket.emit('ice-candidate', e.candidate, window.signalingId, targetId);
        }
    };
    
    pc.oniceconnectionstatechange = () => {
        console.log('FIXED: ICE state:', pc.iceConnectionState);
    };
    
    // Create and send offer
    try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        
        if (window.socket && window.signalingId) {
            window.socket.emit('offer', pc.localDescription, window.signalingId, targetId);
        }
    } catch (err) {
        console.log('FIXED: Error creating offer:', err);
    }
    
    return pc;
};

// Also fix handleFiles to be more aggressive
const originalHandleFiles = window.handleFiles;

window.handleFiles = async function(files) {
    console.log('FIXED: handleFiles called with', files.length, 'files');
    
    if (!window.peers) {
        if (window.showToast) {
            window.showToast('No Peers', 'Join a room with someone first', 'error');
        }
        return;
    }
    
    const peerArray = Object.values(window.peers);
    if (peerArray.length === 0) {
        if (window.showToast) {
            window.showToast('No Peers', 'Join a room with someone first', 'error');
        }
        return;
    }
    
    const targetPeer = peerArray[0];
    const targetId = targetPeer.id;
    
    // Force connection if not already connected
    if (!targetPeer.dc || targetPeer.dc.readyState !== 'open') {
        if (window.showToast) {
            window.showToast('Establishing Connection', 'Setting up direct link...', 'info');
        }
        
        // Use our fixed version
        window.initiatePeerConnection(targetId).catch(() => {});
        
        // Wait a bit for connection
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // Process each file
    for (let f of files) {
        const pendingId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        
        if (window.createTransferElement) {
            window.createTransferElement(pendingId, f.name, f.size, false, f, '');
        }
        
        if (window.updateTransferProgress) {
            window.updateTransferProgress(pendingId, 0, `Preparing to send to ${targetPeer.name}`, '', '');
        }
        
        if (window.p2pTransferQueue) {
            window.p2pTransferQueue.push({ file: f, targetId, nickname: '' });
        }
    }
    
    if (window.processP2PQueue) {
        window.processP2PQueue();
    }
};

console.log('FIXED: WebRTC emergency fixes applied');