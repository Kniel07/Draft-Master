/**
 * ranked.js — rank awareness.
 *
 * Two jobs, and the order matters:
 *   1. If the public source gave us real pick/ban/win rates for the selected
 *      rank, build the meta score from those.
 *   2. Otherwise, shape the bundled baseline with the rank curve from
 *      ranks.json — mastery heroes gain priority as the rank climbs, and
 *      pick-up-and-play heroes lose it.
 *
 * The two are never mixed silently: `metaFor` reports which one it used, and the
 * UI says so.
 */

import { clamp } from './counter.js';

export function tierFor(registry, rankId) {
  const tiers = (registry.ranks && registry.ranks.tiers) || [];
  return tiers.find((t) => t.id === rankId) || tiers.find((t) => t.id === registry.ranks.default) || tiers[0] || null;
}

/** Maps a rate onto 0-100 through the span configured in meta.json. */
function rateScore(value, span, centre = 0) {
  if (value == null) return null;
  return clamp(50 + ((value - centre) / span) * 50);
}

/**
 * Meta strength for one hero at one rank.
 * @returns {{score:number, source:'live'|'curve', detail:string, rates?:object}}
 */
export function metaFor(registry, hero, rankId) {
  const tier = tierFor(registry, rankId);
  const blend = (registry.meta && registry.meta.blend) || {};
  const live = registry.liveStats && registry.liveStats.get(hero.id);

  const baseline = curveMeta(registry, hero, tier);

  if (live && (live.winRate != null || live.pickRate != null || live.banRate != null)) {
    const win = rateScore(live.winRate, blend.winRateSpan || 0.12, blend.winRateCentre ?? 0.5);
    const pick = rateScore(live.pickRate, blend.pickRateSpan || 0.06);
    const ban = rateScore(live.banRate, blend.banRateSpan || 0.25);

    const parts = [];
    const weights = blend.weights || { win: 0.45, pick: 0.2, ban: 0.35 };
    if (win != null) parts.push([win, weights.win]);
    if (pick != null) parts.push([pick, weights.pick]);
    if (ban != null) parts.push([ban, weights.ban]);

    if (parts.length) {
      const sum = parts.reduce((acc, [, w]) => acc + w, 0);
      const measured = parts.reduce((acc, [v, w]) => acc + v * w, 0) / sum;
      const mix = blend.liveBlend ?? 0.75;
      return {
        score: clamp(measured * mix + baseline.score * (1 - mix)),
        source: 'live',
        detail: describeRates(live, tier),
        rates: live
      };
    }
  }

  return baseline;
}

function describeRates(live, tier) {
  const bits = [];
  if (live.pickRate != null) bits.push(`${(live.pickRate * 100).toFixed(1)}% pick`);
  if (live.banRate != null) bits.push(`${(live.banRate * 100).toFixed(1)}% ban`);
  if (live.winRate != null) bits.push(`${(live.winRate * 100).toFixed(1)}% win`);
  const where = tier ? ` at ${tier.label}` : '';
  return bits.length ? `${bits.join(' · ')}${where}` : `No measured rates${where}`;
}

/** The fallback model: bundled baseline shaped by mechanical difficulty. */
export function curveMeta(registry, hero, tier) {
  const curve = (registry.ranks && registry.ranks.rankCurve) || {};
  const factor = curve.factor ?? 1.6;
  const maxShift = curve.maxShift ?? 14;
  const weight = tier ? tier.skillWeight || 0 : 0;
  const shift = Math.max(-maxShift, Math.min(maxShift, weight * ((hero.difficulty || 3) - 3) * factor));
  return {
    score: clamp((hero.meta || 60) + shift),
    source: 'curve',
    shift,
    detail:
      shift === 0
        ? 'bundled patch baseline'
        : shift > 0
          ? `bundled baseline, lifted ${Math.round(shift)} for a high-skill hero at this rank`
          : `bundled baseline, cut ${Math.abs(Math.round(shift))} for a low-skill-ceiling hero at this rank`
  };
}

/** How contested this hero is at the selected rank — the ban-side popularity term. */
export function popularityFor(registry, hero, rankId) {
  const live = registry.liveStats && registry.liveStats.get(hero.id);
  const blend = (registry.meta && registry.meta.blend) || {};
  if (live && (live.banRate != null || live.pickRate != null)) {
    const ban = rateScore(live.banRate, blend.banRateSpan || 0.25);
    const pick = rateScore(live.pickRate, blend.pickRateSpan || 0.06);
    const parts = [ban, pick].filter((v) => v != null);
    return {
      score: parts.reduce((a, b) => a + b, 0) / parts.length,
      source: 'live',
      detail: describeRates(live, tierFor(registry, rankId))
    };
  }
  const curve = curveMeta(registry, hero, tierFor(registry, rankId));
  return { score: curve.score, source: 'curve', detail: 'bundled priority baseline for this patch' };
}
