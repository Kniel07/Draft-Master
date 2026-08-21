/**
 * strategy.js (view) — renders the pre-game brief for one side.
 *
 * Sequence matters here: win condition first, because that is the line the
 * shotcaller repeats. Everything below it supports that line.
 */

import { el, clear, portrait } from './render.js';
import { buildStrategy } from './strategy-engine.js';

const view = { team: 'blue' };

let hostRef = null;
let dataRef = null;
let snapshotRef = null;

function block(title, note) {
  const section = el('section', 'brief__block');
  const head = el('div', 'brief__head');
  head.appendChild(el('h3', 'brief__title', title));
  if (note) head.appendChild(el('span', 'brief__note', note));
  section.appendChild(head);
  return section;
}

function bulletList(items) {
  const list = el('ul', 'brief__list');
  items.forEach((item) => list.appendChild(el('li', null, item)));
  return list;
}

export function renderStrategy(host, data, snapshot) {
  hostRef = host;
  dataRef = data;
  snapshotRef = snapshot;
  clear(host);

  const head = el('div', 'section__head');
  head.appendChild(el('h2', 'section__title', 'Pre-game brief'));
  head.appendChild(el('span', 'section__note', 'Readable in 30 seconds'));
  host.appendChild(head);

  if (!snapshot.complete) {
    const remaining = snapshot.steps.length - snapshot.stepIndex;
    host.appendChild(
      el(
        'p',
        'empty',
        `The brief unlocks when both sides have locked five heroes. ${remaining} draft ${
          remaining === 1 ? 'action' : 'actions'
        } to go.`
      )
    );
    return;
  }

  const toggle = el('div', 'sidetoggle');
  toggle.setAttribute('role', 'group');
  toggle.setAttribute('aria-label', 'Brief for which side');
  ['blue', 'red'].forEach((team) => {
    const button = el('button', `sidetoggle__btn sidetoggle__btn--${team} ${view.team === team ? 'is-active' : ''}`);
    button.type = 'button';
    button.textContent = team === 'blue' ? 'Blue Side' : 'Red Side';
    button.addEventListener('click', () => {
      view.team = team;
      renderStrategy(hostRef, dataRef, snapshotRef);
    });
    toggle.appendChild(button);
  });
  host.appendChild(toggle);

  const brief = buildStrategy(data, view.team);
  const wrap = el('div', `brief brief--${view.team}`);

  const win = block('Win condition');
  win.appendChild(el('p', 'brief__headline', brief.winCondition.headline));
  win.appendChild(bulletList(brief.winCondition.detail));
  wrap.appendChild(win);

  const obj = block('Turtle & Lord');
  const objList = el('dl', 'brief__pairs');
  objList.appendChild(el('dt', null, 'Turtle'));
  objList.appendChild(el('dd', null, brief.objectives.turtle));
  objList.appendChild(el('dt', null, 'Lord'));
  objList.appendChild(el('dd', null, brief.objectives.lord));
  obj.appendChild(objList);
  wrap.appendChild(obj);

  const threats = block('Enemy threats', 'Highest pressure on your draft');
  const threatList = el('ul', 'threats');
  brief.threats.forEach((row) => {
    const item = el('li', 'threat');
    item.appendChild(portrait(row.hero, 'sm'));
    const body = el('div', 'threat__body');
    body.appendChild(el('span', 'threat__name', row.hero.name));
    body.appendChild(el('span', 'threat__note', row.note.replace(/\s*\(vs [^)]+\)$/, '')));
    item.appendChild(body);
    threatList.appendChild(item);
  });
  threats.appendChild(threatList);
  wrap.appendChild(threats);

  const lanes = block('Lane check', brief.lanes.valid ? 'All five lanes covered' : 'Needs attention');
  const laneList = el('ul', 'lanecheck');
  brief.lanes.rows.forEach((row) => {
    const item = el('li', `lanecheck__row ${row.hero ? '' : 'is-empty'} ${row.offRole ? 'is-warn' : ''}`);
    item.appendChild(el('span', 'lanecheck__tag', row.label));
    item.appendChild(el('span', 'lanecheck__hero', row.hero ? row.hero.name : 'Not covered'));
    if (row.offRole) item.appendChild(el('span', 'lanecheck__flag', 'off comfort role'));
    laneList.appendChild(item);
  });
  lanes.appendChild(laneList);
  if (brief.lanes.unplaced.length) {
    lanes.appendChild(
      el(
        'p',
        'brief__warn',
        `Role conflict: ${brief.lanes.unplaced.map((h) => h.name).join(', ')} ${
          brief.lanes.unplaced.length === 1 ? 'has' : 'have'
        } no free lane. Confirm the swap before the match starts.`
      )
    );
  }
  wrap.appendChild(lanes);

  const notes = block('Shotcaller reminders');
  notes.appendChild(bulletList(brief.reminders));
  wrap.appendChild(notes);

  host.appendChild(wrap);
}
