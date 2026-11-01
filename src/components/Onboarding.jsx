import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, setToken, humanError } from '../api.js';
import { LANGUAGES, TRANSLATED, languageByCode } from '../i18n.js';

const STEPS = ['language', 'phone', 'otp', 'profile'];

export default function Onboarding({ t, lang, translated, onLangChange, onDone, initialUser, bootError, notice }) {
  // If the tab already holds a valid session for an account that never finished
  // its profile, resume at the profile step instead of restarting at language
  // selection — otherwise an interrupted sign-up can never be completed.
  const [step, setStep] = useState(() => (initialUser && !initialUser.name ? 'profile' : 'language'));
  const [phone, setPhone] = useState('');
  const [otpInfo, setOtpInfo] = useState(null);
  const [code, setCode] = useState(['', '', '', '', '', '']);
  const [error, setError] = useState(bootError);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState(() => initialUser?.name || '');
  const [about, setAbout] = useState('');
  const [avatar, setAvatar] = useState(null);
  const [compression, setCompression] = useState(null);

  const stepIndex = STEPS.indexOf(step);

  // ---------------------------------------------------------------- phone --
  const digits = phone.replace(/\D/g, '').slice(0, 10);
  const phoneValid = /^[6-9]\d{9}$/.test(digits);

  async function sendOtp() {
    setError(null);
    setBusy(true);
    try {
      const info = await api.sendOtp(digits);
      setOtpInfo(info);
      setCode(['', '', '', '', '', '']);
      setStep('otp');
      if (info.devCode) setCode(info.devCode.split(''));
    } catch (err) {
      setError(humanError(err));
    } finally {
      setBusy(false);
    }
  }

  // ------------------------------------------------------------------ otp --
  async function verify(value) {
    setError(null);
    setBusy(true);
    try {
      const res = await api.verifyOtp(digits, value ?? code.join(''));
      setToken(res.token);
      if (res.needsProfile) {
        setStep('profile');
      } else {
        const { user } = await api.me();
        onDone(user);
      }
    } catch (err) {
      setError(humanError(err));
      // A rejected code leaves the boxes full, which blocks retyping (and would
      // re-trigger auto-submit). Clear them and focus the first box.
      if (['wrong_code', 'otp_expired', 'no_otp_requested'].includes(err.data?.error)) {
        setCode(['', '', '', '', '', '']);
        setTimeout(() => otpRefs.current[0]?.focus(), 30);
      }
    } finally {
      setBusy(false);
    }
  }

  const otpRefs = useRef([]);

  function setDigit(idx, val) {
    const cleaned = val.replace(/\D/g, '');
    if (!cleaned) {
      const next = [...code];
      next[idx] = '';
      setCode(next);
      return;
    }
    const next = [...code];
    for (let i = 0; i < cleaned.length && idx + i < 6; i += 1) next[idx + i] = cleaned[i];
    setCode(next);
    const focusAt = Math.min(5, idx + cleaned.length);
    otpRefs.current[focusAt]?.focus();
  }

  useEffect(() => {
    if (step === 'otp' && code.every((c) => c !== '') && !busy) {
      verify(code.join(''));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, step]);

  // -------------------------------------------------------------- profile --
  async function pickAvatar(file) {
    if (!file) return;
    const bitmap = await createImageBitmap(file);
    const max = 512;
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
    setAvatar(dataUrl);
    setBusy(true);
    try {
      const res = await api.uploadAvatar(dataUrl);
      setAvatar(`/api/media/${res.avatar.id}?v=${res.avatar.updatedAt}`);
      setCompression(res.compression);
    } catch (err) {
      setError(humanError(err));
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    setError(null);
    setBusy(true);
    try {
      const { user } = await api.saveProfile(name.trim(), about.trim());
      onDone(user);
    } catch (err) {
      setError(humanError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="onboard">
      <div className="onboard-card">
        <header className="brand">
          <div className="brand-mark">भा</div>
          <div>
            <h1>BharatChat</h1>
            <p className="brand-tag">{t('tagline')}</p>
          </div>
        </header>

        <div className="stepper" aria-hidden>
          {STEPS.map((s, i) => (
            <span key={s} className={i <= stepIndex ? 'dot on' : 'dot'} />
          ))}
        </div>

        {notice && (
          <div className="dev-note notice">
            <strong>Signed out.</strong> {notice}
          </div>
        )}

        {step === 'language' && (
          <section className="pane">
            <h2>{t('chooseLanguage')}</h2>
            <div className="lang-grid">
              {LANGUAGES.map((l) => (
                <button
                  key={l.code}
                  type="button"
                  className={l.code === lang ? 'lang on' : 'lang'}
                  onClick={() => onLangChange(l.code)}
                >
                  <span className="lang-native">{l.native}</span>
                  <span className="lang-en">{l.english}</span>
                </button>
              ))}
            </div>
            <p className="fineprint">
              {TRANSLATED.has(lang) && lang !== 'en'
                ? `Interface language: ${languageByCode(lang).english}`
                : lang !== 'en' && `Interface strings are only fully translated for 6 languages in this slice — falling back to English.`}
            </p>
            <button type="button" className="primary" onClick={() => setStep('phone')}>
              {t('continueLabel')}
            </button>
          </section>
        )}

        {step === 'phone' && (
          <section className="pane">
            <h2>{t('phoneTitle')}</h2>
            <p className="sub">{t('phoneHint')}</p>
            <label className="phone-field">
              <span className="cc">🇮🇳 +91</span>
              <input
                autoFocus
                inputMode="numeric"
                autoComplete="tel-national"
                placeholder={t('phonePlaceholder')}
                value={digits}
                onChange={(e) => setPhone(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && phoneValid && sendOtp()}
              />
            </label>
            {error && <p className="error">{error}</p>}
            <button type="button" className="primary" disabled={!phoneValid || busy} onClick={sendOtp}>
              {busy ? '…' : t('sendOtp')}
            </button>
            <button type="button" className="link" onClick={() => setStep('language')}>
              ← {t('chooseLanguage')}
            </button>
          </section>
        )}

        {step === 'otp' && (
          <section className="pane">
            <h2>{t('otpTitle')}</h2>
            <p className="sub">
              {t('sentTo')} <strong>+91 {digits}</strong>
            </p>
            <div className="otp-inputs">
              {code.map((c, i) => (
                <input
                  key={i}
                  ref={(el) => (otpRefs.current[i] = el)}
                  inputMode="numeric"
                  autoComplete={i === 0 ? 'one-time-code' : 'off'}
                  maxLength={6}
                  value={c}
                  onChange={(e) => setDigit(i, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Backspace' && !code[i] && i > 0) otpRefs.current[i - 1]?.focus();
                  }}
                />
              ))}
            </div>

            {otpInfo?.channel === 'development-echo' && (
              <div className="dev-note">
                <strong>Development mode.</strong> No TRAI DLT SMS gateway is configured in this
                deployment, so the server returns the code directly instead of sending an SMS. A
                real deployment would deliver it via DLT + WebOTP autofill.
                {otpInfo.devCode && <code className="dev-code">{otpInfo.devCode}</code>}
              </div>
            )}

            {error && <p className="error">{error}</p>}
            <button type="button" className="primary" disabled={busy || code.some((c) => !c)} onClick={() => verify()}>
              {busy ? '…' : t('verify')}
            </button>
            <button type="button" className="link" disabled={busy} onClick={sendOtp}>
              {t('resend')}
            </button>
          </section>
        )}

        {step === 'profile' && (
          <section className="pane">
            <h2>{t('profileTitle')}</h2>
            <p className="sub">{t('profileHint')}</p>
            <div className="avatar-row">
              <label className="avatar-pick" title="Upload photo">
                {avatar ? <img src={avatar} alt="" /> : <span>📷</span>}
                <input type="file" accept="image/*" hidden onChange={(e) => pickAvatar(e.target.files?.[0])} />
              </label>
              <div className="avatar-meta">
                <p className="sub">Photo is compressed server-side with sharp/libvips.</p>
                {compression && (
                  <p className="fineprint">
                    {(compression.sourceBytes / 1024).toFixed(0)} KB →{' '}
                    {(compression.outputBytes / 1024).toFixed(0)} KB WebP (
                    {Math.round(compression.ratio * 100)}%) · preview {compression.previewBytes} B
                  </p>
                )}
              </div>
            </div>
            <label className="field">
              <span>{t('yourName')}</span>
              <input value={name} maxLength={40} autoFocus onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="field">
              <span>{t('about')}</span>
              <input value={about} maxLength={120} onChange={(e) => setAbout(e.target.value)} placeholder="Available" />
            </label>
            {error && <p className="error">{error}</p>}
            <button type="button" className="primary" disabled={name.trim().length < 2 || busy} onClick={finish}>
              {busy ? '…' : t('finish')}
            </button>
          </section>
        )}
      </div>
      <p className="legal">
        Prototype slice · end-to-end encrypted 1:1 chat · no payment features in scope
      </p>
    </div>
  );
}
