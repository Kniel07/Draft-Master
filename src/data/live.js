/**
 * live.js — the one place that decides what the data badge says.
 *
 * Rule from the brief, taken literally: do not claim the data is live if it is
 * actually cached. Every path through here produces a status object with an
 * honest `label`, `live` flag and `updatedAt`, and the UI renders that verbatim
 * rather than guessing.
 */

import { fetchHeroList, fetchRankStats, isOffline } from '../api/mlbb-api.js';
import { normalizeHeroList, normalizeRankStats } from '../api/normalizer.js';
import { readSetting, writeSetting } from '../api/cache.js';
import { applyLiveLayer } from './registry.js';

/**
 * heroId -> upstream numeric id, learned from whichever load first identified
 * the hero by name. Persisted as a setting rather than a cache entry: it has no
 * useful expiry, and it is what makes every subsequent load rename-proof.
 */
const ID_MAP_KEY = 'api-hero-ids';

function readKnownIds() {
  const stored = readSetting(ID_MAP_KEY, {});
  return stored && typeof stored === 'object' ? stored : {};
}

function persistKnownIds(registry) {
  const learned = registry.learnedApiIds;
  if (learned && Object.keys(learned).length) writeSetting(ID_MAP_KEY, learned);
}

function tierFor(registry, rankId) {
  const tiers = (registry.ranks && registry.ranks.tiers) || [];
  return tiers.find((t) => t.id === rankId) || tiers.find((t) => t.id === registry.ranks.default) || null;
}

function formatDate(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function bundledStatus(registry, detail) {
  return {
    source: 'bundled',
    label: registry.meta.sourceLabel || 'Bundled dataset',
    live: false,
    rank: null,
    rankExact: false,
    patch: registry.patch,
    updatedAt: registry.patchDate,
    updatedLabel: formatDate(registry.patchDate),
    detail
  };
}

/**
 * Pulls the hero list and the rank statistics, merges them, and returns the
 * status to display. Never rejects: a failure resolves to a bundled status.
 *
 * @param {object} registry
 * @param {string} rankId one of the ids in ranks.json
 */
export async function refreshLive(registry, rankId) {
  const tier = tierFor(registry, rankId);
  const apiRank = tier ? tier.apiRank : 'all';

  let heroList = { ok: false };
  let rankStats = { ok: false };
  try {
    [heroList, rankStats] = await Promise.all([fetchHeroList(), fetchRankStats(apiRank, 7)]);
  } catch (cause) {
    // Promise.all cannot reject here — the API layer resolves failures — but a
    // host environment without fetch can still throw on import-time shims.
    heroList = { ok: false };
    rankStats = { ok: false };
  }

  if (!heroList.ok && !rankStats.ok) {
    const status = bundledStatus(
      registry,
      isOffline()
        ? 'Live data unavailable — using the bundled dataset.'
        : 'Live data not reachable — using the bundled dataset.'
    );
    applyLiveLayer(registry, {
      rankRows: [],
      heroRows: [],
      rankId,
      apiRank,
      knownIds: readKnownIds(),
      status
    });
    return status;
  }

  const heroRows = heroList.ok ? normalizeHeroList(heroList.value).rows : [];
  const rankParsed = rankStats.ok ? normalizeRankStats(rankStats.value) : { rows: [], withStats: 0 };

  const fromCache =
    (rankStats.ok && rankStats.source === 'cache') || (!rankStats.ok && heroList.source === 'cache');
  const storedAt = rankStats.storedAt || heroList.storedAt || Date.now();

  const status = {
    source: fromCache ? 'cache' : 'live',
    label: fromCache ? 'Cached public data' : 'Live public data',
    live: !fromCache,
    rank: tier ? tier.label : null,
    rankExact: tier ? tier.exact !== false : false,
    rankNote: tier && tier.exact === false ? tier.fallbackNote : null,
    patch: registry.patch,
    updatedAt: new Date(storedAt).toISOString(),
    updatedLabel: formatDate(storedAt),
    detail: fromCache
      ? `Cached ${rankParsed.withStats ? 'rank statistics' : 'hero list'} — the source did not answer this time.`
      : `${rankParsed.withStats} heroes with ${tier ? tier.label : 'overall'} pick, ban and win rates.`,
    matched: rankParsed.withStats,
    attribution: registry.config.api && registry.config.api.attribution
  };

  applyLiveLayer(registry, {
    rankRows: rankParsed.rows,
    heroRows,
    rankId,
    apiRank,
    knownIds: readKnownIds(),
    status
  });
  persistKnownIds(registry);
  return status;
}

export { formatDate };
