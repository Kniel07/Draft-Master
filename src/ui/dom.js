/**
 * dom.js — element helpers shared by every view.
 *
 * No templating library and no innerHTML anywhere in this app. Every string that
 * reaches the DOM goes through textContent, so a hero name arriving from a
 * public API can never be parsed as markup.
 *
 * This module also owns the app's one hard UX guarantee: **nothing here scrolls
 * the page**. There is no scrollIntoView, no window.scrollTo, no scrollTop write
 * on the document. `keepScroll` exists to actively defend that during a
 * re-render, and `scrollPanel` is the only sanctioned scroll — and it moves a
 * single overflow container, never an ancestor.
 */

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function frag(...children) {
  const f = document.createDocumentFragment();
  children.filter(Boolean).forEach((child) => f.appendChild(child));
  return f;
}

export function button(className, text, onClick, options = {}) {
  const node = el('button', className, text);
  node.type = 'button';
  if (options.label) node.setAttribute('aria-label', options.label);
  if (options.pressed != null) node.setAttribute('aria-pressed', options.pressed ? 'true' : 'false');
  if (options.disabled) node.disabled = true;
  if (onClick) node.addEventListener('click', onClick);
  return node;
}

/**
 * Runs a DOM mutation and puts the viewport back exactly where it was.
 *
 * Replacing a tall subtree shrinks the document for an instant; the browser
 * clamps the scroll position to the shorter page and does not restore it when
 * the content comes back. That is the "the page jumped when I picked a hero"
 * bug, and it does not involve any scroll call at all — which is why removing
 * scrollIntoView is necessary but not sufficient.
 */
export function keepScroll(run) {
  const x = window.scrollX;
  const y = window.scrollY;
  run();
  if (window.scrollX !== x || window.scrollY !== y) {
    window.scrollTo(x, y);
  }
}

/**
 * The only permitted scroll: moves one overflow container, by assignment rather
 * than scrollIntoView, so no ancestor and no document scroll can follow.
 */
export function scrollPanel(container, child, { axis = 'x' } = {}) {
  if (!container || !child) return;
  if (axis === 'x') {
    const target = child.offsetLeft - container.clientWidth / 2 + child.offsetWidth / 2;
    container.scrollLeft = Math.max(0, target);
  } else {
    const target = child.offsetTop - container.clientHeight / 2 + child.offsetHeight / 2;
    container.scrollTop = Math.max(0, target);
  }
}

export function initials(name) {
  const cleaned = String(name || '').replace(/[^A-Za-z0-9 .'-]/g, '');
  const words = cleaned.split(/[\s.'-]+/).filter(Boolean);
  if (!words.length) return '??';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/** Stable hue per hero id, so a crest looks the same session to session. */
function hueFor(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) % 360;
  return hash;
}

/**
 * Hero portrait. Uses the live CDN image when the data layer has one and falls
 * back to a generated crest — a hero with no artwork still renders, still
 * carries its name, and stays fully selectable.
 */
export function portrait(hero, size = 'md', liveStats) {
  const wrap = el('span', `crest crest--${size} class-${String((hero.classes || [])[0] || 'tank').toLowerCase()}`);
  wrap.style.setProperty('--crest-hue', hueFor(hero.id));

  const live = liveStats && liveStats.get ? liveStats.get(hero.id) : null;
  const src = hero.portrait || (live && live.portrait);

  if (src) {
    const img = el('img', 'crest__img');
    img.src = src;
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.addEventListener('error', () => {
      img.remove();
      if (!wrap.querySelector('.crest__text')) wrap.appendChild(el('span', 'crest__text', initials(hero.name)));
    });
    wrap.appendChild(img);
  } else {
    wrap.appendChild(el('span', 'crest__text', initials(hero.name)));
  }
  return wrap;
}

export function laneShort(registry, laneId) {
  const lane = registry.config.lanes.find((l) => l.id === laneId);
  return lane ? lane.short : String(laneId).toUpperCase();
}

export function laneLabel(registry, laneId) {
  const lane = registry.config.lanes.find((l) => l.id === laneId);
  return lane ? lane.label : laneId;
}

/** A labelled 0-100 bar. */
export function bar(label, value, tone) {
  const row = el('div', 'bar');
  row.appendChild(el('span', 'bar__label', label));
  const track = el('span', 'bar__track');
  const fill = el('span', `bar__fill${tone ? ` bar__fill--${tone}` : ''}`);
  fill.style.width = `${Math.max(2, Math.min(100, value))}%`;
  track.appendChild(fill);
  row.appendChild(track);
  row.appendChild(el('span', 'bar__value', String(Math.round(value))));
  return row;
}

export function stars(count, max = 5) {
  return `${'★'.repeat(Math.max(0, count))}${'☆'.repeat(Math.max(0, max - count))}`;
}

let toastTimer = null;

/**
 * Transient confirmation. Lives in a fixed-position host so it never changes
 * document height — a toast that reflowed the page would reintroduce the jump
 * this app exists to avoid.
 */
export function toast(message, tone = 'info') {
  const host = document.getElementById('toast-host');
  if (!host) return;
  clear(host);
  const node = el('div', `toast toast--${tone}`, message);
  host.appendChild(node);
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    node.classList.add('toast--out');
    window.setTimeout(() => node.remove(), 200);
  }, 2400);
}

/** Trailing debounce — used by search so typing never triggers 133 re-renders. */
export function debounce(fn, wait = 120) {
  let timer = null;
  return (...args) => {
    if (timer) window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), wait);
  };
}
