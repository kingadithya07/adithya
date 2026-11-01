import React, { useEffect, useState } from 'react';
import { LANGUAGES, TRANSLATED } from '../i18n.js';
import { safetyNumber } from '../crypto/e2ee.js';
import { api } from '../api.js';

const LIMITATIONS = [
  ['Key exchange', 'Static–static ECDH per tab. No ratchet, so no forward secrecy.'],
  ['Key storage', 'sessionStorage. Closing the tab destroys the private key.'],
  ['SMS delivery', 'No DLT gateway configured — OTP is echoed back in development mode.'],
  ['Video', 'No ffmpeg in this environment; only photo attachments are implemented.'],
  ['Group chat', 'Not implemented; 1:1 only in this slice.'],
];

export default function SettingsView({ user, identity, lang, onLangChange, onLogout, t }) {
  const [fingerprint, setFingerprint] = useState(null);
  const [peers, setPeers] = useState([]);
  const [stats, setStats] = useState(null);
  const [safety, setSafety] = useState({});

  useEffect(() => {
    (async () => {
      const jwk = identity.jwk;
      const digest = new Uint8Array(
        await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${jwk.x}|${jwk.y}`))
      );
      setFingerprint([...digest.slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join(' '));
      try {
        const [dir, st] = await Promise.all([api.users(), api.status()]);
        setPeers(dir.users);
        setStats(st);
        const table = {};
        for (const p of dir.users) {
          if (p.publicKey) table[p.id] = await safetyNumber(jwk, p.publicKey);
        }
        setSafety(table);
      } catch {
        /* directory may be empty */
      }
    })();
  }, [identity.jwk]);

  return (
    <div className="settings">
      <div className="profile-card">
        <div className="avatar lg">
          {user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : <span className="av-fallback">{user.name?.[0]}</span>}
        </div>
        <div>
          <strong>{user.name}</strong>
          <span className="sub">{user.phoneMasked}</span>
          <span className="sub">{user.about || '—'}</span>
        </div>
      </div>

      <section className="block">
        <h4>Your device key</h4>
        <p className="mono">{fingerprint || '…'}</p>
        <p className="fineprint">
          Fingerprint of this tab's ECDH P-256 public key. Regenerating the tab creates a new
          identity, which is exactly the limitation a real build would solve with a
          hardware-backed keystore.
        </p>
      </section>

      {peers.length > 0 && (
        <section className="block">
          <h4>Safety numbers</h4>
          <p className="fineprint">Compare these out-of-band to rule out a substituted key.</p>
          {peers.map((p) => (
            <div key={p.id} className="safety-row">
              <span>{p.name}</span>
              <span className="mono sm">{safety[p.id] || 'no key published'}</span>
            </div>
          ))}
        </section>
      )}

      <section className="block">
        <h4>{t('chooseLanguage')}</h4>
        <select value={lang} onChange={(e) => onLangChange(e.target.value)}>
          {LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.native} — {l.english}
              {TRANSLATED.has(l.code) ? '' : ' (English fallback)'}
            </option>
          ))}
        </select>
      </section>

      {stats && (
        <section className="block">
          <h4>Server state</h4>
          <div className="stat-grid">
            <div><strong>{stats.users}</strong><span>accounts</span></div>
            <div><strong>{stats.messages}</strong><span>ciphertexts</span></div>
            <div><strong>{stats.media.blobs}</strong><span>blobs</span></div>
            <div><strong>{stats.online}</strong><span>live sockets</span></div>
          </div>
          <p className="fineprint">{stats.media.engine}</p>
        </section>
      )}

      <section className="block">
        <h4>What this slice does not do</h4>
        <ul className="limits">
          {LIMITATIONS.map(([title, detail]) => (
            <li key={title}>
              <strong>{title}</strong> — {detail}
            </li>
          ))}
        </ul>
      </section>

      <button type="button" className="danger" onClick={onLogout}>
        {t('logOut')}
      </button>
    </div>
  );
}
