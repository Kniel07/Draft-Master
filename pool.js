/**
 * pool.js — the hero pool: search, role filter, and the tappable grid.
 *
 * The same grid renderer serves the draft board and the comfort-pick screen;
 * only the click handler and the "selected" set differ.
 */

import { el, clear, portrait, laneShort } from './render.js';
import { getUnavailable, getComfortIds, setUi } from './state.js';

const MAX_RENDERED = 400;

function matchesSearch(hero, query) {
  if (!query) return true;
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return (
    hero.name.toLowerCase().includes(needle) ||
    hero.classes.some((c) => c.toLowerCase().includes(needle)) ||
    hero.tags.some((t) => t.replace(/-/g, ' ').includes(needle))
  );
}

export function filterHeroes(data, { search, laneFilter, comfortIds, onlyComfort }) {
  return data.heroes.filter((hero) => {
    if (!matchesSearch(hero, search)) return false;
    if (laneFilter && laneFilter !== 'all' && !hero.lanes.includes(laneFilter)) return false;
    if (onlyComfort && comfortIds && !comfortIds.has(hero.id)) return false;
    return true;
  });
}

export function heroCard(data, hero, options) {
  const { unavailable, selected, onSelect, showMeta = true } = options;
  const isOut = unavailable && unavailable.has(hero.id);
  const isSelected = selected && selected.has(hero.id);

  const card = el(
    'button',
    ['hero', isOut ? 'is-out' : '', isSelected ? 'is-selected' : ''].filter(Boolean).join(' ')
  );
  card.type = 'button';
  card.disabled = Boolean(isOut);
  card.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
  card.setAttribute(
    'aria-label',
    `${hero.name}. ${hero.classes.join(', ')}. ${hero.lanes.map((l) => laneShort(data, l)).join(', ')}.` +
      (isOut ? ' Unavailable.' : '')
  );

  card.appendChild(portrait(hero, 'md'));
  const body = el('div', 'hero__body');
  body.appendChild(el('span', 'hero__name', hero.name));
  body.appendChild(el('span', 'hero__lanes', hero.lanes.map((l) => laneShort(data, l)).join(' · ')));
  card.appendChild(body);

  // Third column shows one badge only: availability beats meta score.
  if (isOut) {
    card.appendChild(el('span', 'hero__out', 'OUT'));
  } else if (showMeta) {
    card.appendChild(el('span', 'hero__meta', String(hero.meta)));
  }

  if (!isOut && onSelect) {
    card.addEventListener('click', () => onSelect(hero));
  }
  return card;
}

export function heroGrid(host, data, heroes, options) {
  clear(host);
  if (heroes.length === 0) {
    const empty = el('p', 'empty', 'No hero matches that filter. Clear the search or switch role.');
    host.appendChild(empty);
    return;
  }
  const grid = el('div', 'grid');
  heroes.slice(0, MAX_RENDERED).forEach((hero) => {
    grid.appendChild(heroCard(data, hero, options));
  });
  host.appendChild(grid);
}

/** Search + role filter bar. Rebuilt only once; values are synced on update. */
export function buildFilterBar(host, data) {
  clear(host);

  const search = el('input', 'search');
  search.type = 'search';
  search.placeholder = 'Search hero, role or trait';
  search.setAttribute('aria-label', 'Search heroes');
  search.addEventListener('input', () => setUi({ search: search.value }));
  host.appendChild(search);

  const roles = el('div', 'roles');
  roles.setAttribute('role', 'group');
  roles.setAttribute('aria-label', 'Filter by role');

  const options = [{ id: 'all', short: 'ALL' }].concat(
    data.config.lanes.map((l) => ({ id: l.id, short: l.short }))
  );
  options.forEach((option) => {
    const button = el('button', 'chip', option.short);
    button.type = 'button';
    button.dataset.lane = option.id;
    button.addEventListener('click', () => setUi({ laneFilter: option.id }));
    roles.appendChild(button);
  });
  host.appendChild(roles);

  return {
    sync(snapshot) {
      if (search.value !== snapshot.ui.search) search.value = snapshot.ui.search;
      roles.querySelectorAll('.chip').forEach((chip) => {
        const active = chip.dataset.lane === snapshot.ui.laneFilter;
        chip.classList.toggle('is-active', active);
        chip.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
    }
  };
}

export function renderPool(host, data, snapshot, onSelect) {
  const step = snapshot.currentStep;
  const comfortIds = step ? getComfortIds(step.team) : new Set();
  const heroes = filterHeroes(data, {
    search: snapshot.ui.search,
    laneFilter: snapshot.ui.laneFilter,
    comfortIds,
    onlyComfort: snapshot.ui.poolOnlyComfort
  });

  heroGrid(host, data, heroes, {
    unavailable: getUnavailable(),
    selected: comfortIds,
    onSelect,
    showMeta: true
  });
}
