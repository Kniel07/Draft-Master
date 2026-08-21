/**
 * recommender.js — weighted scoring for pick and ban suggestions.
 *
 * Evaluation order (per the approved spec):
 *   1. Availability      hard filter — banned/picked heroes never score
 *   2. Role compatibility does this hero fill a lane we still need?
 *   3. Counter            what it beats, minus what beats it
 *   4. Synergy            with heroes already locked on our side
 *   5. Comfort            is it on a rostered player's list?
 *   6. Meta               Official Server priority for the loaded patch
 *
 * Every component is normalised to 0-100 before weighting so that retuning a
 * weight in config.json has a predictable effect. Each component also emits a
 * short reason string; the top contributors become the displayed explanation.
 */

import { getSelections, getUnavailable, getComfortIds, getComfortLanes, getOpenLanes } from './state.js';

const NEUTRAL = 50;
const SCALE = 1.6; // raw matchup points -> 0-100 curve

function clamp(value, lo = 0, hi = 100) {
  return Math.max(lo, Math.min(hi, value));
}

function normalise(raw) {
  return clamp(raw * SCALE);
}

function unique(list) {
  return Array.from(new Set(list));
}

/* ------------------------------------------------------- matchup primitives */

/** Raw counter points that `hero` applies to `target`, with reasons. */
function counterPoints(data, hero, target) {
  let total = 0;
  const reasons = [];

  const named = (data.heroCounterMap.get(hero.id) || []).filter((r) => r.against === target.id);
  named.forEach((row) => {
    total += row.weight;
    reasons.push({ weight: row.weight, text: `${row.reason} (vs ${target.name})` });
  });

  hero.tags.forEach((tag) => {
    (data.tagCounterMap.get(tag) || []).forEach((row) => {
      if (!target.tags.includes(row.against)) return;
      total += row.weight;
      reasons.push({ weight: row.weight, text: `${row.reason} (vs ${target.name})` });
    });
  });

  hero.classes.forEach((cls) => {
    (data.classCounterMap.get(cls) || []).forEach((row) => {
      if (!target.classes.includes(row.against)) return;
      total += row.weight;
      reasons.push({ weight: row.weight, text: `${row.reason} (vs ${target.name})` });
    });
  });

  return { total, reasons };
}

/** Raw synergy points between two heroes on the same side, with reasons. */
function synergyPoints(data, hero, ally) {
  let total = 0;
  const reasons = [];

  const named = data.heroSynergyMap.get(data.pairKey(hero.id, ally.id));
  if (named) {
    total += named.weight;
    reasons.push({ weight: named.weight, text: `${named.reason} (with ${ally.name})` });
  }

  const counted = new Set();
  hero.tags.forEach((tag) => {
    (data.tagSynergyMap.get(tag) || []).forEach((row) => {
      if (!ally.tags.includes(row.other)) return;
      const key = `${row.reason}|${ally.id}`;
      if (counted.has(key)) return;
      counted.add(key);
      total += row.weight;
      reasons.push({ weight: row.weight, text: `${row.reason} (with ${ally.name})` });
    });
  });

  return { total, reasons };
}

/* --------------------------------------------------------------- components */

function roleComponent(hero, openLanes) {
  if (openLanes.length === 0) {
    return { score: NEUTRAL, reason: null };
  }
  const fits = hero.lanes.filter((lane) => openLanes.includes(lane));
  if (fits.length === 0) {
    return { score: 20, reason: null };
  }
  const flexBonus = Math.min(10, (hero.lanes.length - 1) * 5);
  return {
    score: clamp(90 + flexBonus),
    reason: { weight: 14, text: `Fills the open ${fits.map(laneLabel).join(' / ')} slot` }
  };
}

function laneLabel(id) {
  return id === 'gold' ? 'Gold Lane' : id === 'exp' ? 'EXP Lane' : id.charAt(0).toUpperCase() + id.slice(1);
}

