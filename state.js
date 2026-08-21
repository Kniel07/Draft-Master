/**
 * state.js — the single source of truth for a draft in progress.
 *
 * UI modules never mutate state directly; they call the exported actions and
 * re-render from the snapshot they receive. One store, one direction of flow.
 */

import { read, write } from './storage.js';

const ROSTER_KEY = 'roster-v1';
const TEAMS = ['blue', 'red'];

let steps = [];
let lanes = [];
const listeners = new Set();

const state = {
  stepIndex: 0,
  /** @type {Array<{stepIndex:number, team:string, action:string, heroId:string}>} */
  history: [],
  /** roster[team][laneId] = { player: string, comfort: string[] } */
  roster: {},
  ui: {
    search: '',
    laneFilter: 'all',
    poolOnlyComfort: false
  }
};

function emptyRoster() {
  const roster = {};
  TEAMS.forEach((team) => {
    roster[team] = {};
    lanes.forEach((lane) => {
      roster[team][lane.id] = { player: '', comfort: [] };
    });
  });
  return roster;
}

function mergeStoredRoster(stored) {
  const base = emptyRoster();
  if (!stored || typeof stored !== 'object') return base;
  TEAMS.forEach((team) => {
    lanes.forEach((lane) => {
      const slot = stored[team] && stored[team][lane.id];
      if (!slot) return;
      base[team][lane.id] = {
        player: typeof slot.player === 'string' ? slot.player : '',
        comfort: Array.isArray(slot.comfort) ? slot.comfort.filter((id) => typeof id === 'string') : []
      };
    });
  });
  return base;
}

/** Must be called once, after data has loaded. */
export function initState(data) {
  steps = data.config.draftFormat.steps;
  lanes = data.config.lanes;
  state.roster = mergeStoredRoster(read(ROSTER_KEY, null));
  // Drop comfort entries for heroes that no longer exist in heroes.json.
  TEAMS.forEach((team) => {
    lanes.forEach((lane) => {
      const slot = state.roster[team][lane.id];
      slot.comfort = slot.comfort.filter((id) => data.byId.has(id));
    });
  });
  notify();
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify() {
  listeners.forEach((listener) => {
    try {
      listener(getSnapshot());
    } catch (cause) {
      console.error('A view failed to update.', cause);
    }
  });
}

/* ------------------------------------------------------------------ reads */

export function getSnapshot() {
  return {
    stepIndex: state.stepIndex,
    steps,
    history: state.history.slice(),
    roster: state.roster,
    ui: { ...state.ui },
    currentStep: getCurrentStep(),
    complete: isComplete()
  };
}

export function getCurrentStep() {
  if (state.stepIndex >= steps.length) return null;
  return { ...steps[state.stepIndex], index: state.stepIndex };
}

export function isComplete() {
  return state.stepIndex >= steps.length;
}

/** All hero ids that are off the board — picked or banned by either team. */
export function getUnavailable() {
  return new Set(state.history.map((entry) => entry.heroId));
}

export function getSelections(team, action) {
  return state.history
    .filter((entry) => entry.team === team && entry.action === action)
    .map((entry) => entry.heroId);
}

/** Slot layout for a team: how many picks/bans it gets across the whole format. */
export function getSlotCounts(team) {
  return steps.reduce(
    (acc, step) => {
      if (step.team !== team) return acc;
      if (step.action === 'pick') acc.picks += 1;
      else acc.bans += 1;
      return acc;
    },
    { picks: 0, bans: 0 }
  );
}

export function getComfortIds(team) {
  const ids = new Set();
  lanes.forEach((lane) => {
    state.roster[team][lane.id].comfort.forEach((id) => ids.add(id));
  });
  return ids;
}

/** Which lane(s) a comfort hero was listed under, for explanation text. */
export function getComfortLanes(team, heroId) {
  return lanes
    .filter((lane) => state.roster[team][lane.id].comfort.includes(heroId))
    .map((lane) => lane.id);
}

/** Lanes for a team that have no picked hero assigned to them yet. */
export function getOpenLanes(team, data) {
  const picked = getSelections(team, 'pick').map((id) => data.byId.get(id));
  const claimed = new Set();
  // Greedy assignment: single-lane heroes claim first, flex heroes fill gaps.
  picked
    .slice()
    .sort((a, b) => a.lanes.length - b.lanes.length)
    .forEach((hero) => {
      const target = hero.lanes.find((lane) => !claimed.has(lane));
      if (target) claimed.add(target);
    });
  return lanes.map((lane) => lane.id).filter((id) => !claimed.has(id));
}

/* ---------------------------------------------------------------- actions */

export function commitHero(heroId) {
  const step = getCurrentStep();
  if (!step) return { ok: false, message: 'The draft is already complete.' };
  if (getUnavailable().has(heroId)) {
    return { ok: false, message: 'That hero is already off the board.' };
  }
  state.history.push({
    stepIndex: state.stepIndex,
    team: step.team,
    action: step.action,
    heroId
  });
  state.stepIndex += 1;
  notify();
  return { ok: true };
}

export function undoLast() {
  if (state.history.length === 0) return { ok: false, message: 'Nothing to undo.' };
  const last = state.history.pop();
  state.stepIndex = last.stepIndex;
  notify();
  return { ok: true };
}

export function resetDraft() {
  state.history = [];
  state.stepIndex = 0;
  notify();
}

export function setPlayerName(team, laneId, name) {
  state.roster[team][laneId].player = name;
  write(ROSTER_KEY, state.roster);
  notify();
}

export function toggleComfort(team, laneId, heroId) {
  const slot = state.roster[team][laneId];
  const at = slot.comfort.indexOf(heroId);
  if (at >= 0) slot.comfort.splice(at, 1);
  else slot.comfort.push(heroId);
  write(ROSTER_KEY, state.roster);
  notify();
  return at < 0;
}

export function clearComfort(team, laneId) {
  state.roster[team][laneId].comfort = [];
  write(ROSTER_KEY, state.roster);
  notify();
}

export function setUi(patch) {
  Object.assign(state.ui, patch);
  notify();
}
