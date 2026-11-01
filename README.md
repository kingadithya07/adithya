# BharatChat — working vertical slice

A runnable, deliberately scoped slice of the BharatChat blueprint (SAB v4.1): **+91 passwordless
onboarding, real end-to-end encrypted 1:1 messaging, encrypted photo attachments, and a 5-tab
consumer shell.**

This repository does **not** contain the production platform the blueprint describes. It contains
one honest vertical slice of it, plus a reconciled architecture document that separates what is
built from what is designed.

> **Read this first:** [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) contains a
> claim-by-claim status table for every subsystem in SAB v4.1 — *Built*, *Partial*, or
> *Not built*. Nothing in this README is claimed beyond what that table says.

---

## Run it

```bash
npm install
npm run dev        # http://localhost:3001  (server + Vite middleware on one port)
```

Production-style run:

```bash
npm run build
npm run start      # NODE_ENV=production, serves dist/ + /api + /ws
```

## Try it in 60 seconds

The slice is real E2EE, so it needs **two identities**. A second device is not required — each
browser tab keeps its own session and its own device key:

1. Open the app, pick a language, enter any valid-looking 10-digit Indian mobile number
   (must start 6–9), e.g. `9876543210`.
2. The code is shown on screen — see *SMS* below. It also auto-fills.
3. Set a name, optionally upload a photo, then **duplicate the tab**.
4. In the second tab, register a **different** number and a different name.
5. Message between the two tabs. Open DevTools → Network and watch `/api/messages`: the payload is
   base64 ciphertext, never plaintext. `🔒` badges, live typing indicators and encrypted photos all
   work across the two tabs.

To watch the server's view directly:

```bash
curl -s localhost:3001/api/health
cat data/messages.json     # every stored message, all ciphertext
```

## What actually works

| Capability | Status | Where |
|---|---|---|
| Language-first onboarding (23 languages listed, 6 fully translated) | ✅ Built | `src/i18n.js`, `src/components/Onboarding.jsx` |
| +91 mobile sign-up/login with 6-digit OTP, hashed at rest, 5-min TTL, 5 attempts | ✅ Built (no SMS gateway — see below) | `server/auth.js` |
| ECDH P-256 → HKDF-SHA256 → AES-256-GCM message encryption | ✅ Built | `src/crypto/e2ee.js` |
| Real-time delivery over WebSocket, presence, typing indicators | ✅ Built | `server/chat.js`, `server/index.js` |
| 60-digit safety numbers for out-of-band key verification | ✅ Built | `src/crypto/e2ee.js`, `src/components/SettingsView.jsx` |
| Photo attachments: on-device compress → encrypt → opaque blob upload | ✅ Built | `src/components/ChatWindow.jsx` |
| HTTP 206 byte-range streaming of stored blobs | ✅ Built | `server/media.js` |
| Server-side avatar transcoding (sharp/libvips → WebP) + 24px micro-blur preview | ✅ Built | `server/media.js` |
| Edge spam guard: 25 msg/10 s token bucket + 10-new-peer fan-out cap | ✅ Built | `server/guard.js` |
| 5-tab shell (Chats, Status, Channels, Calls, Settings) + floating *New chat* FAB | ✅ Built | `src/components/Shell.jsx` |
| Status / Channels / Calls feature bodies | ❌ Not built — labelled in-app | `src/components/PlaceholderViews.jsx` |
| Group chat, voice notes, WebRTC calls, bots, ONDC, verification, backups | ❌ Not built | — |

## Tests

```bash
npm run smoke          # 28 end-to-end assertions against the live server
npm run check:render   # server-renders every screen to catch broken components
npm run verify         # both
```

`npm run smoke` is not a mock harness. It drives the real HTTP surface and the real crypto module,
and it asserts the security properties rather than just the happy path:

```
✓ stored payload does not contain plaintext
✓ a third party key fails to decrypt (AES-GCM auth)
✓ tampered ciphertext is rejected
✓ private media rejects anonymous fetch
✓ authenticated range request returns 206 — bytes 0-1023/200016
✓ media decrypts byte-for-byte — 200000 bytes
✓ avatar transcoded to WebP — 203648 B PNG → 4986 B WebP
✓ message flood is rate limited — flood_guard
```

## Two decisions worth knowing about

**1. SMS is not wired up, and the app says so.**
There is no TRAI DLT-registered gateway in this environment. The server returns the OTP in the
response (`channel: "development-echo"`) and the UI labels it *"Development mode — no TRAI DLT SMS
gateway is configured"*. It never pretends an SMS was delivered. Flip `DEV_SMS=false` with a real
gateway to close this.

**2. Server-side compression and E2EE are in direct conflict — so they were split.**
The blueprint promises sharp/FFmpeg transcoding *and* E2EE media. A server cannot transcode what it
cannot decrypt. This slice resolves it the way production messengers do:

- **Avatars** are public to the directory, so they are compressed server-side with real
  sharp/libvips (PNG 203 KB → WebP 5 KB in the test).
- **Chat photos** are downscaled on-device, encrypted, and uploaded as opaque ciphertext. The server
  is a blind, content-addressed blob store and a byte-range server — nothing more.

That trade-off, and what it costs (no server-side malware scanning of chat media), is written up in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#media-compression-vs-e2ee).

## Honest limitations

- **No forward secrecy.** Static–static ECDH per tab, not a Signal/PQXDH ratchet.
- **Keys live in `sessionStorage`.** Closing the tab destroys the private key; older ciphertext then
  renders as `🔒 ciphertext — no matching key on this device`. No hardware keystore, no key backup.
- **One tab per account.** Signing in again from another tab republishes the key and orphans the
  previous one.
- **Single process, JSON files.** Not ScyllaDB/Kafka; `data/` is one atomic-write JSON store.
- **No video, no groups, no calls.** No `ffmpeg` in this environment, and none of those subsystems
  are implemented.

## Layout

```
server/          Express + ws + sharp. index.js boots the API and mounts Vite in dev
  auth.js        OTP issue/verify, profile, public-key publication
  chat.js        directory, message ingest, WS hub, presence
  media.js       opaque blob upload, HTTP 206 serving, sharp avatar pipeline
  guard.js       HMAC sessions, token buckets, fan-out cap
  store.js       atomic-write JSON store
src/
  crypto/e2ee.js ECDH/HKDF/AES-GCM, safety numbers, on-device image compression
  identity.js    per-tab device key lifecycle
  components/    Onboarding, Shell, ChatList, ChatWindow, Settings, placeholder views
scripts/         smoke.js (E2E assertions), render-check.js (screen mount check)
docs/            ARCHITECTURE.md — SAB v4.1 reconciled against this code
```
