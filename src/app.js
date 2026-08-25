/**
 * app.js — bootstrap, view switching, and the one render pass.
 *
 * Data flows one way: store → render(snapshot) → DOM. No view holds state and no
 * view mutates the store directly; they call an action and wait to be re-rendered.
 * That is what stops the board, the recommendations and the strength meter from
 * ever disagreeing about what has been drafted.
 *
 * The render pass is targeted rather than wholesale — each panel is redrawn only
 * when its own inputs changed. That keeps a pick under a frame on a mid-range
 * phone, and it is also the second half of the no-jump guarantee: a panel that is
 * not rebuilt cannot change height, and content that does not change height
 * cannot move the viewport.
 */

import { loadRegistry } from './data/registry.js';
import { refreshLive } from './data/live.js';
import { configureApi } from './api/mlbb-api.js';
import { isPersistent } from './api/cache.js';
import * as store from './state/draft-state.js';
import { el, clear, button, toast, keepScroll } from './ui/dom.js';
import { createSelector } from './ui/hero-selector.js';
import { createLanePicker } from './ui/lane-picker.js';
import { describeUnorthodox } from './engine/composition.js';
import { renderRecommendations, renderSynergy } from './ui/recommendations.js';
import { renderStrength } from './ui/strength-meter.js';
import { renderStrategy } from './ui/strategy.js';
import { renderSetup } from './ui/setup.js';
import {
  renderRankedBoard,
  renderTournamentBoard,
  renderTimeline,
  renderTurn
} from './ui/draft.js';
import { recommendPicks, recommendBans } from './engine/recommendation.js';
import { bestPartners } from './engine/synergy.js';
import { progress } from './engine/tournament.js';

const dom = {};
let registry = null;
let selector = null;
let lanePicker = null;
let view = 'draft';
let expandedWhy = null;
let dataStatus = { source: 'bundled', label: 'Bundled dataset', live: false, detail: '' };
let lastSignature = '';
let wasComplete = false;

const VIEWS = ['draft', 'brief', 'setup'];

function cacheDom() {
  [
    'app', 'boot', 'tabs', 'data-badge', 'storage-note',
    'view-draft', 'view-brief', 'view-setup',
    'timeline', 'board', 'turn', 'controls',
    'recommendations', 'synergy', 'strength', 'sheet-host', 'actionbar'
  ].forEach((id) => {
    dom[id] = document.getElementById(id);
  });
}

/* ----------------------------------------------------------- view switching */

