/**
 * strategy.js — the 30-second pre-game brief.
 *
 * Everything here is derived from the completed draft plus the loaded data.
 * The brief is deliberately short: five sections, no section longer than a
 * few lines, because it is read on a phone in the seconds before the match.
 */

import { getSelections, getComfortLanes } from './state.js';
import { teamStrength, profileHighlights } from './strength.js';
import { counterPoints } from './recommender.js';

const LANE_LABELS = {
  roam: 'Roam',
  jungle: 'Jungle',
  mid: 'Mid Lane',
  gold: 'Gold Lane',
  exp: 'EXP Lane'
};

function labelFor(laneId) {
  return LANE_LABELS[laneId] || laneId;
}

/**
 * Assigns locked picks to lanes. Heroes with the fewest viable lanes are
 * placed first, so flex picks absorb whatever is left — the same order a
 * coach would reason in.
 */
export function validateLanes(data, team) {
  const lanes = data.config.lanes.map((l) => l.id);
  const heroes = getSelections(team, 'pick').map((id) => data.byId.get(id));
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

  const rows = lanes.map((laneId) => {
    const hero = assigned.get(laneId) || null;
    const comfortNames = hero
      ? getComfortLanes(team, hero.id).map((l) => labelFor(l))
      : [];
    const offRole = hero && comfortNames.length > 0 && !comfortNames.includes(labelFor(laneId));
    return { laneId, label: labelFor(laneId), hero, offRole };
  });

  const empty = rows.filter((r) => !r.hero).map((r) => r.label);
  return { rows, unplaced, empty, valid: empty.length === 0 && unplaced.length === 0 };
}

function topThreats(data, team, limit = 3) {
  const enemy = team === 'blue' ? 'red' : 'blue';
  const ourPicks = getSelections(team, 'pick').map((id) => data.byId.get(id));
  const theirPicks = getSelections(enemy, 'pick').map((id) => data.byId.get(id));

  return theirPicks
    .map((hero) => {
      let raw = 0;
      const notes = [];
      ourPicks.forEach((ours) => {
        const out = counterPoints(data, hero, ours);
        raw += out.total;
        notes.push(...out.reasons);
      });
      const top = notes.sort((a, b) => b.weight - a.weight)[0];
      return {
        hero,
        score: raw + hero.meta / 4,
        note: top ? top.text : `Highest individual carry potential on their side`
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function winCondition(data, team) {
  const us = teamStrength(data, team);
  const them = teamStrength(data, team === 'blue' ? 'red' : 'blue');
  const get = (side, id) => (side.dimensions.find((d) => d.id === id) || { value: 0 }).value;

  const earlyEdge = get(us, 'early') - get(them, 'early');
  const lateEdge = get(us, 'late') - get(them, 'late');
  const pushEdge = get(us, 'push') - get(them, 'push');
  const ccEdge = get(us, 'cc') - get(them, 'cc');
  const survEdge = get(us, 'survivability') - get(them, 'survivability');

  const headline = [];
  const detail = [];

  if (earlyEdge >= 5 && earlyEdge > lateEdge) {
    headline.push('Win early, close before the enemy scales');
    detail.push('Force the first three objectives and convert every won fight into map pressure.');
  } else if (lateEdge >= 5) {
    headline.push('Survive to the late game and win the last teamfight');
    detail.push('Trade farm over kills, give up low-value skirmishes, and hold vision until item spikes land.');
  } else {
    headline.push('Win the mid-game objective cycle');
    detail.push('The drafts are close on tempo — the team that converts the second Turtle into a Lord setup takes the game.');
  }

  if (ccEdge >= 8) detail.push('You have the stronger lockdown: fight on your initiation, never theirs.');
  if (pushEdge >= 8) detail.push('Use your push advantage to open side lanes before every objective spawn.');
  if (survEdge <= -8) detail.push('You are the squishier side — fight only with full setup and vision.');

  return { headline: headline[0], detail };
}

function objectivePlan(data, team) {
  const us = teamStrength(data, team);
  const them = teamStrength(data, team === 'blue' ? 'red' : 'blue');
  const get = (side, id) => (side.dimensions.find((d) => d.id === id) || { value: 0 }).value;

  const earlyEdge = get(us, 'early') - get(them, 'early');
  const ccEdge = get(us, 'cc') - get(them, 'cc');

  const turtle =
    earlyEdge >= 5
      ? 'Contest every Turtle. Set vision 30 seconds early and start it with numbers.'
      : earlyEdge <= -5
        ? 'Trade the first Turtle for side-lane farm. Only contest with a numbers advantage.'
        : 'Contest Turtle only when your Roam and Jungle arrive together.';

  const lord =
    ccEdge >= 8
      ? 'Start Lord off a won fight — your CC lets you force the engage before the smite duel.'
      : ccEdge <= -8
        ? 'Never start Lord into a full enemy squad. Bait it, take side lanes, and Lord after a pick.'
        : 'Take Lord after a pick or a spent enemy ultimate, not on a timer.';

  return { turtle, lord };
}

function shotcallerNotes(data, team) {
  const us = teamStrength(data, team);
  const { strong, weak } = profileHighlights(data, us);
  const notes = [];

  strong.slice(0, 2).forEach((dim) => {
    notes.push(`Lean on your ${dim.label.toLowerCase()} — it is this draft's best trait.`);
  });
  weak.slice(0, 2).forEach((dim) => {
    notes.push(`Play around thin ${dim.label.toLowerCase()}; do not take fights that test it.`);
  });

  const topPair = us.synergy.pairs[0];
  if (topPair) {
    notes.push(
      `Combo to call: ${topPair.heroes[0].name} into ${topPair.heroes[1].name} — ${topPair.reason.toLowerCase()}.`
    );
  }

  notes.push('Call retreats out loud after a spent initiation ultimate — that is the enemy window.');
  return notes.slice(0, 5);
}

/** Full pre-game brief for one side of a completed draft. */
export function buildStrategy(data, team) {
  return {
    team,
    winCondition: winCondition(data, team),
    objectives: objectivePlan(data, team),
    threats: topThreats(data, team),
    lanes: validateLanes(data, team),
    reminders: shotcallerNotes(data, team)
  };
}
