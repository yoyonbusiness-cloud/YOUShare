# WebRTC P2P Seamless Reconnect - Test Verification Guide

## Overview
This guide helps verify that the mobile client reconnection now preserves active file transfers and WebRTC connections without interruption.

---

## Test Scenario 1: File Transfer During Reconnect (Mobile)

### Setup
- 2 clients (e.g., laptop + mobile)
- Start a P2P workspace
- Establish connection between both peers

### Test Steps
1. **Mobile client starts sending file to Desktop**
   - File size: ~50MB (enough to take 10+ seconds)
   - Monitor transfer progress bar
   - Note the speed in B/s

2. **After 5 seconds of transfer, background the mobile app**
   - Press home/back button to background
   - This triggers socket disconnect
   - Desktop peer should see UI update: "Reconnecting..."
   - Transfer progress bar should remain visible (NOT removed)

3. **Return to mobile app after 2-3 seconds**
   - App resumes in foreground
   - Browser establishes new WebSocket connection with new socket ID
   - Desktop should see: "Connected" (status updates)
   - Transfer progress should continue from where it paused
   - No "File transfer cancelled" message
   - File should complete sending

### Expected Outcomes ✅
- [ ] Desktop shows "Reconnecting..." while mobile backgrounded (not "Participant Left")
- [ ] Transfer progress item stays in UI (not removed)
- [ ] After reconnect, transfer resumes automatically
- [ ] No new negotiation delay
- [ ] Transfer completes successfully
- [ ] Speed stats roughly continuous (don't reset to 0)

### ❌ Failure Signs
- Transfer item disappears from UI
- Toast message "Participant Left"
- Transfer speed resets to 0 B/s
- ICE negotiation visible in audit log after reconnect
- New transfer metadata sent after reconnect

---

## Test Scenario 2: File Receive During Reconnect (Mobile)

### Setup
- 2 clients
- Both connected in workspace

### Test Steps
1. **Desktop starts sending file to mobile**
   - File size: ~30MB
   - Monitor progress

2. **After 5 seconds, background mobile app**
   - Socket disconnects
   - Desktop should show "Reconnecting..."

3. **Return to mobile app**
   - New socket connects
   - Check transfer progress on mobile
   - Should continue receiving

### Expected Outcomes ✅
- [ ] Mobile transfer UI preserved (not cleared)
- [ ] Download continues from chunk where it paused
- [ ] Audit log shows "Partial file detected... requesting resume"
- [ ] Transfer completes without restarting

---

## Test Scenario 3: Multiple Rapid Reconnects

### Setup
- 2 clients in workspace
- File transfer in progress

### Test Steps
1. Background/foreground mobile 3-4 times rapidly (within 2 seconds each)
2. Monitor for any crashes, UI glitches, or transfer failures

### Expected Outcomes ✅
- [ ] App remains stable
- [ ] No duplicate peers in UI
- [ ] Transfer continues smoothly
- [ ] Audit log shows clean mappings

---

## Test Scenario 4: Actual Peer Exit vs Reconnect Distinction

### Setup
- 2 clients connected

### Test Steps
**Part A: Reconnect (should NOT show "Participant Left")**
1. Background mobile briefly
2. Return to app
3. Verify no "Participant Left" toast

**Part B: Actual Exit (SHOULD show "Participant Left")**
1. Stop/kill mobile app
2. Verify "Participant Left" toast appears
3. Verify peer removed from UI

### Expected Outcomes ✅
- [ ] Reconnect: NO "Participant Left" toast, transfer continues
- [ ] Exit: YES "Participant Left" toast, peer removed, transfers cleaned up

---

## Test Scenario 5: Concurrent Transfers on Reconnect

### Setup
- 3 clients: A, B, C
- A and B already transferring files
- A is about to send to C

### Test Steps
1. **A sends to B** (large file)
2. After 3 seconds: **A sends to C** (smaller file, different data channel)
3. After another 2 seconds: **Background client B**
4. Let B reconnect while both transfers are active

### Expected Outcomes ✅
- [ ] B shows "Reconnecting..." only once
- [ ] Both transfer items stay in UI
- [ ] After B reconnects:
  - Transfer to B resumes
  - Transfer to C continues unaffected
  - No transfer state corruption

---

## Audit Log Inspection

### Key Signatures of Successful Reconnect

**Good Log Sequence:**
```
[MM:SS.mmm] Peer user-left (reconnect)
[MM:SS.mmm] Peer disconnected - awaiting reconnect...
[MM:SS.mmm] Peer seamlessly reconnected - connection preserved
[MM:SS.mmm] Transfer mapped from old peer xxx → new yyy
[MM:SS.mmm] Resumed paused send "fileId" to peer after reconnect
```

**Bad Log Sequence (old behavior):**
```
[MM:SS.mmm] Peer left: xxx
[MM:SS.mmm] Error handling answer from xxx (STALE!)
[MM:SS.mmm] Incoming transfer from xxx cancelled (peer left).
[MM:SS.mmm] Connection with yyy → connecting
```

---

## Browser DevTools Checklist

### WebRTC Stats (Chrome DevTools > WebRTC)
- [ ] **RTCPeerConnection state**: Should remain `connected` (not close→new)
- [ ] **ICE connection state**: Should remain `connected` (not restart)
- [ ] **Data channel state**: Should remain `open`

### Network Tab (F12 > Network)
- Check for WebSocket reconnect (should be quick)
- [ ] Old socket: `101 Switching Protocols` → then closes
- [ ] New socket: New `101 Switching Protocols` established
- [ ] NO spurious fetch/XHR requests

### Console (F12 > Console)
- [ ] No errors about stale targetId references
- [ ] No errors about `dc.send()` on closed channel
- [ ] Audit logs show proper sequencing

---

## Performance Metrics

### Measure Reconnect Time
```javascript
// In browser console during test:
reconnectStart = performance.now();
// [Background and return app]
// Monitor when peer shows as Connected again
reconnectEnd = performance.now();
console.log(`Reconnect took ${reconnectEnd - reconnectStart}ms`);
```

### Expected Values
- **Socket reconnect**: 100-500ms (network dependent)
- **Peer state sync**: <100ms (local processing)
- **Transfer resume**: <500ms (DC already open)
- **Total**: 200-1000ms (typically <500ms for WiFi)

---

## Failure Diagnosis

### If Transfer Still Cancels on Reconnect

**Check 1: Audit Log**
- [ ] Does it show `Transfer mapped... old peer → new`?
  - **NO** = persistentId not matching (server bug)
  - **YES** = continue to Check 2

- [ ] Does it show `Resumed paused send`?
  - **NO** = DC not open or targetId mismatch
  - **YES** = transfer should resume

**Check 2: WebRTC Stats**
- [ ] Is RTCPeerConnection still `connected`?
  - **NO** = PC was destroyed (code issue)
  - **YES** = continue to Check 3

**Check 3: Data Channel State**
```javascript
// In console, after reconnect:
Object.entries(peers).forEach(([id, peer]) => {
    console.log(`Peer ${id}: PC=${peer.pc?.connectionState}, DC=${peer.dc?.readyState}`);
});
```

- [ ] DC shows `open`?
  - **NO** = channel closed or not reused
  - **YES** = transfers should work

**Check 4: Transfer State**
```javascript
// Check if transfers were preserved:
console.log('Active receives:', Object.keys(activeReceives));
console.log('Active sends:', Object.keys(activeSends));
console.log('Peers:', Object.keys(peers));
```

- [ ] Are transfers still in maps?
  - **NO** = they were deleted (code issue)
  - **YES** = they should resume

---

## Server Logs

### What to Look For

**Good Sequence:**
```
socket#xxx join-room with persistentId=abc-def-123
  → Existing peer found with same persistentId but different socket
  → Marked as reconnect, emitting user-left for old socket
socket#xxx emitted peer-list with new socket
```

**Bad Sequence:**
```
socket#xxx disconnect
socket#yyy join-room with persistentId=abc-def-123
  → ERROR: Old socket not found (was deleted premature
