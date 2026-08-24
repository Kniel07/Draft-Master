/**
 * draft-state.js — the single source of truth for a draft in progress.
 *
 * Everything the engine and the UI need is here and nowhere else. UI modules
 * never hold a copy; they read a snapshot and call an action. That is what keeps
 * the recommendation panel, the boards and the strength meter from ever
 * disagreeing about what has been picked.
 *
 * Two modes share this store:
 *   tournament — a fixed 20-step MPL sequence; `currentStep` drives the turn.
 *   ranked     — free-form. The player is not in control of the order in a real
 *                ranked lobby, so the app does not pretend to be: you say what
 *                happened, in whatever order it happened, and set `intent` to
 *                tell the app what you are about to do.
 *
 * The store never chooses a hero. `commit` only ever runs from an explicit user
 * action, and there is no code path anywhere that fills a slot from a
 * recommendation on its own.
 */

import { readSetting, writeSetting } from '../api/cache.js';

const SETTINGS_KEY = 'draft-settings';
const listeners = new Set();

/** @type {object|null} */
let registry = null;

const state = {
  mode: 'ranked',
  rank: 'mythic',
  format: 'mpl-standard',

  /** Ranked: which side the player is on is always 'ally'. Tournament: 'blue'. */
  side: 'blue',

  /** Ranked free-form board. Arrays of hero ids, holes allowed via null. */
  allies: [],
  enemies: [],
  allyBans: [],
  enemyBans: [],

  /** Tournament sequenced history: { stepIndex, team, action, heroId }. */
  history: [],
  stepIndex: 0,

  selectedRole: null,
  comfortHeroes: [],
  /** heroId -> 1..5 */
  comfortRating: {},
  /** Tournament scouting: heroes the opponent is known to play. Drives ban priority. */
  scoutedHeroes: [],

  /** Ranked intent: what the user is about to do. Never set by the engine. */
  intent: 'pick',
  /** Which ranked slot the selector is filling: {group, index} or null. */
  target: null,

  /** Recommendations the player has waved away this turn. */
  ignored: [],

  ui: {
    search: '',
    laneFilter: 'all',
    onlyComfort: false,
    selectorOpen: false,
    detailHeroId: null,
    expandStrength: false,
    showAllRecs: false
  }
};

/* ------------------------------------------------------------ persistence */

function persistable() {
  return {
    mode: state.mode,
    rank: state.rank,
    side: state.side,
    selectedRole: state.selectedRole,
    comfortHeroes: state.comfortHeroes,
    comfortRating: state.comfortRating,
    scoutedHeroes: state.scoutedHeroes
  };
}

function save() {
  writeSetting(SETTINGS_KEY, persistable());
}

/* ------------------------------------------------------------------- init */

export function initState(loadedRegistry) {
  registry = loadedRegistry;

  const modes = registry.config.modes || {};
  const stored = readSetting(SETTINGS_KEY, null) || {};

  state.mode = modes[stored.mode] ? stored.mode : 'ranked';
  const tiers = (registry.ranks.tiers || []).map((t) => t.id);
  state.rank = tiers.includes(stored.rank) ? stored.rank : registry.ranks.default || tiers[0];

  const laneIds = new Set(registry.config.lanes.map((l) => l.id));
  state.selectedRole = laneIds.has(stored.selectedRole) ? stored.selectedRole : null;

  // Comfort ids are re-validated against the registry so a hand-edited or stale
  // value cannot poison scoring.
  state.comfortHeroes = Array.isArray(stored.comfortHeroes)
    ? stored.comfortHeroes.filter((id) => registry.byId.has(id))
    : [];
  state.scoutedHeroes = Array.isArray(stored.scoutedHeroes)
    ? stored.scoutedHeroes.filter((id) => registry.byId.has(id))
    : [];
  state.side = stored.side === 'red' ? 'red' : 'blue';

  state.comfortRating = {};
  state.comfortHeroes.forEach((id) => {
    const raw = stored.comfortRating && stored.comfortRating[id];
    state.comfortRating[id] = Number.isFinite(raw) ? Math.max(1, Math.min(5, Math.round(raw))) : 3;
  });

  resetBoards();
  notify();
}