function counterComponent(data, hero, enemyPicks) {
  if (enemyPicks.length === 0) return { score: NEUTRAL, reasons: [], applied: 0, risk: 0 };

  let applied = 0;
  let risk = 0;
  const reasons = [];

  enemyPicks.forEach((enemy) => {
    const out = counterPoints(data, hero, enemy);
    applied += out.total;
    reasons.push(...out.reasons);
    risk += counterPoints(data, enemy, hero).total;
  });

  const score = clamp(NEUTRAL + (normalise(applied) - normalise(risk)) / 2);
  return { score, reasons, applied, risk };
}

function synergyComponent(data, hero, allyPicks) {
  if (allyPicks.length === 0) return { score: NEUTRAL, reasons: [], total: 0 };

  let total = 0;
  const reasons = [];
  allyPicks.forEach((ally) => {
    const out = synergyPoints(data, hero, ally);
    total += out.total;
    reasons.push(...out.reasons);
  });

  return { score: normalise(total), reasons, total };
}

function comfortComponent(hero, comfortIds, team, roster, lanes) {
  if (comfortIds.size === 0) return { score: 40, reason: null };
  if (!comfortIds.has(hero.id)) return { score: 30, reason: null };

  const laneIds = getComfortLanes(team, hero.id);
  const names = laneIds
    .map((laneId) => roster[team][laneId].player.trim())
    .filter(Boolean);
  const who = names.length ? names.join(' / ') : laneIds.map(laneLabel).join(' / ');
  return {
    score: 100,
    reason: { weight: 12, text: `Comfort pick for ${who}` }
  };
}

function needComponent(hero, profile, thresholds, dimensions) {
  const deficits = dimensions
    .map((dim) => ({ id: dim.id, label: dim.label, gap: thresholds.strongDimension - (profile[dim.id] || 0) }))
    .filter((d) => d.gap > 8);

  if (deficits.length === 0) return { score: NEUTRAL, reason: null };

  const totalGap = deficits.reduce((sum, d) => sum + d.gap, 0);
  const score = clamp(
    deficits.reduce((sum, d) => sum + (hero.stats[d.id] || 0) * (d.gap / totalGap), 0)
  );

  const biggest = deficits.slice().sort((a, b) => b.gap - a.gap)[0];
  const reason =
    hero.stats[biggest.id] >= thresholds.strongDimension
      ? { weight: 10, text: `Covers the draft's thinnest area: ${biggest.label.toLowerCase()}` }
      : null;

  return { score, reason };
}

/* -------------------------------------------------------------- public API */

/**
 * Ranked pick suggestions for `team`.
 * @returns {Array<{hero, total, components, reasons:string[]}>}
 */
export function recommendPicks(data, snapshot, team, limit = 6) {
  const weights = data.config.weights.pick;
  const thresholds = data.config.thresholds;
  const dimensions = data.config.strength.dimensions;
  const enemy = team === 'blue' ? 'red' : 'blue';

  const unavailable = getUnavailable();
  const allyPicks = getSelections(team, 'pick').map((id) => data.byId.get(id));
  const enemyPicks = getSelections(enemy, 'pick').map((id) => data.byId.get(id));
  const openLanes = getOpenLanes(team, data);
  const comfortIds = getComfortIds(team);

  const profile = {};
  dimensions.forEach((dim) => {
    profile[dim.id] = allyPicks.length
      ? allyPicks.reduce((sum, h) => sum + h.stats[dim.id], 0) / allyPicks.length
      : 0;
  });

  const weightSum = Object.values(weights).reduce((a, b) => a + b, 0);

  const scored = data.heroes
    .filter((hero) => !unavailable.has(hero.id))
    .map((hero) => {
      const role = roleComponent(hero, openLanes);
      const counter = counterComponent(data, hero, enemyPicks);
      const synergy = synergyComponent(data, hero, allyPicks);
      const comfort = comfortComponent(hero, comfortIds, team, snapshot.roster, data.config.lanes);
      const need = needComponent(hero, profile, thresholds, dimensions);
      const meta = clamp(hero.meta);

      const total =
        (meta * weights.meta +
          role.score * weights.role +
          counter.score * weights.counter +
          synergy.score * weights.synergy +
          comfort.score * weights.comfort +
          need.score * weights.need) /
        weightSum;

      const reasons = [
        role.reason,
        comfort.reason,
        need.reason,
        ...counter.reasons,
        ...synergy.reasons
      ].filter(Boolean);

      if (meta >= 80) {
        reasons.push({ weight: 9, text: `High Official Server priority this patch` });
      }
      if (counter.risk > 20 && counter.applied < counter.risk) {
        reasons.push({ weight: 8, text: `Warning: the enemy draft already answers this hero` });
      }

      return {
        hero,
        total,
        components: {
          meta,
          role: role.score,
          counter: counter.score,
          synergy: synergy.score,
          comfort: comfort.score,
          need: need.score
        },
        reasons: unique(
          reasons.sort((a, b) => b.weight - a.weight).map((r) => r.text)
        ).slice(0, 3)
      };
    });

  scored.sort((a, b) => b.total - a.total || a.hero.name.localeCompare(b.hero.name));
  return scored.slice(0, limit);
}

