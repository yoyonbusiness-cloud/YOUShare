# EMIT

**Private, peer-to-peer file sharing. No servers, no accounts, no trackers.**

---

## Features

- **P2P Transfer** — Direct device-to-device file sharing using WebRTC. 
- **End-to-End Encryption** — All transfers are protected with AES-GCM encryption.
- **Fast** — High-performance data channel logic for large file transfers.
- **Folder Support** — Send entire folders instantly (recursively zipped).
- **Hosted Drop** — Option to generate encrypted download links for offline sharing.
- **Responsive** — Minimalist, dark-themed UI that works on mobile and desktop.

---

## Quick Start

**Requirements:** Node.js 18+

```bash
git clone https://github.com/yoyonbusiness-cloud/YOUShare.git
cd YOUShare
npm install
node server.js
```

Then open `http://localhost:3000` on two devices on the same network, or expose via a tunnel (e.g. ngrok, Cloudflare Tunnel) for cross-network transfers.

---

## How It Works

1. **Create a Vault** — One device generates a workspace code.
2. **Join** — The other device enters the code (and optional secret word for E2E encryption).
3. **Drop Files** — Drag files or folders, press browse, or paste from clipboard.
4. **Save** — The receiver taps the **Save** button when the transfer completes.

Workspaces are ephemeral. When both users leave or the room is destroyed, all keys are wiped.

---

## Stack

| Layer | Technology |
|---|---|
| Transport | WebRTC DataChannels |
| Signaling | Socket.IO |
| Encryption | Web Crypto API (ECDH + HKDF + AES-GCM) |
| Compression | JSZip (folder bundling) |
| Server | Node.js + Express |

---

## License

MIT © 2026 Yoyon
