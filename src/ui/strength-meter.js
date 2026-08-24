/**
 * strength-meter.js — draft strength, sized for a phone.
 *
 * Collapsed it is seven one-line bars you can read at a glance while the clock
 * runs. Expanded it becomes the tug-of-war comparison against the enemy draft.
 * The expand state lives in the store, so it survives a re-render — a panel that
 * silently re-collapsed after every pick would be worse than not having it.
 */

import { el, clear, button } from './dom.js';
import { compare } from '../engine/composition.js';

export function renderStrength(host, registry, model, onToggle) {
  clear(host);
  const { ourPicks, theirPicks, expanded, ourLabel, theirLabel } = model;
  const { rows, us, them } = compare(registry, ourPicks, theirPicks);

  const head = el('div', 'sect__head');
  head.appendChild(el('h2', 'sect__title', 'Draft strength'));
  head.appendChild(el('span', 'sect__note', `${ourLabel} ${us.locked}/5 · ${theirLabel} ${them.locked}/5`));
  host.appendChild(head);

  if (!us.locked && !them.locked) {
    host.appendChild(el('p', 'empty', 'Fills in as heroes are locked.'));
    return;
  }

  const list = el('div', expanded ? 'tugs' : 'bars');
  rows.forEach((row) => {
    if (!expanded) {
      const line = el('div', 'bar');
      line.appendChild(el('span', 'bar__label', row.short));
      const track = el('span', 'bar__track');
      const fill = el('span', `bar__fill${row.edge === 'us' ? ' bar__fill--lead' : ''}`);
      fill.style.width = `${Math.max(2, row.us)}%`;
      track.appendChild(fill);
      line.appendChild(track);
      line.appendChild(el('span', 'bar__value', String(row.us)));
      list.appendChild(line);
      return;
    }

    const block = el('div', `tug${row.edge ? ` tug--edge-${row.edge}` : ''}`);
    const line = el('div', 'tug__head');
    line.appendChild(el('span', 'tug__val tug__val--us', String(row.us)));
    line.appendChild(el('span', 'tug__label', row.label));
    line.appendChild(el('span', 'tug__val tug__val--them', String(row.them)));
    block.appendChild(line);

    const bars = el('div', 'tug__bars');
    const left = el('div', 'tug__side tug__side--us');
    const leftFill = el('i');
    leftFill.style.width = `${row.us}%`;
    left.appendChild(leftFill);
    const right = el('div', 'tug__side tug__side--them');
    const rightFill = el('i');
    rightFill.style.width = `${row.them}%`;
    right.appendChild(rightFill);
    bars.appendChild(left);
    bars.appendChild(right);
    block.appendChild(bars);
    list.appendChild(block);
  });
  host.appendChild(list);

  host.appendChild(
    button('btn btn--quiet btn--wide', expanded ? 'Hide the comparison' : 'Compare with the enemy draft', onToggle, {
      pressed: expanded
    })
  );
}
