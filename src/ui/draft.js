/**
 * draft.js — the board.
 *
 * Mobile-first in the literal sense: this is designed at 360px and the desktop
 * arrangement is what the wide breakpoint does to it, not the other way round.
 * On a phone the whole board — both teams, both ban strips, the turn line — is
 * about a third of a screen, so the recommendations and the hero list stay in
 * reach without a long scroll.
 *
 * Ranked and tournament share these renderers. The difference is that a ranked
 * slot is tappable (free-form: the player is not in charge of the order in a
 * real lobby) while a tournament slot is filled by the sequence.
 */

import { el, clear, button, portrait, laneShort, scrollPanel } from './dom.js';
import { timeline, turnLabel } from '../engine/tournament.js';

/* ------------------------------------------------------------ ranked board */

/**
 * One pick slot, drawn as a tile: portrait over name over lane.
 *
 * Five tiles across rather than five stacked rows. On a 360px screen that is the
 * difference between the board taking two thirds of the first screen and taking
 * a fifth of it, which is the difference between seeing a recommendation
 * without scrolling and not.
 */
function slot(registry, hero, options) {
  const { label, onTap, onClear, onLane, tone, active, lane } = options;
  const cell = el(
    'div',
    ['slot', hero ? 'is-filled' : '', tone ? `slot--${tone}` : '', active ? 'is-active' : '']
      .filter(Boolean)
      .join(' ')
  );

  const tap = el('button', 'slot__tap');
  tap.type = 'button';
  tap.setAttribute('aria-label', hero ? `${label}: ${hero.name}. Change.` : `${label}: empty. Choose a hero.`);
  tap.appendChild(hero ? portrait(hero, 'sm', registry.liveStats) : el('span', 'crest crest--sm crest--empty'));

  const body = el('span', 'slot__body');
  body.appendChild(el('span', `slot__name${hero ? '' : ' slot__name--empty'}`, hero ? hero.name : label));
  tap.appendChild(body);

  if (onTap) tap.addEventListener('click', onTap);
  cell.appendChild(tap);

  // The lane chip shows what this hero is *playing*, not what its role data
  // says it usually plays — and it is a button, because that assignment is the
  // player's to make. An off-role assignment is marked, never corrected.
  if (hero && lane) {
    const chip = el(
      'button',
      `slot__lane${lane.unorthodox ? ' is-unorthodox' : ''}${onLane ? '' : ' is-static'}`
    );
    chip.type = 'button';
    chip.textContent = lane.unorthodox ? `${laneShort(registry, lane.laneId)} !` : laneShort(registry, lane.laneId);
    chip.setAttribute(
      'aria-label',
      `${hero.name} is playing ${lane.label}${lane.unorthodox ? ', an unorthodox assignment' : ''}.` +
        (onLane ? ' Change it.' : '')
    );
    if (onLane) chip.addEventListener('click', () => onLane(hero));
    else chip.disabled = true;
    cell.appendChild(chip);
  }

  if (hero && onClear) {
    cell.appendChild(button('slot__clear', '✕', onClear, { label: `Clear ${hero.name}` }));
  }
  return cell;
}

function banStrip(registry, ids, count, options) {
  const strip = el('ul', 'bans');
  strip.setAttribute('aria-label', options.label);
  for (let i = 0; i < count; i += 1) {
    const hero = ids[i] ? registry.byId.get(ids[i]) : null;
    const cell = el('li', `bans__cell${hero ? ' is-filled' : ''}`);
    const tap = el('button', 'bans__tap');
    tap.type = 'button';
    tap.setAttribute('aria-label', hero ? `Ban ${i + 1}: ${hero.name}` : `Ban ${i + 1}: empty`);
    if (hero) {
      tap.appendChild(portrait(hero, 'xs', registry.liveStats));
      tap.title = `Banned: ${hero.name}`;
    } else {
      tap.appendChild(el('span', 'bans__x', '·'));
    }
    if (options.onTap) {
      const index = i;
      tap.addEventListener('click', () => options.onTap(index, hero));
    }
    cell.appendChild(tap);
    strip.appendChild(cell);
  }
  return strip;
}

/** Ranked: one team block — bans on top, five pick slots under it. */
function rankedTeam(registry, snapshot, handlers, side) {
  const isAlly = side === 'ally';
  const host = el('section', `team team--${isAlly ? 'ally' : 'enemy'}`);

  const head = el('div', 'team__head');
  head.appendChild(el('h2', 'team__title', isAlly ? 'Your team' : 'Enemy'));
  const picks = isAlly ? snapshot.allies : snapshot.enemies;
  head.appendChild(el('span', 'team__count', `${picks.filter(Boolean).length}/${picks.length}`));
  host.appendChild(head);

  const bansIds = isAlly ? snapshot.allyBans : snapshot.enemyBans;
  host.appendChild(
    banStrip(registry, bansIds, bansIds.length, {
      label: `${isAlly ? 'Your' : 'Enemy'} bans`,
      onTap: (index, hero) =>
        hero
          ? handlers.onClearSlot(isAlly ? 'allyBans' : 'enemyBans', index)
          : handlers.onOpenSlot(isAlly ? 'allyBans' : 'enemyBans', index)
    })
  );

  const list = el('div', 'slots');
  picks.forEach((heroId, index) => {
    const hero = heroId ? registry.byId.get(heroId) : null;
    const group = isAlly ? 'allies' : 'enemies';
    const isYou = isAlly && snapshot.selectedRole && index === 0;
    list.appendChild(
      slot(registry, hero, {
        label: isYou ? 'You' : String(index + 1),
        tone: isAlly ? 'ally' : 'enemy',
        active: snapshot.target && snapshot.target.group === group && snapshot.target.index === index,
        lane: hero ? handlers.laneFor(hero.id) : null,
        onTap: () => handlers.onOpenSlot(group, index),
        onLane: hero ? (h) => handlers.onOpenLane(h) : null,
        onClear: hero ? () => handlers.onClearSlot(group, index) : null
      })
    );
  });
  host.appendChild(list);
  return host;
}

