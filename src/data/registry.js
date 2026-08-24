/**
 * registry.js — the canonical hero registry and everything indexed off it.
 *
 * One rule governs this file: a hero is never hidden because a field is
 * missing. Optional data (portrait, live win rate, counter rows) is decoration.
 * The registry's job is to guarantee that every hero the game has is present,
 * searchable and selectable, and to say out loud — via `diagnostics` — what it
 * could not fill in.
 *
 * Load order:
 *   bundled JSON  →  validate + index  →  (optional) live layer merged on top
 * The app is fully usable after step two. Step three only ever improves numbers
 * and portraits, and can fail without consequence.
 */

import { slug, joinToRegistry } from '../api/normalizer.js';

const FILES = {
  heroes: 'heroes.json',
  meta: 'meta.json',
  counters: 'counters.json',
  synergies: 'synergies.json',
  ranks: 'ranks.json',
  config: 'config.json'
};

/** Stats every hero must have to be scoreable. Missing ones are filled, not fatal. */
const STAT_KEYS = ['early', 'late', 'damage', 'survivability', 'cc', 'push', 'coordination'];
const STAT_DEFAULT = 55;

function dataUrl(name, base) {
  return `${base}${name}`;
}

async function loadJson(url) {
  let response;
  try {
    response = await fetch(url, { cache: 'no-cache' });
  } catch (cause) {
    throw new Error(
      `Could not read ${url}. Opening index.html straight from disk will not work — ` +
        `browsers block module and fetch access on file:// URLs. Serve the folder over HTTP.`
    );
  }
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}.`);
  try {
    return await response.json();
  } catch (cause) {
    throw new Error(`${url} is not valid JSON. Check for a trailing comma.`);
  }
}

function pairKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/* ------------------------------------------------------------- validation */

/**
 * Two severities, and the difference is the whole point.
 *   fatal   — the app cannot draft (no heroes, no lanes, no draft format).
 *   warning — something is incomplete. Reported, repaired with a default, and
 *             the hero stays in the pool.
 */
function validate(heroes, config, counters, synergies) {
  const fatal = [];
  const warnings = [];

  if (!Array.isArray(heroes) || heroes.length === 0) {
    fatal.push('heroes.json contains no heroes.');
    return { fatal, warnings };
  }

  const laneIds = new Set((config.lanes || []).map((l) => l.id));
  if (laneIds.size === 0) fatal.push('config.json defines no lanes.');
  if (!config.draftFormats || !Object.keys(config.draftFormats).length) {
    fatal.push('config.json defines no draft formats.');
  }

  const byId = new Map();
  const bySlug = new Map();

  heroes.forEach((hero, index) => {
    if (!hero.id) {
      warnings.push(`Hero at index ${index} has no id — generated one from its name.`);
      hero.id = slug(hero.name) || `hero-${index}`;
    }
    if (!hero.name) {
      warnings.push(`Hero "${hero.id}" has no name — showing its id instead.`);
      hero.name = hero.id;
    }
    if (byId.has(hero.id)) {
      warnings.push(`Duplicate hero id "${hero.id}" — kept the first, dropped the second.`);
      hero.duplicate = true;
      return;
    }
    byId.set(hero.id, hero);

    const key = slug(hero.name);
    if (bySlug.has(key)) {
      warnings.push(`Two heroes share the display name "${hero.name}".`);
    } else {
      bySlug.set(key, hero);
    }

    if (!Array.isArray(hero.lanes) || hero.lanes.length === 0) {
      warnings.push(`Hero "${hero.name}" has no lane data — it will show under every lane filter.`);
      hero.lanes = [];
    } else {
      const unknown = hero.lanes.filter((lane) => !laneIds.has(lane));
      if (unknown.length) {
        warnings.push(`Hero "${hero.name}" lists unknown lane(s): ${unknown.join(', ')}.`);
        hero.lanes = hero.lanes.filter((lane) => laneIds.has(lane));
      }
    }

    if (!Array.isArray(hero.classes) || hero.classes.length === 0) {
      warnings.push(`Hero "${hero.name}" has no role — treated as Fighter for scoring.`);
      hero.classes = ['Fighter'];
    }
    if (!Array.isArray(hero.tags)) hero.tags = [];
    if (!Array.isArray(hero.aliases)) hero.aliases = [];
    if (typeof hero.meta !== 'number') {
      warnings.push(`Hero "${hero.name}" has no meta score — defaulted to 60.`);
      hero.meta = 60;
    }
    if (typeof hero.difficulty !== 'number') hero.difficulty = 3;
    if (!hero.status) hero.status = 'active';

    if (!hero.stats || typeof hero.stats !== 'object') hero.stats = {};
    const gaps = STAT_KEYS.filter((key) => typeof hero.stats[key] !== 'number');
    if (gaps.length) {
      warnings.push(`Hero "${hero.name}" is missing stats: ${gaps.join(', ')} — defaulted.`);
      gaps.forEach((key) => {
        hero.stats[key] = STAT_DEFAULT;
      });
    }
    if (!hero.portrait) hero.missingPortrait = true;
  });

  const known = new Set(byId.keys());
  (counters.heroCounters || []).forEach((row) => {
    if (!known.has(row.hero) || !known.has(row.against)) {
      warnings.push(`counters.json names an unknown hero: ${row.hero} vs ${row.against} — rule ignored.`);
    }
  });
  (synergies.heroSynergies || []).forEach((row) => {
    const [a, b] = row.pair || [];
    if (!known.has(a) || !known.has(b)) {
      warnings.push(`synergies.json names an unknown hero: ${a} + ${b} — rule ignored.`);
    }
  });

  const noPortrait = heroes.filter((h) => h.missingPortrait).length;
  const noCounterRule = heroes.filter(
    (h) => !(counters.heroCounters || []).some((r) => r.hero === h.id || r.against === h.id)
  ).length;

  return {
    fatal,
    warnings,
    summary: {
      heroes: byId.size,
      missingPortraits: noPortrait,
      withoutNamedCounterRule: noCounterRule
    }
  };
}

/* ----------------------------------------------------------------- indexes */

function buildIndexes(heroes, counters, synergies, config) {
  const byId = new Map(heroes.map((h) => [h.id, h]));

  const heroCounterMap = new Map();
  const counteredByMap = new Map();
  (counters.heroCounters || []).forEach((row) => {
    if (!byId.has(row.hero) || !byId.has(row.against)) return;
    if (!heroCounterMap.has(row.hero)) heroCounterMap.set(row.hero, []);
    heroCounterMap.get(row.hero).push(row);
    if (!counteredByMap.has(row.against)) counteredByMap.set(row.against, []);
    counteredByMap.get(row.against).push(row);
  });

  const heroSynergyMap = new Map();
  (synergies.heroSynergies || []).forEach((row) => {
    const [a, b] = row.pair || [];
    if (!byId.has(a) || !byId.has(b)) return;
    heroSynergyMap.set(pairKey(a, b), row);
  });

  const tagCounterMap = new Map();
  (counters.tagCounters || []).forEach((row) => {
    if (!tagCounterMap.has(row.counter)) tagCounterMap.set(row.counter, []);
    tagCounterMap.get(row.counter).push(row);
  });

  const classCounterMap = new Map();
  (counters.classCounters || []).forEach((row) => {
    if (!classCounterMap.has(row.counter)) classCounterMap.set(row.counter, []);
    classCounterMap.get(row.counter).push(row);
  });

  const tagSynergyMap = new Map();
  (synergies.tagSynergies || []).forEach((row) => {
    [[row.a, row.b], [row.b, row.a]].forEach(([from, to]) => {
      if (!tagSynergyMap.has(from)) tagSynergyMap.set(from, []);
      tagSynergyMap.get(from).push({ other: to, weight: row.weight, reason: row.reason });
    });
  });

  const heroesByLane = new Map();
  (config.lanes || []).forEach((lane) => {
    heroesByLane.set(lane.id, heroes.filter((h) => h.lanes.includes(lane.id)));
  });

  // Prebuilt search haystack: name + id + aliases + roles + lanes + tags, all
  // slugged. Search is then one indexOf per hero, which is why it can run on
  // every keystroke without a worker.
  const searchIndex = new Map();
  heroes.forEach((hero) => {
    const parts = [hero.name, hero.id]
      .concat(hero.aliases || [])
      .concat(hero.classes || [])
      .concat(hero.lanes || [])
      .concat((hero.tags || []).map((t) => t.replace(/-/g, ' ')));
    searchIndex.set(hero.id, {
      name: slug(hero.name),
      all: parts.map(slug).filter(Boolean).join(' ')
    });
  });

  return {
    byId,
    heroesByLane,
    heroCounterMap,
    counteredByMap,
    heroSynergyMap,
    tagCounterMap,
    tagSynergyMap,
    classCounterMap,
    searchIndex
  };
}

/* ------------------------------------------------------------------- load */

/**
 * Loads and indexes every bundled data file.
 * @param {string} base directory the JSON lives in, relative to index.html
 */
export async function loadRegistry(base = 'data/') {
  const [heroesFile, meta, counters, synergies, ranks, config] = await Promise.all(
    ['heroes', 'meta', 'counters', 'synergies', 'ranks', 'config'].map((name) =>
      loadJson(dataUrl(FILES[name], base))
    )
  );

  const heroes = (heroesFile.heroes || []).map((hero) => ({ ...hero, stats: { ...hero.stats } }));
  const report = validate(heroes, config, counters, synergies);
  if (report.fatal.length) {
    throw new Error(`Data problems found:\n• ${report.fatal.join('\n• ')}`);
  }

  const live = heroes.filter((h) => !h.duplicate).sort((a, b) => a.name.localeCompare(b.name));

  return {
    heroes: live,
    ...buildIndexes(live, counters, synergies, config),
    config,
    ranks,
    meta,
    counters,
    synergies,
    patch: heroesFile.patch || meta.patch || 'unknown',
    patchDate: heroesFile.patchDate || meta.patchDate || '',
    pairKey,
    diagnostics: {
      warnings: report.warnings,
      summary: report.summary,
      source: 'bundled',
      generatedAt: heroesFile.generated || null
    },
    /** Live layer, replaced by applyLiveLayer(). */
    liveStats: new Map(),
    dataStatus: {
      source: 'bundled',
      label: meta.sourceLabel || 'Bundled dataset',
      live: false,
      rank: null,
      updatedAt: heroesFile.patchDate || null,
      detail: 'Bundled dataset — live statistics not requested yet.'
    }
  };
}

/* -------------------------------------------------------------- live merge */

/**
 * Folds a normalized live layer onto the registry.
 *
 * Portraits and per-rank rates are written onto a side map, never over the
 * bundled hero object, so a bad live payload can be dropped by reloading rather
 * than by clearing storage. Heroes the API knows and we do not are appended as
 * provisional entries — a hero released after this build shipped is still
 * draftable, just without curated tags.
 */
export function applyLiveLayer(registry, { rankRows = [], heroRows = [], rankId, apiRank, status }) {
  const stats = new Map();
  const notes = [];

  const joinRank = joinToRegistry(rankRows, registry.heroes);
  joinRank.matched.forEach((row, heroId) => {
    stats.set(heroId, {
      pickRate: row.pickRate,
      banRate: row.banRate,
      winRate: row.winRate,
      portrait: row.portrait || null
    });
  });

  const joinHeroes = joinToRegistry(heroRows, registry.heroes);
  joinHeroes.matched.forEach((row, heroId) => {
    const existing = stats.get(heroId) || {};
    if (!existing.portrait && row.portrait) existing.portrait = row.portrait;
    stats.set(heroId, existing);
  });

  // Heroes the source knows that this build does not.
  const knownNew = new Map();
  [...joinRank.unmatched, ...joinHeroes.unmatched].forEach((row) => {
    if (knownNew.has(row.slug)) return;
    knownNew.set(row.slug, row);
  });

  const added = [];
  knownNew.forEach((row) => {
    const id = row.slug;
    if (registry.byId.has(id)) return;
    const hero = {
      id,
      name: row.name,
      aliases: [],
      classes: ['Fighter'],
      roles: ['fighter'],
      lanes: [],
      tags: [],
      difficulty: 3,
      meta: 60,
      portrait: row.portrait || '',
      status: 'provisional',
      releaseVersion: '',
      stats: STAT_KEYS.reduce((acc, key) => ({ ...acc, [key]: STAT_DEFAULT }), {})
    };
    registry.heroes.push(hero);
    registry.byId.set(id, hero);
    registry.searchIndex.set(id, { name: slug(hero.name), all: slug(hero.name) });
    if (row.pickRate != null || row.winRate != null || row.banRate != null) {
      stats.set(id, { pickRate: row.pickRate, banRate: row.banRate, winRate: row.winRate });
    }
    added.push(hero.name);
  });

  if (added.length) {
    registry.heroes.sort((a, b) => a.name.localeCompare(b.name));
    notes.push(
      `${added.length} hero${added.length === 1 ? '' : 'es'} came from the live source and are not in the ` +
        `bundled data yet (${added.join(', ')}). They are selectable, with default ratings.`
    );
  }
  if (joinRank.missed.length && rankRows.length) {
    notes.push(
      `${joinRank.missed.length} hero${joinRank.missed.length === 1 ? '' : 'es'} had no live statistics for ` +
        `this rank — they keep their bundled meta score.`
    );
  }

  registry.liveStats = stats;
  registry.liveRank = rankId || null;
  registry.dataStatus = status;
  registry.diagnostics.live = { notes, matched: stats.size, added };
  return registry;
}

export { pairKey, slug };
