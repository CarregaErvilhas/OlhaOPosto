import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  checkConstructionMissing, constructionSql, diffConstruction, mergeStatements, toConstructionRows,
  type CurrentRow, type FeedPlanned,
} from '../scripts/lib/construction.ts';
import { autoMerge, osmElement } from '../src/merge.ts';
import { d1 } from './d1.ts';

const planned = (id: string, extra: Partial<FeedPlanned> = {}): FeedPlanned => ({
  id, osm: { element: osmElement(id) }, lifecycle: 'construction', codes: ['ALM-00114', 'ALM-00155'],
  name: 'ALM-00114/155', operator: 'Mota-Engil', lat: 38.67, lon: -9.16, ...extra,
});
const current = (r: ReturnType<typeof toConstructionRows>[number], status = 'active'): CurrentRow =>
  ({ ...r, source: 'osm', status });
const napAt = (id: string, element: string | null, code: string | null, status = 'active') =>
  ({ id, status, code, osm_ref: element });

test('osmElement reads the feed id; anything else is not one', () => {
  assert.equal(osmElement('OSM-w1551836005'), 'way/1551836005');
  assert.equal(osmElement('OSM-n42'), 'node/42');
  assert.equal(osmElement('OSM-r42'), null);
  assert.equal(osmElement('EZC-AMD-00051'), null);
});

test('only construction is imported; codes are cleaned; odd ids are skipped', () => {
  const rows = toConstructionRows([
    planned('OSM-w1'),
    planned('OSM-w2', { lifecycle: 'planned' }),
    planned('OSM-w3', { codes: [' alm-00001 ', 'ALM-00001', 'not a code'] }),
    planned('OSM-r4'),
    planned('OSM-w5', { osm: { element: 'way/6' } }),
    planned('OSM-w1'),
    planned('OSM-w7', { codes: [] }),
  ]);
  assert.deepEqual(rows.map((r) => r.id), ['OSM-w1', 'OSM-w3', 'OSM-w7']);
  assert.deepEqual(rows[0], {
    id: 'OSM-w1', code: 'ALM-00114', codes: 'ALM-00114 ALM-00155', operator: 'Mota-Engil',
    name: 'ALM-00114/155', lat: 38.67, lon: -9.16, osm_ref: 'way/1',
  });
  assert.equal(rows[1].codes, 'ALM-00001');
  assert.equal(rows[2].codes, null);
});

test('autoMerge: same element and a matching code, or no codes to compare', () => {
  const c = { osm_ref: 'way/1', codes: 'ALM-00114 ALM-00155' };
  assert.equal(autoMerge(c, { osm_ref: 'way/1', code: 'ALM-00155' }), true);
  assert.equal(autoMerge(c, { osm_ref: 'way/1', code: 'ALM-00999' }), false);
  assert.equal(autoMerge(c, { osm_ref: 'way/2', code: 'ALM-00114' }), false);
  assert.equal(autoMerge({ osm_ref: 'way/1', codes: null }, { osm_ref: 'way/1', code: 'X' }), true);
  assert.equal(autoMerge({ osm_ref: null, codes: null }, { osm_ref: null, code: null }), false);
});

test('new, changed, back and missing stations under construction', () => {
  const [a, b, c, e] = toConstructionRows([planned('OSM-w1'), planned('OSM-w2'), planned('OSM-w3'), planned('OSM-w5')]);
  const cur = [current(a), current({ ...b, name: 'old' }), current(c, 'missing_from_osm'),
    current(toConstructionRows([planned('OSM-w4')])[0])];
  const d = diffConstruction([a, b, c, e], cur, []);
  assert.deepEqual(d.upsert.map((r) => r.id), ['OSM-w2', 'OSM-w3', 'OSM-w5']);
  assert.deepEqual(d.missing, ['OSM-w4']);
  assert.deepEqual(d.merges, []);
});

test('the merge runs on every station under construction in D1, also those gone from the feed', () => {
  const [a, b] = toConstructionRows([planned('OSM-w1'), planned('OSM-w2')]);
  const cur = [current(a), current(b, 'missing_from_osm'), current({ ...b, id: 'OSM-w3', osm_ref: 'way/3' }, 'merged')];
  const nap = [napAt('MOT-ALM-00114', 'way/1', 'ALM-00114'), napAt('MOT-ALM-00155', 'way/2', 'ALM-00155'),
    napAt('MOT-ALM-00999', 'way/3', 'ALM-00114')];
  // The feed still lists OSM-w1 (the 30 m rule may lag): it merges anyway.
  const d = diffConstruction([a], cur, nap);
  assert.deepEqual(d.merges, [{ from: 'OSM-w1', to: 'MOT-ALM-00114' }, { from: 'OSM-w2', to: 'MOT-ALM-00155' }]);
  assert.deepEqual(d.upsert, []);
  assert.deepEqual(d.missing, []);
});

test('no automatic merge on a code mismatch, two candidates or an inactive NAP station', () => {
  const [a, b, c] = toConstructionRows([planned('OSM-w1'), planned('OSM-w2'), planned('OSM-w3')]);
  const d = diffConstruction([a, b, c], [current(a), current(b), current(c)], [
    napAt('X-1', 'way/1', 'ALM-00999'),
    napAt('X-2', 'way/2', 'ALM-00114'), napAt('X-3', 'way/2', 'ALM-00155'),
    napAt('X-4', 'way/3', 'ALM-00114', 'missing_from_nap'),
  ]);
  assert.deepEqual(d.merges, []);
});

