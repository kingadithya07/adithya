import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

/**
 * Tiny JSON-file store. Deliberately single-process and synchronous-on-write:
 * this is a prototype slice, not the ScyllaDB tier described in the blueprint.
 * Writes are atomic (tmp file + rename) so a crash cannot truncate the store.
 */
class JsonStore {
  constructor(name, fallback) {
    this.file = path.join(DATA_DIR, name);
    this.data = readJson(this.file, fallback);
    this.timer = null;
  }

  save() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.saveNow();
    }, 50);
  }

  saveNow() {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }
}

const usersStore = new JsonStore('users.json', { users: [] });
const messagesStore = new JsonStore('messages.json', { messages: [] });
const otpStore = new JsonStore('otp.json', { pending: {} });
const mediaStore = new JsonStore('media.json', { blobs: {} });

const MAX_MESSAGES = 20000;

export const db = {
  users: usersStore.data.users,
  messages: messagesStore.data.messages,
  pendingOtps: otpStore.data.pending,
  blobs: mediaStore.data.blobs,

  persistUsers: () => usersStore.save(),
  persistMedia: () => mediaStore.save(),

  persistOtp: () => otpStore.save(),

  persistMessages() {
    if (this.messages.length > MAX_MESSAGES) {
      this.messages.splice(0, this.messages.length - MAX_MESSAGES);
    }
    messagesStore.save();
  },

  findUserById(id) {
    return this.users.find((u) => u.id === id);
  },

  findUserByPhone(phone) {
    return this.users.find((u) => u.phone === phone);
  },

  upsertUser(user) {
    const idx = this.users.findIndex((u) => u.id === user.id);
    if (idx >= 0) this.users[idx] = user;
    else this.users.push(user);
    this.persistUsers();
    return user;
  },

  publicUser(user) {
    if (!user) return null;
    return {
      id: user.id,
      name: user.name,
      about: user.about,
      phoneMasked: `+91 •••••${user.phone.slice(-5)}`,
      avatarUrl: user.avatar ? `/api/media/${user.avatar.id}?v=${user.avatar.updatedAt}` : null,
      avatarPreview: user.avatar?.preview || null,
      publicKey: user.publicKey || null,
      lastSeen: user.lastSeen || null,
      createdAt: user.createdAt,
    };
  },
};

export function flushAll() {
  usersStore.saveNow();
  messagesStore.saveNow();
  otpStore.saveNow();
  mediaStore.saveNow();
}
