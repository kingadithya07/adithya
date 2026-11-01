import React from 'react';

function Avatar({ user, online }) {
  return (
    <div className="avatar">
      {user.avatarUrl ? (
        <img src={user.avatarUrl} alt="" loading="lazy" />
      ) : user.avatarPreview ? (
        <img src={user.avatarPreview} alt="" />
      ) : (
        <span className="av-fallback">{user.name?.[0] || '?'}</span>
      )}
      {online && <span className="dot-on" />}
    </div>
  );
}

export default function ChatList({ users, online, activePeer, onOpen, lastMessageFor, t }) {
  if (users.length === 0) {
    return (
      <div className="list">
        <div className="list-empty">
          <p>{t('noChats')}</p>
          <p className="fineprint">
            Tip: duplicate this tab (no second device needed). Each tab keeps its own session and
            its own device key, so the two tabs can talk to each other with real E2EE.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="list">
      <div className="list-head">
        <span>{t('chats')}</span>
        <span className="count">{users.length}</span>
      </div>
      {users.map((u) => {
        const last = lastMessageFor(u.id);
        return (
          <button
            key={u.id}
            type="button"
            className={u.id === activePeer ? 'row on' : 'row'}
            onClick={() => onOpen(u.id)}
          >
            <Avatar user={u} online={online.has(u.id)} />
            <div className="row-body">
              <div className="row-top">
                <strong>{u.name}</strong>
                {last && (
                  <span className="row-time">
                    {new Date(last.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
              </div>
              <div className="row-bottom">
                <span className="row-preview">
                  {last ? `${last.mine ? 'You: ' : ''}${last.preview}` : u.about || 'Say hello'}
                </span>
                {u.publicKey ? <span className="key-chip" title="Public key published">🔑</span> : <span className="key-chip muted" title="Awaiting device key">⏳</span>}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
