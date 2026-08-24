/**
 * counter.js — what a hero beats, and what beats it.
 *
 * Three layers, all additive, all carrying their own explanation:
 *   named pairs   heroCounters rows, the precise stuff
 *   tag rules     complete coverage from ~30 rules instead of a 133x133 matrix
 *   class rules   archetype pressure (assassin into marksman, and so on)
 *
 * A rule and its `reason` string are written together in the data file, which is
 * the mechanism that stops the displayed explanation from drifting away from the
 * arithmetic that produced the ranking.
 */

export function clamp(value, lo = 0, hi = 100) {
  return Math.max(lo, Math.min(hi, value));
}

/** Raw counter points `hero` applies to `target`, with reasons. */
export function counterPoints(registry, hero, target) {
  let total = 0;
  const reasons = [];

  (registry.heroCounterMap.get(hero.id) || []).forEach((row) => {
    if (row.against !== target.id) return;
    total += row.weight;
    reasons.push({ weight: row.weight, text: `${row.reason} (vs ${target.name})`, vs: target.id });
  });

  (hero.tags || []).forEach((tag) => {
    (registry.tagCounterMap.get(tag) || []).forEach((row) => {
      if (!(target.tags || []).includes(row.against)) return;
      total += row.weight;
      reasons.push({ weight: row.weight, text: `${row.reason} (vs ${target.name})`, vs: target.id });
    });
  });

  (hero.classes || []).forEach((cls) => {
    (registry.classCounterMap.get(cls) || []).forEach((row) => {
      if (!(target.classes || []).includes(row.against)) return;
      total += row.weight;
      reasons.push({ weight: row.weight, text: `${row.reason} (vs ${target.name})`, vs: target.id });
    });
  });

  // Live measured deltas, when a relation lookup happened to be cached for this
  // hero. Additive on top of the rules, never a replacement: one endpoint's
  // win-rate delta is thinner evidence than a written matchup rule.
  const measured = registry.measuredCounters && registry.measuredCounters.get(hero.id);
  if (measured && measured.has(target.id)) {
    const delta = measured.get(target.id);
    const points = clamp(delta * 100, -12, 12);
    if (Math.abs(points) >= 1) {
      total += points;
      reasons.push({
        weight: Math.abs(points),
        text: `Measured win-rate edge against ${target.name} at this rank`,
        vs: target.id,
        measured: true
      });
    }
  }

  return { total, reasons };
}

/**
 * The counter component, 0-100 with 50 neutral.
 * Credit for what this hero answers, debit for what answers it — a hero that
 * beats two enemies but is hard-countered by a third should not read as a clean
 * counter pick.
 */
export function counterComponent(registry, hero, enemyPicks, scale) {
  if (!enemyPicks.length) {
    return { score: 50, reasons: [], applied: 0, risk: 0, riskReasons: [] };
  }

  let applied = 0;
  let risk = 0;
  const reasons = [];
  const riskReasons = [];

  enemyPicks.forEach((enemy) => {
    const out = counterPoints(registry, hero, enemy);
    applied += out.total;
    reasons.push(...out.reasons);

    const back = counterPoints(registry, enemy, hero);
    risk += back.total;
    riskReasons.push(
      ...back.reasons.map((r) => ({
        weight: r.weight,
        text: `${enemy.name} answers this pick — ${stripVs(r.text).toLowerCase()}`
      }))
    );
  });

  const norm = (raw) => clamp(raw * scale);
  const score = clamp(50 + (norm(applied) - norm(risk)) / 2);
  return { score, reasons, riskReasons, applied, risk };
}

/** The exposure half on its own — used by ban scoring, which asks the reverse
 *  question: how much does this hero hurt us if it is left open? */
export function threatAgainst(registry, hero, ourPicks, scale) {
  let raw = 0;
  const reasons = [];
  ourPicks.forEach((ours) => {
    const out = counterPoints(registry, hero, ours);
    raw += out.total;
    reasons.push(...out.reasons);
  });
  return { score: ourPicks.length ? clamp(raw * scale) : 50, raw, reasons };
}

export function stripVs(text) {
  return String(text).replace(/\s*\((?:vs|with) [^)]+\)$/, '');
}
