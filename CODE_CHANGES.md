# FORCE OVERWRITE DEMO
All previous content has been replaced as ordered.
        name: p.name,
        oldPeerId: oldPeerId
    };
    
    // Update transfer references FIRST
    for (const [fId, meta] of Object.entries(activeReceives)) {
        if (meta.senderId === oldPeerId) {
            meta.senderId = p.id;  // ← NEW socket ID
        }
    }
    
    // DELETE only the socket ID reference, not the connection
    delete peers[oldPeerId];
}
```

**Build new peers map**:
```javascript
// Reuse preserved connections
if (peersToPreserveState[p.id]) {
    newPeers[p.id] = {
        id: p.id,
        pc: peersToPreserveState[p.id].pc,    // ← Preserved PC
        dc: peersToPreserveState[p.id].dc,    // ← Preserved DC
        // ... other state
        reconnecting: false  // ← Mark as reconnected
    };
}
```

**Post-reconnect fixup**:
```javascript
// If DC is already open, manually resume transfers
for (const [newPeerId, preservedState] of Object.entries(peersToPreserveState)) {
    if (preservedState.dc && preservedState.dc.readyState === 'open') {
        for (const [fId, sendState] of Object.entries(activeSends)) {
            if (sendState.targetId === newPeerId && sendState.paused) {
                resumeSendFile(fId, newPeerId);  // ← Resume on existing channel
            }
        }
    }
}
```

**Skip redundant offers**:
```javascript
// Only offer for NEW peers, not reconnects
const hasWorkingConnection = peers[p.id].pc && peers[p.id].dc;
if (!p.reconnecting && !hasWorkingConnection && !peers[p.id].pc) {
    await initiateMeshOffer(p.id);  // ← NEW peer only
}
```

---

### 2. Enhanced `user-left` Handler (Line ~1054)

**What Changed**:
- Detect `reason === 'reconnect'` explicitly
- For reconnects: mark as `reconnecting=true` and **RETURN early**
- Don't clean up transfers during reconnect
- Only clean up for actual disconnects

**Key Code**:
```javascript
socket.on('user-left', (leftPeerId, reason) => {
    if (peers[leftPeerId]) {
        if (reason === 'reconnect') {
            // ← NEW: Preserve state during reconnect
            peers[leftPeerId].reconnecting = true;
            const statusEl = document.getElementById(`peer-status-${leftPeerId}`);
            if (statusEl) {
                statusEl.textContent = 'Reconnecting...';
                statusEl.style.color = 'var(--text-warning)';
            }
            auditLog(`Peer disconnected - awaiting reconnect...`);
            return;  // ← EARLY RETURN - don't clean up
        } else {
            // Actual disconnect: full cleanup
            if (peers[leftPeerId].pc) {
                try { peers[leftPeerId].pc.close(); } catch(e){}
            }
            delete peers[leftPeerId];
        }
    }
    
    // Only clean up transfers for ACTUAL disconnects
    if (reason !== 'reconnect') {
        // ... remove transfer items, clean activeReceives, activeSends
    }
});
```

---

## Data Flow: Before vs After

### BEFORE (Broken)
```
User-Left (old socket, reconnect)
    ↓
Client marks peer.reconnecting = true
    ↓
Peer-List (new socket)
    ↓
Client finds old peer with reconnecting flag
    ↓
Client CLOSES old PC ❌
    ↓
Client DELETES old peer ❌
    ↓
Client creates NEW empty peer ❌
    ↓
Client initiates offer/answer ❌
    ↓
ICE negotiation starts ❌
    ↓
MEANWHILE: Transfers try to resume on deleted DC ❌ CRASH
```

### AFTER (Fixed)
```
User-Left (old socket, reconnect)
    ↓
Client marks peer.reconnecting = true
    ↓
Peer-List (new socket)
    ↓
Client finds old peer with reconnecting flag
    ↓
Client PRESERVES old PC ✅
    ↓
Client PRESERVES old DC ✅
    ↓
