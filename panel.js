/**
 * panel.js — the centre column: live recommendations, synergy callout and the
 * broadcast-style strength meter.
 */

import { el, clear, portrait } from './render.js';
import { recommendPicks, recommendBans, bestSynergyFor } from './recommender.js';
import { compareStrength } from './strength.js';
import { getSelections, getUnavailable } from './state.js';

function recommendationCard(data, row, rank, action, onSelect) {
  const card = el('article', 'rec');
  card.appendChild(el('span', 'rec__rank', String(rank)));
  card.appendChild(portrait(row.hero, 'md'));

  const body = el('div', 'rec__body');
  const head = el('div', 'rec__head');
  head.appendChild(el('span', 'rec__name', row.hero.name));
  head.appendChild(el('span', 'rec__score', String(Math.round(row.total))));
  body.appendChild(head);

  const why = el('ul', 'rec__why');
  (row.reasons.length ? row.reasons : ['Highest overall score with the current board']).forEach((reason) => {
    why.appendChild(el('li', null, reason));
  });
  body.appendChild(why);
  card.appendChild(body);

  const act = el('button', `rec__act rec__act--${action}`, action === 'ban' ? 'Ban' : 'Lock');
  act.type = 'button';
  act.addEventListener('click', () => onSelect(row.hero));
  card.appendChild(act);

  return card;
}

export function renderRecommendations(host, data, snapshot, onSelect) {
  clear(host);
  const step = snapshot.currentStep;

  if (!step) {
    host.appendChild(el('p', 'empty', 'Both sides are locked in. The pre-game brief is on the Strategy tab.'));
    return;
  }

  const rows =
    step.action === 'ban'
      ? recommendBans(data, snapshot, step.team, 5)
      : recommendPicks(data, snapshot, step.team, 5);

  const head = el('div', 'section__head');
  head.appendChild(
    el(
      'h2',
      'section__title',
      step.action === 'ban' ? 'Ban these first' : 'Recommended picks'
    )
  );
  head.appendChild(
    el(
      'span',
      'section__note',
      step.action === 'ban'
        ? 'Ranked by threat to your draft'
        : 'Ranked by counter, synergy, comfort and meta'
    )
  );
  host.appendChild(head);

  const list = el('div', 'recs');
  rows.forEach((row, i) => {
    list.appendChild(recommendationCard(data, row, i + 1, step.action, onSelect));
  });
  host.appendChild(list);
}

export function renderSynergy(host, data, snapshot, onSelect) {
  clear(host);
  const step = snapshot.currentStep;
  if (!step || step.action !== 'pick') return;

  const ourPicks = getSelections(step.team, 'pick');
  if (ourPicks.length === 0) return;

  const anchor = data.byId.get(ourPicks[ourPicks.length - 1]);
  const unavailable = getUnavailable();
  const available = data.heroes.filter((h) => !unavailable.has(h.id));
  const partners = bestSynergyFor(data, anchor, available, 2);
  if (partners.length === 0) return;

  const head = el('div', 'section__head');
  head.appendChild(el('h2', 'section__title', 'Synergy watch'));
  head.appendChild(el('span', 'section__note', `Pairs with ${anchor.name}`));
  host.appendChild(head);

  const list = el('div', 'syn');
  partners.forEach((row) => {
    const item = el('button', 'syn__item');
    item.type = 'button';
    item.appendChild(portrait(row.hero, 'sm'));
    const body = el('div', 'syn__body');
    body.appendChild(el('span', 'syn__name', `${anchor.name} + ${row.hero.name}`));
    body.appendChild(
      el('span', 'syn__reason', row.reason ? row.reason.text.replace(/\s*\(with [^)]+\)$/, '') : 'Complementary kits')
    );
    item.appendChild(body);
    item.addEventListener('click', () => onSelect(row.hero));
    list.appendChild(item);
  });
  host.appendChild(list);
}

export function renderStrength(host, data) {
  clear(host);
  const { blue, red, rows } = compareStrength(data);

  const head = el('div', 'section__head');
  head.appendChild(el('h2', 'section__title', 'Draft strength'));
  head.appendChild(el('span', 'section__note', `Blue ${blue.locked}/5 · Red ${red.locked}/5 locked`));
  host.appendChild(head);

  const meter = el('div', 'tugs');
  rows.forEach((row) => {
    const block = el('div', `tug ${row.edge ? `tug--edge-${row.edge}` : ''}`);

    const line = el('div', 'tug__head');
    line.appendChild(el('span', 'tug__val tug__val--blue', String(row.blue)));
    line.appendChild(el('span', 'tug__label', row.label));
    line.appendChild(el('span', 'tug__val tug__val--red', String(row.red)));
    block.appendChild(line);

    const bars = el('div', 'tug__bars');
    const left = el('div', 'tug__side tug__side--blue');
    const leftFill = el('i');
    leftFill.style.width = `${row.blue}%`;
    left.appendChild(leftFill);
    const right = el('div', 'tug__side tug__side--red');
    const rightFill = el('i');
    rightFill.style.width = `${row.red}%`;
    right.appendChild(rightFill);
    bars.appendChild(left);
    bars.appendChild(right);
    block.appendChild(bars);

    meter.appendChild(block);
  });
  host.appendChild(meter);
}
