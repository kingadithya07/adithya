import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { WebSocketServer } from 'ws';
import { PORT, HOST, IS_PROD, DEV_SMS } from './config.js';
import { verifySession } from './guard.js';
import { authRouter } from './auth.js';
import { mediaRouter } from './media.js';
import { chatRouter, hub } from './chat.js';
import { db, flushAll } from './store.js';

const app = express();
app.disable('x-powered-by');

// The shell is a PWA that uses getUserMedia, geolocation and WebAuthn, so the
// Permissions-Policy must not lock those features down.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=(self), publickey-credentials-get=(self)');
  next();
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, devSms: DEV_SMS, prod: IS_PROD, users: db.users.length });
});

// Request log (development only). Without this, a 401 in the browser is a dead
// end: the client only surfaces an error string with no endpoint attached.
app.use((req, res, next) => {
  res.on('finish', () => {
    if (!IS_PROD && req.originalUrl.startsWith('/api/') && res.statusCode < 400) {
      console.log(`[${res.statusCode}] ${req.method} ${req.originalUrl.split('?')[0]}`);
    }
    if (res.statusCode >= 400) {
      const auth = req.get('authorization');
      const tokenState = auth
        ? `token=${auth.slice(7, 19)}…(${verifySession(auth.slice(7)) ? 'valid' : 'INVALID'})`
        : req.query.t
          ? `queryToken=${String(req.query.t).slice(0, 12)}…(${verifySession(req.query.t) ? 'valid' : 'INVALID'})`
          : 'no-token';
      console.warn(`[${res.statusCode}] ${req.method} ${req.originalUrl.split('?')[0]} ${tokenState}`);
    }
  });
  next();
});


app.use(authRouter);
app.use(mediaRouter);
app.use(chatRouter);

app.use((err, req, res, next) => {
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'payload_too_large' });
  console.error('[server]', err.message);
  res.status(500).json({ error: 'internal_error' });
});

const server = http.createServer(app);

// ------------------------------------------------------------------ WS hub --
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  const session = verifySession(url.searchParams.get('token'));
  if (!session) {
    ws.close(4401, 'unauthorized');
    return;
  }
  const userId = session.uid;
  const user = db.findUserById(userId);
  if (!user) {
    ws.close(4404, 'unknown_user');
    return;
  }

  hub.attach(userId, ws);
  ws.send(JSON.stringify({ type: 'ready', userId, online: hub.onlineList() }));

  let lastTyping = 0;
  ws.on('message', (raw) => {
    let event;
    try {
      event = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (event?.type === 'typing' && typeof event.to === 'string') {
      const now = Date.now();
      if (now - lastTyping < 400) return; // coalesce typing noise
      lastTyping = now;
      hub.send(event.to, { type: 'typing', from: userId, at: now });
    }
  });

  ws.on('close', () => hub.detach(userId, ws));
  ws.on('error', () => hub.detach(userId, ws));
});

// ------------------------------------------------------------------ frontend --
if (IS_PROD) {
  const dist = path.resolve('dist');
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  app.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html')));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({
    server: { middlewareMode: true, hmr: false, allowedHosts: true, host: '0.0.0.0' },
    appType: 'spa',
  });
  app.use(vite.middlewares);
}

server.listen(PORT, HOST, () => {
  console.log(`\n  BharatChat slice listening on http://${HOST}:${PORT}`);
  console.log(`  mode=${IS_PROD ? 'production' : 'development'}  sms=${DEV_SMS ? 'DEV ECHO (no gateway)' : 'DLT'}`);
  console.log(`  data dir: ${path.resolve('data')}\n`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log('\n[server] flushing store…');
    flushAll();
    process.exit(0);
  });
}
