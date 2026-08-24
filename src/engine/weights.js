/**
 * weights.js — one configuration object, read from data/config.json.
 *
 * Nothing else in the engine or the UI may name a weight. If you want a build
 * that drafts more reactively, raise `counter` here (or in config.json) and
 * every screen follows, because every screen reads the same numbers.
 */

export const DEFAULT_WEIGHTS = {
  pick: {
    meta: 0.20,
    counter: 0.25,
    synergy: 0.20,
    roleFit: 0.15,
    comfort: 0.10,
    flexibility: 0.10
  },
  ban: {
    meta: 0.20,
    enemyThreat: 0.25,
    counterRisk: 0.23,
    rankPopularity: 0.13,
    comfortRisk: 0.10,
    flexibility: 0.09
  },
  composition: {
    need: 0.12
  }
};

/** Human labels for the score breakdown panel. */
export const COMPONENT_LABELS = {
  meta: 'Meta',
  counter: 'Counter',
  synergy: 'Synergy',
  roleFit: 'Role fit',
  comfort: 'Comfort',
  flexibility: 'Flexibility',
  need: 'Team need',
  enemyThreat: 'Enemy threat',
  counterRisk: 'Counter risk',
  rankPopularity: 'Rank popularity',
  comfortRisk: 'Comfort risk'
};

function merge(base, override) {
  const out = { ...base };
  Object.entries(override || {}).forEach(([key, value]) => {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) out[key] = value;
  });
  return out;
}

/** Resolves the active weights: config.json wins, defaults fill the gaps. */
export function resolveWeights(config) {
  const configured = (config && config.weights) || {};
  return {
    pick: merge(DEFAULT_WEIGHTS.pick, configured.pick),
    ban: merge(DEFAULT_WEIGHTS.ban, configured.ban),
    composition: merge(DEFAULT_WEIGHTS.composition, configured.composition)
  };
}

/** Weighted mean of 0-100 components. Normalising by the weight sum is what
 *  lets a coach edit one weight without re-deriving the whole scale. */
export function weightedScore(components, weights) {
  let total = 0;
  let sum = 0;
  Object.entries(weights).forEach(([key, weight]) => {
    if (typeof components[key] !== 'number' || !weight) return;
    total += components[key] * weight;
    sum += weight;
  });
  return sum > 0 ? total / sum : 0;
}

/**
 * Each component's contribution to the final score, in points, biggest first.
 * This is what the "Why?" breakdown renders — the same numbers the ranking used.
 */
export function contributions(components, weights) {
  let sum = 0;
  Object.entries(weights).forEach(([key, weight]) => {
    if (typeof components[key] === 'number' && weight) sum += weight;
  });
  if (sum <= 0) return [];
  return Object.entries(weights)
    .filter(([key, weight]) => typeof components[key] === 'number' && weight)
    .map(([key, weight]) => ({
      id: key,
      label: COMPONENT_LABELS[key] || key,
      value: components[key],
      points: (components[key] * weight) / sum
    }))
    .sort((a, b) => b.points - a.points);
}
