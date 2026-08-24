/**
 * tools/ui-test.mjs — headless run of the real UI under jsdom.
 *
 * Boots app.js against the actual data files with a failing network, drives a
 * complete draft through the real click handlers in both modes, and asserts the
 * behaviours the brief calls non-negotiable — in particular that no draft action
 * scrolls the page.
 *
 *   node tools/ui-test.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
// jsdom is a dev-only dependency and this repo ships no package.json, so
// resolve it from wherever it happens to be installed:
//   npm i jsdom        (anywhere)  → set JSDOM_PATH to that install, or
//   npm i jsdom        (here)      → picked up automatically.
const jsdomSpecifier = process.env.JSDOM_PATH || 'jsdom';
let JSDOM;
try {
  ({ JSDOM } = await import(jsdomSpecifier));
} catch (cause) {
  console.error(
    `Could not load jsdom from "${jsdomSpecifier}".\n` +
      'Install it (npm i jsdom) or point JSDOM_PATH at an existing install.'
  );
  process.exit(2);
}

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

let failures = 0;
let checks = 0;
function ok(label, condition, detail) {
  checks += 1;
  if (condition) return;
  failures += 1;
  console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
}
function section(name) {
  console.log(`\n${name}`);
}

const dom = new JSDOM(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), {
  url: 'https://example.test/',
  pretendToBeVisual: true
});
const { window } = dom;

global.window = window;
global.document = window.document;
global.HTMLElement = window.HTMLElement;
global.AbortController = window.AbortController || AbortController;

// Track every attempt to move the viewport. The app is allowed to *restore* a
// position (keepScroll), so we record the calls and check that none of them
// actually changed where the user was.
const scrollCalls = [];
window.scrollTo = (x, y) => {
  scrollCalls.push({ x, y });
};
let scrollIntoViewCalls = 0;
window.Element.prototype.scrollIntoView = function scrollIntoView() {
  scrollIntoViewCalls += 1;
};

// Offline by default: the whole point is that the app is fully usable without
// the public API.
//
// `allowNetwork` is either false (every request fails) or a function
// (url, signal) => body. It may also return a never-resolving promise to model
// a hang, or { __status: n } to model an HTTP error, so the matrix below can
// exercise timeouts and rate limits through the real client.
let allowNetwork = false;
let networkCalls = 0;
global.fetch = async (url, options = {}) => {
  const raw = String(url);
  if (raw.startsWith('http')) {
    networkCalls += 1;
    if (allowNetwork === false) throw new Error('offline');

    const outcome = allowNetwork(raw, options.signal);

    if (outcome && typeof outcome.then === 'function') {
      return new Promise((resolve, reject) => {
        outcome.then(
          (body) => resolve({ ok: true, status: 200, json: async () => body }),
          reject
        );
        if (options.signal) {
          options.signal.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        }
      });
    }
    if (outcome && outcome.__status) {
      return { ok: false, status: outcome.__status, json: async () => ({}) };
    }
    return { ok: true, status: 200, json: async () => outcome };
  }
  const file = path.join(root, raw.replace(/^\.?\//, ''));
  return { ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(file, 'utf8')) };
};

const importFresh = (rel) => import(pathToFileURL(path.join(root, rel)).href);

await importFresh('src/app.js');
await new Promise((resolve) => setTimeout(resolve, 60));

function goTo(name) {
  const tab = $$('.tab').find((t) => t.dataset.view === name);
  if (tab && !tab.classList.contains('is-active')) tap(tab);
}

const $ = (sel) => window.document.querySelector(sel);
const $$ = (sel) => Array.from(window.document.querySelectorAll(sel));
const byText = (sel, text) => $$(sel).find((n) => n.textContent.trim().toLowerCase() === text.toLowerCase());
const tap = (node) => {
  if (!node) throw new Error('tried to tap a node that is not there');
  node.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
};

section('Boot');
ok('app is visible', !$('#app').hidden);
ok('boot screen is gone', $('#boot').hidden);
ok('offline boot still renders recommendations', $$('#recommendations .rec').length > 0);
ok('data badge says bundled, not live', $('#data-badge').textContent.toLowerCase().includes('bundled'),
  $('#data-badge').textContent);
ok('the network was attempted', networkCalls > 0);

const store = await importFresh('src/state/draft-state.js');
const registry = await importFresh('src/data/registry.js');

section('Hero registry');
const snap0 = store.getSnapshot();
ok('starts in ranked mode', snap0.mode === 'ranked', snap0.mode);
ok('five ally slots', snap0.allies.length === 5);
ok('three ban slots per side', snap0.allyBans.length === 3 && snap0.enemyBans.length === 3);

section('No autoscroll on draft actions');
const before = scrollCalls.length;
const beforeIntoView = scrollIntoViewCalls;

// Ranked: open a slot, search, pick a hero the engine did not recommend.
tap($$('#board .slot__tap')[0]);
ok('hero sheet opened', !$('.sheet').hidden);
const search = $('.sheet .search');
search.value = 'yuz';
search.dispatchEvent(new window.Event('input', { bubbles: true }));
await new Promise((r) => setTimeout(r, 160));
const results = $$('.sheet .hcard__name').map((n) => n.textContent);
ok('partial search "yuz" finds Yu Zhong', results.includes('Yu Zhong'), results.slice(0, 4).join(', '));
ok('search did not call scrollIntoView', scrollIntoViewCalls === beforeIntoView);

const yz = $$('.sheet .hcard').find((c) => c.dataset.heroId === 'yu-zhong');
tap(yz);
ok('sheet closed after pick', $('.sheet').hidden);
ok('Yu Zhong is on the board', store.getSnapshot().allies.includes('yu-zhong'), JSON.stringify(store.getSnapshot().allies));
ok('no scrollIntoView from a pick', scrollIntoViewCalls === beforeIntoView);
ok('no net viewport movement', scrollCalls.slice(before).every((c) => c.x === 0 && c.y === 0),
  JSON.stringify(scrollCalls.slice(before)));

section('Recommendations are advisory');
let recs = $$('#recommendations .rec');
ok('three suggestions shown by default', recs.length === 3, String(recs.length));
tap(byText('.recs__foot .btn', 'Show 2 more suggestions'));
ok('the rest are one tap away', $$('#recommendations .rec').length === 5);
tap(byText('.recs__foot .btn', 'Show fewer suggestions'));
recs = $$('#recommendations .rec');
ok('and collapse again', recs.length === 3);
ok('every suggestion has its own action button', recs.every((r) => r.querySelector('.btn--act')));
ok('every suggestion has an Ignore', recs.every((r) => byTextIn(r, 'Ignore')));
ok('every suggestion has a reason', recs.every((r) => r.querySelectorAll('.rec__why li').length > 0));
ok('Browse all heroes is always present', Boolean($('.recs__foot .btn--browse')));

function byTextIn(scope, text) {
  return Array.from(scope.querySelectorAll('button')).find((b) => b.textContent.trim() === text);
}

const topName = recs[0].querySelector('.rec__name').textContent;
tap(byTextIn(recs[0], 'Ignore'));
recs = $$('#recommendations .rec');
ok('ignoring removes only that row', !recs.some((r) => r.querySelector('.rec__name').textContent === topName));
ok('ignoring does not commit anything', !store.getUnavailable().has(
  registry.slug ? topName.toLowerCase().replace(/[^a-z0-9]/g, '') : topName));
ok('draft is not locked after ignore', $$('#recommendations .rec').length > 0);
ok('ignored heroes can be brought back', Boolean(byText('.recs__foot .btn', 'Bring back 1 ignored')));
ok('a sticky action bar keeps the hero list in reach', !$('#actionbar').hidden);

section('Why? breakdown');
tap(byTextIn($$('#recommendations .rec')[0], 'Why?'));
const detail = $('#recommendations .rec__detail');
ok('breakdown opens', Boolean(detail));
ok('breakdown lists weighted components', detail.querySelectorAll('.rec__scores dt').length >= 5,
  String(detail ? detail.querySelectorAll('.rec__scores dt').length : 0));
ok('breakdown names its data source', Boolean(detail.querySelector('.rec__source')));
tap(byTextIn($$('#recommendations .rec')[0], 'Hide why'));
ok('breakdown closes again', !$('#recommendations .rec__detail'));

section('Ban flow');
tap(byText('.intent__btn', "I'm banning"));
ok('intent switched to ban', store.getSnapshot().intent === 'ban');
const banRecs = $$('#recommendations .rec');
ok('ban list offers several choices', banRecs.length === 3, String(banRecs.length));
ok('ban buttons say Ban', Array.from(banRecs).every((r) => r.querySelector('.btn--ban')));
ok('ban list is titled as priority, not instruction',
  $('#recommendations .sect__title').textContent === 'Ban priority',
  $('#recommendations .sect__title').textContent);
const banName = banRecs[2].querySelector('.rec__name').textContent;
tap(banRecs[2].querySelector('.btn--ban'));
const bannedId = store.getSnapshot().enemyBans.filter(Boolean)[0];
ok('banning the third suggestion works', store.getSnapshot().enemyBans.filter(Boolean).length === 1);
ok('the banned hero is the one that was tapped, not the top row',
  Boolean(bannedId) && store.getUnavailable().has(bannedId), `${banName} -> ${bannedId}`);

section('Every hero stays reachable');
tap($('.recs__foot .btn--browse'));
const count = $('.sheet__count').textContent;
ok('sheet reports the full roster', count.includes('133'), count);

// A hero that is off the board must still be findable by search — shown,
// struck through and disabled, never removed from the list.
const sheetSearch = $('.sheet .search');
sheetSearch.value = banName;
sheetSearch.dispatchEvent(new window.Event('input', { bubbles: true }));
await new Promise((r) => setTimeout(r, 160));
const outCard = $$('.sheet .hcard').find((c) => c.dataset.heroId === bannedId);
ok('a banned hero is still listed by search', Boolean(outCard), banName);
ok('it is marked unavailable', outCard && outCard.classList.contains('is-out'));
ok('it is not tappable', outCard && outCard.disabled);
sheetSearch.value = '';
sheetSearch.dispatchEvent(new window.Event('input', { bubbles: true }));
await new Promise((r) => setTimeout(r, 160));
ok('clearing search restores the full list', $('.sheet__count').textContent.includes('133'));
tap($('.sheet__close'));

section('Tournament mode');
tap($$('.tab').find((t) => t.dataset.view === 'setup'));
tap(byText('.segment__btn', 'Tournament'));
tap($$('.tab').find((t) => t.dataset.view === 'draft'));
ok('timeline appears', !$('#timeline').hidden);
ok('timeline has 20 steps', $$('#timeline .tl__step').length === 20, String($$('#timeline .tl__step').length));
ok('exactly one step is live', $$('#timeline .tl__step.is-active').length === 1);

const scrollBeforeDraft = scrollCalls.length;
let steps = 0;
while (!store.getSnapshot().complete && steps < 25) {
  const rows = $$('#recommendations .rec');
  if (!rows.length) break;
  const action = rows[0].querySelector('.btn--act');
  tap(action);
  steps += 1;
}
ok('a full 20-step draft completes through the UI', steps === 20 && store.getSnapshot().complete, `steps=${steps}`);
ok('no scrollIntoView across the whole draft', scrollIntoViewCalls === beforeIntoView, String(scrollIntoViewCalls));
ok('no viewport movement across the whole draft',
  scrollCalls.slice(scrollBeforeDraft).every((c) => c.x === 0 && c.y === 0));
ok('twenty heroes are off the board', store.getUnavailable().size === 20, String(store.getUnavailable().size));

section('Pre-game brief');
tap($$('.tab').find((t) => t.dataset.view === 'brief'));
const briefBlocks = $$('#view-brief .brief__block');
ok('brief unlocks on a complete draft', briefBlocks.length === 5, String(briefBlocks.length));
ok('win condition is first', briefBlocks[0].querySelector('.brief__title').textContent === 'Win condition');
ok('brief names enemy threats', $$('#view-brief .threat').length >= 2);
ok('brief gives shotcaller reminders', $$('#view-brief .brief__block:last-child .brief__list li').length >= 3);

section('Undo and reset');
tap($$('.tab').find((t) => t.dataset.view === 'draft'));
const sizeBefore = store.getUnavailable().size;
tap(byText('#controls .btn', 'Undo'));
ok('undo reverses exactly one action', store.getUnavailable().size === sizeBefore - 1);
tap(byText('#controls .btn', 'Clear draft'));
ok('clear empties the draft', store.getUnavailable().size === 0);
ok('clear keeps rank and comfort', store.getSnapshot().rank === snap0.rank);

/* ==========================================================================
   The API resilience matrix — the nine cases the source can put us in.

   Assertions read the UI wherever the UI can show it, because the thing that
   matters is not that the fetch layer returned a well-formed object; it is that
   a player looking at the screen is told the truth and can still draft.

   The client's real timeout is six seconds, which would make this suite crawl,
   so the matrix reconfigures it through the module's own configuration entry
   point rather than by patching internals.
   ========================================================================== */

