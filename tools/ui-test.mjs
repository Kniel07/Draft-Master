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
let allowNetwork = false;
let networkCalls = 0;
global.fetch = async (url) => {
  const raw = String(url);
  if (raw.startsWith('http')) {
    networkCalls += 1;
    if (!allowNetwork) throw new Error('offline');
    return { ok: true, status: 200, json: async () => allowNetwork(raw) };
  }
  const file = path.join(root, raw.replace(/^\.?\//, ''));
  return { ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(file, 'utf8')) };
};

const importFresh = (rel) => import(pathToFileURL(path.join(root, rel)).href);

await importFresh('src/app.js');
await new Promise((resolve) => setTimeout(resolve, 60));

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

section('Live data path');
allowNetwork = (url) => {
  if (url.includes('/heroes/rank')) {
    return {
      code: 0,
      data: {
        total: 2,
        records: [
          { data: { main_heroid: 1, main_hero: { data: { name: 'Fanny', head: 'https://cdn.test/f.png' } },
            main_hero_appearance_rate: 0.031, main_hero_ban_rate: 0.42, main_hero_win_rate: 0.508 } },
          // A hero this build has never heard of, plus a record with no name at
          // all: neither may break the app.
          { data: { main_heroid: 999, main_hero: { data: { name: 'Testhero', head: 'https://cdn.test/t.png' } },
            main_hero_appearance_rate: 0.01, main_hero_win_rate: 0.5 } },
          { data: { main_heroid: 1000, main_hero: { data: { head: 'https://cdn.test/none.png' } } } }
        ]
      }
    };
  }
  return { code: 0, data: { total: 1, records: [
    { data: { hero_id: 1, hero: { data: { name: 'Fanny', head: 'https://cdn.test/f.png' } } } }
  ] } };
};
tap($$('.tab').find((t) => t.dataset.view === 'setup'));
tap(byText('.setup__actions .btn', 'Refresh live data'));
await new Promise((r) => setTimeout(r, 120));
ok('badge switches to live', $('#data-badge').textContent.toLowerCase().includes('live'), $('#data-badge').textContent);
ok('an unknown hero from the API is added, not dropped', store.getSnapshot() && Boolean(
  $$('.datalist dd').find((d) => d.textContent === '134')), $$('.datalist dd').map((d) => d.textContent).join('/'));

section('Result');
console.log(`${checks - failures}/${checks} checks passed`);
if (failures) process.exit(1);
