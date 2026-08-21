/**
 * storage.js — persistence for the team roster and comfort picks.
 *
 * localStorage is used when available so a team's comfort list survives a
 * refresh between games. Some embedded/sandboxed browser contexts block it,
 * so every call falls back to an in-memory map rather than throwing.
 */

const PREFIX = 'mlbb-draft-room:';
const memory = new Map();

let available = false;
try {
  const probe = `${PREFIX}probe`;
  window.localStorage.setItem(probe, '1');
  window.localStorage.removeItem(probe);
  available = true;
} catch (cause) {
  available = false;
}

export const isPersistent = available;

export function read(key, fallback) {
  const full = PREFIX + key;
  try {
    const raw = available ? window.localStorage.getItem(full) : memory.get(full);
    if (raw == null) return fallback;
    return JSON.parse(raw);
  } catch (cause) {
    console.warn(`Could not read "${key}" from storage; using default.`, cause);
    return fallback;
  }
}

export function write(key, value) {
  const full = PREFIX + key;
  const raw = JSON.stringify(value);
  try {
    if (available) window.localStorage.setItem(full, raw);
    else memory.set(full, raw);
    return true;
  } catch (cause) {
    console.warn(`Could not save "${key}".`, cause);
    memory.set(full, raw);
    return false;
  }
}

export function clear(key) {
  const full = PREFIX + key;
  try {
    if (available) window.localStorage.removeItem(full);
  } catch (cause) {
    console.warn(`Could not clear "${key}".`, cause);
  }
  memory.delete(full);
}