const api = await importFresh('src/api/mlbb-api.js');
const cacheModule = await importFresh('src/api/cache.js');
const identity = await importFresh('src/api/identity.js');
const config = JSON.parse(fs.readFileSync(path.join(root, 'data/config.json'), 'utf8'));
// Two deliberate deviations from production config, both so the matrix
// exercises the network instead of the cache:
//   timeoutMs   the real six seconds would make this suite crawl
//   cacheHours  zero makes every stored entry stale, so each case below
//               actually reaches its scripted response — and case 9 gets to
//               exercise the real stale-cache fallback rather than a cache hit
api.configureApi({ ...config.api, timeoutMs: 150, cacheHours: { heroes: 0, rank: 0, relations: 0 } });

const RANK_URL = '/heroes/rank';

/** A hero record in the shape the upstream actually sends. */
function rankRecord(id, name, { pick = 0.03, ban = null, win = 0.51 } = {}) {
  return {
    data: {
      main_heroid: id,
      main_hero: { data: { name, head: `https://cdn.test/${id}.png` } },
      main_hero_appearance_rate: pick,
      main_hero_ban_rate: ban,
      main_hero_win_rate: win
    }
  };
}
function listRecord(id, name) {
  return { data: { hero_id: id, hero: { data: { name, head: `https://cdn.test/${id}.png` } } } };
}
function payload(records) {
  return { code: 0, message: 'SUCCESS', data: { total: records.length, records } };
}