function teamSize() {
  const mode = registry.config.modes[state.mode] || {};
  return mode.teamSize || 5;
}

function banSlots() {
  const mode = registry.config.modes[state.mode] || {};
  return mode.banSlots || { ally: 3, enemy: 3 };
}

function resetBoards() {
  const size = teamSize();
  const bans = banSlots();
  state.allies = new Array(size).fill(null);
  state.enemies = new Array(size).fill(null);
  state.allyBans = new Array(bans.ally).fill(null);
  state.enemyBans = new Array(bans.enemy).fill(null);
  state.history = [];
  state.stepIndex = 0;
  state.ignored = [];
  state.target = null;
}

/* ----------------------------------------------------------- subscription */

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

let notifyDepth = 0;
function notify() {
  if (notifyDepth > 0) return;
  notifyDepth += 1;
  const snapshot = getSnapshot();
  listeners.forEach((listener) => {
    try {
      listener(snapshot);
    } catch (cause) {
      console.error('A view failed to update.', cause);
    }
  });
  notifyDepth -= 1;
}

/* ------------------------------------------------------------------ reads */

export function isSequenced() {
  const mode = registry.config.modes[state.mode];
  return Boolean(mode && mode.sequenced);
}

export function getSteps() {
  const format = registry.config.draftFormats[state.format];
  return (format && format.steps) || [];
}

export function getCurrentStep() {
  if (!isSequenced()) return null;
  const steps = getSteps();
  if (state.stepIndex >= steps.length) return null;
  return { ...steps[state.stepIndex], index: state.stepIndex };
}

export function isComplete() {
  if (isSequenced()) return state.stepIndex >= getSteps().length;
  return state.allies.every(Boolean) && state.enemies.every(Boolean);
}

/** Hero ids that are off the board, whatever mode we are in. */
export function getUnavailable() {
  const out = new Set();
  if (isSequenced()) {
    state.history.forEach((entry) => out.add(entry.heroId));
    return out;
  }
  [state.allies, state.enemies, state.allyBans, state.enemyBans].forEach((group) => {
    group.forEach((id) => {
      if (id) out.add(id);
    });
  });
  return out;
}

/** Locked picks for one side, as hero objects. Side is 'ally'|'enemy' in
 *  ranked, 'blue'|'red' in tournament. */
export function getPicks(side) {
  const ids = isSequenced()
    ? state.history.filter((h) => h.team === side && h.action === 'pick').map((h) => h.heroId)
    : (side === 'ally' ? state.allies : state.enemies).filter(Boolean);
  return ids.map((id) => registry.byId.get(id)).filter(Boolean);
}

export function getBans(side) {
  const ids = isSequenced()
    ? state.history.filter((h) => h.team === side && h.action === 'ban').map((h) => h.heroId)
    : (side === 'ally' ? state.allyBans : state.enemyBans).filter(Boolean);
  return ids.map((id) => registry.byId.get(id)).filter(Boolean);
}

/** The side the player is drafting for right now. */
export function ourSide() {
  if (!isSequenced()) return 'ally';
  const step = getCurrentStep();
  return step ? step.team : state.side;
}

export function theirSide() {
  const us = ourSide();
  if (!isSequenced()) return 'enemy';
  return us === 'blue' ? 'red' : 'blue';
}

/** What the app should be advising on: 'pick' or 'ban'. */
export function currentAction() {
  if (isSequenced()) {
    const step = getCurrentStep();
    return step ? step.action : null;
  }
  return state.intent;
}

export function getSlotCounts(team) {
  if (!isSequenced()) {
    const bans = banSlots();
    return { picks: teamSize(), bans: team === 'ally' ? bans.ally : bans.enemy };
  }
  return getSteps().reduce(
    (acc, step) => {
      if (step.team !== team) return acc;
      if (step.action === 'pick') acc.picks += 1;
      else acc.bans += 1;
      return acc;
    },
    { picks: 0, bans: 0 }
  );
}

