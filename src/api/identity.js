/**
 * identity.js — deciding which registry hero an API record refers to.
 *
 * The provisional-hero mechanism exists so a hero released after this build
 * shipped is still draftable. Its failure mode is that it cannot, on its own,
 * tell these two apart:
 *
 *   "this is a hero I have never seen"        → add it
 *   "this is a hero whose name changed"       → do NOT add it; it already exists
 *
 * Get that wrong and the safety net manufactures the exact problem it exists to
 * prevent: two entries for one hero, one carrying the live statistics and one
 * carrying the curated tags. So identity is resolved in four passes, strongest
 * evidence first, and a hero can only be claimed once.
 *
 *   1. stable numeric id   rename-proof, and the reason ids are remembered
 *   2. exact name / alias  slug-normalised, so punctuation drift is free
 *   3. similarity guard    near-miss to an unclaimed hero → a rename
 *   4. provisional         genuinely unrecognised → add it
 *
 * The upstream numeric id is not in the bundled data (this build has never seen
 * a live response), so it is *learned*: every match by name records the id it
 * saw, and every later refresh matches on it first. One successful load is
 * enough to make the app rename-proof from then on.
 */

import { slug } from './normalizer.js';

/**
 * Levenshtein distance, capped. Cheap enough at this size — the guard runs only
 * against heroes nothing else claimed, which is normally zero rows.
 */
function distance(a, b) {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;

  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j += 1) prev[j] = j;

  for (let i = 1; i <= m; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    const swap = prev;
    prev = curr;
    curr = swap;
  }
  return prev[n];
}

/** 0..1, where 1 is identical. Operates on slugs, so casing and punctuation are already gone. */
export function similarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const longest = Math.max(a.length, b.length);
  return 1 - distance(a, b) / longest;
}

/**
 * Is this near-miss close enough to call a rename?
 *
 * Short names are deliberately excluded from the fuzzy path. "Sun" and "Sup"
 * score 0.67 on a ratio that means nothing at three characters, and a false
 * rename is worse than a false new hero: it binds the wrong statistics to a
 * hero the player will actually draft.
 */
const MIN_FUZZY_LENGTH = 5;
const RENAME_THRESHOLD = 0.72;

export function looksLikeRename(candidate, existing) {
  if (!candidate || !existing) return false;
  if (candidate.length < MIN_FUZZY_LENGTH || existing.length < MIN_FUZZY_LENGTH) return false;

  // A name gaining or losing a trailing word ("X.Borg" → "X Borg Reborn") is a
  // prefix relationship, not an edit-distance one.
  //
  // Prefix specifically, not containment: "hilda" is a substring of "mathilda"
  // and those are two different heroes on the live roster. Plain containment
  // would let an unmatched Hilda row claim Mathilda's slot and bind her
  // statistics to the wrong hero — the precise failure this guard exists to
  // stop, reintroduced one layer up.
  if (candidate.startsWith(existing) || existing.startsWith(candidate)) return true;

  return similarity(candidate, existing) >= RENAME_THRESHOLD;
}

function indexHeroes(heroes) {
  const bySlug = new Map();
  heroes.forEach((hero) => {
    const keys = [hero.name, hero.id].concat(hero.aliases || []);
    keys.forEach((key) => {
      const k = slug(key);
      if (k && !bySlug.has(k)) bySlug.set(k, hero);
    });
  });
  return bySlug;
}

/**
 * @param {Array} rows       normalized API rows ({ apiId, name, slug, ... })
 * @param {Array} heroes     the registry
 * @param {object} knownIds  heroId -> apiId, learned on earlier loads
 * @returns {{
 *   matched: Map<string, object>,
 *   renames: Array<{heroId, from, to, score}>,
 *   provisional: Array<object>,
 *   missed: string[],
 *   learned: object,
 *   conflicts: string[]
 * }}
 */
export function resolveIdentities(rows, heroes, knownIds = {}) {
  const bySlug = indexHeroes(heroes);
  const byApiId = new Map();
  Object.entries(knownIds || {}).forEach(([heroId, apiId]) => {
    if (apiId != null) byApiId.set(String(apiId), heroId);
  });
  // Ids baked into the data file win over anything learned at runtime.
  heroes.forEach((hero) => {
    if (hero.apiId != null) byApiId.set(String(hero.apiId), hero.id);
  });

  const byId = new Map(heroes.map((h) => [h.id, h]));
  const matched = new Map();
  const claimed = new Set();
  const renames = [];
  const conflicts = [];
  const learned = { ...knownIds };
  let pending = rows.slice();

  const claim = (hero, row) => {
    matched.set(hero.id, row);
    claimed.add(hero.id);
    if (row.apiId != null) learned[hero.id] = row.apiId;
  };

  // Pass 1 — stable numeric id.
  pending = pending.filter((row) => {
    if (row.apiId == null) return true;
    const heroId = byApiId.get(String(row.apiId));
    if (!heroId || claimed.has(heroId)) return true;
    const hero = byId.get(heroId);
    if (!hero) return true;

    // A remembered id that disagrees with an exact name match is stale — the
    // upstream renumbered, or we learned it from a payload that has since
    // changed. An exact name is the stronger evidence, so defer to pass 2 and
    // let the id be re-learned there.
    const exact = bySlug.get(row.slug);
    if (exact && exact.id !== heroId) {
      conflicts.push(
        `Remembered id ${row.apiId} pointed at ${hero.name}, but the source calls it "${row.name}" — re-learning.`
      );
      return true;
    }

    claim(hero, row);
    return false;
  });

  // Pass 2 — exact name, id or alias, slug-normalised.
  pending = pending.filter((row) => {
    const hero = bySlug.get(row.slug);
    if (!hero || claimed.has(hero.id)) return true;
    claim(hero, row);
    return false;
  });

  // Pass 3 — the similarity guard. Only heroes nothing has claimed are
  // eligible, so this can never steal a hero that already matched cleanly.
  pending = pending.filter((row) => {
    let best = null;
    let bestScore = 0;
    heroes.forEach((hero) => {
      if (claimed.has(hero.id)) return;
      const candidates = [hero.name, hero.id].concat(hero.aliases || []).map(slug);
      candidates.forEach((candidate) => {
        if (!looksLikeRename(row.slug, candidate)) return;
        const score = similarity(row.slug, candidate);
        if (score > bestScore) {
          bestScore = score;
          best = hero;
        }
      });
    });
    if (!best) return true;
    renames.push({ heroId: best.id, from: best.name, to: row.name, score: bestScore });
    claim(best, row);
    return false;
  });

  // Pass 4 — everything left is genuinely unrecognised.
  return {
    matched,
    renames,
    provisional: pending,
    missed: heroes.filter((hero) => !claimed.has(hero.id)).map((hero) => hero.name),
    learned,
    conflicts
  };
}
