/**
 * recommendation.js — deterministic scoring for picks and bans.
 *
 * No language model decides anything here. Given the same draft state and the
 * same data files, this returns the same ranking every time, and every ranking
 * arrives with the reasons that produced it — not a paraphrase of them, the
 * actual weighted components.
 *
 * Pick score  = meta, counter, synergy, roleFit, comfort, flexibility
 *               (+ a small team-need nudge)
 * Ban score   = meta, enemyThreat, counterRisk, rankPopularity, comfortRisk,
 *               flexibility — a different question, so different components:
 *               "what hurts us if this is left open?"
 *
 * Both return 0-100. Both are advisory. Nothing in this module can commit a
 * hero; it does not import the store's write actions at all.
 */

import { resolveWeights, weightedScore, contributions } from './weights.js';
import { counterComponent, threatAgainst, counterPoints, clamp, stripVs } from './counter.js';
import { synergyComponent, synergyPoints } from './synergy.js';
import { needComponent, profile } from './composition.js';
import { metaFor, popularityFor } from './ranked.js';

const MAX_REASONS = 4;

function laneLabel(registry, laneId) {
  const lane = registry.config.lanes.find((l) => l.id === laneId);
  return lane ? lane.label : laneId;
}

/** Role fit: does this hero answer the slot we still have to fill? */
function roleComponent(registry, hero, openLanes, selectedRole) {
  const playable = hero.playableLanes || hero.lanes || [];
  if (selectedRole) {
    const fits = playable.includes(selectedRole);
    return fits
      ? {
          score: 95,
          reason: { weight: 16, text: `Plays your ${laneLabel(registry, selectedRole)}` }
        }
      : { score: 22, reason: null };
  }
  if (!openLanes.length) return { score: 50, reason: null };

  const fits = playable.filter((lane) => openLanes.includes(lane));
  if (!fits.length) return { score: 20, reason: null };
  return {
    score: 92,
    reason: {
      weight: 14,
      text: `Fills the open ${fits.map((l) => laneLabel(registry, l)).join(' / ')} slot`
    }
  };
}

/** Flexibility: how many lanes this hero can be drafted into. */
function flexComponent(registry, hero) {
  const lanes = (hero.playableLanes || hero.lanes || []).length;
  const laneCount = registry.config.lanes.length;
  const score = clamp((lanes / Math.min(3, laneCount)) * 100);
  return {
    score,
    reason:
      lanes >= 3
        ? { weight: 8, text: 'Flexible across three lanes — hard to read in draft' }
        : lanes === 2
          ? { weight: 5, text: 'Two-lane flex pick' }
          : null
  };
}

/**
 * Comfort, 0-100 from the player's own star rating.
 *
 * Deliberately capped by its weight, not by a special case: a five-star hero
 * contributes at most 10% of the score, so it lifts a close call without ever
 * turning a bad matchup into the top recommendation. That is the balance the
 * brief asks for, and it falls out of the weights rather than being bolted on.
 */
function comfortComponent(hero, comfortIds, ratings) {
  if (!comfortIds.size) return { score: 45, reason: null };
  if (!comfortIds.has(hero.id)) return { score: 30, reason: null };
  const stars = ratings[hero.id] || 3;
  return {
    score: clamp(50 + stars * 10),
    reason: {
      weight: 11,
      text: `${'★'.repeat(stars)}${'☆'.repeat(5 - stars)} on your comfort list`
    }
  };
}

function pickReasons(list) {
  const seen = new Set();
  const out = [];
  list
    .filter(Boolean)
    .sort((a, b) => b.weight - a.weight)
    .forEach((reason) => {
      const text = reason.text;
      if (seen.has(text)) return;
      seen.add(text);
      out.push(text);
    });
  return out.slice(0, MAX_REASONS);
}

/**
 * Ranked pick suggestions.
 *
 * @param {object} registry
 * @param {object} snapshot draft-state snapshot
 * @param {object} context  { ourPicks, theirPicks, openLanes, comfortIds, unavailable }
 */
