/**
 * strength.js — the seven-dimension draft strength meter.
 *
 * A team's value on a dimension is the mean of its locked heroes' ratings for
 * that dimension. Team Coordination additionally absorbs a bonus for realised
 * synergy pairs, because coordination is a property of the combination rather
 * than of any single hero.
 */

import { getSelections } from './state.js';
import { synergyPoints } from './recommender.js';

// A full five-hero draft routinely accumulates 100+ raw synergy points, so the
// divisor is set high enough that the bonus separates good combinations from
// great ones instead of saturating for every complete draft.
const MAX_SYNERGY_BONUS = 12;
const SYNERGY_DIVISOR = 14;

function clamp(value, lo = 0, hi = 100) {
  return Math.max(lo, Math.min(hi, value));
}

/** Total realised synergy points among a set of locked heroes. */
export function synergyTotal(data, heroes) {
  let total = 0;
  const pairs = [];
  for (let i = 0; i < heroes.length; i += 1) {
    for (let j = i + 1; j < heroes.length; j += 1) {
      const out = synergyPoints(data, heroes[i], heroes[j]);
      if (out.total <= 0) continue;
      total += out.total;
      const top = out.reasons.sort((a, b) => b.weight - a.weight)[0];
      pairs.push({
        heroes: [heroes[i], heroes[j]],
        weight: out.total,
        reason: top ? top.text.replace(/\s*\(with [^)]+\)$/, '') : 'Complementary kits'
      });
    }
  }
  pairs.sort((a, b) => b.weight - a.weight);
  return { total, pairs };
}

/**
 * @returns {{ team:string, locked:number, slots:number, dimensions:Array, synergy:object }}
 */
export function teamStrength(data, team) {
  const dimensions = data.config.strength.dimensions;
  const heroes = getSelections(team, 'pick').map((id) => data.byId.get(id));
  const synergy = synergyTotal(data, heroes);

  const values = dimensions.map((dim) => {
    if (heroes.length === 0) return { ...dim, value: 0 };
    let value = heroes.reduce((sum, h) => sum + h.stats[dim.id], 0) / heroes.length;
    if (dim.id === 'coordination') {
      value += Math.min(MAX_SYNERGY_BONUS, synergy.total / SYNERGY_DIVISOR);
    }
    return { ...dim, value: Math.round(clamp(value)) };
  });

  return {
    team,
    locked: heroes.length,
    heroes,
    dimensions: values,
    synergy
  };
}

/** Side-by-side comparison used by the meter UI. */
export function compareStrength(data) {
  const blue = teamStrength(data, 'blue');
  const red = teamStrength(data, 'red');
  const rows = blue.dimensions.map((dim, i) => ({
    id: dim.id,
    label: dim.label,
    blue: dim.value,
    red: red.dimensions[i].value,
    edge: dim.value === red.dimensions[i].value ? null : dim.value > red.dimensions[i].value ? 'blue' : 'red'
  }));
  return { blue, red, rows };
}

/** Dimensions above/below the configured thresholds, for strategy text. */
export function profileHighlights(data, strength) {
  const { strongDimension, weakDimension } = data.config.thresholds;
  return {
    strong: strength.dimensions.filter((d) => d.value >= strongDimension),
    weak: strength.dimensions.filter((d) => d.value > 0 && d.value <= weakDimension)
  };
}
