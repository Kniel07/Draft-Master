/**
 * ranked-rules.js — the Ranked ruleset, which is not the Tournament ruleset.
 *
 * Ranked was previously modelled as a free-form board: five ally slots, five
 * enemy slots, three bans a side regardless of rank, and no notion of what
 * phase the draft was in. That was wrong in two ways at once. Rank actually
 * decides the ban count (3 at Epic, 4 at Legend, 5 at Mythic and above), and
 * "the player does not control the lobby order" was taken to mean there is no
 * order — when in fact Ranked has a perfectly definite structure.
 *
 * Free-form does not mean structure-free. So this module supplies the real
 * structure, and the store keeps every slot directly addressable on top of it:
 *
 *   · Bans are blind and simultaneous. Both teams ban at once without seeing
 *     each other, and the enemy's bans are revealed afterwards. The sequence
 *     therefore asks for our bans first — the only window where a ban
 *     recommendation can influence anything — and theirs once they are visible.
 *   · Picks run a snake: first-pick side, then two, two, two, two, one.
 *
 * What this module deliberately does NOT model: which player in the lobby holds
 * the current selection, S1–S5 slot ownership, or the ban wave timing at Mythic
 * (three revealed, then two). The app is not in the lobby and must not pretend
 * to know any of it.
 */

const FALLBACK_BANS = 3;
const FALLBACK_PICK_ORDER = ['ally', 'enemy', 'enemy', 'ally', 'ally', 'enemy', 'enemy', 'ally', 'ally', 'enemy'];

function rankedConfig(registry) {
  return (registry.config.modes && registry.config.modes.ranked) || {};
}

/** The ruleset a rank implies. Unknown ranks fall back rather than throwing. */
export function rulesetFor(registry, rankId) {
  const mode = rankedConfig(registry);
  const rulesets = mode.rulesets || {};
  const ruleset = rulesets[rankId] || rulesets[registry.ranks.default] || {};
  const tier = (registry.ranks.tiers || []).find((t) => t.id === rankId);
  return {
    rank: rankId,
    rankLabel: tier ? tier.label : rankId,
    rankShort: tier ? tier.short : String(rankId || '').toUpperCase(),
    bansPerTeam: ruleset.bansPerTeam || FALLBACK_BANS,
    banStyle: mode.banStyle || 'blind-simultaneous',
    pickOrder: Array.isArray(mode.pickOrder) && mode.pickOrder.length ? mode.pickOrder : FALLBACK_PICK_ORDER,
    teamSize: mode.teamSize || 5
  };
}

const other = (side) => (side === 'ally' ? 'enemy' : 'ally');

/**
 * The full ordered sequence for one Ranked draft.
 *
 * @param {object} ruleset from rulesetFor()
 * @param {boolean} weFirst does our team pick first?
 * @returns {Array<{index,phase,side,group,slot,blind,label,detail}>}
 */
export function rankedSequence(ruleset, weFirst = true) {
  const steps = [];
  const n = ruleset.bansPerTeam;

  for (let i = 0; i < n; i += 1) {
    steps.push({
      phase: 'ban',
      side: 'ally',
      group: 'allyBans',
      slot: i,
      blind: true,
      label: `Your ban ${i + 1} of ${n}`,
      detail: i === 0 ? 'Both teams ban at the same time — they cannot see yours either.' : ''
    });
  }
  for (let i = 0; i < n; i += 1) {
    steps.push({
      phase: 'ban',
      side: 'enemy',
      group: 'enemyBans',
      slot: i,
      blind: false,
      label: `Enemy ban ${i + 1} of ${n}`,
      detail: i === 0 ? 'Record these once the lobby reveals them.' : ''
    });
  }

  const order = weFirst ? ruleset.pickOrder : ruleset.pickOrder.map(other);
  const used = { ally: 0, enemy: 0 };
  order.forEach((side) => {
    const slot = used[side];
    used[side] += 1;
    steps.push({
      phase: 'pick',
      side,
      group: side === 'ally' ? 'allies' : 'enemies',
      slot,
      blind: false,
      label: side === 'ally' ? `Your pick ${slot + 1} of ${ruleset.teamSize}` : `Enemy pick ${slot + 1} of ${ruleset.teamSize}`,
      detail: ''
    });
  });

  return steps.map((step, index) => ({ ...step, index }));
}

/**
 * The step the draft is on: the first one whose slot is still empty.
 *
 * Derived rather than stored, which is what lets the player record out of
 * order. Fill a later slot and the pointer simply steps over it; clear one and
 * the pointer comes back to it. There is no transition to get stuck in.
 */
export function currentStep(sequence, board) {
  return sequence.find((step) => !board[step.group] || !board[step.group][step.slot]) || null;
}

/** Progress for the phase the draft is currently in. */
export function phaseProgress(sequence, board, phase) {
  const steps = sequence.filter((s) => s.phase === phase);
  const done = steps.filter((s) => board[s.group] && board[s.group][s.slot]).length;
  return { done, total: steps.length };
}

/** Per-side counters for the ban strip: "2 / 5". */
export function banProgress(board, ruleset) {
  const count = (list) => (list || []).filter(Boolean).length;
  return {
    ally: { done: count(board.allyBans), total: ruleset.bansPerTeam },
    enemy: { done: count(board.enemyBans), total: ruleset.bansPerTeam }
  };
}

/** A one-line description of where the draft is, for the turn banner. */
export function describeStep(step, ruleset) {
  if (!step) {
    return {
      phase: 'Draft complete',
      call: 'Both sides are locked in',
      side: null,
      action: null,
      recording: false
    };
  }
  return {
    phase: step.phase === 'ban' ? `Ban phase · ${ruleset.rankLabel}` : `Pick phase · ${ruleset.rankLabel}`,
    call: step.label,
    detail: step.detail,
    side: step.side,
    action: step.phase,
    // An enemy action is something you observe and write down; your own is a
    // decision the app can actually help with. The banner says which.
    recording: step.side === 'enemy'
  };
}