export function recommendPicks(registry, snapshot, context, limit = 6) {
  const weights = resolveWeights(registry.config);
  const scale = registry.config.thresholds.matchupScale || 1.6;
  const { ourPicks, theirPicks, openLanes, comfortIds, unavailable } = context;

  const comp = profile(registry, ourPicks);
  const ignored = new Set(snapshot.ignored || []);

  const scored = registry.heroes
    .filter((hero) => !unavailable.has(hero.id))
    .map((hero) => {
      const meta = metaFor(registry, hero, snapshot.rank);
      const counter = counterComponent(registry, hero, theirPicks, scale);
      const synergy = synergyComponent(registry, hero, ourPicks, scale);
      const role = roleComponent(registry, hero, openLanes, snapshot.selectedRole);
      const comfort = comfortComponent(hero, comfortIds, snapshot.comfortRating);
      const flex = flexComponent(registry, hero);
      const need = needComponent(registry, hero, comp);

      const components = {
        meta: meta.score,
        counter: counter.score,
        synergy: synergy.score,
        roleFit: role.score,
        comfort: comfort.score,
        flexibility: flex.score
      };

      const base = weightedScore(components, weights.pick);
      const needWeight = weights.composition.need || 0;
      const score = clamp(base * (1 - needWeight) + need.score * needWeight);

      const reasons = pickReasons([
        role.reason,
        comfort.reason,
        need.reason,
        flex.reason,
        ...counter.reasons,
        ...synergy.reasons,
        meta.source === 'live' && meta.score >= 70
          ? { weight: 12, text: `Contested at your rank — ${meta.detail}` }
          : null,
        meta.source === 'curve' && meta.score >= 82
          ? { weight: 9, text: 'High priority on the current patch' }
          : null
      ]);

      const warnings = [];
      if (counter.risk > (registry.config.thresholds.highCounterRisk || 18) && counter.applied < counter.risk) {
        const worst = counter.riskReasons.slice().sort((a, b) => b.weight - a.weight)[0];
        warnings.push(worst ? worst.text : 'The enemy draft already answers this hero');
      }
      if (snapshot.selectedRole && !(hero.playableLanes || hero.lanes || []).includes(snapshot.selectedRole)) {
        warnings.push(`Off-role for your ${laneLabel(registry, snapshot.selectedRole)}`);
      }

      return {
        hero,
        score,
        components,
        need: need.score,
        breakdown: contributions({ ...components, need: need.score }, {
          ...weights.pick,
          need: needWeight
        }),
        metaDetail: meta.detail,
        metaSource: meta.source,
        reasons: reasons.length ? reasons : ['Highest overall score against the current board'],
        warnings,
        ignored: ignored.has(hero.id)
      };
    });

  scored.sort((a, b) => b.score - a.score || a.hero.name.localeCompare(b.hero.name));
  return scored.filter((row) => !row.ignored).slice(0, limit);
}

/**
 * Ban suggestions — ranked by what they cost us if left available.
 *
 * These are presented as a list of choices, each with its own action. There is
 * no "the ban", and no code path anywhere marks one of these as required.
 */
