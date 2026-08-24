/**
 * tools/validate-data.mjs — data checks, outside the browser.
 *
 *   node tools/validate-data.mjs
 *
 * Runs the same validator the app runs at boot, then adds the checks that only
 * make sense at authoring time: roster completeness, orphaned matchup rules,
 * heroes with no counter coverage at all, and weights that do not resolve.
 *
 * Exit code 1 on anything that would break a draft; warnings alone exit 0,
 * because a warning must never be able to remove a hero from the pool.
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

globalThis.fetch = async (url) => {
  const file = path.join(root, String(url).replace(/^\.?\//, ''));
  if (!fs.existsSync(file)) return { ok: false, status: 404, json: async () => ({}) };
  return { ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(file, 'utf8')) };
};

const { loadRegistry } = await import(pathToFileURL(path.join(root, 'src/data/registry.js')).href);
const { resolveWeights } = await import(pathToFileURL(path.join(root, 'src/engine/weights.js')).href);
const { recommendPicks, recommendBans } = await import(
  pathToFileURL(path.join(root, 'src/engine/recommendation.js')).href
);

let errors = 0;
const warn = (msg) => console.log(`  warn   ${msg}`);
const fail = (msg) => {
  errors += 1;
  console.log(`  ERROR  ${msg}`);
};

let registry;
try {
  registry = await loadRegistry('data/');
} catch (error) {
  console.error(`FATAL: ${error.message}`);
  process.exit(1);
}

console.log(`heroes: ${registry.heroes.length}  patch: ${registry.patch}  (${registry.patchDate})`);

console.log('\nregistry');
registry.diagnostics.warnings.forEach(warn);
if (!registry.diagnostics.warnings.length) console.log('  clean');

console.log('\ncoverage');
const noTags = registry.heroes.filter((h) => !h.tags.length);
if (noTags.length) fail(`${noTags.length} hero(es) have no tags, so no counter or synergy rule can reach them: ${noTags.map((h) => h.name).join(', ')}`);

const noLanes = registry.heroes.filter((h) => !h.lanes.length);
if (noLanes.length) warn(`${noLanes.length} hero(es) have no lane: ${noLanes.map((h) => h.name).join(', ')}`);

const tagsInUse = new Set();
registry.heroes.forEach((h) => h.tags.forEach((t) => tagsInUse.add(t)));
const ruleTags = new Set();
(registry.counters.tagCounters || []).forEach((r) => { ruleTags.add(r.counter); ruleTags.add(r.against); });
(registry.synergies.tagSynergies || []).forEach((r) => { ruleTags.add(r.a); ruleTags.add(r.b); });

const unusedRuleTags = [...ruleTags].filter((t) => !tagsInUse.has(t));
if (unusedRuleTags.length) warn(`rules reference tags no hero has: ${unusedRuleTags.join(', ')}`);
const uncoveredTags = [...tagsInUse].filter((t) => !ruleTags.has(t));
if (uncoveredTags.length) warn(`tags no rule uses (they contribute nothing to scoring): ${uncoveredTags.join(', ')}`);

const reachable = new Set();
registry.heroes.forEach((hero) => {
  const hits =
    hero.tags.some((t) => registry.tagCounterMap.has(t)) ||
    hero.classes.some((c) => registry.classCounterMap.has(c)) ||
    registry.heroCounterMap.has(hero.id) ||
    registry.counteredByMap.has(hero.id);
  if (hits) reachable.add(hero.id);
});
const unreachable = registry.heroes.filter((h) => !reachable.has(h.id));
if (unreachable.length) warn(`${unreachable.length} hero(es) participate in no counter rule: ${unreachable.map((h) => h.name).join(', ')}`);
else console.log('  every hero is reachable by at least one counter rule');

console.log('\nweights');
const weights = resolveWeights(registry.config);
Object.entries(weights).forEach(([group, set]) => {
  const sum = Object.values(set).reduce((a, b) => a + b, 0);
  if (sum <= 0) fail(`weights.${group} sums to zero — scoring would divide by zero`);
  else console.log(`  ${group}: ${Object.entries(set).map(([k, v]) => `${k} ${v}`).join(', ')}  (sum ${sum.toFixed(2)})`);
});

console.log('\nengine smoke test');
const snapshot = {
  rank: registry.ranks.default,
  ignored: [],
  comfortRating: {},
  selectedRole: null
};
const context = {
  ourPicks: [],
  theirPicks: [],
  openLanes: registry.config.lanes.map((l) => l.id),
  comfortIds: new Set(),
  enemyComfortIds: new Set(),
  unavailable: new Set()
};
const picks = recommendPicks(registry, snapshot, context, 5);
const bans = recommendBans(registry, snapshot, context, 5);
if (picks.length !== 5) fail('pick engine did not return five suggestions on an empty board');
if (bans.length !== 5) fail('ban engine did not return five suggestions on an empty board');
if (picks.some((r) => !r.reasons.length)) fail('a pick suggestion came back with no reason');
if (bans.some((r) => !r.reasons.length)) fail('a ban suggestion came back with no reason');
if (picks.some((r) => !r.breakdown.length)) fail('a pick suggestion came back with no score breakdown');
console.log(`  picks: ${picks.map((r) => `${r.hero.name} ${Math.round(r.score)}`).join(', ')}`);
console.log(`  bans:  ${bans.map((r) => `${r.hero.name} ${Math.round(r.score)}`).join(', ')}`);

console.log(`\n${errors ? `${errors} error(s)` : 'no errors'}`);
process.exit(errors ? 1 : 0);
