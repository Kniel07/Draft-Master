/**
 * mlbb-api.js — the public MLBB data source.
 *
 * Source: the api-mobilelegends project (github.com/ridwaanhall/api-mobilelegends).
 * Free, no key, CORS open (`allow_origins: ["*"]`), two interchangeable hosts.
 * Endpoints used, all GET under /api:
 *
 *   /heroes                                  hero list + portrait heads
 *   /heroes/rank?rank=&days=&sort_field=     pick / ban / win rate for a rank tier
 *   /heroes/{id}/counters?rank=              measured counter deltas
 *   /heroes/{id}/compatibility?rank=         measured synergy deltas
 *
 * The project's own guidance is 0-500 requests/day on the standard host, so this
 * client is built to be quiet: two requests fill a whole session, relation calls
 * are opt-in, capped per session and cached for a week, and every response is
 * written to the local cache before it is used.
 *
 * Nothing here throws at the caller. Every function resolves to a result object
 * carrying `ok` and a `source` label so the UI can tell the truth about where a
 * number came from.
 */

import { readCache, writeCache } from './cache.js';

const DEFAULTS = {
  hosts: ['https://openmlbb.fastapicloud.dev', 'https://mlbb.rone.dev'],
  basePath: '/api',
  timeoutMs: 6000
};

let settings = { ...DEFAULTS };
let hostOrder = DEFAULTS.hosts.slice();
let relationBudget = 12;

/** Sessions that have already failed on every host stop trying. */
let offline = false;

export function configureApi(apiConfig = {}) {
  settings = {
    hosts: Array.isArray(apiConfig.hosts) && apiConfig.hosts.length ? apiConfig.hosts : DEFAULTS.hosts,
    basePath: apiConfig.basePath || DEFAULTS.basePath,
    timeoutMs: apiConfig.timeoutMs || DEFAULTS.timeoutMs,
    enabled: apiConfig.enabled !== false,
    cacheHours: apiConfig.cacheHours || { heroes: 72, rank: 12, relations: 168 }
  };
  hostOrder = settings.hosts.slice();
  relationBudget = apiConfig.maxRelationFetchesPerSession ?? 12;
  offline = false;
}

export function isOffline() {
  return offline;
}

function query(params) {
  const usable = Object.entries(params || {}).filter(([, v]) => v != null && v !== '');
  if (!usable.length) return '';
  return `?${usable.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')}`;
}

/**
 * One GET, tried against each host in turn. A host that answers is promoted to
 * the front so the rest of the session goes straight there.
 */
async function get(path, params) {
  if (settings.enabled === false) return { ok: false, reason: 'disabled' };
  if (typeof fetch !== 'function') return { ok: false, reason: 'no-fetch' };

  const suffix = `${settings.basePath}${path}${query(params)}`;
  let lastReason = 'unreachable';

  for (let i = 0; i < hostOrder.length; i += 1) {
    const host = hostOrder[i];
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller
      ? setTimeout(() => controller.abort(), settings.timeoutMs)
      : null;
    try {
      const response = await fetch(host + suffix, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller ? controller.signal : undefined,
        mode: 'cors',
        credentials: 'omit'
      });
      if (timer) clearTimeout(timer);
      if (!response.ok) {
        lastReason = `http-${response.status}`;
        continue;
      }
      const body = await response.json();
      if (i > 0) {
        hostOrder = [host, ...hostOrder.filter((h) => h !== host)];
      }
      return { ok: true, body, host };
    } catch (cause) {
      if (timer) clearTimeout(timer);
      lastReason = cause && cause.name === 'AbortError' ? 'timeout' : 'network';
    }
  }

  offline = true;
  return { ok: false, reason: lastReason };
}

/**
 * Cache-first fetch. Fresh cache short-circuits the network entirely; a stale
 * cache is still handed back if the network then fails, labelled as cached.
 */
async function cached(key, maxAgeHours, run) {
  const hit = readCache(key, maxAgeHours);
  if (hit && !hit.stale) {
    return { ok: true, value: hit.value, source: 'cache', storedAt: hit.storedAt, ageHours: hit.ageHours };
  }

  const fresh = await run();
  if (fresh.ok) {
    const { storedAt } = writeCache(key, fresh.value);
    return { ok: true, value: fresh.value, source: 'live', storedAt, ageHours: 0, host: fresh.host };
  }

  if (hit) {
    return {
      ok: true,
      value: hit.value,
      source: 'cache',
      stale: true,
      storedAt: hit.storedAt,
      ageHours: hit.ageHours,
      reason: fresh.reason
    };
  }
  return { ok: false, source: 'none', reason: fresh.reason };
}

/** Full hero list — ids, display names and portrait URLs. */
export function fetchHeroList() {
  return cached('heroes', settings.cacheHours?.heroes ?? 72, async () => {
    const res = await get('/heroes', { size: 200, index: 1, lang: 'en' });
    return res.ok ? { ok: true, value: res.body, host: res.host } : res;
  });
}

/**
 * Pick / ban / win rate for one rank tier.
 * @param {string} apiRank one of all|epic|legend|mythic|honor|glory
 * @param {number} days    1|3|7|15|30
 */
export function fetchRankStats(apiRank = 'all', days = 7) {
  return cached(`rank:${apiRank}:${days}`, settings.cacheHours?.rank ?? 12, async () => {
    const res = await get('/heroes/rank', {
      days,
      rank: apiRank,
      sort_field: 'pick_rate',
      sort_order: 'desc',
      size: 200,
      index: 1,
      lang: 'en'
    });
    return res.ok ? { ok: true, value: res.body, host: res.host } : res;
  });
}

/**
 * Measured counters for one hero. Opt-in and budgeted: the whole point of the
 * rule-based counter layer is that the app never needs 133 of these.
 */
export function fetchHeroCounters(apiHeroId, apiRank = 'all') {
  if (relationBudget <= 0) return Promise.resolve({ ok: false, source: 'none', reason: 'budget' });
  return cached(`counters:${apiHeroId}:${apiRank}`, settings.cacheHours?.relations ?? 168, async () => {
    relationBudget -= 1;
    const res = await get(`/heroes/${encodeURIComponent(apiHeroId)}/counters`, {
      rank: apiRank,
      days: 7,
      size: 20,
      index: 1,
      lang: 'en'
    });
    return res.ok ? { ok: true, value: res.body, host: res.host } : res;
  });
}

/** Measured synergy partners for one hero. Same budget as counters. */
export function fetchHeroCompatibility(apiHeroId, apiRank = 'all') {
  if (relationBudget <= 0) return Promise.resolve({ ok: false, source: 'none', reason: 'budget' });
  return cached(`compat:${apiHeroId}:${apiRank}`, settings.cacheHours?.relations ?? 168, async () => {
    relationBudget -= 1;
    const res = await get(`/heroes/${encodeURIComponent(apiHeroId)}/compatibility`, {
      rank: apiRank,
      days: 7,
      size: 20,
      index: 1,
      lang: 'en'
    });
    return res.ok ? { ok: true, value: res.body, host: res.host } : res;
  });
}

export function relationBudgetLeft() {
  return relationBudget;
}