test('a new site that already matches a NAP station is not added', () => {
  const [a] = toConstructionRows([planned('OSM-w1')]);
  assert.deepEqual(diffConstruction([a], [], [napAt('X-1', 'way/1', 'ALM-00114')]).upsert, []);
});

test('a feed without the planned array adds and drops nothing, but still merges', () => {
  const [a, b] = toConstructionRows([planned('OSM-w1'), planned('OSM-w2')]);
  const d = diffConstruction(null, [current(a), current(b)], [napAt('X-1', 'way/1', 'ALM-00114')]);
  assert.deepEqual(d, { upsert: [], missing: [], merges: [{ from: 'OSM-w1', to: 'X-1' }] });
});

test('the guard refuses to drop over half of ten or more', () => {
  const rows = toConstructionRows(Array.from({ length: 12 }, (_, i) => planned(`OSM-w${i + 1}`)));
  const cur = rows.map((r) => current(r));
  assert.match(checkConstructionMissing(diffConstruction(rows.slice(0, 5), cur, []), cur) ?? '', /refusing: 7 of 12/);
  assert.equal(checkConstructionMissing(diffConstruction(rows.slice(0, 7), cur, []), cur), null);
});

// The SQL the import writes, run on the real schema.
test('constructionSql: upsert, missing and merge on the real schema', () => {
  const db = d1();
  db.sql.exec(`
    INSERT INTO stations (id, code, name, lat, lon, osm_ref, updated_at) VALUES ('MOT-ALM-00114', 'ALM-00114', 'Almada', 38.67, -9.16, 'way/1', 'x');
    INSERT INTO users (id, osm_uid, osm_name, created_at, last_login_at) VALUES ('u', 1, 'ana', 'x', 'x');`);
  const [a, b] = toConstructionRows([planned('OSM-w1'), planned('OSM-w2')]);
  for (const s of constructionSql({ upsert: [a, b], missing: [], merges: [] }, 't1')) db.sql.exec(s);
  db.sql.exec(`INSERT INTO photos (id, station_id, uploader_id, panoramax_id, status, created_at) VALUES
    ('p1', 'OSM-w1', 'u', 'pano-1', 'published', 'x'), ('p2', 'OSM-w1', 'u', NULL, 'failed', 'x');`);
  const sql = constructionSql({ upsert: [{ ...b, name: 'Novo' }], missing: [], merges: [{ from: 'OSM-w1', to: 'MOT-ALM-00114' }] }, 't2');
  for (const s of sql) db.sql.exec(s);
  const rows = db.sql.prepare('SELECT id, source, status, name, codes FROM stations ORDER BY id').all();
  assert.deepEqual(rows.map((r) => ({ ...r })), [
    { id: 'MOT-ALM-00114', source: 'nap', status: 'active', name: 'Almada', codes: null },
    { id: 'OSM-w1', source: 'osm', status: 'merged', name: 'ALM-00114/155', codes: 'ALM-00114 ALM-00155' },
    { id: 'OSM-w2', source: 'osm', status: 'active', name: 'Novo', codes: 'ALM-00114 ALM-00155' },
  ]);
  assert.deepEqual(db.sql.prepare('SELECT id, station_id, site_tag_old FROM photos ORDER BY id').all().map((r) => ({ ...r })), [
    { id: 'p1', station_id: 'MOT-ALM-00114', site_tag_old: 'OSM-w1' },
    { id: 'p2', station_id: 'MOT-ALM-00114', site_tag_old: null },
  ]);
  assert.equal((db.sql.prepare('SELECT new_id FROM station_aliases WHERE old_id = ?').get('OSM-w1') as { new_id: string }).new_id, 'MOT-ALM-00114');
  // A merged station never comes back, and a NAP row is never overwritten.
  for (const s of constructionSql({ upsert: [a, { ...a, id: 'MOT-ALM-00114' }], missing: ['OSM-w2'], merges: [] }, 't3')) db.sql.exec(s);
  assert.deepEqual(db.sql.prepare('SELECT id, source, status FROM stations ORDER BY id').all().map((r) => ({ ...r })), [
    { id: 'MOT-ALM-00114', source: 'nap', status: 'active' },
    { id: 'OSM-w1', source: 'osm', status: 'merged' },
    { id: 'OSM-w2', source: 'osm', status: 'missing_from_osm' },
  ]);
  // The codes are in the search index.
  assert.deepEqual(db.sql.prepare(`SELECT id FROM stations_fts WHERE stations_fts MATCH '"ALM-00155"' ORDER BY id`).all().map((r) => r.id), ['OSM-w1', 'OSM-w2']);
  // A second merge of the same pair changes nothing.
  for (const s of mergeStatements({ from: 'OSM-w1', to: 'MOT-ALM-00114' }, 't4')) db.sql.exec(s);
  assert.equal((db.sql.prepare('SELECT site_tag_old FROM photos WHERE id = ?').get('p1') as { site_tag_old: string }).site_tag_old, 'OSM-w1');
});
