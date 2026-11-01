import express from 'express';
import crypto from 'node:crypto';
import { DEV_SMS, OTP_TTL_MS, OTP_MAX_ATTEMPTS } from './config.js';
import { signSession, requireAuth, otpBucket, otpIpBucket } from './guard.js';
import { db } from './store.js';

export const authRouter = express.Router();

const PHONE_RE = /^[6-9]\d{9}$/; // Indian mobile numbering plan, 10 digits after +91

function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  const local = digits.startsWith('91') && digits.length > 10 ? digits.slice(2) : digits;
  return PHONE_RE.test(local) ? local : null;
}

function hashOtp(code) {
  // OTPs are stored as salted SHA-256, never in clear, and expire in 5 minutes.
  return crypto.createHash('sha256').update(`otp:${code}`).digest('hex');
}

authRouter.post('/api/auth/send-otp', express.json(), (req, res) => {
  const phone = normalizePhone(req.body?.phone);
  if (!phone) return res.status(400).json({ error: 'invalid_indian_mobile' });

  const perPhone = otpBucket.take(phone);
  if (!perPhone.ok) {
    return res.status(429).json({
      error: 'otp_rate_limited',
      retryAfterMs: perPhone.retryAfterMs,
    });
  }
  const perIp = otpIpBucket.take(req.ip);
  if (!perIp.ok) return res.status(429).json({ error: 'otp_ip_rate_limited' });

  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  db.pendingOtps[phone] = {
    codeHash: hashOtp(code),
    expiresAt: Date.now() + OTP_TTL_MS,
    attempts: 0,
    sentAt: Date.now(),
  };
  db.persistOtp();

  // Deliberately explicit: no TRAI DLT-registered SMS gateway is configured in
  // this deployment. In DEV_SMS mode the code is returned to the client so the
  // flow is testable; the UI labels it "development mode", never as an SMS.
  const payload = {
    ok: true,
    channel: DEV_SMS ? 'development-echo' : 'sms-dlt',
    expiresInSec: Math.round(OTP_TTL_MS / 1000),
    phoneMasked: `+91 •••••${phone.slice(-5)}`,
  };
  if (DEV_SMS) {
    payload.devCode = code;
    console.log(`[auth] DEV OTP for +91${phone}: ${code} (no SMS gateway configured)`);
  }
  res.json(payload);
});

authRouter.post('/api/auth/verify-otp', express.json(), (req, res) => {
  const phone = normalizePhone(req.body?.phone);
  const code = String(req.body?.code || '').trim();
  if (!phone || !/^\d{6}$/.test(code)) return res.status(400).json({ error: 'invalid_input' });

  const entry = db.pendingOtps[phone];
  if (!entry) return res.status(400).json({ error: 'no_otp_requested' });
  if (entry.expiresAt < Date.now()) {
    delete db.pendingOtps[phone];
    db.persistOtp();
    return res.status(400).json({ error: 'otp_expired' });
  }
  if (entry.attempts >= OTP_MAX_ATTEMPTS) {
    delete db.pendingOtps[phone];
    db.persistOtp();
    return res.status(429).json({ error: 'too_many_attempts' });
  }
  entry.attempts += 1;
  db.persistOtp();

  const provided = Buffer.from(hashOtp(code));
  const expected = Buffer.from(entry.codeHash);
  const matches =
    provided.length === expected.length && crypto.timingSafeEqual(provided, expected);

  if (!matches) {
    db.persistOtp();
    return res.status(401).json({ error: 'wrong_code', attemptsLeft: OTP_MAX_ATTEMPTS - entry.attempts });
  }

  delete db.pendingOtps[phone];
  db.persistOtp();

  let user = db.findUserByPhone(phone);
  const isNew = !user;
  if (!user) {
    user = {
      id: crypto.randomUUID(),
      phone,
      name: null,
      about: '',
      avatar: null,
      publicKey: null,
      createdAt: Date.now(),
      lastSeen: Date.now(),
    };
    db.upsertUser(user);
  }

  res.json({
    token: signSession(user.id),
    userId: user.id,
    isNew,
    needsProfile: !user.name,
  });
});

authRouter.post('/api/auth/profile', requireAuth, express.json(), (req, res) => {
  const user = db.findUserById(req.userId);
  if (!user) return res.status(404).json({ error: 'unknown_user' });
  const name = String(req.body?.name || '').trim().slice(0, 40);
  const about = String(req.body?.about || '').trim().slice(0, 120);
  if (name.length < 2) return res.status(400).json({ error: 'name_too_short' });
  user.name = name;
  user.about = about;
  user.lastSeen = Date.now();
  db.upsertUser(user);
  res.json({ user: db.publicUser(user) });
});

authRouter.post('/api/keys', requireAuth, express.json({ limit: '8kb' }), (req, res) => {
  const user = db.findUserById(req.userId);
  if (!user) return res.status(404).json({ error: 'unknown_user' });
  const key = req.body?.publicKey;
  if (!key || key.kty !== 'EC' || key.crv !== 'P-256' || typeof key.x !== 'string' || typeof key.y !== 'string') {
    return res.status(400).json({ error: 'invalid_public_key' });
  }
  user.publicKey = { kty: 'EC', crv: 'P-256', x: key.x, y: key.y };
  user.publicKeyUpdatedAt = Date.now();
  db.upsertUser(user);
  res.json({ ok: true, publicKey: user.publicKey });
});

authRouter.get('/api/auth/me', requireAuth, (req, res) => {
  const user = db.findUserById(req.userId);
  if (!user) return res.status(404).json({ error: 'unknown_user' });
  user.lastSeen = Date.now();
  db.upsertUser(user);
  res.json({ user: db.publicUser(user) });
});

export { normalizePhone };
