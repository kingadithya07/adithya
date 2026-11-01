import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, getToken } from '../api.js';
import { importPublicJwk, decryptText, decryptMediaBytes } from '../crypto/e2ee.js';
import ChatList from './ChatList.jsx';
import ChatWindow from './ChatWindow.jsx';
import SettingsView from './SettingsView.jsx';
import { StatusView, ChannelsView, CallsView } from './PlaceholderViews.jsx';

const TABS = [
  { id: 'chats', icon: '💬', key: 'chats' },
  { id: 'status', icon: '◍', key: 'status' },
  { id: 'channels', icon: '📣', key: 'channels' },
  { id: 'calls', icon: '📞', key: 'calls' },
  { id: 'settings', icon: '⚙', key: 'settings' },
];

export default function Shell({ user, identity, t, lang, onLangChange, onLogout }) {
  const [tab, setTab] = useState('chats');
  const [users, setUsers] = useState([]);
  const [online, setOnline] = useState(new Set());
  const [activePeer, setActivePeer] = useState(null);
  const [threads, setThreads] = useState({}); // peerId -> message[]
  const [plain, setPlain] = useState({}); // msgId -> {text} | {imageUrl} | {locked:true}
  const [conn, setConn] = useState('connecting');
  const [typingPeer, setTypingPeer] = useState(null);
  const [newChatOpen, setNewChatOpen] = useState(false);
  const wsRef = useRef(null);
  const pubKeyCache = useRef(new Map());
  const plainRef = useRef(plain);
  plainRef.current = plain;
  const usersRef = useRef(users);
  usersRef.current = users;

  // --------------------------------------------------------------- bootstrap --
  const loadDirectory = useCallback(async () => {
    const res = await api.users();
    setUsers(res.users);
    setOnline(new Set(res.online || []));
    return res.users;
  }, []);

  const peerPub = useCallback(async (jwk) => {
    const id = `${jwk.x}.${jwk.y}`;
    if (!pubKeyCache.current.has(id)) pubKeyCache.current.set(id, await importPublicJwk(jwk));
    return pubKeyCache.current.get(id);
  }, []);

  // ------------------------------------------------------------ decryption --
  const decryptMessage = useCallback(
    async (m, peer) => {
      try {
        if (m.kind === 'image') {
          const otherJwk = m.from === user.id ? peer.publicKey : m.senderPub || peer.publicKey;
          if (!otherJwk) return { locked: true };
          const theirKey = await peerPub(otherJwk);
          const ct = await api.media(m.mediaId);
          const bytes = await decryptMediaBytes({
            ciphertext: ct,
            ivB64: m.iv,
            myPrivateKey: identity.privateKey,
            theirPublicKey: theirKey,
            saltB64: m.mediaSalt,
          });
          const url = URL.createObjectURL(new Blob([bytes], { type: m.mime || 'image/webp' }));
          return { imageUrl: url, bytes: bytes.length, width: m.width, height: m.height };
        }
        const otherJwk = m.from === user.id ? peer.publicKey : m.senderPub;
        if (!otherJwk) return { locked: true };
        const theirKey = await peerPub(otherJwk);
        const text = await decryptText({
          envelope: m,
          myPrivateKey: identity.privateKey,
          theirPublicKey: theirKey,
          from: m.from,
          to: m.to,
        });
        return { text };
      } catch (err) {
        return { locked: true, reason: err?.name || 'decrypt_failed' };
      }
    },
    [identity.privateKey, peerPub, user.id]
  );

  const ingest = useCallback(
    async (incoming) => {
      const peerId = incoming.from === user.id ? incoming.to : incoming.from;
      let peers = usersRef.current;
      let peer = peers.find((u) => u.id === peerId);

      // A message can arrive from someone who signed up after we loaded the
      // directory; refresh once so we can find their public key.
      if (!peer) {
        peers = await loadDirectory().catch(() => usersRef.current);
        peer = peers.find((u) => u.id === peerId);
      }

      setThreads((prev) => {
        const list = prev[peerId] || [];
        if (list.some((m) => m.id === incoming.id)) return prev;
        return { ...prev, [peerId]: [...list, incoming] };
      });
      if (plainRef.current[incoming.id] || !peer) return;
      const decrypted = await decryptMessage(incoming, peer);
      setPlain((prev) => (prev[incoming.id] ? prev : { ...prev, [incoming.id]: decrypted }));
    },
    [decryptMessage, loadDirectory, user.id]
  );

  // --------------------------------------------------------------- bootstrap --
  useEffect(() => {
    loadDirectory().catch(() => {});
  }, [loadDirectory]);

  // Load history for a peer when opened.
  useEffect(() => {
    if (!activePeer) return;
    const peer = users.find((u) => u.id === activePeer);
    if (!peer) return;
    let cancelled = false;
    (async () => {
      const { messages } = await api.messages(activePeer);
      if (cancelled) return;
      // Merge rather than replace, so live messages that arrived while this
      // thread was closed are not dropped when the history lands.
      setThreads((prev) => {
        const byId = new Map((prev[activePeer] || []).map((m) => [m.id, m]));
        for (const m of messages) byId.set(m.id, m);
        return {
          ...prev,
          [activePeer]: [...byId.values()].sort((a, b) => a.createdAt - b.createdAt),
        };
      });
      for (const m of messages) {
        if (plainRef.current[m.id]) continue;
        const d = await decryptMessage(m, peer);
        if (cancelled) return;
        setPlain((prev) => (prev[m.id] ? prev : { ...prev, [m.id]: d }));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePeer, users.length]);

  // --------------------------------------------------------------------- ws --
  useEffect(() => {
    let closed = false;
    let retry = 0;

    function connect() {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(getToken() || '')}`);
      wsRef.current = ws;
      setConn('connecting');

      ws.onopen = () => {
        setConn('online');
        retry = 0;
        loadDirectory().catch(() => {});
      };
      ws.onmessage = (event) => {
        let data;
        try {
          data = JSON.parse(event.data);
        } catch {
          return;
        }
        if (data.type === 'presence') {
          setOnline(new Set(data.online || []));
        } else if (data.type === 'message') {
          ingest(data.message);
        } else if (data.type === 'typing') {
          setTypingPeer(data.from);
          setTimeout(() => setTypingPeer((cur) => (cur === data.from ? null : cur)), 2500);
        }
      };
      ws.onclose = () => {
        setConn('offline');
        if (closed) return;
        retry = Math.min(retry + 1, 6);
        setTimeout(connect, 800 * retry);
      };
      ws.onerror = () => ws.close();
    }

    connect();
    return () => {
      closed = true;
      wsRef.current?.close();
    };
  }, [ingest, loadDirectory]);

  const sendTyping = useCallback((peerId) => {
    const ws = wsRef.current;
    if (ws?.readyState === 1) ws.send(JSON.stringify({ type: 'typing', to: peerId }));
  }, []);

  const activePeerUser = useMemo(() => users.find((u) => u.id === activePeer) || null, [users, activePeer]);

  const lastMessageFor = useCallback(
    (peerId) => {
      const list = threads[peerId];
      if (!list || list.length === 0) return null;
      const last = list[list.length - 1];
      const dec = plain[last.id];
      const mine = last.from === user.id;
      const preview = dec?.text
        ? dec.text
        : dec?.imageUrl
          ? '📷 Photo'
          : dec?.locked
            ? '🔒 Encrypted'
            : '…';
      return { preview, at: last.createdAt, mine };
    },
    [threads, plain, user.id]
  );

  return (
    <div className={`app ${activePeer ? 'has-active' : ''}`}>
      <aside className="rail">
        <div className="rail-head">
          <div className="me">
            {user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : <span className="av-fallback">{user.name?.[0]}</span>}
            <div className="me-meta">
              <strong>{user.name}</strong>
              <span>{user.phoneMasked}</span>
            </div>
          </div>
          <span className={`pill ${conn}`}>{conn === 'online' ? 'live' : conn}</span>
        </div>

        <nav className="tabs">
          {TABS.map((tb) => (
            <button
              key={tb.id}
              type="button"
              className={tab === tb.id ? 'tab on' : 'tab'}
              onClick={() => {
                setTab(tb.id);
                if (tb.id !== 'chats') setActivePeer(null);
              }}
            >
              <span className="tab-icon">{tb.icon}</span>
              <span className="tab-label">{t(tb.key)}</span>
            </button>
          ))}
        </nav>

        {tab === 'chats' && (
          <ChatList
            users={users}
            online={online}
            activePeer={activePeer}
            onOpen={setActivePeer}
            lastMessageFor={lastMessageFor}
            t={t}
          />
        )}
        {tab === 'chats' && (
          <button type="button" className="fab" onClick={() => setNewChatOpen(true)} title={t('newChat')}>
            <span>+</span>
            <em>{t('newChat')}</em>
          </button>
        )}

        {tab === 'settings' && (
          <SettingsView
            user={user}
            identity={identity}
            lang={lang}
            onLangChange={onLangChange}
            onLogout={onLogout}
            t={t}
          />
        )}
      </aside>

      <main className="stage">
        {tab === 'chats' &&
          (activePeerUser ? (
            <ChatWindow
              key={activePeerUser.id}
              me={user}
              peer={activePeerUser}
              identity={identity}
              messages={threads[activePeerUser.id] || []}
              plain={plain}
              onIngest={ingest}
              online={online.has(activePeerUser.id)}
              peerTyping={typingPeer === activePeerUser.id}
              onTyping={() => sendTyping(activePeerUser.id)}
              onBack={() => setActivePeer(null)}
              t={t}
            />
          ) : (
            <EmptyState users={users} t={t} />
          ))}

        {tab === 'status' && <StatusView t={t} />}
        {tab === 'channels' && <ChannelsView t={t} />}
        {tab === 'calls' && <CallsView t={t} />}
        {tab === 'settings' && (
          <div className="stage-scroll">
            <div className="card wide">
              <h3>About this build</h3>
              <p>
                This is the vertical slice: real +91 OTP onboarding, real ECDH/AES-GCM end-to-end
                encryption over a WebSocket, and encrypted media. Settings duplicates the panel on
                the left; open it from the tab bar on any screen size.
              </p>
            </div>
          </div>
        )}
      </main>

      {newChatOpen && (
        <NewChatSheet
          users={users}
          online={online}
          t={t}
          onClose={() => setNewChatOpen(false)}
          onPick={(id) => {
            setNewChatOpen(false);
            setTab('chats');
            setActivePeer(id);
          }}
        />
      )}
    </div>
  );
}

function NewChatSheet({ users, online, onClose, onPick, t }) {
  const [q, setQ] = useState('');
  const filtered = users.filter((u) => u.name?.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="sheet-scrim" onClick={onClose} role="presentation">
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={t('newChat')}>
        <div className="sheet-head">
          <strong>{t('newChat')}</strong>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <input
          autoFocus
          className="sheet-search"
          placeholder="Search people"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="sheet-list">
          {filtered.length === 0 && <p className="fineprint pad">{t('noChats')}</p>}
          {filtered.map((u) => (
            <button key={u.id} type="button" className="row" onClick={() => onPick(u.id)}>
              <div className="avatar">
                {u.avatarUrl ? <img src={u.avatarUrl} alt="" /> : <span className="av-fallback">{u.name?.[0]}</span>}
                {online.has(u.id) && <span className="dot-on" />}
              </div>
              <div className="row-body">
                <strong>{u.name}</strong>
                <span className="row-preview">{u.about || u.phoneMasked}</span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function EmptyState({ users, t }) {
  return (
    <div className="empty">
      <div className="empty-mark">भा</div>
      <h2>BharatChat</h2>
      <p>{users.length === 0 ? t('noChats') : 'Select a chat to start. Messages are encrypted on this device before they are sent.'}</p>
      <div className="badge-row">
        <span className="badge">🔒 {t('encrypted')}</span>
        <span className="badge">ECDH P-256 · AES-256-GCM</span>
      </div>
    </div>
  );
}