/** Reads a row out of the Setup → Data panel. */
function dataRow(term) {
  const dt = $$('#view-setup .datalist dt').find((n) => n.textContent.trim() === term);
  return dt && dt.nextElementSibling ? dt.nextElementSibling.textContent.trim() : null;
}
function hints() {
  return $$('#view-setup .setup__hint').map((n) => n.textContent).join(' | ');
}

/** Everything the player can see about the data layer, after a refresh. */
async function refreshWith(script) {
  allowNetwork = script;
  goTo('setup');
  tap(byText('.setup__actions .btn', 'Refresh live data'));
  await new Promise((r) => setTimeout(r, 400));
  goTo('setup');
  return {
    badge: $('#data-badge').textContent.trim(),
    heroes: Number(dataRow('Heroes')),
    source: dataRow('Source') || '',
    updated: dataRow('Updated') || '',
    hints: hints()
  };
}

/** Finds a hero in the browse sheet and reports what its card shows. */
function inspectHero(name) {
  goTo('draft');
  const browse = $('.recs__foot .btn--browse') || $('#actionbar .btn');
  tap(browse);
  const search = $('.sheet .search');
  search.value = name;
  search.dispatchEvent(new window.Event('input', { bubbles: true }));
  return new Promise((resolve) => {
    setTimeout(() => {
      const cards = $$('.sheet .hcard').map((card) => ({
        id: card.dataset.heroId,
        name: card.querySelector('.hcard__name').textContent,
        flag: card.querySelector('.hcard__flag') ? card.querySelector('.hcard__flag').textContent : null
      }));
      tap($('.sheet__close'));
      resolve(cards);
    }, 220);
  });
}

