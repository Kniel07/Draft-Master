/**
 * lane-picker.js — "what is this hero actually playing?"
 *
 * Deliberately the smallest thing that closes the loop. The app can infer a
 * lane and can say when a pairing is unusual, but only the player knows what
 * their team decided, so there has to be somewhere to say it. This is that
 * somewhere: one row of chips, an Auto escape hatch, and the hero's known roles
 * shown as context rather than as a constraint.
 *
 * It reuses the hero sheet's chrome, so it costs no new layout, no new scroll
 * container and no new way for the page to move.
 */

import { el, clear, button, portrait, laneShort } from './dom.js';

export function createLanePicker(registry, { onAssign, onClose }) {
  const root = el('div', 'sheet sheet--short');
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'Assign a lane');

  const backdrop = el('div', 'sheet__backdrop');
  backdrop.addEventListener('click', () => api.close());
  root.appendChild(backdrop);

  const panel = el('div', 'sheet__panel');
  root.appendChild(panel);

  const head = el('div', 'sheet__head');
  const titles = el('div', 'sheet__titles');
  const title = el('h2', 'sheet__title', 'Assign a lane');
  const note = el('p', 'sheet__note', '');
  titles.appendChild(title);
  titles.appendChild(note);
  head.appendChild(titles);
  head.appendChild(button('sheet__close', '✕', () => api.close(), { label: 'Close' }));
  panel.appendChild(head);

  const body = el('div', 'sheet__body lanepick');
  panel.appendChild(body);

  let current = null;

  function render() {
    clear(body);
    if (!current) return;
    const { hero, assigned, current: playing, unorthodox } = current;

    const heroRow = el('div', 'lanepick__hero');
    heroRow.appendChild(portrait(hero, 'md', registry.liveStats));
    const meta = el('div', 'lanepick__meta');
    meta.appendChild(el('span', 'lanepick__name', hero.name));
    meta.appendChild(
      el(
        'span',
        'lanepick__known',
        (hero.playableLanes || hero.lanes || []).length
          ? `Known roles: ${(hero.playableLanes || hero.lanes).map((l) => laneShort(registry, l)).join(' · ')}`
          : 'No role data for this hero'
      )
    );
    heroRow.appendChild(meta);
    body.appendChild(heroRow);

    const chips = el('div', 'chips chips--wide lanepick__chips');
    chips.setAttribute('role', 'group');
    chips.setAttribute('aria-label', 'Lane');

    registry.config.lanes.forEach((lane) => {
      const active = assigned === lane.id;
      // The lane the hero is playing right now, arrived at by inference rather
      // than by the player. Shown differently from an explicit choice so
      // "nothing is selected" never means "nowhere assigned".
      const inferred = !assigned && playing === lane.id;
      const known = hero.playableLanes || hero.lanes || [];
      const off = known.length && !known.includes(lane.id);
      const chip = button(
        `chip chip--lg${active ? ' is-active' : ''}${inferred ? ' is-current' : ''}${off ? ' chip--off' : ''}`,
        lane.short,
        () => onAssign(hero.id, lane.id),
        { pressed: active, label: `Assign ${hero.name} to ${lane.label}` }
      );
      chips.appendChild(chip);
    });
    body.appendChild(chips);

    const playingLane = registry.config.lanes.find((l) => l.id === playing);
    body.appendChild(
      el(
        'p',
        'lanepick__state',
        playingLane
          ? assigned
            ? `Playing ${playingLane.label} — you set this.`
            : `Playing ${playingLane.label} — worked out automatically. Tap a lane to fix it in place.`
          : 'No lane worked out yet.'
      )
    );

    if (assigned) {
      body.appendChild(
        button('btn btn--quiet btn--wide', 'Back to automatic', () => onAssign(hero.id, null), {
          label: `Clear the lane assignment for ${hero.name}`
        })
      );
    }

    if (unorthodox) {
      body.appendChild(el('p', 'lanepick__warn', unorthodox));
    }
    body.appendChild(
      el(
        'p',
        'lanepick__hint',
        'Unusual is not invalid. The app will flag an off-role assignment so you can see it, and then leave it alone.'
      )
    );
  }

  const api = {
    root,
    open(context) {
      current = context;
      title.textContent = 'Assign a lane';
      note.textContent = `${context.hero.name} — what is this hero playing?`;
      render();
      root.hidden = false;
      document.body.classList.add('is-locked');
    },
    update(context) {
      if (root.hidden) return;
      current = context;
      render();
    },
    close() {
      if (root.hidden) return;
      root.hidden = true;
      current = null;
      document.body.classList.remove('is-locked');
      if (onClose) onClose();
    },
    isOpen() {
      return !root.hidden;
    },
    heroId() {
      return current ? current.hero.id : null;
    }
  };

  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') api.close();
  });

  return api;
}
