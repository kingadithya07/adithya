import React, { useEffect, useRef, useState } from 'react';
import { api, humanError } from '../api.js';
import {
  compressImage,
  encryptMediaBytes,
  encryptText,
  importPublicJwk,
  newId,
  randomSaltB64,
} from '../crypto/e2ee.js';

export default function ChatWindow({
  me,
  peer,
  identity,
  messages,
  plain,
  onIngest,
  online,
  peerTyping,
  onTyping,
  onBack,
  t,
}) {
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [upload, setUpload] = useState(null);
  const scroller = useRef(null);
  const fileInput = useRef(null);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, peerTyping]);

  async function sendText() {
    const text = draft.trim();
    if (!text || sending) return;
    if (!peer.publicKey) {
      setError('peer_key_missing');
      return;
    }
    setSending(true);
    setError(null);
    try {
      const msgId = newId();
      const theirKey = await importPublicJwk(peer.publicKey);
      const envelope = await encryptText({
        plaintext: text,
        myPrivateKey: identity.privateKey,
        theirPublicKey: theirKey,
        from: me.id,
        to: peer.id,
        msgId,
      });
      const { message } = await api.sendMessage({
        to: peer.id,
        msgId,
        ct: envelope.ct,
        iv: envelope.iv,
        salt: envelope.salt,
        senderPub: identity.jwk,
        kind: 'text',
      });
      setDraft('');
      await onIngest(message);
    } catch (err) {
      setError(humanError(err));
    } finally {
      setSending(false);
    }
  }

  async function sendImage(file) {
    if (!file || sending) return;
    if (!peer.publicKey) {
      setError('peer_key_missing');
      return;
    }
    setSending(true);
    setError(null);
    try {
      const theirKey = await importPublicJwk(peer.publicKey);

      const compressed = await compressImage(file, { maxDim: 1280, quality: 0.72 });
      setUpload({ stage: 'compressing', sourceBytes: compressed.sourceBytes, bytes: compressed.bytes.length });

      const mediaSalt = randomSaltB64();
      const { ciphertext, iv } = await encryptMediaBytes({
        bytes: compressed.bytes,
        myPrivateKey: identity.privateKey,
        theirPublicKey: theirKey,
        saltB64: mediaSalt,
      });

      setUpload({ stage: 'uploading', sourceBytes: compressed.sourceBytes, bytes: ciphertext.length });
      const blob = await api.uploadMedia(ciphertext, 'image/webp');

      const msgId = newId();
      const { message } = await api.sendMessage({
        to: peer.id,
        msgId,
        kind: 'image',
        mediaId: blob.id,
        mediaSalt,
        iv,
        mime: 'image/webp',
        width: compressed.width,
        height: compressed.height,
        senderPub: identity.jwk,
      });
      await onIngest(message);
      setUpload(null);
    } catch (err) {
      setError(humanError(err));
      setUpload(null);
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="chat">
      <header className="chat-head">
        <button type="button" className="icon-btn back" onClick={onBack} aria-label="Back">
          ←
        </button>
        <div className="avatar sm">
          {peer.avatarUrl ? <img src={peer.avatarUrl} alt="" /> : <span className="av-fallback">{peer.name?.[0]}</span>}
          {online && <span className="dot-on" />}
        </div>
        <div className="chat-head-meta">
          <strong>{peer.name}</strong>
          <span>{peerTyping ? 'typing…' : online ? 'online' : peer.about || 'offline'}</span>
        </div>
        <span className="e2ee-chip" title="End-to-end encrypted">🔒 E2EE</span>
      </header>

      <div className="messages" ref={scroller}>
        <div className="sys-note">
          🔒 Messages and photos are encrypted on this device with ECDH P-256 → HKDF-SHA256 →
          AES-256-GCM. The server stores ciphertext only.
        </div>
        {messages.map((m) => (
          <Bubble key={m.id} m={m} mine={m.from === me.id} dec={plain[m.id]} />
        ))}
        {peerTyping && <div className="typing">● ● ●</div>}
      </div>

      {(upload || error) && (
        <div className={error ? 'composer-note error' : 'composer-note'}>
          {error ? (
            `Send failed: ${error}`
          ) : upload.stage === 'compressing' ? (
            <>
              Compressing on-device: {(upload.sourceBytes / 1024).toFixed(0)} KB →{' '}
              {(upload.bytes / 1024).toFixed(0)} KB
            </>
          ) : (
            <>Uploading {(upload.bytes / 1024).toFixed(0)} KB of ciphertext…</>
          )}
        </div>
      )}

      <footer className="composer">
        <button type="button" className="icon-btn" onClick={() => fileInput.current?.click()} title="Send photo">
          📎
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            sendImage(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        <textarea
          rows={1}
          value={draft}
          placeholder={t('typeMessage')}
          onChange={(e) => {
            setDraft(e.target.value);
            onTyping();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              sendText();
            }
          }}
        />
        <button type="button" className="send" disabled={!draft.trim() || sending} onClick={sendText}>
          {sending ? '…' : '➤'}
        </button>
      </footer>
    </section>
  );
}

function Bubble({ m, mine, dec }) {
  const time = new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return (
    <div className={mine ? 'bubble-row mine' : 'bubble-row'}>
      <div className={mine ? 'bubble mine' : 'bubble'}>
        {dec?.imageUrl ? (
          <img className="bubble-img" src={dec.imageUrl} alt="Photo" />
        ) : dec?.text ? (
          <span className="bubble-text">{dec.text}</span>
        ) : dec?.locked ? (
          <span className="bubble-locked" title={dec.reason || 'no key'}>
            🔒 ciphertext — no matching key on this device
          </span>
        ) : (
          <span className="bubble-locked">decrypting…</span>
        )}
        <span className="bubble-meta">
          {time}
          {mine && <span className="tick">✓✓</span>}
        </span>
      </div>
    </div>
  );
}
