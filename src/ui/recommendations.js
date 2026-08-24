/**
 * recommendations.js — advice, rendered as choices.
 *
 * This is the file the brief is most specific about, so the rules are worth
 * stating where they are implemented:
 *
 *   · Every recommendation carries its own action button. There is no "the"
 *     recommendation and no primary action that the layout pushes you toward.
 *   · Nothing here calls commit on its own. A hero moves only when a finger
 *     lands on a button.
 *   · Ignore hides one row. It does not lock anything, does not advance the
 *     draft, and does not require a replacement choice.
 *   · Every row opens a "Why?" panel showing the actual weighted components
 *     that produced the ranking — the same numbers, not a retelling.
 *   · "Browse all heroes" sits under the list at all times, because ignoring
 *     every suggestion has to be a first-class path, not an escape hatch.
 */

import { el, clear, button, portrait, keepScroll } from './dom.js';
import { explain } from '../engine/recommendation.js';

/** Reasons shown on the face of a card. The rest live under "Why?". */
const COLLAPSED_REASONS = 2;
/** Suggestions shown before the player asks for more. */
export const COLLAPSED_ROWS = 3;

/** Two reasons in the card, the rest behind "Why?" — a draft clock does not
 *  leave time to read four bullets per hero across five heroes. */
function reasonList(reasons, limit) {
  const list = el('ul', 'rec__why');
  reasons.slice(0, limit).forEach((reason) => list.appendChild(el('li', null, reason)));
  return list;
}

function breakdownPanel(registry, row, action) {
  const panel = el('div', 'rec__detail');
  panel.appendChild(el('p', 'rec__prose', explain(row, action)));

  if (row.reasons.length > COLLAPSED_REASONS) {
    panel.appendChild(reasonList(row.reasons.slice(COLLAPSED_REASONS), row.reasons.length));
  }

  const table = el('dl', 'rec__scores');
  row.breakdown.forEach((part) => {
    const term = el('dt', null, part.label);
    const value = el('dd', null, `${part.points >= 0 ? '+' : ''}${part.points.toFixed(0)}`);
    const meter = el('span', 'rec__scorebar');
    const fill = el('i');
    fill.style.width = `${Math.max(2, Math.min(100, part.value))}%`;
    meter.appendChild(fill);
    term.appendChild(meter);
    table.appendChild(term);
    table.appendChild(value);
  });
  panel.appendChild(table);

  if (row.metaDetail) {
    panel.appendChild(
      el(
        'p',
        'rec__source',
        row.metaSource === 'live'
          ? `Measured — ${row.metaDetail}`
          : `Estimated — no live statistics for this rank, so this uses the ${row.metaDetail}.`
      )
    );
  }
  return panel;
}

function card(registry, row, rank, action, handlers, expanded) {
  const wrap = el('article', `rec${expanded ? ' is-open' : ''}`);

  const head = el('div', 'rec__head');
  head.appendChild(el('span', 'rec__rank', String(rank)));
  head.appendChild(portrait(row.hero, 'md', registry.liveStats));

  const body = el('div', 'rec__body');
  const line = el('div', 'rec__line');
  line.appendChild(el('span', 'rec__name', row.hero.name));
  const score = el('span', 'rec__score', String(Math.round(row.score)));
  score.setAttribute('aria-label', `${action === 'ban' ? 'Threat' : 'Score'} ${Math.round(row.score)} out of 100`);
  line.appendChild(score);
  body.appendChild(line);
  body.appendChild(el('span', 'rec__meta', action === 'ban' ? 'Threat' : 'Score'));
  head.appendChild(body);
  wrap.appendChild(head);

  wrap.appendChild(reasonList(row.reasons, COLLAPSED_REASONS));

  (row.warnings || []).forEach((warning) => {
    wrap.appendChild(el('p', 'rec__warn', warning));
  });

  const actions = el('div', 'rec__actions');
  actions.appendChild(
    button(
      `btn btn--act btn--${action}`,
      action === 'ban' ? 'Ban' : 'Pick',
      () => handlers.onCommit(row.hero),
      { label: `${action === 'ban' ? 'Ban' : 'Pick'} ${row.hero.name}` }
    )
  );
  actions.appendChild(
    button('btn btn--ghost', expanded ? 'Hide why' : 'Why?', () => handlers.onToggleWhy(row.hero.id), {
      label: `Why is ${row.hero.name} suggested?`
    })
  );
  actions.appendChild(
    button('btn btn--quiet', 'Ignore', () => handlers.onIgnore(row.hero), {
      label: `Ignore the ${row.hero.name} suggestion`
    })
  );
  wrap.appendChild(actions);

  if (expanded) wrap.appendChild(breakdownPanel(registry, row, action));
  return wrap;
}

