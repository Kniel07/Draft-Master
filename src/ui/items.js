/**
 * items.js — the equipment table.
 *
 * A real <table>, because equipment is genuinely tabular: the reader is
 * comparing a price against a stat line across rows, and that is the one shape
 * a card grid is worse at. On a phone it scrolls inside its own wrapper — the
 * page itself never scrolls sideways.
 *
 * Nothing in the engine reads this file's data. It is reference material, and
 * the header says out loud that the numbers are authored rather than scraped,
 * because the same honesty rule that governs hero roles governs this too.
 */

import { el, clear, button, initials, debounce, keepScroll } from './dom.js';
import { slug } from '../api/normalizer.js';

const SORTS = [
  { id: 'name', label: 'A–Z', compare: (a, b) => a.name.localeCompare(b.name) },
  {
    id: 'price',
    label: 'Price',
    compare: (a, b) => (b.price ?? -1) - (a.price ?? -1) || a.name.localeCompare(b.name)
  },
  {
    id: 'category',
    label: 'Type',
    compare: (a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name)
  }
];

/** Items have no artwork anywhere in the public data, so the tile is generated. */
function icon(item) {
  const node = el('span', `itemicon itemicon--${item.category}`, initials(item.name));
  return node;
}

function search(library, query) {
  const needle = slug(query);
  if (!needle) return library.items;
  return library.items.filter((item) => {
    const index = library.searchIndex.get(item.id);
    return index ? index.name.startsWith(needle) || index.all.includes(needle) : false;
  });
}

function effectCell(item) {
  const cell = el('td', 'itable__effect');
  cell.dataset.label = 'Effect';
  if (item.passive) {
    cell.appendChild(el('span', 'effect__name', `Passive · ${item.passive.name}`));
    cell.appendChild(el('span', 'effect__text', item.passive.text));
  }
  if (item.active) {
    cell.appendChild(el('span', 'effect__name', `Active · ${item.active.name}`));
    cell.appendChild(el('span', 'effect__text', item.active.text));
  }
  if (!item.passive && !item.active) cell.appendChild(el('span', 'effect__text', 'Stats only.'));
  return cell;
}

function row(library, item, categoryLabel) {
  const tr = el('tr', 'itable__row');
  tr.dataset.itemId = item.id;

  const nameCell = el('td', 'itable__name');
  const wrap = el('div', 'itable__namewrap');
  wrap.appendChild(icon(item));
  const text = el('div', 'itable__namebody');
  text.appendChild(el('span', 'itable__title', item.name));
  if ((item.tags || []).length) {
    const tags = el('span', 'itable__tags', item.tags.map((t) => t.replace(/-/g, ' ')).join(' · '));
    text.appendChild(tags);
  }
  wrap.appendChild(text);
  nameCell.appendChild(wrap);
  tr.appendChild(nameCell);

  const typeCell = el('td', 'itable__type', categoryLabel);
  typeCell.dataset.label = 'Type';
  tr.appendChild(typeCell);

  const priceCell = el('td', 'itable__price', item.price == null ? '—' : item.price.toLocaleString('en-US'));
  priceCell.dataset.label = 'Price';
  tr.appendChild(priceCell);

  const attrs = el('td', 'itable__attrs');
  attrs.dataset.label = 'Attributes';
  const list = el('ul', 'attrlist');
  (item.attributes || []).forEach((attribute) => list.appendChild(el('li', 'attrlist__row', attribute)));
  if (!item.attributes.length) list.appendChild(el('li', 'attrlist__row', '—'));
  attrs.appendChild(list);
  tr.appendChild(attrs);

  tr.appendChild(effectCell(item));

  const buyCell = el('td', 'itable__buy', item.buyWhen || '—');
  buyCell.dataset.label = 'Buy when';
  tr.appendChild(buyCell);
  return tr;
}