export function recommendBans(registry, snapshot, context, limit = 6) {
  const weights = resolveWeights(registry.config);
  const scale = registry.config.thresholds.matchupScale || 1.6;
  const { ourPicks, theirPicks, comfortIds, unavailable, enemyComfortIds } = context;

  const ignored = new Set(snapshot.ignored || []);
  const enemyComfort = enemyComfortIds || new Set();
  const ourComp = profile(registry, ourPicks);
  const thinCC = (ourComp.values.cc || 0) > 0 && ourComp.values.cc < registry.config.thresholds.weakDimension;
  const thinSurvive =
    (ourComp.values.survivability || 0) > 0 &&
    ourComp.values.survivability < registry.config.thresholds.weakDimension;

  const scored = registry.heroes
    .filter((hero) => !unavailable.has(hero.id))
    .map((hero) => {
      const meta = metaFor(registry, hero, snapshot.rank);
      const popularity = popularityFor(registry, hero, snapshot.rank);
      const threat = threatAgainst(registry, hero, ourPicks, scale);
      const flex = flexComponent(registry, hero);

      // What this hero adds to *their* side if they get it.
      let fit = 0;
      const fitReasons = [];
      theirPicks.forEach((ally) => {
        const out = synergyPoints(registry, hero, ally);
        fit += out.total;
        fitReasons.push(...out.reasons);
      });
      const counterRisk = theirPicks.length
        ? clamp(fit * scale)
        : clamp(50 + (meta.score - 60) / 2);

      // Comfort cuts both ways, and the sign matters. A hero the opponent is
      // known to play is a reason to take it away. A hero *we* are comfortable
      // on is a reason not to — banning it spends a ban denying ourselves a
      // pick. Scoring it any other way would quietly recommend banning the
      // player's own best heroes.
      const ourComfort = comfortIds.has(hero.id);
      const comfortRisk = enemyComfort.has(hero.id)
        ? 100
        : ourComfort
          ? clamp(30 - (snapshot.comfortRating[hero.id] || 3) * 4)
          : 45;

      const components = {
        meta: meta.score,
        enemyThreat: threat.score,
        counterRisk,
        rankPopularity: popularity.score,
        comfortRisk,
        flexibility: flex.score
      };
      const score = weightedScore(components, weights.ban);

      const reasons = pickReasons([
        ...threat.reasons,
        ...fitReasons,
        enemyComfort.has(hero.id) ? { weight: 18, text: 'On the opponent’s scouted comfort list' } : null,
        popularity.source === 'live' && popularity.score >= 70
          ? { weight: 16, text: `Heavily contested at your rank — ${popularity.detail}` }
          : null,
        popularity.source === 'curve' && meta.score >= 80
          ? { weight: 14, text: 'Top-priority hero on the current patch' }
          : null,
        !ourPicks.length && !theirPicks.length
          ? { weight: 6, text: 'Opening ban — nothing is locked yet, so this is priority, not matchup' }
          : null,
        flex.reason ? { ...flex.reason, weight: 5 } : null,
        thinCC && (hero.tags || []).some((t) => t === 'mobility' || t === 'blink' || t === 'backline-access')
          ? { weight: 12, text: 'Your draft has thin lockdown — this hero punishes exactly that' }
          : null,
        thinSurvive && (hero.tags || []).includes('burst')
          ? { weight: 11, text: 'Your draft is squishy and this hero deletes squishy drafts' }
          : null
      ]);

      const warnings = [];
      if (ourComfort) {
        warnings.push(
          `${hero.name} is on your own comfort list — banning it spends a ban denying yourself the pick`
        );
      }

      return {
        hero,
        score,
        components,
        breakdown: contributions(components, weights.ban),
        metaDetail: popularity.detail,
        metaSource: popularity.source,
        reasons: reasons.length ? reasons : ['Strong hero with no answer on your side yet'],
        warnings,
        ignored: ignored.has(hero.id)
      };
    });

  scored.sort((a, b) => b.score - a.score || a.hero.name.localeCompare(b.hero.name));
  return scored.filter((row) => !row.ignored).slice(0, limit);
}

/**
 * One-line prose for the "Why?" sheet, assembled from the reasons the engine
 * already produced. Template text, filled from deterministic components — there
 * is no text-generation service anywhere in this app.
 */
export function explain(row, action) {
  const top = row.breakdown[0];
  const second = row.breakdown[1];
  if (!top) return '';
  if (action === 'ban') {
    return (
      `Ranked here mostly on ${top.label.toLowerCase()}` +
      (second ? ` and ${second.label.toLowerCase()}` : '') +
      `. Leaving ${row.hero.name} open is the risk; taking it away is one option of several.`
    );
  }
  return (
    `${row.hero.name} scores highest on ${top.label.toLowerCase()}` +
    (second ? ` and ${second.label.toLowerCase()}` : '') +
    ` against the board as it stands. It is a suggestion — any available hero is still yours to take.`
  );
}

export { counterPoints, stripVs };
