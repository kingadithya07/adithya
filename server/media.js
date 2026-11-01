import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { BLOB_DIR, MAX_MEDIA_BYTES } from './config.js';
import { requireAuth, sha256Hex, verifySession } from './guard.js';
import { db } from './store.js';

export const mediaRouter = express.Router();

function blobPath(id) {
  return path.join(BLOB_DIR, `${id}.bin`);
}

function storeBlob(buffer, meta) {
  const sha = sha256Hex(buffer);
  // Dedupe key is the SHA-256 of the payload. Chat media arrives already
  // encrypted with a fresh random IV per message, so in practice these hashes
  // are all unique — the map is honest about what it is: a content-addressed
  // index, not a bandwidth saving for E2EE attachments.
  const id = sha.slice(0, 32);
  fs.writeFileSync(blobPath(id), buffer);
  db.blobs[id] = {
    id,
    sha256: sha,
    size: buffer.length,
    ...meta,
  };
  db.persistMedia();
  return db.blobs[id];
}

// ------------------------------------------------------------------ uploads --
// Chat media is uploaded as opaque ciphertext. The server never sees, decodes,
// resizes or inspects it — that is the whole point of keeping media inside the
// E2EE boundary.
mediaRouter.post(
  '/api/media/upload',
  requireAuth,
  express.raw({ type: '*/*', limit: MAX_MEDIA_BYTES }),
  (req, res) => {
    const body = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      return res.status(400).json({ error: 'empty_body' });
    }
    const kind = req.get('x-media-kind') === 'image' ? 'image' : 'blob';
    const blob = storeBlob(body, {
      kind,
      visibility: 'private',
      ownerId: req.userId,
      createdAt: Date.now(),
      mime: req.get('x-media-mime') || 'application/octet-stream',
      cipher: 'aes-256-gcm',
    });
    res.json({ id: blob.id, size: blob.size, sha256: blob.sha256 });
  }
);

// ------------------------------------------------------- avatar (server-side) --
// Avatars are the one asset class that is *not* end-to-end encrypted: they are
// shown to every contact in the directory. Transcoding them server-side with
// sharp/libvips is therefore safe, and it is where real compression happens.
mediaRouter.post('/api/profile/avatar', requireAuth, express.json({ limit: '12mb' }), async (req, res) => {
  try {
    const dataUrl = String(req.body?.dataUrl || '');
    const match = /^data:image\/[a-z+]+;base64,(.+)$/i.exec(dataUrl);
    if (!match) return res.status(400).json({ error: 'invalid_image' });

    const input = Buffer.from(match[1], 'base64');
    if (input.length > 10 * 1024 * 1024) return res.status(413).json({ error: 'too_large' });

    const pipeline = sharp(input, { failOn: 'error' }).rotate();
    const meta = await pipeline.metadata();

    const full = await pipeline
      .clone()
      .resize(512, 512, { fit: 'cover', position: 'attention' })
      .webp({ quality: 80, effort: 4 })
      .toBuffer();

    // 24px micro-blur placeholder, inlined as a base64 data URL (~<=1 KB) so the
    // directory can paint an avatar before the full image lands.
    const previewBuf = await pipeline
      .clone()
      .resize(24, 24, { fit: 'cover' })
      .blur(1.2)
      .webp({ quality: 45 })
      .toBuffer();

    const user = db.findUserById(req.userId);
    if (!user) return res.status(404).json({ error: 'unknown_user' });

    const blob = storeBlob(full, {
      kind: 'avatar',
      visibility: 'public',
      ownerId: req.userId,
      createdAt: Date.now(),
      mime: 'image/webp',
    });

    user.avatar = {
      id: blob.id,
      preview: `data:image/webp;base64,${previewBuf.toString('base64')}`,
      updatedAt: Date.now(),
      bytes: full.length,
      sourceBytes: input.length,
      width: 512,
      height: 512,
      sourceWidth: meta.width,
      sourceHeight: meta.height,
    };
    db.upsertUser(user);

    res.json({
      avatar: user.avatar,
      compression: {
        sourceBytes: input.length,
        outputBytes: full.length,
        ratio: Number((full.length / input.length).toFixed(3)),
        previewBytes: previewBuf.length,
        engine: `sharp ${sharp.versions.sharp} / libvips ${sharp.versions.vips}`,
      },
    });
  } catch (err) {
    res.status(415).json({ error: 'transcode_failed', detail: String(err.message || err) });
  }
});

// ------------------------------------------------- HTTP 206 byte-range serving --
mediaRouter.get('/api/media/:id', (req, res) => {
  const blob = db.blobs[req.params.id];
  if (!blob) return res.status(404).json({ error: 'not_found' });

  // Public assets (avatars) need no token because <img> cannot send headers.
  // Private chat media requires the session token, passed as ?t= by the client.
  if (blob.visibility !== 'public') {
    const session = verifySession(req.query.t);
    if (!session) return res.status(401).json({ error: 'unauthorized' });
    const participant = session.uid === blob.ownerId || db.messages.some(
      (m) => m.mediaId === blob.id && (m.to === session.uid || m.from === session.uid)
    );
    if (!participant) return res.status(403).json({ error: 'forbidden' });
  }

  const file = blobPath(blob.id);
  if (!fs.existsSync(file)) return res.status(410).json({ error: 'gone' });
  const stat = fs.statSync(file);
  const total = stat.size;

  res.setHeader('Content-Type', blob.mime || 'application/octet-stream');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', blob.visibility === 'public' ? 'public, max-age=86400' : 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  const range = req.headers.range;
  if (!range) {
    res.setHeader('Content-Length', total);
    return fs.createReadStream(file).pipe(res);
  }

  const m = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!m) {
    res.setHeader('Content-Range', `bytes */${total}`);
    return res.status(416).end();
  }
  let start = m[1] === '' ? null : Number(m[1]);
  let end = m[2] === '' ? null : Number(m[2]);
  if (start === null && end === null) {
    res.setHeader('Content-Range', `bytes */${total}`);
    return res.status(416).end();
  }
  if (start === null) {
    start = Math.max(0, total - end);
    end = total - 1;
  } else if (end === null || end >= total) {
    end = total - 1;
  }
  if (start > end || start >= total) {
    res.setHeader('Content-Range', `bytes */${total}`);
    return res.status(416).end();
  }

  res.status(206);
  res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
  res.setHeader('Content-Length', end - start + 1);
  fs.createReadStream(file, { start, end }).pipe(res);
});

export function mediaStats() {
  const blobs = Object.values(db.blobs);
  const avatars = blobs.filter((b) => b.kind === 'avatar');
  const chat = blobs.filter((b) => b.kind !== 'avatar');
  const sum = (list) => list.reduce((acc, b) => acc + (b.size || 0), 0);
  return {
    blobs: blobs.length,
    avatarCount: avatars.length,
    chatMediaCount: chat.length,
    avatarBytes: sum(avatars),
    chatMediaBytes: sum(chat),
    engine: `sharp ${sharp.versions.sharp} / libvips ${sharp.versions.vips}`,
  };
}

export { crypto };
