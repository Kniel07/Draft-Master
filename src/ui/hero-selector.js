/**
 * hero-selector.js — the hero browser.
 *
 * Two rules from the brief drive every decision in this file.
 *
 * "Every hero must remain searchable and selectable if available." So the grid
 * is the whole registry, always. Filters narrow what is shown; they never remove
 * a hero from reach, and an unavailable hero is drawn struck-through rather than
 * hidden, because a player scanning for a hero needs to see that it is gone.
 *
 * "Never automatically scroll the main page." So the sheet is a fixed-position
 * layer with its own internal scroll, the body is locked while it is open, and
 * search re-renders only the grid — the input is never rebuilt, so focus, the
 * caret and the keyboard all stay put.
 */

import { el, clear, button, portrait, laneShort, stars, debounce, keepScroll } from './dom.js';
import { slug } from '../api/normalizer.js';

/** Search across name, alias, role and lane. One indexOf per hero. */
export function searchHeroes(registry, query) {
  const needle = slug(query);
  if (!needle) return registry.heroes;
  const starts = [];
  const contains = [];
  registry.heroes.forEach((hero) => {
    const index = registry.searchIndex.get(hero.id);
    if (!index) return;
    if (index.name.startsWith(needle)) starts.push(hero);
    else if (index.all.includes(needle)) contains.push(hero);
  });
  return starts.concat(contains);
}

export function filterHeroes(registry, { query, lane, comfortIds, onlyComfort }) {
  return searchHeroes(registry, query).filter((hero) => {
    if (lane && lane !== 'all' && !(hero.lanes || []).includes(lane)) return false;
    if (onlyComfort && comfortIds && !comfortIds.has(hero.id)) return false;
    return true;
  });
}

export function heroCard(registry, hero, options = {}) {
  const { unavailable, selected, onSelect, rating, showRates = true, compact = false } = options;
  const isOut = unavailable && unavailable.has(hero.id);
  const isSelected = selected && selected.has(hero.id);

  const card = el(
    'button',
    ['hcard', compact ? 'hcard--compact' : '', isOut ? 'is-out' : '', isSelected ? 'is-selected' : '']
      .filter(Boolean)
      .join(' ')
  );
  card.type = 'button';
  card.disabled = Boolean(isOut);
  card.dataset.heroId = hero.id;
  card.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
  card.setAttribute(
    'aria-label',
    `${hero.name}. ${(hero.classes || []).join(', ')}. ${(hero.lanes || [])
      .map((l) => laneShort(registry, l))
      .join(', ')}.${isOut ? ' Unavailable.' : ''}`
  );

  card.appendChild(portrait(hero, compact ? 'sm' : 'md', registry.liveStats));

  const body = el('div', 'hcard__body');
  body.appendChild(el('span', 'hcard__name', hero.name));
  const sub = el('span', 'hcard__sub');
  sub.textContent = (hero.lanes || []).length
    ? (hero.lanes || []).map((l) => laneShort(registry, l)).join(' · ')
    : (hero.classes || []).join(' · ');
  body.appendChild(sub);
  if (rating) body.appendChild(el('span', 'hcard__stars', stars(rating)));
  card.appendChild(body);

  if (isOut) {
    card.appendChild(el('span', 'hcard__flag hcard__flag--out', 'OUT'));
  } else if (hero.status === 'provisional') {
    card.appendChild(el('span', 'hcard__flag hcard__flag--new', 'NEW'));
  } else if (showRates) {
    const live = registry.liveStats.get(hero.id);
    if (live && live.banRate != null) {
      card.appendChild(el('span', 'hcard__flag', `${Math.round(live.banRate * 100)}%B`));
    } else if (live && live.winRate != null) {
      card.appendChild(el('span', 'hcard__flag', `${Math.round(live.winRate * 100)}%W`));
    }
  }

  if (!isOut && onSelect) card.addEventListener('click', () => onSelect(hero));
  return card;
}

/**
 * Renders the grid into `host`. Windowed: the DOM holds a page of cards and
 * grows on demand, so opening the selector never builds 133 nodes at once on a
 * mid-range phone.
 */
export function heroGrid(host, registry, heroes, options = {}) {
  const pageSize = options.pageSize || 60;
  clear(host);

  if (!heroes.length) {
    host.appendChild(
      el('p', 'empty', 'No hero matches that. Clear the search or switch the lane filter — every hero is still here.')
    );
    return;
  }

  const grid = el('div', 'hgrid');
  let shown = 0;

  const more = button('btn btn--quiet more', '', () => {
    // Appending to the existing grid, never rebuilding it: the cards already on
    // screen keep their exact position, so the viewport has no reason to move.
    keepScroll(() => {
      renderPage();
      grid.parentNode.appendChild(more);
    });
  });

  function renderPage() {
    const next = heroes.slice(shown, shown + pageSize);
    next.forEach((hero) => grid.appendChild(heroCard(registry, hero, options)));
    shown += next.length;
    const left = heroes.length - shown;
    more.textContent = `Show ${Math.min(pageSize, left)} more (${left} left)`;
    more.hidden = left <= 0;
  }

  host.appendChild(grid);
  renderPage();
  host.appendChild(more);
}

