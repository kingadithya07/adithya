/** Replays the exact HTTP call sequence the browser makes, printing every status. */
const BASE = process.env.BASE || 'http://127.0.0.1:3001';

async function call(path, { method = 'GET', body, token } = {}) {
  const opts = { method, headers: {} };
  if (token) opts.headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const res = await fetch(BASE + path, opts);
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { json = text.slice(0, 80); }
  const flag = res.status >= 400 ? '  <-- FAIL' : '';
  console.log(`  ${String(res.status).padEnd(3)} ${method.padEnd(4)} ${path.padEnd(34)} ${json?.error || json?.ok || ''}${flag}`);
  return { status: res.status, json };
}

const rnd = () => String(9000000000 + Math.floor(Math.random() * 89999999));

console.log('\nA. Fresh registration (what the onboarding screen does)');
const phoneA = rnd();
const otp1 = await call('/api/auth/send-otp', { method: 'POST', body: { phone: phoneA } });
const v = await call('/api/auth/verify-otp', { method: 'POST', body: { phone: phoneA, code: otp1.json.devCode } });
const tok = v.json.token;
await call('/api/auth/profile', { method: 'POST', token: tok, body: { name: 'Diag One', about: '' } });
await call('/api/keys', { method: 'POST', token: tok, body: { publicKey: { kty: 'EC', crv: 'P-256', x: 'aaa', y: 'bbb' } } });
await call('/api/users', { token: tok });
await call('/api/status', { token: tok });

console.log('\nB. Resend, then submit the OLD code (stale-code path)');
const phoneB = rnd();
const o1 = await call('/api/auth/send-otp', { method: 'POST', body: { phone: phoneB } });
const o2 = await call('/api/auth/send-otp', { method: 'POST', body: { phone: phoneB } });
await call('/api/auth/verify-otp', { method: 'POST', body: { phone: phoneB, code: o1.json.devCode } });
const okB = await call('/api/auth/verify-otp', { method: 'POST', body: { phone: phoneB, code: o2.json.devCode } });

console.log('\nC. Existing user signs in again (needsProfile=false path)');
const again = await call('/api/auth/send-otp', { method: 'POST', body: { phone: phoneA } });
const v2 = await call('/api/auth/verify-otp', { method: 'POST', body: { phone: phoneA, code: again.json.devCode } });
console.log(`      needsProfile=${v2.json.needsProfile}`);
await call('/api/auth/me', { token: v2.json.token });
await call('/api/users', { token: v2.json.token });
await call('/api/keys', { method: 'POST', token: v2.json.token, body: { publicKey: { kty: 'EC', crv: 'P-256', x: 'ccc', y: 'ddd' } } });

console.log('\nD. Token edge cases');
await call('/api/users');
await call('/api/users', { token: 'garbage.token' });
await call('/api/users', { token: tok + 'x' });
await call('/api/auth/me', { token: okB.json.token });
