/**
 * main.js — bootstrap and the single render loop.
 *
 * Flow: load data -> init state -> subscribe -> render on every change.
 * Views are pure functions of the snapshot; nothing renders itself.
 */

import { loadData } from './data.js';
import {
  initState,
  subscribe,
  getSnapshot,
  commitHero,
  undoLast,
  resetDraft,
  setUi
} from './state.js';
import { isPersistent } from './storage.js';
import { el, clear, toast } from './render.js';
import { renderTimeline, renderBoard, renderTurnBanner } from './board.js';
import { renderPool, buildFilterBar } from './pool.js';
import { renderRecommendations, renderSynergy, renderStrength } from './panel.js';
import { renderRoster } from './roster.js';
import { renderStrategy } from './strategy-view.js';

const dom = {};
let data = null;
let filterBar = null;
let activeView = 'draft';
let wasComplete = false;

function cacheDom() {
  [
    'app',
    'boot',
    'patch-badge',
    'tabs',
    'view-roster',
    'view-draft',
    'view-strategy',
    'timeline',
    'board-blue',
    'board-red',
    'turn-banner',
    'recommendations',
    'synergy',
    'strength',
    'filter-bar',
    'pool',
    'undo',
    'reset',
    'comfort-toggle',
    'storage-note'
  ].forEach((id) => {
    dom[id] = document.getElementById(id);
  });
}

function setView(next) {
  activeView = next;
  ['roster', 'draft', 'strategy'].forEach((name) => {
    dom[`view-${name}`].hidden = name !== next;
  });
  dom.tabs.querySelectorAll('.tab').forEach((tab) => {
    const active = tab.dataset.view === next;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function onHeroChosen(hero) {
  const result = commitHero(hero.id);
  if (!result.ok) {
    toast(result.message, 'warn');
    return;
  }
  setUi({ search: '' });
}

function render(snapshot) {
  if (activeView === 'roster') {
    renderRoster(dom['view-roster'], data, snapshot);
    return;
  }
  if (activeView === 'strategy') {
    renderStrategy(dom['view-strategy'], data, snapshot);
    return;
  }

  renderTimeline(dom.timeline, data, snapshot);
  renderBoard(dom['board-blue'], data, snapshot, 'blue');
  renderBoard(dom['board-red'], data, snapshot, 'red');
  renderTurnBanner(dom['turn-banner'], data, snapshot);
  renderRecommendations(dom.recommendations, data, snapshot, onHeroChosen);
  renderSynergy(dom.synergy, data, snapshot, onHeroChosen);
  renderStrength(dom.strength, data);
  renderPool(dom.pool, data, snapshot, onHeroChosen);
  filterBar.sync(snapshot);

  dom['comfort-toggle'].classList.toggle('is-active', snapshot.ui.poolOnlyComfort);
  dom['comfort-toggle'].setAttribute('aria-pressed', snapshot.ui.poolOnlyComfort ? 'true' : 'false');
  dom.undo.disabled = snapshot.history.length === 0;

  if (snapshot.complete && !wasComplete) {
    toast('Draft complete — the pre-game brief is ready.', 'good');
  }
  wasComplete = snapshot.complete;
}

function wireControls() {
  dom.tabs.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      setView(tab.dataset.view);
      render(getSnapshot());
    });
  });

  dom.undo.addEventListener('click', () => {
    const result = undoLast();
    if (!result.ok) toast(result.message, 'warn');
  });

  dom.reset.addEventListener('click', () => {
    if (getSnapshot().history.length === 0) return;
    if (window.confirm('Clear the whole draft? Rosters and comfort picks are kept.')) {
      resetDraft();
      toast('Draft cleared.', 'info');
    }
  });

  dom['comfort-toggle'].addEventListener('click', () => {
    setUi({ poolOnlyComfort: !getSnapshot().ui.poolOnlyComfort });
  });
}

function showBootError(error) {
  clear(dom.boot);
  dom.boot.hidden = false;
  dom.app.hidden = true;
  dom.boot.appendChild(el('h1', 'boot__title', 'The draft data did not load'));
  dom.boot.appendChild(el('pre', 'boot__detail', error.message));
  dom.boot.appendChild(
    el('p', 'boot__hint', 'Fix the file it names, then reload. Nothing else needs restarting.')
  );
  console.error(error);
}

async function start() {
  cacheDom();
  try {
    data = await loadData();
  } catch (error) {
    showBootError(error);
    return;
  }

  dom['patch-badge'].textContent = `${data.config.app.server} · Patch ${data.patch}`;
  if (!isPersistent) {
    dom['storage-note'].hidden = false;
  }

  filterBar = buildFilterBar(dom['filter-bar'], data);
  wireControls();
  subscribe(render);
  initState(data);

  dom.boot.hidden = true;
  dom.app.hidden = false;
  setView('draft');
  render(getSnapshot());
}

start();
