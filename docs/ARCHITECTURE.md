# BharatChat — SAB v4.1, reconciled against the code

**Status:** this document supersedes the pasted SAB v4.1 blueprint as the repository's source of
truth. Where the two disagree, this document describes the code that actually runs.

**How it was produced:** every subsystem in the SAB inventory was checked against the working tree
and, where implemented, against a live server (`npm run smoke` — 28 assertions). Nothing below is
marked *Built* on the strength of a design document alone.

**Provenance note.** SAB v4.1 states it was "updated to reflect … every live subsystem in
`/home/user/bharatchat`". That path does not exist, and the repository this document lives in began
as a stock AI-Studio README with a single commit and no application code. The SAB is therefore
treated as a *specification*, not as a description of shipped software. Its inventory table has been
re-graded from scratch.

---

## 0. Status legend

| Mark | Meaning |
|---|---|
| **Built** | Implemented and exercised by an automated test in this repo. |
| **Partial** | Some of the claim is real; the rest is absent, and the gap is named. |
| **Not built** | No implementation. The UI (where one exists) says so on the screen. |
| **Design only** | Production-tier architecture. Described here for planning; not present in code. |

---

## 1. SAB v4.1 inventory — re-graded

### 1.1 Customer onboarding & consumer UI

| SAB v4.1 claim | Grade | Reality in this repo |
|---|---|---|
| 23-language customer welcome screen | **Partial** | All 22 scheduled languages + English are listed with endonyms (`src/i18n.js`). **Six** have complete string packs: English, Hindi, Telugu, Tamil, Bengali, Marathi. Selecting any other language falls back to English and the UI states that it is untranslated. |
| +91 10-digit mobile sign-up/login | **Built** | `POST /api/auth/send-otp` validates the Indian numbering plan (10 digits, first digit 6–9), accepts a `+91` prefix or bare number. |
| 6-digit SMS OTP | **Partial** | Code generation, salted SHA-256 storage, 5-minute TTL, 5-attempt cap, 5-per-phone-per-hour and 30-per-IP-per-hour limits are all real. **Delivery is not:** no DLT gateway exists in this environment, so the code is echoed in the API response and labelled *development mode* in the UI. |
| WebOTP-style 1-tap auto-fill | **Partial** | The client auto-populates and auto-submits when it receives a code, and the field carries `autocomplete="one-time-code"` so a real WebOTP SMS would fill it. The genuine WebOTP path (DLT-formatted SMS with app hash) is untested here because no SMS is sent. |
| Profile & photo setup | **Built** | `POST /api/auth/profile`, and `POST /api/profile/avatar` transcodes via sharp/libvips to 512 px WebP + a 24 px micro-blur inline preview (measured: 203,648 B PNG → 4,986 B WebP, 134 B preview). |
| Personal Contact QR | **Not built** | No QR generation or scanning. |
| 5-tab inbox (Chats, Status, Channels, Calls, Settings) | **Built** (Chats only) | Shell, tab bar and routing exist and work. Chats is fully functional; Status, Channels and Calls render an explicit *"Not built in this slice"* panel listing what each would contain. |
| Floating + New Chat FAB | **Built** | Opens a searchable people sheet. |
| Emoji tray | **Not built** | — |
| "UPI removed" | **N/A** | Correct as a scope statement: there is no payment code anywhere in this repository. It is a true negative, not an achievement. |

### 1.2 Simplified UX & PWA shell

| SAB v4.1 claim | Grade | Reality |
|---|---|---|
| Clean 5-tab layout | **Built** | `src/components/Shell.jsx`. |
| Network-first service worker `bharatchat-pwa-v3` | **Not built** | No `sw.js`, no `manifest.webmanifest`, no offline outbox. The app is installable-looking but is not a PWA. |
| Android `share_target` & shortcuts | **Not built** | — |

### 1.3 End-to-end encryption

