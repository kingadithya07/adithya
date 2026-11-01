import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const PORT = Number(process.env.PORT || 3001);
export const HOST = process.env.HOST || '0.0.0.0';
export const IS_PROD = process.env.NODE_ENV === 'production';

export const DATA_DIR = path.resolve(process.env.DATA_DIR || 'data');
export const BLOB_DIR = path.join(DATA_DIR, 'blobs');
export const SECRET_FILE = path.join(DATA_DIR, 'secret.key');

/**
 * There is no DLT-registered SMS gateway wired into this sandbox, so the OTP is
 * echoed back to the client instead of being delivered by SMS. This flag is
 * what makes that explicit: it flips off in production, and the UI labels the
 * code it receives as a development shortcut, never as a delivered SMS.
 */
export const DEV_SMS = process.env.DEV_SMS === 'true' ? true : !IS_PROD;

export const OTP_TTL_MS = 5 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export const MAX_MEDIA_BYTES = 12 * 1024 * 1024; // 12 MB ciphertext cap
export const MAX_JSON_BYTES = 512 * 1024;

// Spam Kavach (edge layer), matching the blueprint's published thresholds.
export const MSG_BUCKET = { capacity: 25, windowMs: 10_000 };
export const FANOUT_WINDOW_MS = 60_000;
export const FANOUT_MAX_NEW_PEERS = 10;

fs.mkdirSync(BLOB_DIR, { recursive: true });

function loadSecret() {
  try {
    return Buffer.from(fs.readFileSync(SECRET_FILE, 'utf8').trim(), 'hex');
  } catch {
    const secret = crypto.randomBytes(32);
    fs.writeFileSync(SECRET_FILE, secret.toString('hex'), { mode: 0o600 });
    return secret;
  }
}

export const SERVER_SECRET = loadSecret();
