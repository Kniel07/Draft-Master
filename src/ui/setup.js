/**
 * setup.js — what the app needs to know before it can advise.
 *
 * Ranked: rank, lane, comfort pool. Tournament: side and scouting.
 * All of it optional — the draft board works with none of it filled in, because
 * a tool that demands setup before it will say anything is a tool you close.
 */

import { el, clear, button, portrait, stars } from './dom.js';

function fieldset(title, note) {
  const section = el('section', 'setup__block');
  const head = el('div', 'sect__head');
  head.appendChild(el('h2', 'sect__title', title));
  if (note) head.appendChild(el('span', 'sect__note', note));
  section.appendChild(head);
  return section;
}

function modePicker(registry, snapshot, handlers) {
  const block = fieldset('Mode', registry.config.app.principle);
  const row = el('div', 'segment');
  row.setAttribute('role', 'group');
  row.setAttribute('aria-label', 'Draft mode');
  Object.values(registry.config.modes).forEach((mode) => {
    const active = snapshot.mode === mode.id;
    const item = button(`segment__btn${active ? ' is-active' : ''}`, mode.label, () => handlers.onMode(mode.id), {
      pressed: active
    });
    row.appendChild(item);
  });
  block.appendChild(row);
  block.appendChild(
    el('p', 'setup__hint', (registry.config.modes[snapshot.mode] || {}).description || '')
  );
  return block;
}

function rankPicker(registry, snapshot, handlers, status) {
  const block = fieldset('Your rank', 'Recommendations use this rank’s statistics where the source has them');
  const grid = el('div', 'ranks');
  (registry.ranks.tiers || []).forEach((tier) => {
    const active = snapshot.rank === tier.id;
    const item = button(`rankbtn${active ? ' is-active' : ''}`, null, () => handlers.onRank(tier.id), {
      pressed: active
    });
    item.appendChild(el('span', 'rankbtn__short', tier.short));
    item.appendChild(el('span', 'rankbtn__label', tier.label));
    if (tier.exact === false) item.appendChild(el('span', 'rankbtn__flag', 'approx'));
    grid.appendChild(item);
  });
  block.appendChild(grid);

  const tier = (registry.ranks.tiers || []).find((t) => t.id === snapshot.rank);
  if (tier) {
    block.appendChild(el('p', 'setup__hint', tier.blurb));
    if (tier.exact === false && tier.fallbackNote) {
      block.appendChild(el('p', 'setup__warn', tier.fallbackNote));
    }
  }
  if (status && status.rank && status.live) {
    block.appendChild(el('p', 'setup__hint', status.detail));
  }
  return block;
}

function rolePicker(registry, snapshot, handlers) {
  const block = fieldset('Your role', 'Optional. Set it and picks are ranked for that lane first');
  const row = el('div', 'chips chips--wide');
  registry.config.lanes.forEach((lane) => {
    const active = snapshot.selectedRole === lane.id;
    row.appendChild(
      button(`chip chip--lg${active ? ' is-active' : ''}`, lane.short, () => handlers.onRole(lane.id), {
        pressed: active,
        label: `Play ${lane.label}`
      })
    );
  });
  block.appendChild(row);
  return block;
}

function heroChips(registry, ids, { onRemove, ratings, onRate }) {
  const list = el('ul', 'pool');
  ids.forEach((heroId) => {
    const hero = registry.byId.get(heroId);
    if (!hero) return;
    const item = el('li', 'pool__item');

    const label = el('div', 'pool__hero');
    label.appendChild(portrait(hero, 'xs', registry.liveStats));
    label.appendChild(el('span', 'pool__name', hero.name));
    item.appendChild(label);

    if (ratings) {
      const rating = ratings[heroId] || 3;
      const rate = el('div', 'rate');
      rate.setAttribute('role', 'group');
      rate.setAttribute('aria-label', `Comfort on ${hero.name}`);
      for (let i = 1; i <= 5; i += 1) {
        const star = button(`rate__star${i <= rating ? ' is-on' : ''}`, '★', () => onRate(heroId, i), {
          label: `${i} of 5 on ${hero.name}`
        });
        rate.appendChild(star);
      }
      item.appendChild(rate);
      item.setAttribute('data-stars', stars(rating));
    }

    item.appendChild(button('pool__x', '✕', () => onRemove(heroId), { label: `Remove ${hero.name}` }));
    list.appendChild(item);
  });
  return list;
}