/**
 * Ranked ban suggestions for `team` — heroes most dangerous if left open.
 */
export function recommendBans(data, snapshot, team, limit = 6) {
  const weights = data.config.weights.ban;
  const enemy = team === 'blue' ? 'red' : 'blue';

  const unavailable = getUnavailable();
  const ourPicks = getSelections(team, 'pick').map((id) => data.byId.get(id));
  const enemyPicks = getSelections(enemy, 'pick').map((id) => data.byId.get(id));
  const enemyComfort = getComfortIds(enemy);

  const weightSum = Object.values(weights).reduce((a, b) => a + b, 0);

  const scored = data.heroes
    .filter((hero) => !unavailable.has(hero.id))
    .map((hero) => {
      const reasons = [];

      // Threat = what this hero does to us, plus what it adds to their comp.
      let threatRaw = 0;
      ourPicks.forEach((ours) => {
        const out = counterPoints(data, hero, ours);
        threatRaw += out.total;
        reasons.push(...out.reasons);
      });
      enemyPicks.forEach((ally) => {
        const out = synergyPoints(data, hero, ally);
        threatRaw += out.total * 0.8;
        reasons.push(...out.reasons.map((r) => ({ weight: r.weight * 0.8, text: r.text })));
      });
      const threat = ourPicks.length || enemyPicks.length ? normalise(threatRaw) : NEUTRAL;

      const comfortHit = enemyComfort.has(hero.id);
      if (comfortHit) {
        reasons.push({ weight: 15, text: 'On the opponent roster\u2019s comfort list' });
      }
      const comfortScore = enemyComfort.size === 0 ? 40 : comfortHit ? 100 : 25;

      const flex = clamp((hero.lanes.length / 3) * 100);
      if (hero.lanes.length >= 3) {
        reasons.push({ weight: 8, text: 'Flexible across three roles — hard to read in draft' });
      }
      if (hero.meta >= 82) {
        reasons.push({ weight: 11, text: 'Top-priority hero on the current patch' });
      }

      const total =
        (hero.meta * weights.meta +
          threat * weights.threat +
          comfortScore * weights.enemyComfort +
          flex * weights.flex) /
        weightSum;

      return {
        hero,
        total,
        components: { meta: hero.meta, threat, comfort: comfortScore, flex },
        reasons: unique(reasons.sort((a, b) => b.weight - a.weight).map((r) => r.text)).slice(0, 3)
      };
    });

  scored.sort((a, b) => b.total - a.total || a.hero.name.localeCompare(b.hero.name));
  return scored.slice(0, limit);
}

/** Best remaining partner for a hero already locked, used by the synergy panel. */
export function bestSynergyFor(data, hero, availableHeroes, limit = 3) {
  return availableHeroes
    .map((candidate) => {
      const out = synergyPoints(data, candidate, hero);
      return { hero: candidate, total: out.total, reason: out.reasons.sort((a, b) => b.weight - a.weight)[0] };
    })
    .filter((row) => row.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
}

export { counterPoints, synergyPoints };