/** Lanes on our side with nobody assigned yet. Greedy: least-flexible first. */
export function getOpenLanes(side) {
  const lanes = registry.config.lanes.map((l) => l.id);
  const claimed = new Set();
  getPicks(side)
    .slice()
    .sort((a, b) => a.lanes.length - b.lanes.length)
    .forEach((hero) => {
      const target = hero.lanes.find((lane) => !claimed.has(lane));
      if (target) claimed.add(target);
    });
  const open = lanes.filter((id) => !claimed.has(id));
  // In ranked the player has told us their own lane; it stays "open" for them
  // until they lock something in it, so recommendations answer their role.
  if (!isSequenced() && state.selectedRole && !claimed.has(state.selectedRole)) {
    return [state.selectedRole];
  }
  return open;
}

export function getComfortIds() {
  return new Set(state.comfortHeroes);
}

export function comfortRating(heroId) {
  return state.comfortRating[heroId] || 0;
}

export function getSnapshot() {
  return {
    mode: state.mode,
    rank: state.rank,
    format: state.format,
    side: state.side,
    allies: state.allies.slice(),
    enemies: state.enemies.slice(),
    allyBans: state.allyBans.slice(),
    enemyBans: state.enemyBans.slice(),
    history: state.history.slice(),
    stepIndex: state.stepIndex,
    steps: isSequenced() ? getSteps() : [],
    selectedRole: state.selectedRole,
    comfortHeroes: state.comfortHeroes.slice(),
    comfortRating: { ...state.comfortRating },
    scoutedHeroes: state.scoutedHeroes.slice(),
    intent: state.intent,
    target: state.target ? { ...state.target } : null,
    ignored: state.ignored.slice(),
    ui: { ...state.ui },
    sequenced: isSequenced(),
    currentStep: getCurrentStep(),
    action: currentAction(),
    ourSide: ourSide(),
    theirSide: theirSide(),
    complete: isComplete()
  };
}

/* ---------------------------------------------------------------- actions */

export function setMode(mode) {
  if (!registry.config.modes[mode] || mode === state.mode) return;
  state.mode = mode;
  state.format = mode === 'tournament' ? 'mpl-standard' : state.format;
  state.side = mode === 'tournament' ? 'blue' : 'ally';
  resetBoards();
  save();
  notify();
}

export function setRank(rank) {
  if (rank === state.rank) return;
  state.rank = rank;
  save();
  notify();
}

export function setRole(laneId) {
  state.selectedRole = state.selectedRole === laneId ? null : laneId;
  save();
  notify();
}

export function setIntent(intent) {
  if (intent !== 'pick' && intent !== 'ban') return;
  state.intent = intent;
  state.ignored = [];
  notify();
}

/** Opens the hero selector against a specific slot. */
export function setTarget(target) {
  state.target = target;
  if (target && (target.group === 'allyBans' || target.group === 'enemyBans')) state.intent = 'ban';
  if (target && (target.group === 'allies' || target.group === 'enemies')) state.intent = 'pick';
  notify();
}

export function setUi(patch) {
  Object.assign(state.ui, patch);
  notify();
}

export function toggleComfort(heroId) {
  const at = state.comfortHeroes.indexOf(heroId);
  if (at >= 0) {
    state.comfortHeroes.splice(at, 1);
    delete state.comfortRating[heroId];
  } else {
    state.comfortHeroes.push(heroId);
    state.comfortRating[heroId] = 3;
  }
  save();
  notify();
  return at < 0;
}

export function setComfortRating(heroId, rating) {
  if (!state.comfortHeroes.includes(heroId)) return;
  state.comfortRating[heroId] = Math.max(1, Math.min(5, Math.round(rating)));
  save();
  notify();
}

/** Which side the player's own team is on, in tournament mode. */
export function setSide(side) {
  if (side !== 'blue' && side !== 'red') return;
  state.side = side;
  save();
  notify();
}

export function toggleScouted(heroId) {
  const at = state.scoutedHeroes.indexOf(heroId);
  if (at >= 0) state.scoutedHeroes.splice(at, 1);
  else state.scoutedHeroes.push(heroId);
  save();
  notify();
  return at < 0;
}

export function clearScouted() {
  state.scoutedHeroes = [];
  save();
  notify();
}

export function clearComfort() {
  state.comfortHeroes = [];
  state.comfortRating = {};
  save();
  notify();
}