function comfortPool(registry, snapshot, handlers) {
  const block = fieldset(
    'Your comfort pool',
    'Comfort nudges the ranking. It is capped by its weight, so it never turns a bad matchup into the top pick'
  );

  if (!snapshot.comfortHeroes.length) {
    block.appendChild(el('p', 'empty', 'Nothing added yet. Recommendations work fine without it.'));
  } else {
    block.appendChild(
      heroChips(registry, snapshot.comfortHeroes, {
        onRemove: handlers.onToggleComfort,
        ratings: snapshot.comfortRating,
        onRate: handlers.onRateComfort
      })
    );
  }

  const actions = el('div', 'setup__actions');
  actions.appendChild(button('btn btn--wide', 'Add comfort heroes', () => handlers.onBrowseComfort()));
  if (snapshot.comfortHeroes.length) {
    actions.appendChild(button('btn btn--quiet', 'Clear all', () => handlers.onClearComfort()));
  }
  block.appendChild(actions);
  return block;
}

function sidePicker(registry, snapshot, handlers) {
  const block = fieldset('Your side', 'Which side your team is drafting on');
  const row = el('div', 'segment');
  row.setAttribute('role', 'group');
  row.setAttribute('aria-label', 'Your side');
  ['blue', 'red'].forEach((side) => {
    const active = snapshot.side === side;
    row.appendChild(
      button(`segment__btn segment__btn--${side}${active ? ' is-active' : ''}`, side === 'blue' ? 'Blue side' : 'Red side', () =>
        handlers.onSide(side), { pressed: active })
    );
  });
  block.appendChild(row);
  return block;
}

function scouting(registry, snapshot, handlers) {
  const block = fieldset('Scouted opponent heroes', 'The highest-signal input to ban priority');
  if (!snapshot.scoutedHeroes.length) {
    block.appendChild(el('p', 'empty', 'Nothing scouted. Ban priority falls back to meta and matchup.'));
  } else {
    block.appendChild(heroChips(registry, snapshot.scoutedHeroes, { onRemove: handlers.onToggleScouted }));
  }
  const actions = el('div', 'setup__actions');
  actions.appendChild(button('btn btn--wide', 'Add scouted heroes', () => handlers.onBrowseScouted()));
  if (snapshot.scoutedHeroes.length) {
    actions.appendChild(button('btn btn--quiet', 'Clear all', () => handlers.onClearScouted()));
  }
  block.appendChild(actions);
  return block;
}

function dataBlock(registry, status, handlers) {
  const block = fieldset('Data', status.label);
  const list = el('dl', 'datalist');

  const rows = [
    ['Server', registry.config.app.server],
    ['Patch', registry.patch],
    ['Updated', status.updatedLabel || '—'],
    ['Source', status.live ? 'Public MLBB data (live)' : status.source === 'cache' ? 'Public MLBB data (cached)' : 'Bundled with this build'],
    ['Heroes', String(registry.heroes.length)]
  ];
  if (status.rank) rows.splice(3, 0, ['Rank data', `${status.rank}${status.rankExact ? '' : ' (approximated)'}`]);

  rows.forEach(([term, value]) => {
    list.appendChild(el('dt', null, term));
    list.appendChild(el('dd', null, value));
  });
  block.appendChild(list);
  block.appendChild(el('p', 'setup__hint', status.detail));

  const notes = (registry.diagnostics.live && registry.diagnostics.live.notes) || [];
  notes.forEach((note) => block.appendChild(el('p', 'setup__hint', note)));

  const warnings = registry.diagnostics.warnings || [];
  if (warnings.length) {
    const details = el('details', 'diag');
    details.appendChild(el('summary', null, `${warnings.length} data warning${warnings.length === 1 ? '' : 's'}`));
    const ul = el('ul', 'diag__list');
    warnings.slice(0, 20).forEach((warning) => ul.appendChild(el('li', null, warning)));
    details.appendChild(ul);
    details.appendChild(
      el('p', 'setup__hint', 'Every hero above is still selectable — a warning never removes one from the pool.')
    );
    block.appendChild(details);
  }

  const actions = el('div', 'setup__actions');
  actions.appendChild(button('btn btn--wide', 'Refresh live data', () => handlers.onRefresh()));
  block.appendChild(actions);
  if (registry.config.api && registry.config.api.attribution) {
    block.appendChild(el('p', 'setup__credit', registry.config.api.attribution));
  }
  return block;
}

export function renderSetup(host, registry, snapshot, status, handlers) {
  clear(host);
  host.appendChild(modePicker(registry, snapshot, handlers));

  if (snapshot.mode === 'ranked') {
    host.appendChild(rankPicker(registry, snapshot, handlers, status));
    host.appendChild(rolePicker(registry, snapshot, handlers));
    host.appendChild(comfortPool(registry, snapshot, handlers));
  } else {
    host.appendChild(sidePicker(registry, snapshot, handlers));
    host.appendChild(rankPicker(registry, snapshot, handlers, status));
    host.appendChild(comfortPool(registry, snapshot, handlers));
    host.appendChild(scouting(registry, snapshot, handlers));
  }

  host.appendChild(dataBlock(registry, status, handlers));
}
