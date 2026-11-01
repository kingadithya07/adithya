import express from 'express';
import crypto from 'node:crypto';
import { requireAuth, messageBucket, checkFanout } from './guard.js';
import { db } from './store.js';
import { mediaStats } from './media.js';

export const chatRouter = express.Router();

/** Sockets registry, owned by the WS hub in index.js. */
export const hub = {
  sockets: new Map(), // userId -> Set<ws>
  attach(userId, ws) {
    let set = this.sockets.get(userId);
    if (!set) {
      set = new Set();
      this.sockets.set(userId, set);
    }
    set.add(ws);
    this.broadcastPresence();
  },
  detach(userId, ws) {
    const set = this.sockets.get(userId);
    if (!set) return;
    set.delete(ws);
    if (set.size === 0) this.sockets.delete(userId);
    this.broadcastPresence();
  },
  isOnline(userId) {
    return this.sockets.has(userId);
  },
  send(userId, payload) {
    const set = this.sockets.get(userId);
    if (!set) return 0;
    const raw = JSON.stringify(payload);
    let delivered = 0;
    for (const ws of set) {
      if (ws.readyState === 1) {
        ws.send(raw);
        delivered += 1;
      }
    }
    return delivered;
  },
  broadcastPresence() {
    const online = [...this.sockets.keys()];
    for (const [, set] of this.sockets) {
      for (const ws of set) {
        if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'presence', online }));
      }
    }
  },
  onlineList() {
    return [...this.sockets.keys()];
  },
};

// --------------------------------------------------------------- directory --
chatRouter.get('/api/users', requireAuth, (req, res) => {
  const users = db.users
    .filter((u) => u.id !== req.userId && u.name)
    .map((u) => db.publicUser(u))
    .sort((a, b) => a.name.localeCompare(b.name));
  res.json({ users, online: hub.onlineList() });
});

// ---------------------------------------------------------------- messages --
chatRouter.get('/api/messages/:peerId', requireAuth, (req, res) => {
  const peerId = req.params.peerId;
  const messages = db.messages
    .filter(
      (m) =>
        (m.from === req.userId && m.to === peerId) || (m.from === peerId && m.to === req.userId)
    )
    .slice(-400);
  res.json({ messages });
});

const ALLOWED_KINDS = new Set(['text', 'image']);

chatRouter.post('/api/messages', requireAuth, express.json({ limit: '256kb' }), (req, res) => {
  const bucket = messageBucket.take(req.userId);
  if (!bucket.ok) {
    return res.status(429).json({ error: 'flood_guard', retryAfterMs: bucket.retryAfterMs });
  }
  const { to, msgId, ct, iv, salt, senderPub, kind = 'text', mediaId, mediaSalt, mime, width, height } = req.body || {};

  if (typeof to !== 'string' || typeof msgId !== 'string') return res.status(400).json({ error: 'bad_envelope' });
  if (to === req.userId) return res.status(400).json({ error: 'self_send' });
  if (!db.findUserById(to)) return res.status(404).json({ error: 'unknown_recipient' });
  if (!ALLOWED_KINDS.has(kind)) return res.status(400).json({ error: 'bad_kind' });

  // For images the ciphertext field may be an empty caption; the payload lives
  // in the media blob. Text messages must carry a real AES-GCM envelope.
  if (kind === 'text') {
    if (!ct || !iv || !salt || !senderPub) return res.status(400).json({ error: 'missing_ciphertext' });
  } else if (!mediaId || !mediaSalt) {
    return res.status(400).json({ error: 'missing_media' });
  }

  const fanout = checkFanout(req.userId, to);
  if (!fanout.ok) return res.status(429).json({ error: 'fanout_cap' });
  if (mediaId && !db.blobs[mediaId]) return res.status(400).json({ error: 'unknown_media' });

  const message = {
    id: msgId,
    from: req.userId,
    to,
    kind,
    ct: ct || '',
    iv: iv || null,
    salt: salt || null,
    senderPub: senderPub || null,
    mediaId: mediaId || null,
    mediaSalt: mediaSalt || null,
    mime: mime || null,
    width: width || null,
    height: height || null,
    alg: kind === 'text' ? 'ECDH-P256+HKDF-SHA256+AES-256-GCM' : 'ECDH-P256+HKDF-SHA256+AES-256-GCM(media)',
    createdAt: Date.now(),
  };

  db.messages.push(message);
  db.persistMessages();

  hub.send(to, { type: 'message', message });
  hub.send(req.userId, { type: 'message', message });

  res.status(201).json({ message });
});

// ------------------------------------------------------------------- status --
chatRouter.get('/api/status', requireAuth, (req, res) => {
  res.json({
    users: db.users.length,
    messages: db.messages.length,
    online: hub.onlineList().length,
    media: mediaStats(),
    runtime: {
      node: process.version,
      uptimeSec: Math.round(process.uptime()),
      rssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    },
  });
});

export function newMessageId() {
  return crypto.randomUUID();
}