/**
 * Puts a hero on the board. The only way a hero is ever committed.
 *
 * @param {string} heroId
 * @param {{group?:string, index?:number}} [where] ranked only; defaults to the
 *        current intent's first empty slot.
 */
export function commitHero(heroId, where) {
  if (!registry.byId.has(heroId)) return { ok: false, message: 'That hero is not in the registry.' };
  if (getUnavailable().has(heroId)) return { ok: false, message: 'That hero is already off the board.' };

  if (isSequenced()) {
    const step = getCurrentStep();
    if (!step) return { ok: false, message: 'The draft is already complete.' };
    state.history.push({ stepIndex: state.stepIndex, team: step.team, action: step.action, heroId });
    state.stepIndex += 1;
    state.ignored = [];
    notify();
    return { ok: true, action: step.action, team: step.team };
  }

  const target = where || state.target || defaultTarget();
  const group = state[target.group];
  if (!Array.isArray(group)) return { ok: false, message: 'Unknown draft slot.' };

  let index = target.index;
  if (index == null || index < 0 || index >= group.length || group[index]) {
    index = group.indexOf(null);
  }
  if (index < 0) return { ok: false, message: 'Those slots are full — clear one first.' };

  group[index] = heroId;
  state.target = null;
  state.ignored = [];
  notify();
  return { ok: true, action: target.group.includes('Ban') ? 'ban' : 'pick', group: target.group, index };
}

function defaultTarget() {
  if (state.intent === 'ban') return { group: 'enemyBans', index: null };
  return { group: 'allies', index: null };
}

/** Ranked: empties one slot. Tournament uses undo instead. */
export function clearSlot(group, index) {
  if (isSequenced()) return { ok: false, message: 'Use Undo in tournament mode.' };
  if (!Array.isArray(state[group])) return { ok: false, message: 'Unknown draft slot.' };
  state[group][index] = null;
  state.ignored = [];
  notify();
  return { ok: true };
}

export function undoLast() {
  if (isSequenced()) {
    if (state.history.length === 0) return { ok: false, message: 'Nothing to undo.' };
    const last = state.history.pop();
    state.stepIndex = last.stepIndex;
    state.ignored = [];
    notify();
    return { ok: true };
  }
  // Free-form: undo the last-filled slot in a stable order.
  const order = ['allies', 'enemies', 'enemyBans', 'allyBans'];
  for (const group of order) {
    const filled = state[group].map((id, i) => (id ? i : -1)).filter((i) => i >= 0);
    if (filled.length) {
      state[group][filled[filled.length - 1]] = null;
      state.ignored = [];
      notify();
      return { ok: true };
    }
  }
  return { ok: false, message: 'Nothing to undo.' };
}

export function resetDraft() {
  resetBoards();
  notify();
  return { ok: true };
}

/**
 * Waves a recommendation away. Deliberately toothless: it hides one row and
 * nothing else. No lock, no penalty, no forced follow-up.
 */
export function ignoreHero(heroId) {
  if (!state.ignored.includes(heroId)) state.ignored.push(heroId);
  notify();
}

export function clearIgnored() {
  state.ignored = [];
  notify();
}

/**
 * Everything the engine needs, assembled once per render. Keeping this here
 * rather than in the engine is what lets the engine stay a pure function of its
 * arguments — and therefore testable without a DOM or a store.
 */
export function getContext() {
  const us = ourSide();
  const them = theirSide();

  // In a sequenced draft the clock alternates sides, so "our comfort" has to
  // follow the side the player's team is actually on — otherwise the app would
  // recommend the opponent's picks off the player's own comfort list.
  const advisingOurTeam = !isSequenced() || us === state.side;
  const comfortIds = advisingOurTeam ? new Set(state.comfortHeroes) : new Set(state.scoutedHeroes);
  const enemyComfortIds = advisingOurTeam ? new Set(state.scoutedHeroes) : new Set(state.comfortHeroes);

  return {
    ourPicks: getPicks(us),
    theirPicks: getPicks(them),
    ourBans: getBans(us),
    theirBans: getBans(them),
    openLanes: getOpenLanes(us),
    comfortIds,
    enemyComfortIds,
    advisingOurTeam,
    unavailable: getUnavailable()
  };
}