Client maps transfer state to new socket ID ✅
    ↓
Client replaces peer object but keeps PC/DC reference ✅
    ↓
Existing DC remains open & active ✅
    ↓
Transfers resume on preserved channel immediately ✅
    ↓
No new negotiation needed ✅
```

---

## Critical Code Paths

### Transfer State Preservation

**activeReceives mapping** (line ~949):
```javascript
// Before:
for (const [fId, meta] of Object.entries(activeReceives)) {
    if (meta.senderId === oldPeerId) {
        meta.senderId = p.id;  // ← Update to new socket
    }
}
```

**activeSends mapping** (line ~956):
```javascript
// Before:
for (const [fId, sendState] of Object.entries(activeSends)) {
    if (sendState.targetId === oldPeerId) {
        sendState.targetId = p.id;  // ← Update to new socket
    }
}
```

These ensure transfers continue with correct peer references.

### Connection Reuse

**Preserved state structure** (line ~935):
```javascript
peersToPreserveState[p.id] = {
    pc: oldPeer.pc,           // ← RTCPeerConnection object (stays open)
    dc: oldPeer.dc,           // ← RTCDataChannel object (stays open)
    ecdhKey: oldPeer.ecdhKey, // ← AES key (stays valid)
    currentSpeedStats: oldPeer.currentSpeedStats,  // ← Speed calc state
    persistentId: p.persistentId,
    name: p.name,
    oldPeerId: oldPeerId
};
```

The PC and DC remain active because we're holding references to them through the new peer object.

### Resumed Transfers Trigger

**Manual resumption after reconnect** (line ~1019):
```javascript
for (const [newPeerId, preservedState] of Object.entries(peersToPreserveState)) {
    if (preservedState.dc && preservedState.dc.readyState === 'open') {
        for (const [fId, sendState] of Object.entries(activeSends)) {
            if (sendState.targetId === newPeerId && sendState.paused && !sendState.aborted) {
                resumeSendFile(fId, newPeerId);
                auditLog(`Resumed paused send after reconnect`);
            }
        }
    }
}
```

This catches the case where the DC opens while we're still updating state.

---

## Backward Compatibility

✅ **Fully backward compatible**:
- Non-reconnect scenarios unchanged
- Server-side changes already in place (disconnect handler)
- No breaking API changes
- Graceful fallback if DC not open

---

## Testing Impact

| Scenario | Before | After |
|----------|--------|-------|
| Background/foreground | ❌ Transfer fails | ✅ Transfer continues |
| Long transfer + reconnect | ❌ Restart from 0% | ✅ Resume from last chunk |
| Multiple reconnects | ❌ Each breaks transfer | ✅ All seamless |
| Actual peer exit | ❌ Same as reconnect | ✅ Properly detected |
| Speed stats | ❌ Reset to 0 | ✅ Continuous |
| UI toast messages | ❌ False "left" | ✅ "Reconnecting..." only |

---

## Troubleshooting

### Transfer Still Cancels?
1. Check `peersToPreserveState` logic - is persistentId matching?
2. Check DC readyState - should be `open`
3. Check `resumeSendFile` being called with correct newPeerId
4. Check audit log for "Resumed paused send" message

### Duplicate Peers in UI?
1. Check that old peer ID is properly deleted from `peers` map
2. Check that `updatePeerListUI()` is called after peer map update
3. Check that old socket ID cleanup happens before new peer creation

### New Negotiation Still Happening?
1. Check `hasWorkingConnection` condition - should be true for reconnects
2. Check that `initiateMeshOffer` is NOT being called
3. Check audit log for absence of "Connection with ... → connecting"

---

## Key Invariants

✅ **Always true after this fix**:
1. Reconnecting peer preserves PC/DC
2. Transfer state references updated before cleanup
3. New peer object created ONLY for genuinely new peers
4. Old socket ID removed ONLY after references updated
5. DC handlers trigger transfer resumption when open
6. `user-left` with reason='reconnect' does NOT clean up transfers

