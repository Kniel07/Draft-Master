/**
 * composition.js — what a set of locked heroes actually is.
 *
 * Feeds three consumers: the strength meter, the "team need" nudge in pick
 * scoring, and the pre-game brief. One implementation so all three agree.
 */

import { synergyTotal } from './synergy.js';
import { clamp } from './counter.js';

// A full five-hero draft accumulates 100+ raw synergy points, so the divisor is
// set high enough that the coordination bonus separates good combinations from
// great ones instead of pinning every complete draft at the top.
const MAX_SYNERGY_BONUS = 12;
const SYNERGY_DIVISOR = 14;

export function dimensions(registry) {
  return registry.config.strength.dimensions;
}

/** Mean rating per dimension, plus a coordination bonus for realised synergy. */
export function profile(registry, heroes) {
  const dims = dimensions(registry);
  const synergy = synergyTotal(registry, heroes);
  const values = {};

  dims.forEach((dim) => {
    if (!heroes.length) {
      values[dim.id] = 0;
      return;
    }
    let value = heroes.reduce((sum, h) => sum + (h.stats[dim.id] || 0), 0) / heroes.length;
    if (dim.id === 'coordination') {
      value += Math.min(MAX_SYNERGY_BONUS, synergy.total / SYNERGY_DIVISOR);
    }
    values[dim.id] = Math.round(clamp(value));
  });

  return { values, synergy, locked: heroes.length, heroes };
}

/**
 * The "team need" component: how well this hero covers the dimensions the draft
 * is currently thinnest in. 50 when the draft has no gaps worth naming.
 */
export function needComponent(registry, hero, comp) {
  const dims = dimensions(registry);
  const { strongDimension } = registry.config.thresholds;

  const deficits = dims
    .map((dim) => ({ id: dim.id, label: dim.label, gap: strongDimension - (comp.values[dim.id] || 0) }))
    .filter((d) => d.gap > 8);

  if (!comp.locked || deficits.length === 0) return { score: 50, reason: null };

  const totalGap = deficits.reduce((sum, d) => sum + d.gap, 0);
  const score = clamp(
    deficits.reduce((sum, d) => sum + (hero.stats[d.id] || 0) * (d.gap / totalGap), 0)
  );

  const biggest = deficits.slice().sort((a, b) => b.gap - a.gap)[0];
  const reason =
    (hero.stats[biggest.id] || 0) >= strongDimension
      ? { weight: 10, text: `Covers the draft's thinnest area: ${biggest.label.toLowerCase()}` }
      : null;

  return { score, reason };
}

/** Side-by-side rows for the tug-of-war meter. */
export function compare(registry, ourHeroes, theirHeroes) {
  const dims = dimensions(registry);
  const us = profile(registry, ourHeroes);
  const them = profile(registry, theirHeroes);
  const rows = dims.map((dim) => {
    const a = us.values[dim.id];
    const b = them.values[dim.id];
    return {
      id: dim.id,
      label: dim.label,
      short: dim.short || dim.label,
      us: a,
      them: b,
      edge: a === b ? null : a > b ? 'us' : 'them'
    };
  });
  return { us, them, rows };
}

/** Dimensions above/below the configured thresholds — the brief's raw material. */
export function highlights(registry, comp) {
  const dims = dimensions(registry);
  const { strongDimension, weakDimension } = registry.config.thresholds;
  return {
    strong: dims.filter((d) => comp.values[d.id] >= strongDimension).map((d) => ({ ...d, value: comp.values[d.id] })),
    weak: dims
      .filter((d) => comp.values[d.id] > 0 && comp.values[d.id] <= weakDimension)
      .map((d) => ({ ...d, value: comp.values[d.id] }))
  };
}

/**
 * Who is playing which lane.
 *
 * Three sources of truth, in this order, and the order is the whole point:
 *
 *   1. what the player explicitly assigned   — authoritative
 *   2. what the draft state implies          — greedy natural fit
 *   3. what the hero's role data suggests    — informs, never overrides
 *
 * The previous version had only (3), which meant an intentional off-role pick
 * was reported as a missing lane: assign Belerick to EXP and the brief said
 * "EXP — not covered" while flagging a role conflict for whoever lost Roam. The
 * app was reinterpreting the draft instead of reading it.
 *
 * So a hero on the board is now always playing somewhere. A lane comes back
 * empty only when there are genuinely fewer heroes than lanes — that is, the
 * draft is not finished. An unusual pairing is reported as unorthodox, which is
 * information; it is never reported as invalid.
 *
 * @param {object} registry
 * @param {Array}  heroes    the locked picks for one side
 * @param {object} explicit  heroId -> laneId, set by the player
 */
/** Every lane a hero is actually drafted into: the game's classification plus meta flex. */
function playable(hero) {
  return hero.playableLanes || hero.lanes || [];
}

export function assignLanes(registry, heroes, explicit = {}) {
  const lanes = registry.config.lanes;
  const laneIds = lanes.map((l) => l.id);
  const assigned = new Map();
  const placed = new Set();

  // 1. Explicit assignments claim their lane first, orthodox or not.
  heroes.forEach((hero) => {
    const laneId = explicit[hero.id];
    if (!laneId || !laneIds.includes(laneId) || assigned.has(laneId)) return;
    assigned.set(laneId, { hero, source: 'explicit' });
    placed.add(hero.id);
  });

  // 2. Natural fit for the rest — least flexible first, so flex picks absorb
  //    whatever is left. The order a coach reasons in.
  heroes
    .filter((hero) => !placed.has(hero.id))
    .slice()
    .sort((a, b) => playable(a).length - playable(b).length)
    .forEach((hero) => {
      const target = playable(hero).find((lane) => !assigned.has(lane));
      if (!target) return;
      assigned.set(target, { hero, source: 'natural' });
      placed.add(hero.id);
    });

  // 3. Anyone left has no lane their role data likes. They are still in the
  //    game, so they go in whatever is free rather than being dropped and
  //    leaving a phantom hole in the plan.
  const free = laneIds.filter((id) => !assigned.has(id));
  heroes
    .filter((hero) => !placed.has(hero.id))
    .forEach((hero, index) => {
      const laneId = free[index];
      if (!laneId) return;
      assigned.set(laneId, { hero, source: 'inferred' });
      placed.add(hero.id);
    });

  const rows = lanes.map((lane) => {
    const entry = assigned.get(lane.id) || null;
    const hero = entry ? entry.hero : null;
    return {
      laneId: lane.id,
      label: lane.label,
      short: lane.short,
      hero,
      source: entry ? entry.source : null,
      // A property of the pairing, not of how we arrived at it: an explicit
      // off-role assignment and an inferred one are equally unorthodox, and
      // equally valid. A hero with no lane data at all is neither.
      unorthodox: Boolean(hero && playable(hero).length && !playable(hero).includes(lane.id)),
      knownLanes: hero ? playable(hero) : []
    };
  });

  const overflow = heroes.filter((hero) => !placed.has(hero.id));

  return {
    rows,
    overflow,
    unorthodox: rows.filter((row) => row.unorthodox),
    empty: rows.filter((row) => !row.hero).map((row) => row.label),
    valid: rows.every((row) => row.hero) && overflow.length === 0
  };
}

/** Prose for one unorthodox pairing, used by the brief and the lane picker. */
export function describeUnorthodox(registry, row) {
  const known = row.knownLanes
    .map((id) => {
      const lane = registry.config.lanes.find((l) => l.id === id);
      return lane ? lane.label : id;
    })
    .join(' / ');
  return `${row.hero.name} is primarily classified as ${known}, but is assigned to ${row.label}.`;
}