section('API 1/9 — a normal live response');
let result = await refreshWith((url) =>
  url.includes(RANK_URL)
    ? payload([
        rankRecord(21, 'Fanny', { pick: 0.031, ban: 0.42, win: 0.508 }),
        rankRecord(35, 'Lancelot', { pick: 0.05, ban: null, win: 0.52 }),
        // A record with no name at all.
        { data: { main_heroid: 1000, main_hero: { data: { head: 'https://cdn.test/x.png' } } } }
      ])
    : payload([listRecord(21, 'Fanny'), listRecord(35, 'Lancelot')])
);
ok('badge reads live', /live/i.test(result.badge), result.badge);
ok('source names the public data', /public/i.test(result.source), result.source);
ok('a nameless record is dropped without breaking the load', result.heroes === 133, String(result.heroes));
let cards = await inspectHero('Fanny');
ok('live ban rate is bound to the right hero', cards.some((c) => c.id === 'fanny' && c.flag === '42%B'),
  JSON.stringify(cards.slice(0, 3)));
cards = await inspectHero('Lancelot');
ok('a hero with only a win rate still shows it',
  cards.some((c) => c.id === 'lancelot' && /%W$/.test(c.flag || '')), JSON.stringify(cards.slice(0, 2)));

section('API 2/9 — fewer heroes than we know about');
ok('the shortfall is reported to the user', /had no live statistics/i.test(result.hints), result.hints.slice(0, 160));
ok('heroes with no live stats stay in the pool', result.heroes === 133);
goTo('draft');
ok('and are still recommended', $$('#recommendations .rec').length > 0);