/**
 * The bottom-sheet selector. Built once and reused: opening it swaps content and
 * flips a class, so there is no layout thrash and no chance of the page behind
 * it moving.
 */
export function createSelector(registry, { onSelect, onClose }) {
  const root = el('div', 'sheet');
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'Choose a hero');

  const backdrop = el('div', 'sheet__backdrop');
  backdrop.addEventListener('click', () => api.close());
  root.appendChild(backdrop);

  const panel = el('div', 'sheet__panel');
  // Focusable so the sheet can hold focus without the search field taking it —
  // Escape and screen-reader announcement both need focus inside the dialog.
  panel.tabIndex = -1;
  root.appendChild(panel);

  const head = el('div', 'sheet__head');
  const titleWrap = el('div', 'sheet__titles');
  const title = el('h2', 'sheet__title', 'Choose a hero');
  const note = el('p', 'sheet__note', '');
  titleWrap.appendChild(title);
  titleWrap.appendChild(note);
  head.appendChild(titleWrap);
  head.appendChild(button('sheet__close', '✕', () => api.close(), { label: 'Close hero list' }));
  panel.appendChild(head);

  const controls = el('div', 'sheet__controls');
  const search = el('input', 'search');
  search.type = 'search';
  search.autocomplete = 'off';
  search.placeholder = 'Search hero, role or lane…';
  search.setAttribute('aria-label', 'Search heroes');
  search.setAttribute('enterkeyhint', 'search');
  controls.appendChild(search);

  const chips = el('div', 'chips');
  chips.setAttribute('role', 'group');
  chips.setAttribute('aria-label', 'Filter by lane');
  controls.appendChild(chips);
  panel.appendChild(controls);

  const body = el('div', 'sheet__body');
  panel.appendChild(body);

  const foot = el('div', 'sheet__foot');
  const count = el('span', 'sheet__count', '');
  foot.appendChild(count);
  foot.appendChild(button('btn btn--ghost', 'Close', () => api.close()));
  panel.appendChild(foot);

  const view = { query: '', lane: 'all', onlyComfort: false, context: null };

  [{ id: 'all', short: 'ALL' }]
    .concat(registry.config.lanes.map((l) => ({ id: l.id, short: l.short })))
    .forEach((option) => {
      const chip = button('chip', option.short, () => {
        view.lane = option.id;
        syncChips();
        // Filtering redraws the grid only. The sheet's own scroll position is
        // reset to the top of *its* panel, which is correct here and cannot
        // touch the document behind it.
        renderBody(true);
      });
      chip.dataset.lane = option.id;
      chips.appendChild(chip);
    });

  function syncChips() {
    chips.querySelectorAll('.chip').forEach((chip) => {
      const active = chip.dataset.lane === view.lane;
      chip.classList.toggle('is-active', active);
      chip.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function renderBody(resetScroll = false) {
    const context = view.context || {};
    const heroes = filterHeroes(registry, {
      query: view.query,
      lane: view.lane,
      comfortIds: context.comfortIds,
      onlyComfort: view.onlyComfort
    });
    const available = context.unavailable
      ? heroes.filter((h) => !context.unavailable.has(h.id)).length
      : heroes.length;
    count.textContent = `${available} available · ${registry.heroes.length} heroes total`;

    heroGrid(body, registry, heroes, {
      unavailable: context.unavailable,
      selected: context.selected,
      ratings: context.ratings,
      onSelect: (hero) => onSelect(hero, view.context),
      rating: null,
      pageSize: 60
    });
    if (resetScroll) body.scrollTop = 0;
  }

  const onInput = debounce(() => {
    view.query = search.value;
    // Only the grid is rebuilt — the input keeps focus, the caret and the
    // on-screen keyboard, and the page behind the sheet never moves.
    renderBody(false);
  }, 110);
  search.addEventListener('input', onInput);

  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') api.close();
  });

  const api = {
    root,
    open(context) {
      view.context = context || {};
      view.query = '';
      view.lane = context && context.lane ? context.lane : 'all';
      view.onlyComfort = false;
      search.value = '';
      title.textContent = (context && context.title) || 'Choose a hero';
      note.textContent = (context && context.note) || '';
      syncChips();
      renderBody(true);
      root.hidden = false;
      document.body.classList.add('is-locked');

      // Focus the panel, not the search field.
      //
      // Autofocusing the input made Android raise the keyboard every time the
      // sheet opened, which covers half the grid — so the common case (tap a
      // hero you can already see) started with an obstruction to dismiss. On a
      // phone, browsing is the default and typing is the exception; the player
      // opens the keyboard by tapping the field when they actually want it.
      //
      // A pointer-fine device has no on-screen keyboard to raise and its user
      // is likely to type, so there the input still takes focus.
      const wantsKeyboard =
        typeof window.matchMedia === 'function' && window.matchMedia('(pointer: fine)').matches;
      window.setTimeout(() => {
        if (wantsKeyboard) search.focus({ preventScroll: true });
        else panel.focus({ preventScroll: true });
      }, 30);
    },
    close() {
      if (root.hidden) return;
      root.hidden = true;
      document.body.classList.remove('is-locked');
      if (onClose) onClose();
    },
    isOpen() {
      return !root.hidden;
    },
    refresh() {
      if (!root.hidden) renderBody(false);
    }
  };

  return api;
}
