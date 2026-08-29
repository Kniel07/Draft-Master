/**
 * heroes.js — the hero library tab.
 *
 * The draft sheet answers "which of these can I take right now". This tab
 * answers "what is this hero", and it is the only place in the app where the
 * artwork is the point rather than a label on a slot. So the portrait is drawn
 * large, and — following the same rule as everywhere else — a hero with no
 * artwork still renders, as its generated crest, and is never dropped from the
 * gallery for it.
 *
 * The view owns its own filter state in a closure and is built once. A render
 * pass calls refresh(), which rebuilds the gallery and nothing else: the search
 * input node survives, so focus, the caret and the keyboard stay put.
 */

import { el, clear, button, portrait, bar, stars, laneShort, debounce, keepScroll } from './dom.js';
import { searchHeroes } from './hero-selector.js';

const PAGE = 48;

const SORTS = [
  { id: 'name', label: 'A–Z', compare: (a, b) => a.name.localeCompare(b.name) },
  { id: 'meta', label: 'Meta', compare: (a, b) => b.meta - a.meta || a.name.localeCompare(b.name) },
  {
    id: 'difficulty',
    label: 'Difficulty',
    compare: (a, b) => a.difficulty - b.difficulty || a.name.localeCompare(b.name)
  }
];

function rateLine(registry, hero) {
  const live = registry.liveStats.get(hero.id);
  if (!live) return null;
  const parts = [];
  if (live.winRate != null) parts.push(`${(live.winRate * 100).toFixed(1)}% win`);
  if (live.pickRate != null) parts.push(`${(live.pickRate * 100).toFixed(1)}% pick`);
  if (live.banRate != null) parts.push(`${(live.banRate * 100).toFixed(1)}% ban`);
  return parts.length ? parts.join(' · ') : null;
}

/** The expanded panel under a tapped hero: everything the registry knows. */
function detail(registry, hero) {
  const panel = el('div', 'hero-detail');

  const meta = el('div', 'hero-detail__meta');
  const common = (hero.lanes || []).map((l) => laneShort(registry, l));
  const flex = (hero.flexLanes || []).map((l) => laneShort(registry, l));
  [
    ['Role', (hero.classes || []).join(' · ') || '—'],
    ['Lane', common.length ? common.join(' · ') : 'Unlisted'],
    ['Flex lane', flex.length ? flex.join(' · ') : '—'],
    ['Difficulty', stars(hero.difficulty)],
    ['Meta score', String(hero.meta)]
  ].forEach(([term, value]) => {
    meta.appendChild(el('dt', null, term));
    meta.appendChild(el('dd', null, value));
  });
  const rates = rateLine(registry, hero);
  if (rates) {
    meta.appendChild(el('dt', null, `Live${registry.liveRank ? ` · ${registry.liveRank}` : ''}`));
    meta.appendChild(el('dd', null, rates));
  }
  panel.appendChild(meta);

  // The same seven dimensions the strength meter reads, named the same way and
  // in the same order — one hero's profile has to be comparable to the meter the
  // player sees during a draft, and `short` is what fits the bar's label column.
  const bars = el('div', 'hero-detail__bars bars');
  ((registry.config.strength || {}).dimensions || []).forEach((dim) => {
    bars.appendChild(bar(dim.short || dim.label, hero.stats[dim.id] ?? 0));
  });
  panel.appendChild(bars);

  if ((hero.tags || []).length) {
    const tags = el('ul', 'taglist');
    hero.tags.forEach((tag) => tags.appendChild(el('li', 'taglist__tag', tag.replace(/-/g, ' '))));
    panel.appendChild(tags);
  }

  if (hero.provenance === 'authored') {
    panel.appendChild(
      el('p', 'setup__warn', 'Role and lane for this hero are authored rather than sourced — treat them as a hint.')
    );
  }
  return panel;
}

function card(registry, hero, { expanded, onToggle }) {
  const node = el('button', `hero-tile${expanded ? ' is-expanded' : ''}`);
  node.type = 'button';
  node.dataset.heroId = hero.id;
  node.setAttribute('aria-expanded', expanded ? 'true' : 'false');

  node.appendChild(portrait(hero, 'lg', registry.liveStats));

  const body = el('div', 'hero-tile__body');
  body.appendChild(el('span', 'hero-tile__name', hero.name));
  body.appendChild(el('span', 'hero-tile__role', (hero.classes || []).join(' · ')));
  const lanes = (hero.playableLanes || hero.lanes || []).map((l) => laneShort(registry, l));
  body.appendChild(el('span', 'hero-tile__lanes', lanes.length ? lanes.join(' · ') : '—'));
  node.appendChild(body);

  if (hero.status === 'provisional') node.appendChild(el('span', 'hero-tile__flag hero-tile__flag--new', 'NEW'));
  node.addEventListener('click', () => onToggle(hero.id));
  return node;
}

