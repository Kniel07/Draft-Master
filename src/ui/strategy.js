/**
 * strategy.js (view) — the pre-game brief.
 *
 * Win condition first, because that is the line the shotcaller repeats.
 * Everything under it supports that line. The whole panel is meant to be read in
 * about thirty seconds, so nothing here expands, nothing here paginates, and no
 * section runs past four bullets.
 */

import { el, clear, portrait } from './dom.js';
import { buildStrategy } from '../engine/strategy.js';

function block(title, note) {
  const section = el('section', 'brief__block');
  const head = el('div', 'brief__head');
  head.appendChild(el('h3', 'brief__title', title));
  if (note) head.appendChild(el('span', 'brief__note', note));
  section.appendChild(head);
  return section;
}

function bullets(items) {
  const list = el('ul', 'brief__list');
  items.forEach((item) => list.appendChild(el('li', null, item)));
  return list;
}

export function renderStrategy(host, registry, model) {
  clear(host);
  const { ourPicks, theirPicks, remaining, ourLabel, explicitLanes, onOpenLane } = model;

  const head = el('div', 'sect__head');
  head.appendChild(el('h2', 'sect__title', 'Pre-game brief'));
  head.appendChild(el('span', 'sect__note', `${ourLabel} · readable in 30 seconds`));
  host.appendChild(head);

  if (ourPicks.length < 5 || theirPicks.length < 5) {
    host.appendChild(
      el(
        'p',
        'empty',
        `The brief unlocks when both sides have five heroes. ${remaining} to go — a partial brief would be ` +
          `wrong, and being wrong here is worse than being absent.`
      )
    );
    return;
  }

  const brief = buildStrategy(registry, ourPicks, theirPicks, explicitLanes || {});
  const wrap = el('div', 'brief');

  const win = block('Win condition');
  win.appendChild(el('p', 'brief__headline', brief.winCondition.headline));
  win.appendChild(bullets(brief.winCondition.detail));
  wrap.appendChild(win);

  const obj = block('Objectives');
  const pairs = el('dl', 'brief__pairs');
  pairs.appendChild(el('dt', null, 'Turtle'));
  pairs.appendChild(el('dd', null, brief.objectives.turtle));
  pairs.appendChild(el('dt', null, 'Lord'));
  pairs.appendChild(el('dd', null, brief.objectives.lord));
  obj.appendChild(pairs);
  wrap.appendChild(obj);

  const threats = block('Enemy threats', 'Most pressure on your draft');
  const threatList = el('ul', 'threats');
  brief.threats.forEach((row) => {
    const item = el('li', 'threat');
    item.appendChild(portrait(row.hero, 'sm', registry.liveStats));
    const body = el('div', 'threat__body');
    body.appendChild(el('span', 'threat__name', row.hero.name));
    body.appendChild(el('span', 'threat__note', row.note));
    item.appendChild(body);
    threatList.appendChild(item);
  });
  threats.appendChild(threatList);
  wrap.appendChild(threats);

  const unusual = brief.lanes.unorthodox.length;
  const lanes = block(
    'Lane plan',
    brief.lanes.valid
      ? unusual
        ? `${unusual} unorthodox assignment${unusual === 1 ? '' : 's'}`
        : 'All five lanes covered'
      : 'Draft not finished'
  );

  const laneList = el('ul', 'lanecheck');
  brief.lanes.rows.forEach((row) => {
    const item = el('li', `lanecheck__row${row.hero ? '' : ' is-empty'}${row.unorthodox ? ' is-unusual' : ''}`);
    item.appendChild(el('span', 'lanecheck__tag', row.short));

    if (row.hero && onOpenLane) {
      // Tappable, because this is where an unorthodox assignment is noticed and
      // therefore where the player will want to correct or confirm it.
      const tap = el('button', 'lanecheck__hero lanecheck__hero--tap');
      tap.type = 'button';
      tap.textContent = row.hero.name;
      tap.setAttribute('aria-label', `${row.hero.name} is playing ${row.label}. Change the assignment.`);
      tap.addEventListener('click', () => onOpenLane(row.hero));
      item.appendChild(tap);
    } else {
      item.appendChild(el('span', 'lanecheck__hero', row.hero ? row.hero.name : 'Still to fill'));
    }

    if (row.unorthodox) item.appendChild(el('span', 'lanecheck__flag', 'unorthodox'));
    laneList.appendChild(item);
  });
  lanes.appendChild(laneList);

  // An unusual assignment is reported as what it is — unusual — and never as a
  // missing lane. The player already made this call; the brief's job is to make
  // sure they made it on purpose.
  brief.lanes.unorthodox.forEach((entry) => {
    lanes.appendChild(el('p', 'brief__warn', `⚠ Unorthodox assignment: ${entry.text}`));
  });

  lanes.appendChild(bullets(brief.lanes.notes));
  wrap.appendChild(lanes);

  const notes = block('Shotcaller reminders');
  notes.appendChild(bullets(brief.reminders));
  wrap.appendChild(notes);

  host.appendChild(wrap);
}