| SAB v4.1 claim | Grade | Reality |
|---|---|---|
| Browser Web Crypto ECDH P-256 + AES-256-GCM, 96-bit IVs | **Built** | `src/crypto/e2ee.js`. ECDH → HKDF-SHA256 → AES-256-GCM, random 12-byte IV per message, AAD binds `v1\|from\|to\|msgId` so an envelope cannot be replayed against a different pair or id. |
| 60-digit Safety Numbers | **Built** | SHA-256 over the lexicographically sorted public-key pair, rendered as 12 groups of 5 digits, surfaced per-contact in Settings. |
| 10×10 QR verification grid | **Not built** | Safety numbers only. |
| PBKDF2 group sender keys | **Not built** | No groups exist, so there are no group keys. |
| libsignal / PQXDH / MLS ratchet | **Not built** | Static–static ECDH. **No forward secrecy, no post-compromise security.** This is the single largest gap between the slice and the blueprint. |
| Zero-knowledge ciphertext wire inspector (`GET /api/wire-log`) | **Partial** | The equivalent exists as `GET /api/status` counters plus the raw `data/messages.json` store; there is no dedicated wire-log UI. DevTools → Network shows the same thing. |

### 1.4 Media compression & streaming

| SAB v4.1 claim | Grade | Reality |
|---|---|---|
| Server-side sharp (libvips) → WebP | **Built for avatars only** | libvips 8.18.7, real transcodes, measured compression. **Chat media is never decrypted server-side**, so it is compressed on-device instead — see §4. |
| 24 px micro-blur inline previews | **Built** (avatars) | 24×24, blur 1.2, WebP q45 ≈ 134 B, inlined as a data URL. |
| `?lite=1` 2G edge downscaling | **Not built** | The client downscales to 1280 px before encryption; there is no edge variant endpoint. |
| FFmpeg H.264 MP4 `+faststart`, WebP poster extraction | **Not built** | No `ffmpeg` binary in this environment and no video path at all. |
| SHA-256 deduplication | **Partial** | Blobs are content-addressed by SHA-256, but chat media arrives with a random IV per message, so ciphertext hashes never repeat. It is an index, not a bandwidth saving. The code comment says so. |
| HTTP 206 byte-range streaming | **Built** | `GET /api/media/:id` supports `Range`, returns 206 with `Content-Range`, 416 on unsatisfiable ranges, and enforces authorisation before any bytes are served. |

### 1.5 Telegram-style bots

**Not built.** No `@BharatFather`, no slash-command palette, no inline keyboards, no `/bot<TOKEN>/*`
HTTP Bot API. There is no `server/botEngine.js` in this repository.

### 1.6 Spam Kavach

| SAB v4.1 claim | Grade | Reality |
|---|---|---|
| Edge token-bucket flood guard 25 msg / 10 s | **Built** | `server/guard.js`, enforced at ingest, returns 429 with `Retry-After`-style metadata. Verified by test. |
| Bulk fan-out cap (10 distinct recipients / min) | **Built** | Verified in code; not separately asserted in the smoke run. |
| Blocklist drops | **Not built** | No blocklist store or endpoint. |
| Cryptographic message franking (SHA-256 HMAC reports) | **Not built** | No franking commitment tags. |
| On-device `.apk`/`.exe` malware blocker, KYC/lottery scam classifier, unknown-sender quarantine, 5-hop forward warning | **Not built** | No `src/utils/spamDetector.js`. |
| Play Integrity attestation | **Not built** | — |

### 1.7 Zero-knowledge backups

**Not built.** No PBKDF2/Argon2id backup bundle, no cloud vault, no `.bharatbackup` export.

### 1.8 Android hardware

**Not built.** No `capacitor.config.json`, no `android-native/AndroidManifest.xml`, no CameraX /
ConnectionService / StrongBox bridge, no WebAuthn passkeys, no contact picker, no NFC/Bluetooth.
The only platform integration present is a permissive `Permissions-Policy` header so that camera and
microphone are not pre-blocked if such features are added.

