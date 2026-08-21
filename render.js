/**
 * render.js — small DOM helpers shared by every view.
 *
 * No templating library: element creation stays explicit so that user-entered
 * text (player names) is always set via textContent and never parsed as HTML.
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

export function initials(name) {
  const cleaned = name.replace(/[^A-Za-z0-9 .'-]/g, '');
  const words = cleaned.split(/[\s.'-]+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/** Deterministic hue from the hero id so crests stay stable between sessions. */
function hueFor(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) % 360;
  }
  return hash;
}

/**
 * Hero crest. Uses assets/heroes/<id>.<ext> when a hero declares a "portrait"
 * path in heroes.json, and falls back to a generated crest otherwise — the
 * repository ships no hero artwork.
 */
export function portrait(hero, size = 'md') {
  const wrap = el('span', `crest crest--${size} class-${(hero.classes[0] || 'tank').toLowerCase()}`);
  wrap.style.setProperty('--crest-hue', hueFor(hero.id));

  if (hero.portrait) {
    const img = el('img', 'crest__img');
    img.src = hero.portrait;
    img.alt = '';
    img.loading = 'lazy';
    img.addEventListener('error', () => {
      img.remove();
      wrap.appendChild(el('span', 'crest__text', initials(hero.name)));
    });
    wrap.appendChild(img);
  } else {
    wrap.appendChild(el('span', 'crest__text', initials(hero.name)));
  }
  return wrap;
}

export function laneLabel(data, laneId) {
  const lane = data.config.lanes.find((l) => l.id === laneId);
  return lane ? lane.label : laneId;
}

export function laneShort(data, laneId) {
  const lane = data.config.lanes.find((l) => l.id === laneId);
  return lane ? lane.short : laneId.toUpperCase();
}

export function meterRow(label, value, tone) {
  const row = el('div', 'meter');
  row.appendChild(el('span', 'meter__label', label));
  const track = el('span', 'meter__track');
  const fill = el('span', `meter__fill meter__fill--${tone || 'neutral'}`);
  fill.style.width = `${Math.max(2, Math.min(100, value))}%`;
  track.appendChild(fill);
  row.appendChild(track);
  row.appendChild(el('span', 'meter__value', String(Math.round(value))));
  return row;
}

export function toast(message, tone = 'info') {
  const host = document.getElementById('toast-host');
  if (!host) return;
  const node = el('div', `toast toast--${tone}`, message);
  host.appendChild(node);
  window.setTimeout(() => {
    node.classList.add('toast--out');
    window.setTimeout(() => node.remove(), 220);
  }, 2600);
}
