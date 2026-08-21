/**
 * roster.js — pre-draft setup: who plays which lane, and what they are
 * comfortable on. Both sides are editable: the opponent's comfort list is
 * scouting input and drives the ban recommendations.
 */

import { el, clear, portrait } from './render.js';
import { heroGrid, filterHeroes } from './pool.js';
import { setPlayerName, toggleComfort, clearComfort, getComfortIds } from './state.js';

const view = {
  team: 'blue',
  openLane: null,
  search: ''
};

function laneCard(data, snapshot, lane) {
  const slot = snapshot.roster[view.team][lane.id];
  const card = el('section', `lane ${view.openLane === lane.id ? 'is-open' : ''}`);

  const head = el('div', 'lane__head');
  head.appendChild(el('span', 'lane__tag', lane.short));

  const name = el('input', 'lane__name');
  name.type = 'text';
  name.value = slot.player;
  name.placeholder = `${lane.label} player`;
  name.setAttribute('aria-label', `${lane.label} player name`);
  name.addEventListener('change', () => setPlayerName(view.team, lane.id, name.value.trim()));
  head.appendChild(name);

  const count = el('span', 'lane__count', `${slot.comfort.length}`);
  head.appendChild(count);
  card.appendChild(head);

  if (slot.comfort.length) {
    const chips = el('ul', 'comforts');
    slot.comfort.forEach((heroId) => {
      const hero = data.byId.get(heroId);
      if (!hero) return;
      const chip = el('li');
      const button = el('button', 'comfort');
      button.type = 'button';
      button.title = `Remove ${hero.name}`;
      button.setAttribute('aria-label', `Remove ${hero.name} from ${lane.label} comfort list`);
      button.appendChild(portrait(hero, 'xs'));
      button.appendChild(el('span', null, hero.name));
      button.appendChild(el('span', 'comfort__x', '×'));
      button.addEventListener('click', () => toggleComfort(view.team, lane.id, heroId));
      chip.appendChild(button);
      chips.appendChild(chip);
    });
    card.appendChild(chips);
  }

  const actions = el('div', 'lane__actions');
  const toggle = el('button', 'btn btn--ghost', view.openLane === lane.id ? 'Done' : 'Add heroes');
  toggle.type = 'button';
  toggle.addEventListener('click', () => {
    view.openLane = view.openLane === lane.id ? null : lane.id;
    view.search = '';
    rerender();
  });
  actions.appendChild(toggle);

  if (slot.comfort.length) {
    const wipe = el('button', 'btn btn--quiet', 'Clear');
    wipe.type = 'button';
    wipe.addEventListener('click', () => clearComfort(view.team, lane.id));
    actions.appendChild(wipe);
  }
  card.appendChild(actions);

  if (view.openLane === lane.id) {
    const picker = el('div', 'lane__picker');
    const search = el('input', 'search');
    search.type = 'search';
    search.value = view.search;
    search.placeholder = `Search ${lane.label} heroes`;
    search.setAttribute('aria-label', `Search ${lane.label} heroes`);
    search.addEventListener('input', () => {
      view.search = search.value;
      rerender({ keepFocus: true });
    });
    picker.appendChild(search);

    const gridHost = el('div');
    const heroes = filterHeroes(data, {
      search: view.search,
      laneFilter: lane.id,
      comfortIds: null,
      onlyComfort: false
    });
    heroGrid(gridHost, data, heroes, {
      unavailable: null,
      selected: new Set(slot.comfort),
      onSelect: (hero) => toggleComfort(view.team, lane.id, hero.id),
      showMeta: true
    });
    picker.appendChild(gridHost);
    card.appendChild(picker);
  }

  return card;
}

let hostRef = null;
let dataRef = null;
let snapshotRef = null;

function rerender(options = {}) {
  if (!hostRef) return;
  const focusWasSearch = options.keepFocus && document.activeElement;
  const caret = focusWasSearch ? document.activeElement.selectionStart : null;
  renderRoster(hostRef, dataRef, snapshotRef);
  if (focusWasSearch) {
    const next = hostRef.querySelector('.lane__picker .search');
    if (next) {
      next.focus();
      if (caret != null) next.setSelectionRange(caret, caret);
    }
  }
}

export function renderRoster(host, data, snapshot) {
  hostRef = host;
  dataRef = data;
  snapshotRef = snapshot;
  clear(host);

  const head = el('div', 'section__head');
  head.appendChild(el('h2', 'section__title', 'Roster & comfort picks'));
  head.appendChild(
    el('span', 'section__note', 'Saved on this device. Scout the enemy list too — it drives ban priority.')
  );
  host.appendChild(head);

  const toggle = el('div', 'sidetoggle');
  toggle.setAttribute('role', 'group');
  toggle.setAttribute('aria-label', 'Choose side to edit');
  ['blue', 'red'].forEach((team) => {
    const count = getComfortIds(team).size;
    const button = el('button', `sidetoggle__btn sidetoggle__btn--${team} ${view.team === team ? 'is-active' : ''}`);
    button.type = 'button';
    button.appendChild(el('span', null, team === 'blue' ? 'Blue Side' : 'Red Side'));
    button.appendChild(el('span', 'sidetoggle__count', `${count} heroes`));
    button.addEventListener('click', () => {
      view.team = team;
      view.openLane = null;
      rerender();
    });
    toggle.appendChild(button);
  });
  host.appendChild(toggle);

  const lanes = el('div', 'lanes');
  data.config.lanes.forEach((lane) => {
    lanes.appendChild(laneCard(data, snapshot, lane));
  });
  host.appendChild(lanes);
}