### 1.9 ONDC Kirana & 4-tier verification

**Not built.** No Beckn v1.2 buyer node, no Smart Parcha cart, no Pay-on-Delivery settlement, no
W3C Verifiable Credentials, no DigiLocker/GSTN/FSSAI integration.

### 1.10 Indic languages & input

| SAB v4.1 claim | Grade | Reality |
|---|---|---|
| 23 languages | **Partial** | Listed; 6 translated (see §1.1). |
| Phonetic Indic input | **Not built** | Users type in their own keyboard; no transliteration layer. |
| Bhashini / IndicTrans2 | **Not built** | — |

**Score across the SAB inventory: 6 subsystems Built, 5 Partial, the remainder Not built.** The rest
of this document describes the slice in detail, then the production design the SAB was aiming at.

---

## 2. What is actually running

```
┌────────────────────────────────────────────────────────────────────┐
│  Browser tab  (= one device, one identity)                         │
│                                                                    │
│  Onboarding ── language → +91 → OTP → profile                      │
│  Shell ── 5 tabs, FAB, chat list, conversation                     │
│                                                                    │
│  src/crypto/e2ee.js                                                │
│    ECDH P-256 keypair  ── private key stays in sessionStorage      │
│    encrypt(plaintext) → { ct, iv, salt }  ─────────────────┐       │
│    decrypt(envelope)  ← WebSocket / history                │       │
└────────────────────────────────────────────────────────────│───────┘
                                                             │
             HTTPS /api/*            WSS /ws (token-authed)  │
                                                             ▼
┌────────────────────────────────────────────────────────────────────┐
│  Node process (single)                                             │
│                                                                    │
│  auth.js   OTP hash+TTL, HMAC session token, key publication        │
│  chat.js   directory, ingest, WS hub, presence, typing              │
│  media.js  opaque blob store + HTTP 206 + sharp avatar pipeline     │
│  guard.js  token buckets, fan-out cap, timing-safe comparisons      │
│  store.js  atomic-write JSON (data/)                                │
│                                                                    │
│  Sees: ciphertext, sender/recipient ids, sizes, timings.           │
│  Never sees: plaintext, private keys, media bytes.                  │
└────────────────────────────────────────────────────────────────────┘
```

### 2.1 Onboarding path

1. `POST /api/auth/send-otp` → validates the number, applies two token buckets, generates
   `crypto.randomInt` 6-digit code, stores `sha256("otp:"+code)` with a 5-minute expiry and attempt
   counter. In development mode the code is returned to the client **and clearly labelled as a
   development echo**.
2. `POST /api/auth/verify-otp` → timing-safe hash comparison, attempt cap, single-use code deletion,
   then upserts the account and mints a 30-day HMAC-SHA256 session token
   (`base64url(payload).base64url(sig)` — no JWT library, constant-time signature comparison).
3. `POST /api/keys` → publishes **only** the ECDH public key (validated as `EC`/`P-256` with string
   `x`/`y`). The private key never leaves the tab.

### 2.2 Message path

1. Sender derives `AES-256-GCM` key from `ECDH(myPriv, theirPub)` through
   `HKDF-SHA256(salt=random 16 B, info="bharatchat/msg/v1")`.
2. Encrypts with a fresh 12-byte IV; AAD is `bharatchat|v1|from|to|msgId`.
3. `POST /api/messages` stores the envelope and pushes it over WebSocket to recipient and sender.
4. Recipient re-derives the same key using `senderPub` carried in the envelope and decrypts.

The server's entire stored record for a message is: ids, `ct`, `iv`, `salt`, `senderPub`, kind,
media id, mime, dimensions, timestamp, and an `alg` string. That is why
`test: stored payload does not contain plaintext` can be asserted mechanically.

### 2.3 Media path

