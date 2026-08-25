/**
 * tools/audit-roles.mjs — Gate 2: is the hero knowledge layer true?
 *
 *   node tools/audit-roles.mjs
 *
 * Compares the built registry against the vendored official snapshot and
 * reports every disagreement in role, lane and hero id.
 *
 * This gate exists because the previous validator could not have caught what
 * field testing caught. Obsidia was listed as a Mage/Fighter playing Mid and
 * EXP; she is a Marksman who plays Gold Lane. The row was schema-valid,
 * internally consistent, and simply false. Internal consistency cannot detect
 * that. Only comparison with an external source can, so that comparison is a
 * committed, repeatable check rather than a thing someone once did by hand.
 *
 * Refreshing the snapshot:
 *   curl -sSL -o /tmp/heroes.json \
 *     https://raw.githubusercontent.com/vin-03/web-scraper-mlbb-heroInfo/main/data/heroes.json
 *   then rebuild data/sources/mlbb-official-heroes.json from it and re-run this.
 *
 * Exit 1 on any disagreement, so drift cannot pass unnoticed.
 */

import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const LANE = { 'gold lane': 'gold', 'exp lane': 'exp', 'mid lane': 'mid', jungle: 'jungle', roam: 'roam' };

const slug = (value) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

const registry = JSON.parse(fs.readFileSync(path.join(root, 'data/heroes.json'), 'utf8'));
const snapshot = JSON.parse(fs.readFileSync(path.join(root, 'data/sources/mlbb-official-heroes.json'), 'utf8'));

const bySlug = new Map(registry.heroes.map((h) => [slug(h.name), h]));

let problems = 0;
const say = (label, detail) => {
  problems += 1;
  console.log(`  MISMATCH  ${label}${detail ? ` — ${detail}` : ''}`);
};

console.log(`registry: ${registry.heroes.length} heroes   snapshot: ${snapshot.count} (captured ${snapshot.captured})`);
console.log(`source: ${snapshot.source}\n`);

console.log('role, lane and id against the official snapshot');
snapshot.heroes.forEach((row) => {
  const hero = bySlug.get(slug(row.name));
  if (!hero) {
    say(`${row.name} is in the snapshot but not in the registry`);
    return;
  }
  const lanes = row.lane.map((l) => LANE[l.toLowerCase()]).filter(Boolean).sort();
  const roles = row.role.slice().sort();

  if (JSON.stringify(hero.classes.slice().sort()) !== JSON.stringify(roles)) {
    say(`${row.name} role`, `registry=${hero.classes.join(',')} official=${row.role.join(',')}`);
  }
  if (lanes.length && JSON.stringify(hero.lanes.slice().sort()) !== JSON.stringify(lanes)) {
    say(`${row.name} lane`, `registry=${hero.lanes.join(',')} official=${lanes.join(',')}`);
  }
  if (hero.apiId !== row.id) {
    say(`${row.name} id`, `registry=${hero.apiId} official=${row.id}`);
  }
});
if (!problems) console.log('  every hero the snapshot covers agrees with it');

console.log('\nheroes released after the snapshot, checked against their cited source');
(snapshot.manual || []).forEach((row) => {
  const hero = bySlug.get(slug(row.name));
  if (!hero) return say(`${row.name} is listed as manually verified but is not in the registry`);
  const lanes = row.lane.map((l) => LANE[l.toLowerCase()]).filter(Boolean).sort();
  const roles = row.role.slice().sort();
  if (hero.classes.slice().sort().join(',') !== roles.join(',')) {
    say(`${row.name} role`, `registry=${hero.classes.join(',')} cited=${row.role.join(',')}`);
  }
  if (hero.lanes.slice().sort().join(',') !== lanes.join(',')) {
    say(`${row.name} lane`, `registry=${hero.lanes.join(',')} cited=${lanes.join(',')}`);
  }
  if (hero.apiId !== row.id) say(`${row.name} id`, `registry=${hero.apiId} cited=${row.id}`);
  console.log(`  ${row.name} (${row.role.join(',')} / ${lanes.join(',')})`);
  console.log(`      ${row.source}`);
});

const covered = new Set(
  snapshot.heroes.map((r) => slug(r.name)).concat((snapshot.manual || []).map((r) => slug(r.name)))
);
const uncovered = registry.heroes.filter((h) => !covered.has(slug(h.name)));
if (uncovered.length) {
  console.log('\nheroes with NO canonical source at all');
  uncovered.forEach((hero) => {
    say(`${hero.name} has no source`, `${hero.classes.join(',')} / ${hero.lanes.join(',')} is authored guesswork`);
  });
}

console.log('\nprovenance');
const counts = {};
registry.heroes.forEach((h) => {
  counts[h.provenance] = (counts[h.provenance] || 0) + 1;
});
Object.entries(counts).forEach(([key, n]) => console.log(`  ${key}: ${n}`));

const noId = registry.heroes.filter((h) => h.apiId == null);
if (noId.length) {
  console.log(`\n  ${noId.length} hero(es) have no official id, so identity resolution must fall back to name matching:`);
  noId.forEach((h) => console.log(`    ${h.name}`));
}

console.log(`\n${problems ? `${problems} disagreement(s)` : 'no disagreements'}`);
process.exit(problems ? 1 : 0);
