import {
  generateKeyPair,
  exportPublicJwk,
  exportPrivateJwk,
  importKeyPair,
  importPublicJwk,
} from './crypto/e2ee.js';
import { api } from './api.js';

/**
 * Device identity keys.
 *
 * Stored per user id in sessionStorage — per tab, so two tabs are two devices.
 * This is a prototype-grade keystore: it is NOT hardware-backed, it is wiped
 * when the tab closes, and old ciphertext becomes unreadable once that happens.
 * The production plan is StrongBox/Android Keystore with a passkey-wrapped
 * backup, which is not what runs here.
 */
const privKey = (userId) => `bharatchat.priv.${userId}`;
const pubKey = (userId) => `bharatchat.pub.${userId}`;

export async function ensureIdentity(userId) {
  const storedPriv = sessionStorage.getItem(privKey(userId));
  const storedPub = sessionStorage.getItem(pubKey(userId));

  if (storedPriv && storedPub) {
    const pair = await importKeyPair(JSON.parse(storedPriv), JSON.parse(storedPub));
    return { ...pair, jwk: JSON.parse(storedPub), fresh: false };
  }

  const generated = await generateKeyPair();
  const publicJwk = await exportPublicJwk(generated);
  const privateJwk = await exportPrivateJwk(generated);
  sessionStorage.setItem(privKey(userId), JSON.stringify(privateJwk));
  sessionStorage.setItem(pubKey(userId), JSON.stringify(publicJwk));

  // Publish only the public half. The server never sees the private key.
  await api.publishKey(publicJwk);

  return { privateKey: generated.privateKey, publicKey: generated.publicKey, jwk: publicJwk, fresh: true };
}

export function forgetIdentity(userId) {
  sessionStorage.removeItem(privKey(userId));
  sessionStorage.removeItem(pubKey(userId));
}

export function peerKeyCache() {
  const cache = new Map();
  return async (jwk) => {
    const id = `${jwk.x}:${jwk.y}`;
    if (!cache.has(id)) cache.set(id, await importPublicJwk(jwk));
    return cache.get(id);
  };
}