section('API 3/9 — a newly released hero');
result = await refreshWith((url) =>
  url.includes(RANK_URL)
    ? payload([rankRecord(21, 'Fanny', { ban: 0.42 }), rankRecord(9001, 'Novahex', { pick: 0.06, ban: 0.3 })])
    : payload([listRecord(21, 'Fanny'), listRecord(9001, 'Novahex')])
);
ok('an unknown hero is added, not dropped', result.heroes === 134, String(result.heroes));
ok('the addition is surfaced', /not in the/i.test(result.hints) && /Novahex/.test(result.hints), result.hints.slice(0, 200));
cards = await inspectHero('Novahex');
ok('it is selectable', cards.some((c) => c.name === 'Novahex'));
ok('and marked as new', cards.some((c) => c.name === 'Novahex' && c.flag === 'NEW'), JSON.stringify(cards));

section('API 4/9 — the source renames a hero');
// Same numeric id, new display name. Must bind to the existing hero rather than
// manufacture a second one. This is the bug the matrix was written for.
result = await refreshWith((url) =>
  url.includes(RANK_URL)
    ? payload([rankRecord(21, 'Fanny Awakened', { ban: 0.51 })])
    : payload([listRecord(21, 'Fanny Awakened')])
);
ok('a rename creates no new hero', result.heroes === 134, String(result.heroes));
cards = await inspectHero('Fanny');
ok('there is exactly one Fanny', cards.filter((c) => /^Fanny/.test(c.name)).length === 1,
  cards.map((c) => c.name).join(', '));
ok('the renamed hero\'s stats went to the existing entry',
  cards.some((c) => c.id === 'fanny' && c.flag === '51%B'), JSON.stringify(cards.slice(0, 2)));

section('API 5/9 — a rename with no id to lean on');
// The harder case: name evidence only, resolved by the similarity guard.
const roster = JSON.parse(fs.readFileSync(path.join(root, 'data/heroes.json'), 'utf8')).heroes;
const renamed = identity.resolveIdentities(
  [{ apiId: null, name: 'Popol & Kupa', slug: 'popolkupa', pickRate: 0.02 }], roster, {}
);
ok('the guard recognises the rename', renamed.renames.length === 1, JSON.stringify(renamed.renames));
ok('it binds to the existing hero', renamed.matched.has('popol-and-kupa'));
ok('it creates no provisional entry', renamed.provisional.length === 0);

// The guard must not absorb a genuinely different hero with a similar name.
const hildaRow = [{ apiId: null, name: 'Hilda', slug: 'hilda', pickRate: 0.02 }];
const withoutHilda = identity.resolveIdentities(hildaRow, roster.filter((h) => h.id !== 'hilda'), {});
ok('Hilda is never absorbed into Mathilda',
  withoutHilda.renames.length === 0 && withoutHilda.provisional.length === 1,
  JSON.stringify(withoutHilda.renames));