```
pick file → createImageBitmap → canvas downscale 1280 px → WebP q0.72
         → AES-256-GCM encrypt (media key, salt in envelope, AAD "bharatchat|media|v1")
         → POST /api/media/upload  (opaque bytes, 12 MB cap)
         → POST /api/messages { kind: "image", mediaId, mediaSalt, iv }
Recipient: GET /api/media/:id?t=<token> → decrypt → Blob URL → <img>
```

Avatars take the other path: base64 data URL → `POST /api/profile/avatar` → sharp → public WebP.

---

## 3. Threat model

**Protected against**

| Threat | Mechanism |
|---|---|
| Passive network observer | TLS in transit + application-layer AES-256-GCM |
| Server/operator reading messages | Server stores ciphertext only; keys never leave the tab |
| Server or DB compromise | Same, plus public keys are non-sensitive |
| Ciphertext tampering | AES-GCM authentication tag; asserted by test |
| Envelope replay against another pair/id | AAD binds `from`, `to`, `msgId` |
| Third-party decryption attempt | ECDH with a foreign key fails GCM auth; asserted by test |
| OTP brute force | 6 digits, 5 attempts, 5 min TTL, per-phone and per-IP buckets |
| Message flooding / bulk fan-out | Token bucket 25/10 s, 10 new peers/minute |
| Session forgery | HMAC-SHA256, constant-time verify, expiry |
| Unauthorised media access | Blob owner + message-participant check before serving bytes |

**Explicitly not protected**

| Threat | Why | Consequence |
|---|---|---|
| Compromised device / XSS | Private key sits in `sessionStorage` | Full plaintext disclosure — this is the top production risk and the reason for a hardware keystore |
| Key substitution (MITM by server) | Public keys are served by the same server | Mitigated only by manually comparing Safety Numbers |
| Forward secrecy | No ratchet | One leaked static key decrypts everything ever sent to that key |
| Post-compromise security | No ratchet | No automatic healing after a compromise |
| Traffic analysis | Metadata is stored | Server learns who talks to whom, when, how much |
| Malicious attachments | Server is blind to chat media | No server-side malware scanning of E2EE photos |
| Abuse reporting without breaking E2EE | No franking | Genuine reports cannot be cryptographically attributed |
| Account takeover via SMS | OTP only | SIM-swap / SS7 is unresolved without passkeys |

---

## 4. Media compression vs E2EE

The SAB promises both *"server-side image (Sharp) compression"* and *"end-to-end encrypted
messaging"*. **These are mutually exclusive for the same bytes.** A server that transcodes an image
has decrypted it. Any architecture claiming both is either not encrypting media or not compressing
it server-side.

This slice resolves the conflict per asset class:

| Asset | Confidential? | Who compresses | Outcome |
|---|---|---|---|
| Profile avatar | No — shown to the whole directory | Server (sharp/libvips) | Real server-side pipeline, measured 40× reduction |
| Chat photo | Yes — E2EE | Client, before encryption | Server stores opaque ciphertext and serves byte ranges |

**Cost of this decision:** the server cannot scan chat media for malware, cannot generate
server-side thumbnails or `?lite=1` variants, and cannot re-encode for 2G. Those abilities are
genuinely lost, not deferred. The blueprint's *"on-device .APK malware classifier"* is the intended
compensation, and it is not implemented here.

---

## 5. Deliberate divergences from SAB v4.1

| SAB says | This repo does | Why |
|---|---|---|
| "every live subsystem in `/home/user/bharatchat`" | Treats SAB as spec; grades the code that exists | That directory does not exist; the repo was empty |
| Server-side compression of chat media | Client-side compression, server is a blind store | §4 — the two claims cannot both hold |
| `10,000,000+ MAU` on the described stack | Single Node process, JSON files | A prototype must not pretend to be a fleet; the JSON store is the honest ceiling |
| OTP "dispatched via TRAI DLT" | Echoed in dev mode and labelled as such | No gateway credentials exist here; faking a "sent" state would be a lie |
| 23-language onboarding | 23 listed, 6 translated, fallback stated in UI | Machine-translating 17 Indian languages without review produces confidently wrong UI |
| Video transcoding | Absent | No `ffmpeg` in the environment; an untested video path is worse than none |

