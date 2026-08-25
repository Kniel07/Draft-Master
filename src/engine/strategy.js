/**
 * strategy.js — the pre-game brief.
 *
 * Five sections, none longer than a few lines, because this is read on a phone
 * in the seconds before the match starts. Every sentence is assembled from the
 * completed draft by template — no generated prose, nothing that can hallucinate
 * a hero interaction that the data does not contain.
 */

import { profile, highlights, assignLanes, describeUnorthodox } from './composition.js';
import { counterPoints } from './counter.js';
import { renderReason, stripQualifier, THEIRS } from './reason.js';

function edge(us, them, id) {
  return (us.values[id] || 0) - (them.values[id] || 0);
}

function winCondition(registry, us, them) {
  const early = edge(us, them, 'early');
  const late = edge(us, them, 'late');
  const cc = edge(us, them, 'cc');
  const push = edge(us, them, 'push');
  const survive = edge(us, them, 'survivability');

  let headline;
  const detail = [];

  if (early >= 5 && early > late) {
    headline = 'Win early and close before they scale';
    detail.push('Force the first three objectives and turn every won fight into map pressure.');
  } else if (late >= 5) {
    headline = 'Survive to the late game and win the last fight';
    detail.push('Trade farm over kills, skip low-value skirmishes, hold vision until item spikes land.');
  } else {
    headline = 'Win the mid-game objective cycle';
    detail.push('The drafts are close on tempo — whoever converts the second Turtle into a Lord setup takes it.');
  }

  if (cc >= 8) detail.push('You have the stronger lockdown: fight on your initiation, never theirs.');
  if (push >= 8) detail.push('Use the push advantage to open side lanes before every objective spawn.');
  if (survive <= -8) detail.push('You are the squishier side — commit only with full setup and vision.');

  return { headline, detail };
}

function objectives(registry, us, them) {
  const early = edge(us, them, 'early');
  const cc = edge(us, them, 'cc');

  const turtle =
    early >= 5
      ? 'Contest every Turtle. Set vision 30 seconds early and start it with numbers.'
      : early <= -5
        ? 'Trade the first Turtle for side-lane farm. Only contest with a numbers advantage.'
        : 'Contest Turtle only when your Roam and Jungle arrive together.';

  const lord =
    cc >= 8
      ? 'Start Lord off a won fight — your CC lets you force the engage before the smite duel.'
      : cc <= -8
        ? 'Never start Lord into a full enemy squad. Bait it, take side lanes, Lord after a pick.'
        : 'Take Lord after a pick or a spent enemy ultimate, not on a timer.';

  return { turtle, lord };
}