// The guard run across the whole roster pairwise. Any hit here means one real
// hero could be absorbed into another, which is worse than the bug this
// replaced — so it has to be zero, and it has to be checked on every run rather
// than the day the guard was written.
const slugMod = await importFresh('src/api/normalizer.js');
const allKeys = roster.flatMap((h) =>
  [h.name, h.id, ...(h.aliases || [])].map((k) => ({ hero: h.name, key: slugMod.slug(k) }))
);
const collisions = [];
for (let i = 0; i < allKeys.length; i += 1) {
  for (let j = i + 1; j < allKeys.length; j += 1) {
    if (allKeys[i].hero === allKeys[j].hero) continue;
    if (identity.looksLikeRename(allKeys[i].key, allKeys[j].key)) {
      collisions.push(`${allKeys[i].hero} ~ ${allKeys[j].hero}`);
    }
  }
}
ok(`the guard confuses no two of the ${roster.length} real heroes`, collisions.length === 0,
  [...new Set(collisions)].join(', '));

// A remembered id that contradicts an exact name match must yield to the name.
const stale = identity.resolveIdentities(
  [{ apiId: 21, name: 'Lancelot', slug: 'lancelot' }], roster, { fanny: 21 }
);
ok('a stale learned id defers to an exact name', stale.matched.has('lancelot') && !stale.matched.has('fanny'),
  JSON.stringify([...stale.matched.keys()]));
ok('and the contradiction is recorded', stale.conflicts.length === 1, JSON.stringify(stale.conflicts));

section('API 6/9 — duplicate records in one payload');
result = await refreshWith((url) =>
  url.includes(RANK_URL)
    ? payload([
        rankRecord(21, 'Fanny', { ban: 0.4 }),
        rankRecord(21, 'Fanny', { ban: 0.9 }),
        rankRecord(35, 'Lancelot', { ban: 0.1 })
      ])
    : payload([listRecord(21, 'Fanny')])
);
ok('a duplicated hero does not duplicate the registry', result.heroes === 134, String(result.heroes));
cards = await inspectHero('Fanny');
ok('the first record wins', cards.some((c) => c.id === 'fanny' && c.flag === '40%B'), JSON.stringify(cards.slice(0, 2)));

section('API 7/9 — rate limited');
result = await refreshWith(() => ({ __status: 429 }));
ok('a 429 does not blank the app', result.heroes >= 133, String(result.heroes));
ok('the badge stops claiming live', !/live/i.test(result.badge), result.badge);
goTo('draft');
ok('the draft board still works', $$('#recommendations .rec').length > 0);

section('API 8/9 — slow enough to time out');
let hangs = 0;
result = await refreshWith(() => {
  hangs += 1;
  return new Promise(() => {}); // only the client's AbortController can end this
});
ok('the hanging request was attempted on every host', hangs >= 2, String(hangs));
ok('the timeout resolved rather than hanging the app', result.heroes >= 133, String(result.heroes));
ok('the badge does not claim live after a timeout', !/live/i.test(result.badge), result.badge);
goTo('draft');
ok('drafting is unaffected by a timed-out refresh', $$('#recommendations .rec').length > 0);

section('API 9/9 — cached data, then the source goes away');
// Cache entries are stale by configuration here, so this is the real fallback:
// the client tries the network, fails, and serves what it stored last time.
cacheModule.clearApiCache();
cacheModule.writeCache('rank:mythic:7', payload([rankRecord(21, 'Fanny', { ban: 0.66 })]));
result = await refreshWith(() => {
  throw new Error('offline');
});
ok('the badge says cached, never live', /cached/i.test(result.badge), result.badge);
ok('the source line admits it is cached', /cached/i.test(result.source), result.source);
ok('a stored date is shown', result.updated.length > 0 && result.updated !== '—', result.updated);
cards = await inspectHero('Fanny');
ok('the cached rate is what is served', cards.some((c) => c.id === 'fanny' && c.flag === '66%B'),
  JSON.stringify(cards.slice(0, 2)));

section('API: cold start with no network at all');
allowNetwork = false;
goTo('draft');
ok('the app is fully usable offline', $$('#recommendations .rec').length > 0);
ok('every hero is still selectable', (await inspectHero('')).length > 0);

/* ==========================================================================
   Field test findings.

   #1  the hero sheet raised the on-screen keyboard on open
   #2  the lane plan read hero role metadata as if it were the actual lane
       assignment, so an intentional off-role pick was reported as a missing
       lane and someone else was flagged as having no free lane
   ========================================================================== */

