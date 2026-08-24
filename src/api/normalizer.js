/**
 * normalizer.js — turns whatever the public API returns into our schema.
 *
 * The upstream payload is a proxied game-server response: deeply nested, with
 * key names that have changed at least once already (`main_heroid` vs
 * `hero_id`, `appearance_rate` vs `pick_rate`). Parsing it by a fixed path is
 * how an app breaks silently the day the upstream shifts a field.
 *
 * So nothing here walks a hardcoded path. Each extractor searches the record
 * for a value that *looks* like the thing it wants — a numeric hero id, a
 * display name, a rate between 0 and 1, an image URL — and reports what it
 * could not find. A record that yields no name is dropped and counted; a record
 * missing only its portrait is kept, because a hero must never disappear over a
 * missing optional field.
 */

const ID_KEYS = /(^|_)(hero_?id|heroid|_id|id)$/i;
const NAME_KEYS = /^(name|hero_?name|title)$/i;
const IMAGE_KEYS = /^(head|headbig|head_big|smallmap|square|portrait|image|icon|avatar)$/i;
const WIN_KEYS = /win_rate|winrate/i;
const BAN_KEYS = /ban_rate|banrate/i;
const PICK_KEYS = /appearance_rate|pick_rate|pickrate|use_rate/i;
const DELTA_KEYS = /increase_win_rate|win_rate_increase|hero_win_rate|increase/i;

const MAX_DEPTH = 8;

/** Every [key, value] pair in a nested object, breadth-first, depth-capped. */
function* walk(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > MAX_DEPTH) return;
  if (Array.isArray(node)) {
    for (const item of node) yield* walk(item, depth + 1);
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    yield [key, value, depth];
    if (value && typeof value === 'object') yield* walk(value, depth + 1);
  }
}

function findNumber(node, pattern, { max = Infinity, min = -Infinity } = {}) {
  let best = null;
  let bestDepth = Infinity;
  for (const [key, value, depth] of walk(node)) {
    if (!pattern.test(key)) continue;
    if (value == null || typeof value === 'boolean') continue;
    if (typeof value !== 'number' && !(typeof value === 'string' && value.trim())) continue;
    const num = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(num) || num > max || num < min) continue;
    if (depth < bestDepth) {
      best = num;
      bestDepth = depth;
    }
  }
  return best;
}

function findString(node, pattern, validate) {
  let best = null;
  let bestDepth = Infinity;
  for (const [key, value, depth] of walk(node)) {
    if (!pattern.test(key)) continue;
    if (typeof value !== 'string' || !value.trim()) continue;
    if (validate && !validate(value)) continue;
    if (depth < bestDepth) {
      best = value.trim();
      bestDepth = depth;
    }
  }
  return best;
}

/** Rates arrive as fractions upstream; some mirrors send whole percentages. */
function asFraction(value) {
  if (value == null || !Number.isFinite(value)) return null;
  if (value < 0) return null;
  if (value > 1.5) return value / 100;
  return value;
}

/** Pulls the record array out of any of the wrapper shapes seen in the wild. */
export function extractRecords(body) {
  if (!body) return [];
  if (Array.isArray(body)) return body;
  const candidates = [
    body.data && body.data.records,
    body.records,
    body.data && body.data.data,
    body.data,
    body.results,
    body.items
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

/**
 * Search key for a hero name: lowercase, alphanumerics only. Makes "X.Borg"
 * findable as "xborg" and "Yi Sun-shin" as "yisunshin", which is what a player
 * types on a phone keyboard.
 */
export function slug(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

/** One hero from the hero-list endpoint. */
function readHero(record) {
  const name = findString(record, NAME_KEYS);
  if (!name) return null;
  return {
    apiId: findNumber(record, ID_KEYS, { min: 1 }),
    name,
    slug: slug(name),
    portrait: findString(record, IMAGE_KEYS, (v) => /^https?:\/\//i.test(v))
  };
}

/** One hero from the rank-statistics endpoint. */
function readRankRow(record) {
  const name = findString(record, NAME_KEYS);
  if (!name) return null;
  return {
    apiId: findNumber(record, ID_KEYS, { min: 1 }),
    name,
    slug: slug(name),
    portrait: findString(record, IMAGE_KEYS, (v) => /^https?:\/\//i.test(v)),
    winRate: asFraction(findNumber(record, WIN_KEYS, { min: 0, max: 100 })),
    banRate: asFraction(findNumber(record, BAN_KEYS, { min: 0, max: 100 })),
    pickRate: asFraction(findNumber(record, PICK_KEYS, { min: 0, max: 100 }))
  };
}

function normalizeWith(body, reader) {
  const records = extractRecords(body);
  const rows = [];
  const seen = new Set();
  let dropped = 0;
  let duplicates = 0;

  records.forEach((record) => {
    const row = reader(record);
    if (!row) {
      dropped += 1;
      return;
    }
    if (seen.has(row.slug)) {
      duplicates += 1;
      return;
    }
    seen.add(row.slug);
    rows.push(row);
  });

  return { rows, dropped, duplicates, total: records.length };
}

export function normalizeHeroList(body) {
  return normalizeWith(body, readHero);
}

export function normalizeRankStats(body) {
  const out = normalizeWith(body, readRankRow);
  out.withStats = out.rows.filter((r) => r.winRate != null || r.pickRate != null || r.banRate != null).length;
  return out;
}

/** Counter / compatibility rows: a partner hero plus a win-rate delta. */
export function normalizeRelations(body) {
  const records = extractRecords(body);
  const rows = [];
  records.forEach((record) => {
    const name = findString(record, NAME_KEYS);
    if (!name) return;
    const delta = findNumber(record, DELTA_KEYS, { min: -100, max: 100 });
    rows.push({
      apiId: findNumber(record, ID_KEYS, { min: 1 }),
      name,
      slug: slug(name),
      delta: delta == null ? null : Math.abs(delta) > 1.5 ? delta / 100 : delta
    });
  });
  return { rows, total: records.length };
}

/**
 * Joins normalized API rows onto the local registry by name.
 * @returns {{matched:Map<string,object>, unmatched:object[], missed:string[]}}
 *   `unmatched` are heroes the API knows and we do not — a new release. They are
 *   surfaced, never dropped. `missed` are our heroes the API did not mention.
 */
export function joinToRegistry(rows, heroes) {
  const bySlug = new Map();
  heroes.forEach((hero) => {
    bySlug.set(slug(hero.name), hero);
    bySlug.set(slug(hero.id), hero);
    (hero.aliases || []).forEach((alias) => {
      const key = slug(alias);
      if (key && !bySlug.has(key)) bySlug.set(key, hero);
    });
  });

  const matched = new Map();
  const unmatched = [];

  rows.forEach((row) => {
    const hero = bySlug.get(row.slug);
    if (hero) matched.set(hero.id, row);
    else unmatched.push(row);
  });

  const missed = heroes.filter((hero) => !matched.has(hero.id)).map((hero) => hero.name);
  return { matched, unmatched, missed };
}