function threats(registry, ourPicks, theirPicks, limit = 3) {
  const ranked = theirPicks
    .map((hero) => {
      let raw = 0;
      const notes = [];
      ourPicks.forEach((ours) => {
        const out = counterPoints(registry, hero, ours);
        raw += out.total;
        notes.push(...out.reasons);
      });
      return { hero, score: raw + (hero.meta || 60) / 4, notes: notes.sort((a, b) => b.weight - a.weight) };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  // Three threats that all say the same sentence is three lines that carry one
  // line of information. Each takes its strongest note that no higher-ranked
  // threat has already used.
  const used = new Set();
  return ranked.map((row) => {
    // The actor is *their* hero and the target is ours, so these render from
    // the opposite side to a pick reason. Rendering the same fact with the
    // default perspective is what produced "the enemy support's core value"
    // when the support in question was ours.
    const render = (entry) =>
      entry ? renderReason(entry.fact, { actorSide: THEIRS }) : null;

    const fresh = row.notes.find((n) => !used.has(stripQualifier(render(n) || '')));
    const chosen = fresh || row.notes[0];
    const note = render(chosen) || 'Highest individual carry potential on their side';
    used.add(stripQualifier(note));
    return { hero: row.hero, score: row.score, note, fact: chosen ? chosen.fact : null };
  });
}

function lanePlan(registry, ourPicks, theirPicks, explicit = {}) {
  const ours = assignLanes(registry, ourPicks, explicit);
  const theirs = assignLanes(registry, theirPicks, explicit);
  const notes = [];

  // Matchup reads are done against the lanes heroes are *actually* playing, so
  // an off-role assignment is compared to the hero opposite it rather than to
  // whoever its role data would have expected.
  ours.rows.forEach((row) => {
    if (!row.hero) return;
    const opposite = theirs.rows.find((r) => r.laneId === row.laneId);
    if (!opposite || !opposite.hero) return;
    const against = counterPoints(registry, opposite.hero, row.hero);
    const forUs = counterPoints(registry, row.hero, opposite.hero);
    if (against.total - forUs.total >= 8) {
      notes.push(`${row.short}: ${row.hero.name} loses the matchup into ${opposite.hero.name} — plan a rotation.`);
    } else if (forUs.total - against.total >= 8) {
      notes.push(`${row.short}: ${row.hero.name} beats ${opposite.hero.name} — take the early tempo there.`);
    }
  });

  // An empty lane now means one thing only: fewer heroes than lanes. It is a
  // statement about how far the draft has got, never a verdict on a pick.
  if (ours.empty.length) {
    notes.push(`${ours.empty.join(', ')} still to fill.`);
  }
  if (ours.overflow.length) {
    notes.push(
      `More heroes than lanes: ${ours.overflow.map((h) => h.name).join(', ')} ${
        ours.overflow.length === 1 ? 'has' : 'have'
      } nowhere to go.`
    );
  }
  if (!notes.length) notes.push('No standout lane mismatch — play the map, not the matchup.');

  return {
    rows: ours.rows,
    valid: ours.valid,
    unorthodox: ours.unorthodox.map((row) => ({ row, text: describeUnorthodox(registry, row) })),
    notes: notes.slice(0, 4)
  };
}

function reminders(registry, us) {
  const { strong, weak } = highlights(registry, us);
  const out = [];

  const best = strong.slice().sort((a, b) => b.value - a.value);
  best.slice(0, 2).forEach((dim, index) => {
    out.push(
      index === 0
        ? `Lean on your ${dim.label.toLowerCase()} — it is this draft's strongest trait.`
        : `Your ${dim.label.toLowerCase()} is the second thing this draft does well.`
    );
  });
  weak
    .slice()
    .sort((a, b) => a.value - b.value)
    .slice(0, 2)
    .forEach((dim) => {
      out.push(`Play around thin ${dim.label.toLowerCase()}; do not take fights that test it.`);
    });

  const topPair = us.synergy.pairs[0];
  if (topPair) {
    // Describe the pair by what it actually is. Rendering its single
    // highest-weighted reason asserted a cause the pair did not win on: it wins
    // on the sum of its linked effects, and naming one of them as *the* reason
    // is how "Angela into Edith" came to be justified with a claim about
    // scaling carries.
    const { count, text } = topPair.summary;
    const linked = count > 1 ? ` (${count} linked effects)` : '';
    out.push(`Combo to call: ${topPair.heroes[0].name} + ${topPair.heroes[1].name}${linked} — ${text}.`);
  }
  out.push('Call the retreat out loud after a spent initiation ultimate — that is the enemy window.');
  return out.slice(0, 5);
}

/** Full brief for one side. */
export function buildStrategy(registry, ourPicks, theirPicks, explicitLanes = {}) {
  const us = profile(registry, ourPicks);
  const them = profile(registry, theirPicks);
  return {
    winCondition: winCondition(registry, us, them),
    objectives: objectives(registry, us, them),
    threats: threats(registry, ourPicks, theirPicks),
    lanes: lanePlan(registry, ourPicks, theirPicks, explicitLanes),
    reminders: reminders(registry, us),
    profile: us
  };
}