export function createHeroesView(registry) {
  const root = el('section', 'library');

  const head = el('div', 'sect__head');
  head.appendChild(el('h2', 'sect__title', 'Heroes'));
  const note = el('span', 'sect__note', '');
  head.appendChild(note);
  root.appendChild(head);

  const controls = el('div', 'library__controls');
  const search = el('input', 'search');
  search.type = 'search';
  search.autocomplete = 'off';
  search.placeholder = 'Search hero, role, lane or trait…';
  search.setAttribute('aria-label', 'Search heroes');
  search.setAttribute('enterkeyhint', 'search');
  controls.appendChild(search);

  const laneChips = el('div', 'chips');
  laneChips.setAttribute('role', 'group');
  laneChips.setAttribute('aria-label', 'Filter by lane');
  controls.appendChild(laneChips);

  const sortChips = el('div', 'chips');
  sortChips.setAttribute('role', 'group');
  sortChips.setAttribute('aria-label', 'Sort heroes');
  controls.appendChild(sortChips);
  root.appendChild(controls);

  const count = el('p', 'library__count', '');
  root.appendChild(count);

  const gallery = el('div', 'gallery');
  root.appendChild(gallery);

  const more = button('btn btn--quiet more', '', () => {
    // Append, never rebuild: the tiles already on screen keep their position,
    // so the page has no reason to move under the thumb.
    keepScroll(() => {
      renderPage();
      root.appendChild(more);
    });
  });
  more.hidden = true;
  root.appendChild(more);

  const state = { query: '', lane: 'all', sort: 'name', expanded: null };
  let rows = [];
  let shown = 0;

  [{ id: 'all', short: 'ALL' }]
    .concat(registry.config.lanes.map((l) => ({ id: l.id, short: l.short })))
    .forEach((option) => {
      const chip = button('chip', option.short, () => {
        state.lane = option.id;
        refresh();
      });
      chip.dataset.lane = option.id;
      laneChips.appendChild(chip);
    });

  SORTS.forEach((option) => {
    const chip = button('chip', option.label, () => {
      state.sort = option.id;
      refresh();
    });
    chip.dataset.sort = option.id;
    sortChips.appendChild(chip);
  });

  function syncChips() {
    laneChips.querySelectorAll('.chip').forEach((chip) => {
      const active = chip.dataset.lane === state.lane;
      chip.classList.toggle('is-active', active);
      chip.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    sortChips.querySelectorAll('.chip').forEach((chip) => {
      const active = chip.dataset.sort === state.sort;
      chip.classList.toggle('is-active', active);
      chip.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function onToggle(heroId) {
    state.expanded = state.expanded === heroId ? null : heroId;
    // Only the gallery is redrawn, and the viewport is pinned across it — an
    // expanding panel must not push the tile the player just tapped off screen.
    keepScroll(() => renderGallery());
  }

  function renderPage() {
    const next = rows.slice(shown, shown + PAGE);
    next.forEach((hero) => {
      const expanded = state.expanded === hero.id;
      gallery.appendChild(card(registry, hero, { expanded, onToggle }));
      if (expanded) gallery.appendChild(detail(registry, hero));
    });
    shown += next.length;
    const left = rows.length - shown;
    more.textContent = `Show ${Math.min(PAGE, left)} more (${left} left)`;
    more.hidden = left <= 0;
  }

  function renderGallery() {
    clear(gallery);
    shown = 0;
    if (!rows.length) {
      more.hidden = true;
      gallery.appendChild(
        el('p', 'empty', 'No hero matches that. Clear the search or switch the lane filter — every hero is still here.')
      );
      return;
    }
    renderPage();
  }

  function refresh() {
    const sort = SORTS.find((s) => s.id === state.sort) || SORTS[0];
    rows = searchHeroes(registry, state.query)
      .filter((hero) => state.lane === 'all' || (hero.playableLanes || hero.lanes || []).includes(state.lane))
      .slice()
      .sort(sort.compare);

    if (state.expanded && !rows.some((hero) => hero.id === state.expanded)) state.expanded = null;

    const withArt = rows.filter((hero) => {
      const live = registry.liveStats.get(hero.id);
      return Boolean(hero.portrait || (live && live.portrait));
    }).length;

    note.textContent = `${registry.heroes.length} heroes · patch ${registry.patch}`;
    count.textContent = withArt
      ? `${rows.length} shown · ${withArt} with artwork`
      : `${rows.length} shown · artwork arrives with live data — until then every hero shows its crest`;

    syncChips();
    renderGallery();
  }

  search.addEventListener(
    'input',
    debounce(() => {
      state.query = search.value;
      refresh();
    }, 110)
  );

  refresh();
  return { root, refresh };
}
