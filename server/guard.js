import crypto from 'node:crypto';
import { SERVER_SECRET, SESSION_TTL_MS, MSG_BUCKET, FANOUT_WINDOW_MS, FANOUT_MAX_NEW_PEERS } from './config.js';

// ---------------------------------------------------------------- sessions --
// Compact HMAC-signed token: base64url(payload).base64url(sig). No JWT lib.
export function signSession(userId) {
  const payload = Buffer.from(
    JSON.stringify({ uid: userId, exp: Date.now() + SESSION_TTL_MS })
  ).toString('base64url');
  const sig = crypto.createHmac('sha256', SERVER_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifySession(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', SERVER_SECRET).update(payload).digest('base64url');
  const a = Buffer.from(sig || '');
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!parsed.uid || parsed.exp < Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function requireAuth(req, res, next) {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : req.query.t;
  const session = verifySession(token);
  if (!session) return res.status(401).json({ error: 'unauthorized' });
  req.userId = session.uid;
  req.token = token;
  next();
}

// -------------------------------------------------------------- rate limits --
// Sliding-window token bucket. Zero-knowledge: keyed on user id, never on
// message content, and it never inspects or stores the ciphertext payload.
export class TokenBucket {
  constructor(capacity, windowMs) {
    this.capacity = capacity;
    this.windowMs = windowMs;
    this.hits = new Map();
  }

  take(key) {
    const now = Date.now();
    const list = (this.hits.get(key) || []).filter((t) => now - t < this.windowMs);
    if (list.length >= this.capacity) {
      const retryAfterMs = this.windowMs - (now - list[0]);
      this.hits.set(key, list);
      return { ok: false, retryAfterMs };
    }
    list.push(now);
    this.hits.set(key, list);
    if (this.hits.size > 20000) {
      for (const [k, v] of this.hits) {
        if (!v.some((t) => now - t < this.windowMs)) this.hits.delete(k);
      }
    }
    return { ok: true, remaining: this.capacity - list.length };
  }
}

export const messageBucket = new TokenBucket(MSG_BUCKET.capacity, MSG_BUCKET.windowMs);
export const otpBucket = new TokenBucket(5, 60 * 60 * 1000); // 5 OTP requests / phone / hour
export const otpIpBucket = new TokenBucket(30, 60 * 60 * 1000);

const fanoutLog = new Map(); // userId -> Map(peerId -> firstContactTs)

/** Sybil / bulk fan-out guard: cap new conversation partners per window. */
export function checkFanout(userId, peerId) {
  const now = Date.now();
  let peers = fanoutLog.get(userId);
  if (!peers) {
    peers = new Map();
    fanoutLog.set(userId, peers);
  }
  for (const [id, ts] of peers) {
    if (now - ts > FANOUT_WINDOW_MS) peers.delete(id);
  }
  if (peers.has(peerId)) return { ok: true };
  if (peers.size >= FANOUT_MAX_NEW_PEERS) {
    return { ok: false, reason: 'fanout_cap' };
  }
  peers.set(peerId, now);
  return { ok: true };
}

export function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}
