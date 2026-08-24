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
 * Lane assignment for a locked set. Least-flexible heroes claim first, so flex
 * picks absorb whatever is left — the order a coach reasons in.
 */
export function assignLanes(registry, heroes) {
  const lanes = registry.config.lanes;
  const assigned = new Map();
  const unplaced = [];

  heroes
    .slice()
    .sort((a, b) => a.lanes.length - b.lanes.length)
    .forEach((hero) => {
      const target = hero.lanes.find((lane) => !assigned.has(lane));
      if (target) assigned.set(target, hero);
      else unplaced.push(hero);
    });

  const rows = lanes.map((lane) => ({
    laneId: lane.id,
    label: lane.label,
    short: lane.short,
    hero: assigned.get(lane.id) || null
  }));

  return {
    rows,
    unplaced,
    empty: rows.filter((r) => !r.hero).map((r) => r.label),
    valid: rows.every((r) => r.hero) && unplaced.length === 0
  };
}
