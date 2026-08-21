/**
 * data.js — loads and indexes the JSON data layer.
 *
 * Everything the recommendation engine knows about the game comes from
 * data/*.json. No hero, tag or matchup is ever named in code.
 */

const FILES = {
  heroes: 'heroes.json',
  matchups: 'matchups.json',
  config: 'config.json'
};

/** @type {object|null} */
let cache = null;

async function loadJson(path) {
  let response;
  try {
    response = await fetch(path, { cache: 'no-cache' });
  } catch (cause) {
    throw new Error(
      `Could not read ${path}. If you opened index.html directly from disk, ` +
      `serve the folder over HTTP instead — browsers block module and fetch ` +
      `access on file:// URLs.`
    );
  }
  if (!response.ok) {
    throw new Error(`${path} returned HTTP ${response.status}.`);
  }
  try {
    return await response.json();
  } catch (cause) {
    throw new Error(`${path} is not valid JSON. Check for a trailing comma.`);
  }
}

function validate(heroesFile, matchups, config) {
  const problems = [];

  if (!Array.isArray(heroesFile.heroes) || heroesFile.heroes.length === 0) {
    problems.push('heroes.json has no "heroes" array.');
  }
  const laneIds = new Set((config.lanes || []).map((l) => l.id));
  if (laneIds.size === 0) problems.push('config.json has no lanes.');

  const seen = new Set();
  (heroesFile.heroes || []).forEach((hero, i) => {
    if (!hero.id) problems.push(`Hero at index ${i} has no id.`);
    if (seen.has(hero.id)) problems.push(`Duplicate hero id "${hero.id}".`);
    seen.add(hero.id);
    if (!Array.isArray(hero.lanes) || hero.lanes.length === 0) {
      problems.push(`Hero "${hero.id}" has no lanes.`);
    } else {
      hero.lanes.forEach((lane) => {
        if (!laneIds.has(lane)) {
          problems.push(`Hero "${hero.id}" uses unknown lane "${lane}".`);
        }
      });
    }
  });

  const steps = config.draftFormat && config.draftFormat.steps;
  if (!Array.isArray(steps) || steps.length === 0) {
    problems.push('config.json has no draftFormat.steps.');
  }

  const knownIds = seen;
  (matchups.heroCounters || []).forEach((row) => {
    if (!knownIds.has(row.hero) || !knownIds.has(row.against)) {
      problems.push(`heroCounters row references an unknown hero: ${row.hero} vs ${row.against}.`);
    }
  });
  (matchups.heroSynergies || []).forEach((row) => {
    const [a, b] = row.pair || [];
    if (!knownIds.has(a) || !knownIds.has(b)) {
      problems.push(`heroSynergies row references an unknown hero: ${a} + ${b}.`);
    }
  });

  return problems;
}

function pairKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function buildIndex(heroesFile, matchups, config) {
  const heroes = heroesFile.heroes.slice().sort((a, b) => a.name.localeCompare(b.name));
  const byId = new Map(heroes.map((h) => [h.id, h]));

  // hero id -> [{ against, weight, reason }]
  const heroCounterMap = new Map();
  // hero id -> [{ counteredBy, weight, reason }]  (reverse view)
  const counteredByMap = new Map();
  (matchups.heroCounters || []).forEach((row) => {
    if (!byId.has(row.hero) || !byId.has(row.against)) return;
    if (!heroCounterMap.has(row.hero)) heroCounterMap.set(row.hero, []);
    heroCounterMap.get(row.hero).push(row);
    if (!counteredByMap.has(row.against)) counteredByMap.set(row.against, []);
    counteredByMap.get(row.against).push(row);
  });

  const heroSynergyMap = new Map();
  (matchups.heroSynergies || []).forEach((row) => {
    const [a, b] = row.pair || [];
    if (!byId.has(a) || !byId.has(b)) return;
    heroSynergyMap.set(pairKey(a, b), row);
  });

  // tag -> rules, for O(tags) lookup instead of scanning every rule.
  const tagCounterMap = new Map();
  (matchups.tagCounters || []).forEach((row) => {
    if (!tagCounterMap.has(row.counter)) tagCounterMap.set(row.counter, []);
    tagCounterMap.get(row.counter).push(row);
  });

  const tagSynergyMap = new Map();
  (matchups.tagSynergies || []).forEach((row) => {
    [[row.a, row.b], [row.b, row.a]].forEach(([from, to]) => {
      if (!tagSynergyMap.has(from)) tagSynergyMap.set(from, []);
      tagSynergyMap.get(from).push({ other: to, weight: row.weight, reason: row.reason });
    });
  });

  const classCounterMap = new Map();
  (matchups.classCounters || []).forEach((row) => {
    if (!classCounterMap.has(row.counter)) classCounterMap.set(row.counter, []);
    classCounterMap.get(row.counter).push(row);
  });

  const heroesByLane = new Map();
  (config.lanes || []).forEach((lane) => {
    heroesByLane.set(lane.id, heroes.filter((h) => h.lanes.includes(lane.id)));
  });

  return {
    patch: heroesFile.patch || 'unknown',
    patchDate: heroesFile.patchDate || '',
    heroes,
    byId,
    heroesByLane,
    heroCounterMap,
    counteredByMap,
    heroSynergyMap,
    tagCounterMap,
    tagSynergyMap,
    classCounterMap,
    config,
    pairKey
  };
}

/** Loads every data file once and returns the indexed dataset. */
export async function loadData() {
  if (cache) return cache;

  const [heroesFile, matchups, config] = await Promise.all([
    loadJson(FILES.heroes),
    loadJson(FILES.matchups),
    loadJson(FILES.config)
  ]);

  const problems = validate(heroesFile, matchups, config);
  if (problems.length) {
    throw new Error(`Data problems found:\n• ${problems.slice(0, 8).join('\n• ')}`);
  }

  cache = buildIndex(heroesFile, matchups, config);
  return cache;
}

export { pairKey };
