/**
 * End-to-end smoke test for the BharatChat vertical slice.
 *
 * It drives the real HTTP surface and the real crypto module (not mocks):
 * onboarding → key publish → encrypted message → decrypt → encrypted media →
 * HTTP 206 range → server-side avatar compression → spam flood guard.
 *
 * Run with the dev server already listening:  npm run smoke
 */
import {
  generateKeyPair,
  exportPublicJwk,
  importPublicJwk,
  encryptText,
  decryptText,
  encryptMediaBytes,
  decryptMediaBytes,
  randomSaltB64,
  newId,
} from '../src/crypto/e2ee.js';

const BASE = process.env.BASE || 'http://127.0.0.1:3001';

let passed = 0;
let failed = 0;

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function call(path, { method = 'GET', body, token, raw, headers = {} } = {}) {
  const opts = { method, headers: { ...headers } };
  if (token) opts.headers.Authorization = `Bearer ${token}`;
  if (raw !== undefined) opts.body = raw;
  else if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${path}`, opts);
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 160) };
  }
  return { status: res.status, json, headers: res.headers, text };
}

async function onboard(phone, name) {
  const otp = await call('/api/auth/send-otp', { method: 'POST', body: { phone } });
  if (otp.status !== 200) throw new Error(`send-otp ${otp.status} ${JSON.stringify(otp.json)}`);
  const code = otp.json.devCode;
  const verify = await call('/api/auth/verify-otp', { method: 'POST', body: { phone, code } });
  if (verify.status !== 200) throw new Error(`verify-otp ${verify.status} ${JSON.stringify(verify.json)}`);
  const token = verify.json.token;
  await call('/api/auth/profile', { method: 'POST', token, body: { name, about: 'smoke test' } });
  const pair = await generateKeyPair();
  const jwk = await exportPublicJwk(pair);
  const pub = await call('/api/keys', { method: 'POST', token, body: { publicKey: jwk } });
  if (pub.status !== 200) throw new Error(`keys ${pub.status}`);
  return { token, userId: verify.json.userId, pair, jwk, name, phone };
}

console.log(`\nBharatChat smoke test → ${BASE}\n`);

// ---------------------------------------------------------------- onboarding --
console.log('Onboarding & +91 auth');
const phoneA = String(9000000000 + Math.floor(Math.random() * 89999999));
const phoneB = String(9000000000 + Math.floor(Math.random() * 89999999));

const bad = await call('/api/auth/send-otp', { method: 'POST', body: { phone: '12345' } });
check('rejects non-Indian mobile', bad.status === 400, `status ${bad.status}`);

const alice = await onboard(phoneA, 'Alice Smoke');
const bob = await onboard(phoneB, 'Bob Smoke');
check('two accounts onboarded via OTP', Boolean(alice.token && bob.token), `${alice.userId.slice(0, 8)}… / ${bob.userId.slice(0, 8)}…`);

const wrong = await call('/api/auth/verify-otp', { method: 'POST', body: { phone: phoneA, code: '000000' } });
check('rejects wrong OTP', [400, 401, 429].includes(wrong.status), `status ${wrong.status}`);

const unauthed = await call('/api/users');
check('directory requires a session', unauthed.status === 401);

// ------------------------------------------------------------------ directory --
console.log('\nDirectory & key publication');
const dir = await call('/api/users', { token: alice.token });
const bobEntry = dir.json.users.find((u) => u.id === bob.userId);
check('peer appears in directory', Boolean(bobEntry), bobEntry?.name);
check('peer public key is published', Boolean(bobEntry?.publicKey?.x));
check('phone is masked, never exposed', /^\+91 •••••\d{5}$/.test(bobEntry.phoneMasked), bobEntry.phoneMasked);

// ---------------------------------------------------------------------- E2EE --
console.log('\nEnd-to-end encrypted messaging');
const msgId = newId();
const plaintext = 'नमस्ते बॉब — this should never appear on the wire in cleartext 🔒';
const envelope = await encryptText({
  plaintext,
  myPrivateKey: alice.pair.privateKey,
  theirPublicKey: await importPublicJwk(bobEntry.publicKey),
  from: alice.userId,
  to: bob.userId,
  msgId,
});

const sent = await call('/api/messages', {
  method: 'POST',
  token: alice.token,
  body: { to: bob.userId, msgId, ct: envelope.ct, iv: envelope.iv, salt: envelope.salt, senderPub: alice.jwk, kind: 'text' },
});
check('server accepts ciphertext envelope', sent.status === 201, `status ${sent.status}`);
check(
  'stored payload does not contain plaintext',
  !JSON.stringify(sent.json).includes('नमस्ते') && !JSON.stringify(sent.json).includes('cleartext'),
  `${envelope.ct.length} b64 chars of ciphertext`
);
check('server records the algorithm, not the content', sent.json?.message?.alg === 'ECDH-P256+HKDF-SHA256+AES-256-GCM');

const inbox = await call(`/api/messages/${alice.userId}`, { token: bob.token });
const received = inbox.json.messages.find((m) => m.id === msgId);
check('recipient can fetch the envelope', Boolean(received));

const decrypted = await decryptText({
  envelope: received,
  myPrivateKey: bob.pair.privateKey,
  theirPublicKey: await importPublicJwk(received.senderPub),
  from: received.from,
  to: received.to,
});
check('recipient decrypts to the original plaintext', decrypted === plaintext);

// A third party with a different key must not be able to read it.
const eve = await generateKeyPair();
let eveFailed = false;
try {
  await decryptText({
    envelope: received,
    myPrivateKey: eve.privateKey,
    theirPublicKey: await importPublicJwk(received.senderPub),
    from: received.from,
    to: received.to,
  });
} catch {
  eveFailed = true;
}
check('a third party key fails to decrypt (AES-GCM auth)', eveFailed);

// Tampering with the ciphertext must be detected.
const tampered = { ...received, ct: Buffer.from(received.ct, 'base64').fill(0, 0, 4).toString('base64') };
let tamperCaught = false;
try {
  await decryptText({
    envelope: tampered,
    myPrivateKey: bob.pair.privateKey,
    theirPublicKey: await importPublicJwk(received.senderPub),
    from: received.from,
    to: received.to,
  });
} catch {
  tamperCaught = true;
}
check('tampered ciphertext is rejected', tamperCaught);

// --------------------------------------------------------------- media (E2EE) --
console.log('\nEncrypted media + HTTP 206');
const imageBytes = new Uint8Array(200_000).map((_, i) => (i * 37) % 256);
const mediaSalt = randomSaltB64();
const media = await encryptMediaBytes({
  bytes: imageBytes,
  myPrivateKey: alice.pair.privateKey,
  theirPublicKey: await importPublicJwk(bobEntry.publicKey),
  saltB64: mediaSalt,
});
check('media ciphertext differs from plaintext bytes', media.ciphertext[0] !== imageBytes[0] || media.ciphertext[7] !== imageBytes[7]);

const uploaded = await call('/api/media/upload', {
  method: 'POST',
  token: alice.token,
  raw: media.ciphertext,
  headers: { 'Content-Type': 'application/octet-stream', 'x-media-kind': 'image' },
});
check('ciphertext blob uploaded', uploaded.status === 200, `${uploaded.json?.size} bytes, id ${uploaded.json?.id}`);

const mediaMsg = await call('/api/messages', {
  method: 'POST',
  token: alice.token,
  body: {
    to: bob.userId,
    msgId: newId(),
    kind: 'image',
    mediaId: uploaded.json.id,
    mediaSalt,
    iv: media.iv,
    mime: 'image/webp',
    senderPub: alice.jwk,
  },
});
check('media message accepted', mediaMsg.status === 201);

const anonFetch = await fetch(`${BASE}/api/media/${uploaded.json.id}`);
check('private media rejects anonymous fetch', anonFetch.status === 401, `status ${anonFetch.status}`);

const rangeRes = await fetch(`${BASE}/api/media/${uploaded.json.id}?t=${encodeURIComponent(bob.token)}`, {
  headers: { Range: 'bytes=0-1023' },
});
const rangeBuf = new Uint8Array(await rangeRes.arrayBuffer());
check('authenticated range request returns 206', rangeRes.status === 206, rangeRes.headers.get('content-range'));
check('range response is exactly 1024 bytes', rangeBuf.length === 1024, `${rangeBuf.length} bytes`);

const fullRes = await fetch(`${BASE}/api/media/${uploaded.json.id}?t=${encodeURIComponent(bob.token)}`);
const fullCt = new Uint8Array(await fullRes.arrayBuffer());
const decryptedMedia = await decryptMediaBytes({
  ciphertext: fullCt,
  ivB64: media.iv,
  myPrivateKey: bob.pair.privateKey,
  theirPublicKey: await importPublicJwk(mediaMsg.json.message.senderPub),
  saltB64: mediaSalt,
});
check('media decrypts byte-for-byte', decryptedMedia.length === imageBytes.length && decryptedMedia.every((b, i) => b === imageBytes[i]), `${decryptedMedia.length} bytes`);

// ------------------------------------------------------ server-side avatars --
console.log('\nServer-side compression (sharp / libvips)');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1600">
  <defs><linearGradient id="g"><stop offset="0" stop-color="#ff9933"/><stop offset="1" stop-color="#00a884"/></linearGradient></defs>
  <rect width="1600" height="1600" fill="url(#g)"/><circle cx="800" cy="700" r="360" fill="#0b141a"/>
  <text x="800" y="760" font-size="220" fill="#fff" text-anchor="middle" font-family="sans-serif">भा</text></svg>`;
const png = await (async () => {
  const { default: sharp } = await import('sharp');
  return sharp(Buffer.from(svg)).png().toBuffer();
})();
const avatarRes = await call('/api/profile/avatar', {
  method: 'POST',
  token: alice.token,
  body: { dataUrl: `data:image/png;base64,${png.toString('base64')}` },
});
check('avatar transcoded to WebP', avatarRes.status === 200 && avatarRes.json.avatar.bytes > 0, `${avatarRes.json?.compression?.sourceBytes} B PNG → ${avatarRes.json?.compression?.outputBytes} B WebP`);
check('24px micro-blur preview generated', avatarRes.json?.avatar?.preview?.startsWith('data:image/webp;base64,'), `${avatarRes.json?.compression?.previewBytes} B inline`);
check('preview is dramatically smaller than the source', avatarRes.json?.compression?.previewBytes < avatarRes.json?.compression?.sourceBytes / 20);

const avatarFetch = await fetch(`${BASE}${avatarRes.json.avatar ? `/api/media/${avatarRes.json.avatar.id}` : '/api/none'}`);
check('public avatar is fetchable without a token', avatarFetch.status === 200, `status ${avatarFetch.status}`);
check('avatar is served as image/webp', avatarFetch.headers.get('content-type') === 'image/webp', avatarFetch.headers.get('content-type'));

// --------------------------------------------------------------- spam guard --
console.log('\nSpam Kavach — edge flood guard');
let limited = null;
for (let i = 0; i < 30; i += 1) {
  const env = await encryptText({
    plaintext: `burst ${i}`,
    myPrivateKey: alice.pair.privateKey,
    theirPublicKey: await importPublicJwk(bobEntry.publicKey),
    from: alice.userId,
    to: bob.userId,
    msgId: newId(),
  });
  const r = await call('/api/messages', {
    method: 'POST',
    token: alice.token,
    body: { to: bob.userId, msgId: env.msgId, ct: env.ct, iv: env.iv, salt: env.salt, senderPub: alice.jwk, kind: 'text' },
  });
  if (r.status === 429) {
    limited = r;
    break;
  }
}
check('message flood is rate limited', limited?.status === 429, limited?.json?.error);

// ------------------------------------------------------------------- status --
const status = await call('/api/status', { token: alice.token });
check('status endpoint reports live counters', status.status === 200, `${status.json.messages} messages, ${status.json.media.blobs} blobs`);

console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
