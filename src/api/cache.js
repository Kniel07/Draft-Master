/**
 * cache.js — namespaced, versioned, TTL'd storage.
 *
 * Two jobs. It keeps the user's own settings (rank, role, comfort pool, draft
 * mode) across sessions, and it keeps API responses off the network so a draft
 * costs at most a couple of requests. Every path is wrapped: a browser that
 * blocks storage degrades to an in-memory map rather than throwing, because a
 * blocked localStorage must never cost the player a draft.
 */

const PREFIX = 'mlbb-draft:';
const VERSION = 'v2';
const memory = new Map();

/** localStorage if the host has one and permits it, otherwise null. */
function resolveStore() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const key = `${PREFIX}probe`;
    window.localStorage.setItem(key, '1');
    window.localStorage.removeItem(key);
    return window.localStorage;
  } catch (cause) {
    return null;
  }
}

const store = resolveStore();

function probe() {
  return store !== null;
}

export const isPersistent = probe();

function fullKey(key) {
  return `${PREFIX}${VERSION}:${key}`;
}

function rawGet(key) {
  const full = fullKey(key);
  if (!store) return memory.has(full) ? memory.get(full) : null;
  try {
    return store.getItem(full);
  } catch (cause) {
    return memory.has(full) ? memory.get(full) : null;
  }
}

function rawSet(key, raw) {
  const full = fullKey(key);
  memory.set(full, raw);
  if (!store) return false;
  try {
    store.setItem(full, raw);
    return true;
  } catch (cause) {
    // Quota exceeded, or private mode. The memory copy still serves this session.
    return false;
  }
}

/** Plain settings read/write — no expiry. */
export function readSetting(key, fallback) {
  const raw = rawGet(`set:${key}`);
  if (raw == null) return fallback;
  try {
    return JSON.parse(raw);
  } catch (cause) {
    return fallback;
  }
}

export function writeSetting(key, value) {
  try {
    return rawSet(`set:${key}`, JSON.stringify(value));
  } catch (cause) {
    return false;
  }
}

/**
 * Cached API payload.
 * @returns {{value:any, storedAt:number, ageHours:number, stale:boolean}|null}
 *          A stale entry is still returned — serving yesterday's numbers with an
 *          honest label beats serving nothing.
 */
export function readCache(key, maxAgeHours) {
  const raw = rawGet(`api:${key}`);
  if (raw == null) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    return null;
  }
  if (!parsed || typeof parsed.storedAt !== 'number') return null;
  const ageHours = (Date.now() - parsed.storedAt) / 3600000;
  return {
    value: parsed.value,
    storedAt: parsed.storedAt,
    ageHours,
    stale: maxAgeHours != null && ageHours > maxAgeHours
  };
}

export function writeCache(key, value) {
  const storedAt = Date.now();
  const ok = rawSet(`api:${key}`, JSON.stringify({ storedAt, value }));
  return { ok, storedAt };
}

/** Drops every cached API payload but keeps user settings. */
export function clearApiCache() {
  const drop = [];
  try {
    if (!store) throw new Error('no store');
    for (let i = 0; i < store.length; i += 1) {
      const key = store.key(i);
      if (key && key.startsWith(`${PREFIX}${VERSION}:api:`)) drop.push(key);
    }
    drop.forEach((key) => store.removeItem(key));
  } catch (cause) {
    /* storage blocked — the memory map below is the whole cache */
  }
  Array.from(memory.keys())
    .filter((key) => key.includes(':api:'))
    .forEach((key) => memory.delete(key));
  return drop.length;
}