section('Field test #1 — the sheet does not raise the keyboard');
// jsdom reports pointer:fine as false, i.e. a touch device, which is the case
// that regressed in the field.
goTo('draft');
tap($('#actionbar .btn') || $('.recs__foot .btn--browse'));
await new Promise((r) => setTimeout(r, 60));
ok('the sheet is open', !$('.sheet').hidden);
ok('focus is on the panel, not the search field',
  window.document.activeElement !== $('.sheet .search'),
  window.document.activeElement ? window.document.activeElement.className : 'none');
ok('focus is still inside the dialog', $('.sheet__panel').contains(window.document.activeElement)
  || window.document.activeElement === $('.sheet__panel'),
  window.document.activeElement ? window.document.activeElement.className : 'none');
ok('the search field is still there to tap', Boolean($('.sheet .search')));
tap($('.sheet__close'));

section('Field test #2 — explicit lane assignment');
store.resetDraft();
store.setMode('ranked');

// The exact board from the field report: Kaja on Roam, Belerick on EXP.
// Both are canonically Roam-only, so the old greedy inference gave one of them
// a lane and left EXP reading "not covered".
const fieldDraft = ['kaja', 'hirara', 'novaria', 'brody', 'belerick'];
fieldDraft.forEach((id, index) => {
  const result = store.commitHero(id, { group: 'allies', index });
  if (!result.ok) throw new Error(`${id}: ${result.message}`);
});
ok('all five heroes are on the board', store.getSnapshot().allies.filter(Boolean).length === 5);

// The brief needs both sides complete, so give the enemy an ordinary draft.
['tigreal', 'lancelot', 'kagura', 'beatrix', 'yu-zhong'].forEach((id, index) => {
  const result = store.commitHero(id, { group: 'enemies', index });
  if (!result.ok) throw new Error(`${id}: ${result.message}`);
});

let plan = store.getLanePlan('ally');
ok('no lane is reported uncovered with five heroes drafted',
  plan.empty.length === 0, plan.empty.join(', '));
ok('nobody is left without a lane', plan.overflow.length === 0,
  plan.overflow.map((h) => h.name).join(', '));
ok('every lane has a hero', plan.rows.every((r) => r.hero),
  plan.rows.map((r) => `${r.short}:${r.hero ? r.hero.name : '—'}`).join(' '));

// Now the player says explicitly what the team decided.
store.setLaneAssignment('kaja', 'roam');
store.setLaneAssignment('belerick', 'exp');
plan = store.getLanePlan('ally');

const laneOf = (heroId) => {
  const row = plan.rows.find((r) => r.hero && r.hero.id === heroId);
  return row ? row.laneId : null;
};
ok('Kaja is on Roam because the player said so', laneOf('kaja') === 'roam', String(laneOf('kaja')));
ok('Belerick is on EXP because the player said so', laneOf('belerick') === 'exp', String(laneOf('belerick')));
ok('EXP is not reported as uncovered', !plan.empty.includes('EXP Lane'), plan.empty.join(', '));
ok('Kaja is not reported as having no free lane',
  !plan.overflow.some((h) => h.id === 'kaja'), plan.overflow.map((h) => h.name).join(', '));

const belerickRow = plan.rows.find((r) => r.laneId === 'exp');
ok('the unusual pairing is marked unorthodox', belerickRow.unorthodox === true);
ok('the orthodox one is not', plan.rows.find((r) => r.laneId === 'roam').unorthodox === false);
ok('the app can tell unusual from invalid', plan.valid === true && plan.unorthodox.length === 1,
  `valid=${plan.valid} unorthodox=${plan.unorthodox.length}`);

section('Field test #2 — the brief reports it as unusual, not missing');
goTo('brief');
const laneBlock = $$('#view-brief .brief__block').find((b) =>
  b.querySelector('.brief__title').textContent === 'Lane plan'
);
ok('the lane plan block is rendered', Boolean(laneBlock));
const laneText = laneBlock.textContent;
ok('Belerick appears under EXP',
  Array.from(laneBlock.querySelectorAll('.lanecheck__row')).some(
    (row) => row.querySelector('.lanecheck__tag').textContent === 'EXP' && /Belerick/.test(row.textContent)
  ), laneText.slice(0, 200));
