/**
 * board.js — the broadcast surface: timeline, both team boards, turn banner.
 */

import { el, clear, portrait, laneShort } from './render.js';
import { getSelections, getSlotCounts } from './state.js';

function stepChip(data, step, index, snapshot) {
  const entry = snapshot.history.find((h) => h.stepIndex === index);
  const isActive = snapshot.stepIndex === index;
  const chip = el(
    'li',
    [
      'tl__step',
      `tl__step--${step.team}`,
      `tl__step--${step.action}`,
      entry ? 'is-done' : '',
      isActive ? 'is-active' : ''
    ]
      .filter(Boolean)
      .join(' ')
  );
  chip.setAttribute('role', 'listitem');

  const label = el('span', 'tl__index', String(index + 1));
  chip.appendChild(label);

  if (entry) {
    const hero = data.byId.get(entry.heroId);
    chip.appendChild(portrait(hero, 'xs'));
    chip.title = `${step.phase}: ${step.team === 'blue' ? 'Blue' : 'Red'} ${step.action} — ${hero.name}`;
  } else {
    chip.appendChild(el('span', 'tl__action', step.action === 'ban' ? 'BAN' : 'PICK'));
    chip.title = `${step.phase}: ${step.team === 'blue' ? 'Blue' : 'Red'} ${step.action}`;
  }
  return chip;
}

export function renderTimeline(host, data, snapshot) {
  clear(host);
  const list = el('ol', 'tl');
  list.setAttribute('role', 'list');
  list.setAttribute('aria-label', 'Pick and ban order');
  snapshot.steps.forEach((step, index) => {
    list.appendChild(stepChip(data, step, index, snapshot));
  });
  host.appendChild(list);

  const active = list.querySelector('.is-active');
  if (active && typeof active.scrollIntoView === 'function') {
    active.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }
}

function pickSlot(data, hero, index) {
  const row = el('li', `slot ${hero ? 'is-filled' : ''}`);
  if (hero) {
    row.appendChild(portrait(hero, 'md'));
    const meta = el('div', 'slot__meta');
    meta.appendChild(el('span', 'slot__name', hero.name));
    meta.appendChild(el('span', 'slot__role', hero.lanes.map((l) => laneShort(data, l)).join(' · ')));
    row.appendChild(meta);
  } else {
    row.appendChild(el('span', 'crest crest--md crest--empty'));
    const meta = el('div', 'slot__meta');
    meta.appendChild(el('span', 'slot__name slot__name--empty', `Pick ${index + 1}`));
    row.appendChild(meta);
  }
  return row;
}

export function renderBoard(host, data, snapshot, team) {
  clear(host);
  const counts = getSlotCounts(team);
  const picks = getSelections(team, 'pick').map((id) => data.byId.get(id));
  const bans = getSelections(team, 'ban').map((id) => data.byId.get(id));

  const isTurn = snapshot.currentStep && snapshot.currentStep.team === team;
  host.className = `board board--${team} ${isTurn ? 'is-turn' : ''}`;

  const head = el('div', 'board__head');
  head.appendChild(el('span', 'board__title', team === 'blue' ? 'Blue Side' : 'Red Side'));
  head.appendChild(el('span', 'board__count', `${picks.length}/${counts.picks}`));
  host.appendChild(head);

  const banStrip = el('ul', 'bans');
  banStrip.setAttribute('aria-label', `${team} bans`);
  for (let i = 0; i < counts.bans; i += 1) {
    const hero = bans[i];
    const cell = el('li', `bans__cell ${hero ? 'is-filled' : ''}`);
    if (hero) {
      cell.appendChild(portrait(hero, 'xs'));
      cell.title = `Banned: ${hero.name}`;
    }
    banStrip.appendChild(cell);
  }
  host.appendChild(banStrip);

  const list = el('ul', 'slots');
  for (let i = 0; i < counts.picks; i += 1) {
    list.appendChild(pickSlot(data, picks[i], i));
  }
  host.appendChild(list);
}

export function renderTurnBanner(host, data, snapshot) {
  clear(host);
  const step = snapshot.currentStep;

  if (!step) {
    host.className = 'turn turn--done';
    host.appendChild(el('span', 'turn__phase', 'Draft complete'));
    host.appendChild(el('span', 'turn__call', 'Open the Strategy tab before you queue up.'));
    return;
  }

  const done = snapshot.history.filter((h) => h.team === step.team && h.action === step.action).length;
  host.className = `turn turn--${step.team}`;
  host.appendChild(el('span', 'turn__phase', step.phase));
  host.appendChild(
    el(
      'span',
      'turn__call',
      `${step.team === 'blue' ? 'Blue' : 'Red'} ${step.action === 'ban' ? 'ban' : 'pick'} ${done + 1}`
    )
  );
}
