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
    const err = new Error(data?.error || `http_${res.status}`);
    err.status = res.status;
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
    if (!res.ok) throw new Error(`media_${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  },
};
