/**
 * synergy.js — how well a hero works with the heroes already locked beside it.
 *
 * Same three-layer shape as counters: named pairs first, then tag pairs. A tag
 * pair fires once per ally per reason, so a hero with three engage tags does not
 * collect the same "initiation lands into area control" credit three times.
 */

import { clamp } from './counter.js';
import { createFact, reasonText, summarisePair, stripQualifier } from './reason.js';

export function synergyPoints(registry, hero, ally) {
  let total = 0;
  const reasons = [];
  if (hero.id === ally.id) return { total, reasons };

  const record = (row, source, effect, mechanism) => {
    const fact = createFact({
      actor: hero,
      target: ally,
      relationship: 'synergy',
      effect,
      source,
      weight: row.weight,
      mechanism
    });
    total += row.weight;
    reasons.push({ weight: row.weight, text: reasonText(fact), with: ally.id, fact });
  };

  const named = registry.heroSynergyMap.get(registry.pairKey(hero.id, ally.id));
  if (named) record(named, 'named', ally.id, named.reason);

  const counted = new Set();
  (hero.tags || []).forEach((tag) => {
    (registry.tagSynergyMap.get(tag) || []).forEach((row) => {
      if (!(ally.tags || []).includes(row.other)) return;
      const key = `${row.reason}|${ally.id}`;
      if (counted.has(key)) return;
      counted.add(key);
      record(row, 'tag', `${tag}+${row.other}`, row.reason);
    });
  });

  const measured = registry.measuredSynergies && registry.measuredSynergies.get(hero.id);
  if (measured && measured.has(ally.id)) {
    const points = clamp(measured.get(ally.id) * 100, -10, 10);
    if (Math.abs(points) >= 1) {
      const fact = createFact({
        actor: hero,
        target: ally,
        relationship: 'synergy',
        effect: 'measured',
        source: 'measured',
        weight: Math.abs(points),
        mechanism: 'A measured win-rate lift at this rank'
      });
      total += points;
      reasons.push({ weight: Math.abs(points), text: reasonText(fact), with: ally.id, measured: true, fact });
    }
  }

  return { total, reasons };
}

/** 0-100, 50 when there is nothing to synergise with yet. */
export function synergyComponent(registry, hero, allyPicks, scale) {
  if (!allyPicks.length) return { score: 50, reasons: [], total: 0 };
  let total = 0;
  const reasons = [];
  allyPicks.forEach((ally) => {
    const out = synergyPoints(registry, hero, ally);
    total += out.total;
    reasons.push(...out.reasons);
  });
  return { score: clamp(total * scale), reasons, total };
}

/** Every realised pair among a locked set — feeds the strength meter and the brief. */
export function synergyTotal(registry, heroes) {
  let total = 0;
  const pairs = [];
  for (let i = 0; i < heroes.length; i += 1) {
    for (let j = i + 1; j < heroes.length; j += 1) {
      const out = synergyPoints(registry, heroes[i], heroes[j]);
      if (out.total <= 0) continue;
      total += out.total;
      const facts = out.reasons.map((r) => r.fact).filter(Boolean);
      const summary = summarisePair(facts);
      pairs.push({
        heroes: [heroes[i], heroes[j]],
        weight: out.total,
        facts,
        summary,
        // Retained for callers that want one clause; it is explicitly the
        // strongest single mechanism, not "the reason the pair won".
        reason: facts.length
          ? stripQualifier(facts.slice().sort((a, b) => b.weight - a.weight)[0].mechanism)
          : 'Complementary kits'
      });
    }
  }
  pairs.sort((a, b) => b.weight - a.weight);
  return { total, pairs };
}

/** Best available partner for a hero already locked. */
export function bestPartners(registry, hero, available, limit = 3) {
  return available
    .map((candidate) => {
      const out = synergyPoints(registry, candidate, hero);
      const top = out.reasons.slice().sort((a, b) => b.weight - a.weight)[0];
      return { hero: candidate, total: out.total, reason: top ? top.fact.mechanism : null, fact: top ? top.fact : null };
    })
    .filter((row) => row.total > 0)
    .sort((a, b) => b.total - a.total || a.hero.name.localeCompare(b.hero.name))
    .slice(0, limit);
}