ok('nothing says "not covered"', !/not covered/i.test(laneText), laneText.slice(0, 200));
ok('no false role-conflict warning for Kaja', !/no free lane/i.test(laneText), laneText.slice(0, 200));
ok('the unorthodox assignment is stated plainly',
  /Unorthodox assignment/i.test(laneText) && /Belerick is primarily classified as Roam/i.test(laneText),
  laneText.slice(0, 300));

section('Field test #2 — the player can change the assignment');
// Release Belerick first, so the picker opens the way it does on a first
// encounter: playing a lane the app worked out, with nothing pinned. The
// inferred placement is still EXP and still unorthodox — the explicit
// assignment confirmed that reading rather than creating it.
store.clearLaneAssignment('belerick');
ok('releasing does not move the hero', store.laneFor('belerick').laneId === 'exp',
  JSON.stringify(store.laneFor('belerick')));
ok('and it is still flagged unorthodox', store.laneFor('belerick').unorthodox === true);

const laneRow = Array.from(laneBlock.querySelectorAll('.lanecheck__row')).find((row) =>
  /Belerick/.test(row.textContent)
);
tap(laneRow.querySelector('.lanecheck__hero--tap'));
await new Promise((r) => setTimeout(r, 60));
const picker = $$('.sheet').find((sheet) => sheet.classList.contains('sheet--short'));
ok('the lane picker opens', picker && !picker.hidden);
ok('it names the hero', /Belerick/.test(picker.textContent));
ok('it shows the known roles as context', /Known roles/i.test(picker.textContent), picker.textContent.slice(0, 160));
ok('every lane is offered, including off-role ones',
  picker.querySelectorAll('.lanepick__chips .chip').length === 5,
  String(picker.querySelectorAll('.lanepick__chips .chip').length));
ok('off-role lanes are marked but not disabled',
  Array.from(picker.querySelectorAll('.chip--off')).every((c) => !c.disabled),
  String(picker.querySelectorAll('.chip--off').length));
ok('it says which lane is in play and how it was chosen',
  /worked out automatically/i.test(picker.textContent), picker.textContent.slice(0, 220));
ok('no release control is offered while nothing is pinned',
  !Array.from(picker.querySelectorAll('.btn')).some((b) => /back to automatic/i.test(b.textContent)));

// Reassign through the real control, then release it back to automatic.
const jungChip = Array.from(picker.querySelectorAll('.lanepick__chips .chip')).find(
  (c) => c.textContent === 'JUNG'
);
tap(jungChip);
ok('the reassignment takes effect', store.getSnapshot().laneAssignments.belerick === 'jungle',
  JSON.stringify(store.getSnapshot().laneAssignments));
ok('and it wins over the hero role data', store.laneFor('belerick').laneId === 'jungle');
ok('the hero it displaced is not lost',
  store.getLanePlan('ally').rows.every((r) => r.hero) &&
    store.getLanePlan('ally').overflow.length === 0);

const releaseBtn = Array.from(picker.querySelectorAll('.btn')).find((b) =>
  /back to automatic/i.test(b.textContent)
);
ok('a release control appears once a lane is pinned', Boolean(releaseBtn),
  Array.from(picker.querySelectorAll('.btn')).map((b) => b.textContent).join(' / '));
ok('the pinned lane is marked as the player\'s choice',
  /you set this/i.test(picker.textContent), picker.textContent.slice(0, 220));
tap(releaseBtn);
ok('releasing clears the explicit assignment',
  store.getSnapshot().laneAssignments.belerick === undefined,
  JSON.stringify(store.getSnapshot().laneAssignments));
tap(picker.querySelector('.sheet__close'));

section('Field test #2 — assignments do not leak');
store.setLaneAssignment('belerick', 'exp');
store.clearSlot('allies', fieldDraft.indexOf('belerick'));
ok('removing a hero drops its assignment',
  store.getSnapshot().laneAssignments.belerick === undefined,
  JSON.stringify(store.getSnapshot().laneAssignments));
store.resetDraft();
ok('clearing the draft drops every assignment',
  Object.keys(store.getSnapshot().laneAssignments).length === 0);
ok('a banned hero is on no lane', (store.setIntent('ban'),
  store.commitHero('fanny', { group: 'enemyBans', index: 0 }),
  store.laneFor('fanny') === null));
store.resetDraft();
store.setIntent('pick');

section('Result');
console.log(`${checks - failures}/${checks} checks passed`);
if (failures) process.exit(1);