/**
 * @param {HTMLElement} host
 * @param {object} registry
 * @param {{rows:Array, action:string, title:string, note:string, ignoredCount:number}} model
 * @param {{onCommit, onIgnore, onToggleWhy, onBrowse, onClearIgnored}} handlers
 */
export function renderRecommendations(host, registry, model, handlers) {
  // keepScroll guards the one case that can still move the viewport: swapping a
  // tall list for a shorter one mid-page.
  keepScroll(() => {
    clear(host);

    const head = el('div', 'sect__head');
    head.appendChild(el('h2', 'sect__title', model.title));
    if (model.note) head.appendChild(el('span', 'sect__note', model.note));
    host.appendChild(head);

    if (!model.rows.length) {
      host.appendChild(
        el(
          'p',
          'empty',
          model.ignoredCount
            ? 'You have set every suggestion aside. Browse the full list, or bring them back.'
            : 'Nothing left to suggest — the board is full.'
        )
      );
    }

    const shown = model.showAll ? model.rows : model.rows.slice(0, COLLAPSED_ROWS);
    const list = el('div', 'recs');
    shown.forEach((row, index) => {
      list.appendChild(
        card(registry, row, index + 1, model.action, handlers, model.expandedId === row.hero.id)
      );
    });
    host.appendChild(list);

    const foot = el('div', 'recs__foot');
    if (model.rows.length > COLLAPSED_ROWS) {
      foot.appendChild(
        button(
          'btn btn--quiet',
          model.showAll
            ? 'Show fewer suggestions'
            : `Show ${model.rows.length - COLLAPSED_ROWS} more suggestions`,
          () => handlers.onToggleAllRecs(),
          { pressed: model.showAll }
        )
      );
    }
    foot.appendChild(
      button('btn btn--wide btn--browse', 'Browse all heroes', () => handlers.onBrowse(), {
        label: 'Open the full hero list'
      })
    );
    if (model.ignoredCount) {
      foot.appendChild(
        button('btn btn--quiet', `Bring back ${model.ignoredCount} ignored`, () => handlers.onClearIgnored())
      );
    }
    host.appendChild(foot);

    host.appendChild(
      el(
        'p',
        'recs__disclaimer',
        'Suggestions only. Pick or ban anything you like — the app never chooses for you.'
      )
    );
  });
}

/** The synergy nudge under the recommendations, on pick turns only. */
export function renderSynergy(host, registry, partners, anchor, onCommit) {
  clear(host);
  if (!anchor || !partners.length) {
    host.hidden = true;
    return;
  }
  host.hidden = false;

  const head = el('div', 'sect__head');
  head.appendChild(el('h2', 'sect__title', 'Pairs well with'));
  head.appendChild(el('span', 'sect__note', anchor.name));
  host.appendChild(head);

  const list = el('div', 'syn');
  partners.forEach((row) => {
    const item = el('div', 'syn__item');
    item.appendChild(portrait(row.hero, 'sm', registry.liveStats));
    const body = el('div', 'syn__body');
    body.appendChild(el('span', 'syn__name', row.hero.name));
    body.appendChild(el('span', 'syn__reason', row.reason || 'Complementary kits'));
    item.appendChild(body);
    item.appendChild(button('btn btn--sm', 'Pick', () => onCommit(row.hero), { label: `Pick ${row.hero.name}` }));
    list.appendChild(item);
  });
  host.appendChild(list);
}