export function renderRankedBoard(host, registry, snapshot, handlers) {
  clear(host);
  host.appendChild(rankedTeam(registry, snapshot, handlers, 'ally'));
  host.appendChild(rankedTeam(registry, snapshot, handlers, 'enemy'));
}

/* -------------------------------------------------------- tournament board */

export function renderTimeline(host, registry, snapshot) {
  clear(host);
  const list = el('ol', 'tl');
  list.setAttribute('aria-label', 'Pick and ban order');

  let activeChip = null;
  timeline(registry, snapshot).forEach((step) => {
    const chip = el(
      'li',
      ['tl__step', `tl__step--${step.team}`, `tl__step--${step.action}`, step.done ? 'is-done' : '', step.active ? 'is-active' : '']
        .filter(Boolean)
        .join(' ')
    );
    chip.appendChild(el('span', 'tl__index', String(step.index + 1)));
    if (step.hero) {
      chip.appendChild(portrait(step.hero, 'xs', registry.liveStats));
      chip.title = `${step.phase}: ${step.team} ${step.action} — ${step.hero.name}`;
    } else {
      chip.appendChild(el('span', 'tl__action', step.action === 'ban' ? 'BAN' : 'PICK'));
      chip.title = `${step.phase}: ${step.team} ${step.action}`;
    }
    if (step.active) activeChip = chip;
    list.appendChild(chip);
  });
  host.appendChild(list);

  // The only scroll in the app, and it moves this strip alone — assigning
  // scrollLeft on the container cannot propagate to an ancestor the way
  // scrollIntoView does, so the page behind it stays exactly where it was.
  if (activeChip) scrollPanel(host, activeChip, { axis: 'x' });
}

function tournamentTeam(registry, snapshot, team, handlers) {
  const host = el('section', `team team--${team}${snapshot.currentStep && snapshot.currentStep.team === team ? ' is-turn' : ''}`);

  const head = el('div', 'team__head');
  const title = el('h2', 'team__title', team === 'blue' ? 'Blue side' : 'Red side');
  if (snapshot.side === team) title.appendChild(el('span', 'team__you', 'YOU'));
  head.appendChild(title);

  const picks = snapshot.history.filter((h) => h.team === team && h.action === 'pick').map((h) => h.heroId);
  const bans = snapshot.history.filter((h) => h.team === team && h.action === 'ban').map((h) => h.heroId);
  const slots = handlers.slotCounts(team);
  head.appendChild(el('span', 'team__count', `${picks.length}/${slots.picks}`));
  host.appendChild(head);

  host.appendChild(banStrip(registry, bans, slots.bans, { label: `${team} bans` }));

  const list = el('div', 'slots');
  for (let i = 0; i < slots.picks; i += 1) {
    const hero = picks[i] ? registry.byId.get(picks[i]) : null;
    list.appendChild(
      slot(registry, hero, {
        label: String(i + 1),
        tone: team,
        lane: hero ? handlers.laneFor(hero.id) : null,
        onLane: hero ? (h) => handlers.onOpenLane(h) : null
      })
    );
  }
  host.appendChild(list);
  return host;
}

export function renderTournamentBoard(host, registry, snapshot, handlers) {
  clear(host);
  host.appendChild(tournamentTeam(registry, snapshot, 'blue', handlers));
  host.appendChild(tournamentTeam(registry, snapshot, 'red', handlers));
}

/* ------------------------------------------------------------- turn banner */

export function renderTurn(host, registry, snapshot, handlers) {
  clear(host);

  if (snapshot.sequenced) {
    const turn = turnLabel(snapshot);
    host.className = `turn${turn.team ? ` turn--${turn.team}` : ' turn--done'}`;
    host.appendChild(el('span', 'turn__phase', turn.phase));
    host.appendChild(el('span', 'turn__call', turn.call));
    return;
  }

  // Ranked: the player says what they are about to do. Nothing else sets this.
  host.className = `turn turn--${snapshot.intent}`;
  host.appendChild(el('span', 'turn__phase', 'Your move'));

  const toggle = el('div', 'intent');
  toggle.setAttribute('role', 'group');
  toggle.setAttribute('aria-label', 'What are you doing now?');
  [
    { id: 'pick', label: "I'm picking" },
    { id: 'ban', label: "I'm banning" }
  ].forEach((option) => {
    const active = snapshot.intent === option.id;
    toggle.appendChild(
      button(`intent__btn${active ? ' is-active' : ''}`, option.label, () => handlers.onIntent(option.id), {
        pressed: active
      })
    );
  });
  host.appendChild(toggle);
}