function setView(next) {
  if (!VIEWS.includes(next) || next === view) return;
  view = next;
  VIEWS.forEach((name) => {
    dom[`view-${name}`].hidden = name !== next;
  });
  dom.tabs.querySelectorAll('.tab').forEach((tab) => {
    const active = tab.dataset.view === next;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  // Deliberately no scroll call. Switching tabs swaps which section is hidden;
  // the browser keeps the viewport where the user left it, which is what they
  // expect when they flick back and forth mid-draft.
  lastSignature = '';
  render(store.getSnapshot());
}

/* ---------------------------------------------------------------- handlers */

/**
 * Where a free-form commit should land. Ranked has no sequence, so "the next
 * slot" has to be worked out rather than read off a step list — and it has to
 * fall through to the other side once one is full, or the sticky bar would open
 * a sheet whose selection could not go anywhere.
 */
function rankedTarget(snapshot) {
  if (snapshot.sequenced) return null;
  // The guided step already knows what the draft is waiting for, including the
  // blind-ban ordering. Falling back to "first empty slot of the current
  // intent" is only for a board filled out of order.
  if (snapshot.guidedStep) {
    return { group: snapshot.guidedStep.group, index: snapshot.guidedStep.slot };
  }
  const order =
    (snapshot.action || 'pick') === 'ban'
      ? [['enemyBans', snapshot.enemyBans], ['allyBans', snapshot.allyBans]]
      : [['allies', snapshot.allies], ['enemies', snapshot.enemies]];
  for (const [group, slots] of order) {
    const index = slots.indexOf(null);
    if (index >= 0) return { group, index };
  }
  return null;
}

function slotTitle(target) {
  return {
    allies: 'Your pick',
    enemies: 'Enemy pick',
    allyBans: 'Your ban',
    enemyBans: 'Enemy ban'
  }[target.group] || 'Choose a hero';
}

/** What the lane picker needs to draw itself for one hero. */
function laneContext(hero) {
  const lane = store.laneFor(hero.id);
  const assignments = store.getSnapshot().laneAssignments;
  const row = lane
    ? { hero, label: lane.label, knownLanes: hero.lanes || [], laneId: lane.laneId }
    : null;
  return {
    hero,
    /** What the player pinned, if anything. */
    assigned: assignments[hero.id] || null,
    /** What the hero is actually playing — pinned or inferred. */
    current: lane ? lane.laneId : null,
    unorthodox: lane && lane.unorthodox ? describeUnorthodox(registry, row) : null
  };
}

function commit(hero, where) {
  const result = store.commitHero(hero.id, where);
  if (!result.ok) {
    toast(result.message, 'warn');
    return;
  }
  expandedWhy = null;
  if (selector.isOpen()) selector.close();
  toast(`${result.action === 'ban' ? 'Banned' : 'Picked'} ${hero.name}`, 'good');
}

const handlers = {
  onMode: (mode) => store.setMode(mode),
  onRank: (rank) => {
    store.setRank(rank);
    // A rank change means different statistics, so go and get them — quietly,
    // and without blocking anything the player is doing.
    refresh({ silent: true });
  },
  onRole: (lane) => store.setRole(lane),
  onSide: (side) => store.setSide(side),
  onIntent: (intent) => store.setIntent(intent),
  onFirstPick: (weFirst) => store.setFirstPick(weFirst),
  onToggleComfort: (heroId) => store.toggleComfort(heroId),
  onRateComfort: (heroId, rating) => store.setComfortRating(heroId, rating),
  onClearComfort: () => store.clearComfort(),
  onToggleScouted: (heroId) => store.toggleScouted(heroId),
  onClearScouted: () => store.clearScouted(),
  onRefresh: () => refresh({ silent: false }),
  slotCounts: (team) => store.getSlotCounts(team),

  onCommit: (hero) => commit(hero),
  onIgnore: (hero) => {
    store.ignoreHero(hero.id);
    toast(`Set ${hero.name} aside. Nothing else changed.`, 'info');
  },
  onClearIgnored: () => store.clearIgnored(),
  onToggleAllRecs: () => store.setUi({ showAllRecs: !store.getSnapshot().ui.showAllRecs }),
  onToggleWhy: (heroId) => {
    expandedWhy = expandedWhy === heroId ? null : heroId;
    lastSignature = '';
    render(store.getSnapshot());
  },

  onBrowse: () => {
    const snapshot = store.getSnapshot();
    const action = snapshot.action || 'pick';
    const target = rankedTarget(snapshot);
    if (target) store.setTarget(target);
    selector.open({
      title: target ? slotTitle(target) : action === 'ban' ? 'Ban any hero' : 'Pick any hero',
      note:
        action === 'ban'
          ? 'Every available hero, whether it was suggested or not.'
          : 'Every available hero. Suggestions are not a shortlist.',
      unavailable: store.getUnavailable(),
      lane: snapshot.selectedRole || 'all',
      mode: target ? 'slot' : 'draft',
      group: target ? target.group : undefined,
      index: target ? target.index : undefined
    });
  },
  onOpenSlot: (group, index) => {
    store.setTarget({ group, index });
    const isBan = group.toLowerCase().includes('ban');
    const isEnemy = group.startsWith('enemy');
    selector.open({
      title: isBan ? `Choose a ban` : isEnemy ? 'Enemy pick' : 'Your pick',
      note: isBan
        ? 'Whatever actually got banned — or what you are about to ban.'
        : isEnemy
          ? 'Log what the enemy locked so the advice can react to it.'
          : 'Any hero. Recommendations are only ever suggestions.',
      unavailable: store.getUnavailable(),
      lane: !isBan && !isEnemy && store.getSnapshot().selectedRole ? store.getSnapshot().selectedRole : 'all',
      mode: 'slot',
      group,
      index
    });
  },
  onClearSlot: (group, index) => store.clearSlot(group, index),

  laneFor: (heroId) => store.laneFor(heroId),
  onOpenLane: (hero) => lanePicker.open(laneContext(hero)),
  onAssignLane: (heroId, laneId) => {
    const result = store.setLaneAssignment(heroId, laneId);
    if (!result.ok) {
      toast(result.message, 'warn');
      return;
    }
    const hero = registry.byId.get(heroId);
    const lane = store.laneFor(heroId);
    lanePicker.update(laneContext(hero));
    toast(
      laneId
        ? `${hero.name} → ${lane ? lane.label : laneId}${lane && lane.unorthodox ? ' (unorthodox)' : ''}`
        : `${hero.name} back to automatic placement`,
      'info'
    );
  },

  onBrowseComfort: () =>
    selector.open({
      title: 'Your comfort heroes',
      note: 'Tap to add or remove. Rate them afterwards.',
      selected: new Set(store.getSnapshot().comfortHeroes),
      mode: 'comfort'
    }),
  onBrowseScouted: () =>
    selector.open({
      title: 'Scouted opponent heroes',
      note: 'Heroes this opponent is known to play.',
      selected: new Set(store.getSnapshot().scoutedHeroes),
      mode: 'scouted'
    })
};

function onSelectorPick(hero, context) {
  if (!context) return;
  if (context.mode === 'comfort') {
    store.toggleComfort(hero.id);
    selector.refresh();
    return;
  }
  if (context.mode === 'scouted') {
    store.toggleScouted(hero.id);
    selector.refresh();
    return;
  }
  commit(hero, context.group ? { group: context.group, index: context.index } : undefined);
}

/* ------------------------------------------------------------------ render */

/**
 * A cheap fingerprint of everything the panels read. Identical signature means
 * nothing visible changed, so the whole pass is skipped — which is how a
 * keystroke in the hero search costs nothing outside the sheet.
 */
function signature(snapshot) {
  return [
    view,
    snapshot.mode,
    snapshot.rank,
    snapshot.side,
    snapshot.intent,
    snapshot.selectedRole,
    snapshot.weFirst,
    snapshot.stepIndex,
    snapshot.allies.join(','),
    snapshot.enemies.join(','),
    snapshot.allyBans.join(','),
    snapshot.enemyBans.join(','),
    snapshot.history.length,
    snapshot.comfortHeroes.join(','),
    JSON.stringify(snapshot.comfortRating),
    snapshot.scoutedHeroes.join(','),
    snapshot.ignored.join(','),
    JSON.stringify(snapshot.laneAssignments),
    snapshot.target ? `${snapshot.target.group}:${snapshot.target.index}` : '',
    snapshot.ui.expandStrength,
    snapshot.ui.showAllRecs,
    expandedWhy,
    dataStatus.source,
    dataStatus.updatedLabel
  ].join('|');
}

function recommendationModel(snapshot, context) {
  const action = snapshot.action || 'pick';
  const rows =
    action === 'ban'
      ? recommendBans(registry, snapshot, context, 5)
      : recommendPicks(registry, snapshot, context, 5);

  const tier = (registry.ranks.tiers || []).find((t) => t.id === snapshot.rank);
  const where = snapshot.mode === 'ranked' && tier ? ` · ${tier.label}` : '';

  return {
    rows,
    action,
    expandedId: expandedWhy,
    showAll: snapshot.ui.showAllRecs,
    ignoredCount: snapshot.ignored.length,
    title: action === 'ban' ? 'Ban priority' : 'Best picks',
    note:
      action === 'ban'
        ? `Ranked by what it costs you if left open${where}`
        : `Counter, synergy, role, comfort and meta${where}`
  };
}

function renderDraft(snapshot) {
  const context = store.getContext();

  if (snapshot.sequenced) {
    dom.timeline.hidden = false;
    renderTimeline(dom.timeline, registry, snapshot);
    renderTournamentBoard(dom.board, registry, snapshot, handlers);
  } else {
    dom.timeline.hidden = true;
    clear(dom.timeline);
    renderRankedBoard(dom.board, registry, snapshot, handlers);
  }

  renderTurn(dom.turn, registry, snapshot, handlers);
  renderControls(snapshot);

  const nextStep = nextStepFor(snapshot, context);
  if (nextStep) renderNextStep(nextStep);
  else renderRecommendations(dom.recommendations, registry, recommendationModel(snapshot, context), handlers);

  const anchor = context.ourPicks[context.ourPicks.length - 1] || null;
  const partners =
    anchor && (snapshot.action || 'pick') === 'pick'
      ? bestPartners(
          registry,
          anchor,
          registry.heroes.filter((h) => !context.unavailable.has(h.id)),
          2
        )
      : [];
  renderSynergy(dom.synergy, registry, partners, anchor, (hero) => commit(hero));

  renderActionBar(snapshot);

  renderStrength(
    dom.strength,
    registry,
    {
      ourPicks: context.ourPicks,
      theirPicks: context.theirPicks,
      expanded: snapshot.ui.expandStrength,
      ourLabel: snapshot.sequenced ? (snapshot.ourSide === 'blue' ? 'Blue' : 'Red') : 'You',
      theirLabel: snapshot.sequenced ? (snapshot.theirSide === 'blue' ? 'Blue' : 'Red') : 'Enemy'
    },
    () => store.setUi({ expandStrength: !snapshot.ui.expandStrength })
  );
}

/**
 * The sticky bar. It exists so the hero list is always one thumb-tap away
 * however far down the page the player has scrolled — the brief's "easy to
 * access without navigating through a long page", solved without moving the
 * viewport for them.
 */
function renderActionBar(snapshot) {
  const bar = dom.actionbar;
  clear(bar);
  if (snapshot.complete) {
    bar.hidden = true;
    return;
  }
  bar.hidden = false;

  const action = snapshot.action || 'pick';
  const target = rankedTarget(snapshot);
  if (!snapshot.sequenced && !target) {
    bar.hidden = true;
    return;
  }

  const step = snapshot.guidedStep;
  const label = step ? step.label : target ? slotTitle(target) : action === 'ban' ? 'Your ban' : 'Your pick';
  bar.appendChild(el('span', 'actionbar__label', label));
  bar.appendChild(
    button(
      `btn btn--act btn--${action}`,
      target && target.group.startsWith('enemy')
        ? `Record ${action === 'ban' ? 'their ban' : 'their pick'}`
        : action === 'ban'
          ? 'Choose a ban'
          : 'Choose a hero',
      () => handlers.onBrowse()
    )
  );
}

/**
 * Ranked is free-form, so the board can reach a state where there is nothing
 * left to advise on — your five are locked, or every ban slot is spent. Saying
 * that plainly, with the one useful next action attached, beats a list of
 * suggestions whose buttons would do nothing.
 */
function nextStepFor(snapshot, context) {
  if (snapshot.complete) {
    return { text: 'Both sides are locked in. The brief is ready.', cta: null };
  }
  if (snapshot.sequenced) return null;

  const action = snapshot.action || 'pick';
  if (action === 'pick' && snapshot.allies.every(Boolean)) {
    const enemyIndex = snapshot.enemies.indexOf(null);
    return {
      text:
        'Your five are locked. Log what the enemy takes and the threat read, draft strength and brief ' +
        'all update against it.',
      cta: enemyIndex >= 0 ? { label: 'Log an enemy pick', run: () => handlers.onOpenSlot('enemies', enemyIndex) } : null
    };
  }
  if (action === 'ban' && snapshot.allyBans.every(Boolean) && snapshot.enemyBans.every(Boolean)) {
    return {
      text: 'Every ban slot is filled. Switch to picking, or clear a ban to change it.',
      cta: { label: 'Switch to picking', run: () => handlers.onIntent('pick') }
    };
  }
  return null;
}

function renderNextStep(step) {
  clear(dom.recommendations);
  const head = el('div', 'sect__head');
  head.appendChild(el('h2', 'sect__title', 'Next'));
  dom.recommendations.appendChild(head);
  dom.recommendations.appendChild(el('p', 'empty', step.text));
  const foot = el('div', 'recs__foot');
  if (step.cta) foot.appendChild(button('btn btn--wide', step.cta.label, step.cta.run));
  foot.appendChild(button('btn btn--quiet btn--browse', 'Browse all heroes', () => handlers.onBrowse()));
  dom.recommendations.appendChild(foot);
}

function renderControls(snapshot) {
  clear(dom.controls);
  const hasHistory = snapshot.sequenced
    ? snapshot.history.length > 0
    : [snapshot.allies, snapshot.enemies, snapshot.allyBans, snapshot.enemyBans].some((g) => g.some(Boolean));

  dom.controls.appendChild(
    button('btn btn--ghost', 'Undo', () => {
      const result = store.undoLast();
      if (!result.ok) toast(result.message, 'warn');
    }, { disabled: !hasHistory })
  );
  dom.controls.appendChild(
    button('btn btn--quiet', 'Clear draft', () => {
      if (!hasHistory) return;
      store.resetDraft();
      toast('Draft cleared. Rank, role and comfort kept.', 'info');
    }, { disabled: !hasHistory })
  );
  if (snapshot.sequenced) {
    const left = progress(snapshot).remaining;
    dom.controls.appendChild(el('span', 'controls__note', left ? `${left} to go` : 'Complete'));
  }
}

function renderBrief(snapshot) {
  const context = store.getContext();
  const remaining = snapshot.sequenced
    ? `${progress(snapshot).remaining} draft action${progress(snapshot).remaining === 1 ? '' : 's'}`
    : `${10 - context.ourPicks.length - context.theirPicks.length} hero slot${
        10 - context.ourPicks.length - context.theirPicks.length === 1 ? '' : 's'
      }`;
  renderStrategy(dom['view-brief'], registry, {
    ourPicks: context.ourPicks,
    theirPicks: context.theirPicks,
    remaining,
    ourLabel: snapshot.sequenced ? (snapshot.side === 'blue' ? 'Blue side' : 'Red side') : 'Your team',
    explicitLanes: snapshot.laneAssignments,
    onOpenLane: handlers.onOpenLane
  });
}

function render(snapshot) {
  const next = signature(snapshot);
  if (next === lastSignature) return;
  lastSignature = next;

  keepScroll(() => {
    if (view === 'draft') renderDraft(snapshot);
    else if (view === 'brief') renderBrief(snapshot);
    else renderSetup(dom['view-setup'], registry, snapshot, dataStatus, handlers);
  });

  if (snapshot.complete && !wasComplete) toast('Draft complete — the brief is ready.', 'good');
  wasComplete = snapshot.complete;
}

/* --------------------------------------------------------------- data badge */

function renderBadge() {
  const badge = dom['data-badge'];
  clear(badge);
  badge.className = `badge badge--${dataStatus.source}`;
  const dot = el('span', 'badge__dot');
  badge.appendChild(dot);
  badge.appendChild(
    el(
      'span',
      'badge__text',
      dataStatus.source === 'live'
        ? `Live · patch ${registry.patch}`
        : dataStatus.source === 'cache'
          ? `Cached · ${dataStatus.updatedLabel}`
          : `Bundled · patch ${registry.patch}`
    )
  );
  badge.title = dataStatus.detail || '';
}

async function refresh({ silent }) {
  if (!silent) toast('Checking the public data source…', 'info');
  try {
    dataStatus = await refreshLive(registry, store.getSnapshot().rank);
  } catch (cause) {
    // refreshLive resolves rather than rejecting, but a host without fetch can
    // still throw at import time. Either way the bundled data is already loaded
    // and the app carries on.
    console.warn('Live refresh failed; staying on the bundled dataset.', cause);
    dataStatus = { source: 'bundled', label: 'Bundled dataset', live: false, detail: 'Live data unavailable — using the bundled dataset.' };
  }
  renderBadge();
  lastSignature = '';
  render(store.getSnapshot());
  if (!silent) {
    toast(
      dataStatus.live
        ? `Live data for ${dataStatus.rank || 'all ranks'}.`
        : dataStatus.source === 'cache'
          ? `Live data unavailable — using the cached set from ${dataStatus.updatedLabel}.`
          : 'Live data unavailable — using the bundled dataset.',
      dataStatus.live ? 'good' : 'warn'
    );
  }
}

/* ------------------------------------------------------------------- boot */

function bootError(error) {
  clear(dom.boot);
  dom.boot.hidden = false;
  dom.app.hidden = true;
  dom.boot.appendChild(el('h1', 'boot__title', 'The draft data did not load'));
  dom.boot.appendChild(el('pre', 'boot__detail', error.message));
  dom.boot.appendChild(el('p', 'boot__hint', 'Fix the file it names and reload.'));
  console.error(error);
}

async function start() {
  cacheDom();

  try {
    registry = await loadRegistry('data/');
  } catch (error) {
    bootError(error);
    return;
  }

  configureApi(registry.config.api || {});
  dataStatus = registry.dataStatus;

  selector = createSelector(registry, {
    onSelect: onSelectorPick,
    onClose: () => store.setTarget(null)
  });
  dom['sheet-host'].appendChild(selector.root);

  lanePicker = createLanePicker(registry, {
    onAssign: (heroId, laneId) => handlers.onAssignLane(heroId, laneId),
    onClose: () => {}
  });
  dom['sheet-host'].appendChild(lanePicker.root);

  dom.tabs.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => setView(tab.dataset.view));
  });
  dom['data-badge'].addEventListener('click', () => setView('setup'));

  if (!isPersistent) dom['storage-note'].hidden = false;

  store.subscribe(render);
  store.initState(registry);

  renderBadge();
  dom.boot.hidden = true;
  dom.app.hidden = false;
  render(store.getSnapshot());

  // The app is fully usable at this point. The live layer arrives when it
  // arrives, and if it never does, nothing above changes.
  refresh({ silent: true });
}

start();