---

## 6. Production target architecture — design only

Everything in this section is **not in the repository**. It is carried forward from SAB v4.1,
retained because it is a reasonable target, and annotated with what the slice would have to change.

```
                      ┌──────────────────────────────┐
PWA / Android APK ───▶│ Anycast Envoy / QUIC LB     │
  SQLCipher + libsignal│  TLS 1.3                   │
  on-device classifier └───────┬──────────────────────┘
                               │
        ┌──────────────────────┼───────────────────────────┐
        ▼                      ▼                           ▼
  Messaging edge        Media workers               Auth / DPI rail
  Elixir/Rust WS        sharp → WebP/AVIF           DLT OTP + passkeys
  spam guard            NVENC → H.264/AV1 MP4       SGX/Nitro PSI discovery
  Kafka / NATS JetStream│                           ONDC Beckn buyer node
        ▼                                                    ▼
  ┌───────────────────────────────────────────────────────────────┐
  │ Key directory + Merkle key-transparency tree                  │
  │ Message-franking verifier (HMAC commitments, E2EE preserved)   │
  │ Argon2id / passkey-PRF backup vault (Mumbai, Hyderabad)        │
  │ Channels & 24 h status (Redis CRDT counters, TTL expiry)       │
  │ Stateless zero-log GPU ASR/MT + on-device INT8 NNAPI           │
  └───────────────────────────────────────────────────────────────┘
```

**What the slice would need first, in dependency order:**

1. **A ratchet.** X3DH/PQXDH with libsignal — closes the largest security gap. Everything else is
   cosmetic next to this.
2. **Hardware-backed key storage** (Android Keystore/StrongBox, passkey-wrapped backup key) — closes
   the top operational risk.
3. **Key transparency** — makes server-side key substitution detectable, which Safety Numbers alone
   cannot scale to.
4. **Real SMS delivery** with DLT + WebOTP, then passkeys to cut per-login cost.
5. **Multi-device sessions** — the current one-tab-one-identity model is a prototype artefact.
6. Only then the breadth features: groups, calls, bots, backups, ONDC, verification.

### 6.1 Cost model (unvalidated, carried from SAB v4.1)

| Phase | Timeline | Scale | Monthly cost (as stated) |
|---|---|---|---|
| 1 — Launch MVP | Weeks 1–6 | 10,000 MAU | ₹22,000–39,000 (~$260–465) |
| 2 — Regional scale | Weeks 7–16 | 250,000 MAU | ₹2.9L–4.7L (~$3,450–5,550) |
| 3 — Bharat scale | Weeks 17–28+ | 10,000,000+ MAU | ₹46L–74L (~$54,000–88,000) |

These figures come from the blueprint and have **not** been validated against any provider's current
pricing; they are retained as planning targets, not as commitments. Note that Phase 1's range cannot
fund Phase 2's feature set on its own, and that SMS OTP at ₹0.15–0.25 per message is the dominant
variable cost at Phase 2 unless passkeys land first — which is the actual argument for passkeys, more
than the convenience.

---

## 7. Verification log

Environment: Node v22.22.3, sharp 0.34.x on libvips 8.18.7, Vite 8.3.5, single process.

| Check | Result |
|---|---|
| `npm run smoke` | **28/28 passed** |
| `npm run check:render` | **5/5 screens mount** |
| `npm run build` | 262 kB JS / 14 kB CSS (82 kB gzipped) |
| Avatar transcode | 203,648 B PNG → 4,986 B WebP, 134 B inline preview |
| Media round-trip | 200,000 B encrypted, stored, ranged, decrypted byte-for-byte |
| Range request | `bytes 0-1023/200016` → 206, exactly 1,024 bytes |
| Flood guard | triggers `flood_guard` at the 26th message in 10 s |
| Plaintext leakage | none found in stored message records |
