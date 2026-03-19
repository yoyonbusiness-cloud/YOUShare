# Emit

**Hyper-speed, zero-knowledge, peer-to-peer file sharing. No accounts. No servers. No limits.**

---

## Features

- **Direct P2P Transfers** — Files go device-to-device via WebRTC. The server never touches your data.
- **End-to-End Encryption** — ECDH key exchange + AES-GCM encryption on every file and chunk.
- **Maximum Speed** — 1Gbps SDP signaling, 64MB saturation buffer, and crypto-pipelining targeting 40MB/s–100MB/s.
- **Folder Support** — Drag a folder or use "Send Folder". It recursively zips and sends the whole thing.
- **Hosted Drop** — No peer? Upload an encrypted file (up to 512 MB) and share a self-decrypting link. The server never sees the plaintext.
- **Mobile Resilient** — Sessions survive page refreshes via `localStorage`. Works on any device, any screen size.
- **Zero-Comment, Production Code** — Clean, professional codebase with no debug artifacts.

---

## Quick Start

**Requirements:** Node.js 18+

```bash
git clone https://github.com/yoyonbusiness-cloud/emit.git
cd emit
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
