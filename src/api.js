/**
 * Thin API client. Session token lives in sessionStorage so that two browser
 * tabs are two independent accounts — which is what makes the two-party E2EE
 * demo possible without a second device.
 */
const TOKEN_KEY = 'bharatchat.token';

export function getToken() {
  return sessionStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  if (token) sessionStorage.setItem(TOKEN_KEY, token);
  else sessionStorage.removeItem(TOKEN_KEY);
}

/**
 * Any authenticated call can come back 401 — a stale token from a previous
 * server secret, a wiped store, an expired session. Instead of leaving the raw
 * word "unauthorized" on screen, the app is told to drop the session and return
 * to sign-in. Auth endpoints are excluded: their 401 means "wrong OTP".
 */
function reportUnauthorized(path) {
  if (path.startsWith('/api/auth/')) return;
  window.dispatchEvent(new CustomEvent('bharatchat:unauthorized', { detail: { path } }));
}

async function request(path, { method = 'GET', body, headers = {}, raw } = {}) {
  const token = getToken();
  const opts = { method, headers: { ...headers } };
  if (token) opts.headers.Authorization = `Bearer ${token}`;
  if (raw !== undefined) {
    opts.body = raw;
  } else if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(path, opts);
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: 'bad_response', raw: text.slice(0, 200) };
  }
  if (!res.ok) {
    if (res.status === 401) reportUnauthorized(path);
    const err = new Error(data?.error || `http_${res.status}`);
    err.status = res.status;
    err.path = path;
    err.data = data;
    throw err;
  }
  return data;
}

export const api = {
  sendOtp: (phone) => request('/api/auth/send-otp', { method: 'POST', body: { phone } }),
  verifyOtp: (phone, code) => request('/api/auth/verify-otp', { method: 'POST', body: { phone, code } }),
  saveProfile: (name, about) => request('/api/auth/profile', { method: 'POST', body: { name, about } }),
  me: () => request('/api/auth/me'),
  publishKey: (publicKey) => request('/api/keys', { method: 'POST', body: { publicKey } }),
  users: () => request('/api/users'),
  messages: (peerId) => request(`/api/messages/${peerId}`),
  sendMessage: (payload) => request('/api/messages', { method: 'POST', body: payload }),
  uploadMedia: (bytes, mime) =>
    request('/api/media/upload', {
      method: 'POST',
      raw: bytes,
      headers: { 'Content-Type': 'application/octet-stream', 'x-media-kind': 'image', 'x-media-mime': mime },
    }),
  uploadAvatar: (dataUrl) => request('/api/profile/avatar', { method: 'POST', body: { dataUrl } }),
  status: () => request('/api/status'),
  media: async (id) => {
    const res = await fetch(`/api/media/${id}?t=${encodeURIComponent(getToken() || '')}`);
    if (res.status === 401 || res.status === 403) reportUnauthorized('/api/media');
    if (!res.ok) throw new Error(`media_${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  },
};

export const ERROR_COPY = {
  unauthorized: 'Your session is no longer valid. Please sign in again.',
  wrong_code: 'That code is not correct.',
  otp_expired: 'That code expired. Request a new one.',
  no_otp_requested: 'Request a code first.',
  too_many_attempts: 'Too many wrong attempts. Request a new code.',
  otp_rate_limited: 'Too many code requests. Try again later.',
  otp_ip_rate_limited: 'Too many code requests from this network. Try again later.',
  invalid_indian_mobile: 'Enter a valid 10-digit Indian mobile number (starting 6–9).',
  name_too_short: 'Please enter at least 2 characters for your name.',
  flood_guard: 'Slow down a moment — you are sending messages too quickly.',
  fanout_cap: 'You have started too many new conversations in the last minute.',
  peer_key_missing: 'This contact has not published a device key yet.',
  too_large: 'That file is too large.',
  payload_too_large: 'That file is too large.',
  invalid_image: 'That image could not be read.',
  transcode_failed: 'That image could not be processed.',
};

export function humanError(err) {
  if (!err) return '';
  const code = err.data?.error || err.message;
  const copy = ERROR_COPY[code];
  if (!copy) return code;
  if (code === 'wrong_code' && err.data?.attemptsLeft != null) {
    return `${copy} ${err.data.attemptsLeft} attempt${err.data.attemptsLeft === 1 ? '' : 's'} left.`;
  }
  return copy;
}
