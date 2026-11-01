import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, getToken, setToken } from './api.js';
import { makeT } from './i18n.js';
import { ensureIdentity } from './identity.js';
import Onboarding from './components/Onboarding.jsx';
import Shell from './components/Shell.jsx';

export default function App() {
  const [lang, setLangState] = useState(() => sessionStorage.getItem('bharatchat.lang') || 'en');
  const [phase, setPhase] = useState('booting');
  const [user, setUser] = useState(null);
  const [identity, setIdentity] = useState(null);
  const [bootError, setBootError] = useState(null);
  const [notice, setNotice] = useState(null);

  const { t, translated } = useMemo(() => makeT(lang), [lang]);

  const setLang = useCallback((code) => {
    sessionStorage.setItem('bharatchat.lang', code);
    setLangState(code);
  }, []);

  const boot = useCallback(async () => {
    if (!getToken()) {
      setPhase('onboarding');
      return;
    }
    try {
      const { user: me } = await api.me();
      const id = await ensureIdentity(me.id);
      setUser(me);
      setIdentity(id);
      setPhase(me.name ? 'app' : 'onboarding');
    } catch (err) {
      if (err.status === 401) {
        setToken(null);
        setPhase('onboarding');
        return;
      }
      setBootError(err.message);
      setPhase('onboarding');
    }
  }, []);

  useEffect(() => {
    boot();
  }, [boot]);

  // A 401 on any authenticated call means the stored session is dead (server
  // restarted, store wiped, token expired). Drop it and explain, rather than
  // leaving a bare "unauthorized" on the screen.
  useEffect(() => {
    const onUnauthorized = (event) => {
      const path = event.detail?.path || 'a request';
      setToken(null);
      setUser(null);
      setIdentity(null);
      setPhase('onboarding');
      setBootError(null);
      setNotice(`Your session expired while calling ${path}. Please sign in again — your account still exists.`);
    };
    window.addEventListener('bharatchat:unauthorized', onUnauthorized);
    return () => window.removeEventListener('bharatchat:unauthorized', onUnauthorized);
  }, []);

  const handleOnboarded = useCallback(async (authedUser) => {
    setNotice(null);
    const id = await ensureIdentity(authedUser.id);
    setUser(authedUser);
    setIdentity(id);
    setPhase('app');
  }, []);

  const handleLogout = useCallback(() => {
    setToken(null);
    setUser(null);
    setIdentity(null);
    setPhase('onboarding');
  }, []);

  if (phase === 'booting') {
    return (
      <div className="boot">
        <div className="boot-mark">भा</div>
        <p>BharatChat</p>
        <div className="boot-bar" />
      </div>
    );
  }

  if (phase === 'app' && user && identity) {
    return (
      <Shell
        user={user}
        identity={identity}
        lang={lang}
        onLangChange={setLang}
        t={t}
        onLogout={handleLogout}
      />
    );
  }

  return (
    <Onboarding
      t={t}
      lang={lang}
      translated={translated}
      onLangChange={setLang}
      initialUser={user}
      bootError={bootError}
      notice={notice}
      onDone={handleOnboarded}
    />
  );
}