export function createItemsView(registry) {
  const library = registry.items;
  const root = el('section', 'library');

  const head = el('div', 'sect__head');
  head.appendChild(el('h2', 'sect__title', 'Items'));
  const note = el('span', 'sect__note', '');
  head.appendChild(note);
  root.appendChild(head);

  // The one-line version of the file's own note. The full paragraph belongs in
  // items.json, where the next person to edit the data will actually read it;
  // on a phone it would push the table off the first screen.
  if (library.caption || library.note) {
    root.appendChild(el('p', 'setup__hint', library.caption || library.note));
  }

  const controls = el('div', 'library__controls');
  const field = el('input', 'search');
  field.type = 'search';
  field.autocomplete = 'off';
  field.placeholder = 'Search item, stat or effect…';
  field.setAttribute('aria-label', 'Search items');
  field.setAttribute('enterkeyhint', 'search');
  controls.appendChild(field);

  const categoryChips = el('div', 'chips');
  categoryChips.setAttribute('role', 'group');
  categoryChips.setAttribute('aria-label', 'Filter by item type');
  controls.appendChild(categoryChips);

  const sortChips = el('div', 'chips');
  sortChips.setAttribute('role', 'group');
  sortChips.setAttribute('aria-label', 'Sort items');
  controls.appendChild(sortChips);
  root.appendChild(controls);

  const blurb = el('p', 'library__count', '');
  root.appendChild(blurb);

  const wrap = el('div', 'tablewrap');
  const table = el('table', 'itable');
  const thead = el('thead');
  const headRow = el('tr');
  ['Item', 'Type', 'Price', 'Attributes', 'Effect', 'Buy when'].forEach((label) => {
    const th = el('th', null, label);
    th.scope = 'col';
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);
  const tbody = el('tbody');
  table.appendChild(tbody);
  wrap.appendChild(table);
  root.appendChild(wrap);

  const empty = el('p', 'empty', 'No item matches that. Clear the search or switch the type filter.');
  empty.hidden = true;
  root.appendChild(empty);

  const state = { query: '', category: 'all', sort: 'category' };

  [{ id: 'all', short: 'ALL', label: 'All items', blurb: '' }]
    .concat(library.categories)
    .forEach((category) => {
      const chip = button('chip', category.short || category.label, () => {
        state.category = category.id;
        keepScroll(() => refresh());
      });
      chip.dataset.category = category.id;
      chip.setAttribute('aria-label', category.label || category.id);
      categoryChips.appendChild(chip);
    });

  SORTS.forEach((option) => {
    const chip = button('chip', option.label, () => {
      state.sort = option.id;
      keepScroll(() => refresh());
    });
    chip.dataset.sort = option.id;
    sortChips.appendChild(chip);
  });

  function syncChips() {
    categoryChips.querySelectorAll('.chip').forEach((chip) => {
      const active = chip.dataset.category === state.category;
      chip.classList.toggle('is-active', active);
      chip.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    sortChips.querySelectorAll('.chip').forEach((chip) => {
      const active = chip.dataset.sort === state.sort;
      chip.classList.toggle('is-active', active);
      chip.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function labelFor(categoryId) {
    const category = library.categories.find((c) => c.id === categoryId);
    return category ? category.label : categoryId;
  }

  function refresh() {
    const sort = SORTS.find((s) => s.id === state.sort) || SORTS[0];
    const rows = search(library, state.query)
      .filter((item) => state.category === 'all' || item.category === state.category)
      .slice()
      .sort(sort.compare);

    note.textContent = library.items.length
      ? `${library.items.length} items · patch ${library.patch || registry.patch}`
      : 'No item data loaded';

    const category = library.categories.find((c) => c.id === state.category);
    blurb.textContent = category
      ? `${rows.length} shown · ${category.blurb}`
      : `${rows.length} of ${library.items.length} items`;

    clear(tbody);
    rows.forEach((item) => tbody.appendChild(row(library, item, labelFor(item.category))));

    const none = rows.length === 0;
    wrap.hidden = none;
    empty.hidden = !none;
    empty.textContent = library.items.length
      ? 'No item matches that. Clear the search or switch the type filter.'
      : 'Equipment data could not be loaded. The draft is unaffected — see Setup for the data warning.';
    syncChips();
  }

  field.addEventListener(
    'input',
    debounce(() => {
      state.query = field.value;
      refresh();
    }, 110)
  );

  refresh();
  return { root, refresh };
}
