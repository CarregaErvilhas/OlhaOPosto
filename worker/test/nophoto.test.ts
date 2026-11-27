import assert from 'node:assert/strict';
import { test } from 'node:test';

import worker from '../src/index.ts';
import { parseFilters } from '../src/types.ts';
import { d1 } from './d1.ts';

const SITE = 'https://olhaoposto.ocarroeletrico.com';

function world() {
  const db = d1();
  const rows = [
    ['EZC-AMD-00001', 'EZC3', 'EZ Charge', 'Amadora', 38.7, -9.2, 'active'],
    ['EZC-AMD-00002', 'EZC3', 'EZ Charge', 'Amadora', 38.7001, -9.2001, 'active'],
    ['EDP-LSB-00003', 'EDP', 'EDP Comercial', 'Lisboa', 38.72, -9.14, 'active'],
    ['EDP-LSB-00004', 'EDP', 'EDP Comercial', 'Lisboa', 38.73, -9.15, 'missing_from_nap'],
    ['OOP-NEW', 'EDP', 'EDP Comercial', 'Lisboa', 38.74, -9.16, 'merged'],
    ['GONE-1', 'EDP', 'EDP Comercial', 'Lisboa', 38.75, -9.17, 'merged'],
  ];
  for (const [id, opc, operator, town, lat, lon, status] of rows) {
    db.sql.prepare(`INSERT INTO stations (id, opc, operator, name, municipality, lat, lon, status, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'x')`)
      .run(id, opc, operator, `Posto ${id}`, town, lat, lon, status);
  }
  db.sql.exec(`
    INSERT INTO users (id, osm_uid, osm_name, role, created_at, last_login_at) VALUES ('ana', 1, 'Ana', 'contributor', 'x', 'x');
    INSERT INTO photos (id, station_id, credit, uploader_id, status, approved_at, created_at) VALUES
      ('p1', 'EZC-AMD-00001', 'Ana', 'ana', 'published', 'x', 'x'),
      ('p2', 'EZC-AMD-00002', 'Ana', 'ana', 'removed', 'x', 'x'),
      ('p3', 'EDP-LSB-00003', 'Ana', 'ana', 'published', 'x', 'x');
    INSERT INTO selections (target, station_id, photo_id, chosen_at, published_at, lost_at) VALUES
      ('EZC-AMD-00001', 'EZC-AMD-00001', 'p1', 'x', 'x', NULL),
      ('EZC-AMD-00002', 'EZC-AMD-00002', 'p2', 'x', NULL, 'x');
    INSERT INTO selections (target, station_id, photo_id, chosen_at, published_at) VALUES
      ('EDP-LSB-00003', 'EDP-LSB-00003', 'p3', 'x', NULL);
  `);
  return { DB: db };
}
const get = (env: unknown, path: string) => worker.fetch(new Request(SITE + path), env as never, {} as never);
const ids = async (env: unknown, path: string) =>
  ((await (await get(env, path)).json()) as { results: { id: string }[] }).results.map((r) => r.id);

test('parseFilters: opc, municipality and has_photo; junk is refused', () => {
  const p = (q: string) => parseFilters(new URLSearchParams(q));
  assert.deepEqual(p(''), {});
  assert.deepEqual(p('opc=EZC3&has_photo=false&municipality=Amadora'), { opc: 'EZC3', hasPhoto: false, municipality: 'Amadora' });
  assert.deepEqual(p('has_photo=1'), { hasPhoto: true });
  assert.deepEqual(p('opc=&has_photo='), {});
  assert.equal(p('has_photo=maybe'), 'bad');
  assert.equal(p("opc=a'b"), 'bad');
  assert.equal(p(`municipality=${'x'.repeat(81)}`), 'bad');
});

test('API: has_photo=false lists public stations whose link would answer 404', async () => {
  const env = world();
  // 00001 has a main photo; 00002 lost it; 00003 never went public (published_at null).
  assert.deepEqual(await ids(env, '/api/v1/stations?has_photo=false'), ['EDP-LSB-00003', 'EDP-LSB-00004', 'EZC-AMD-00002']);
  assert.deepEqual(await ids(env, '/api/v1/stations?has_photo=true'), ['EZC-AMD-00001']);
  assert.deepEqual(await ids(env, '/api/v1/stations?has_photo=0&opc=edp'), ['EDP-LSB-00003', 'EDP-LSB-00004']);
  assert.deepEqual(await ids(env, '/api/v1/stations?opc=EZC3'), ['EZC-AMD-00001', 'EZC-AMD-00002']);
  assert.deepEqual(await ids(env, '/api/v1/stations?municipality=lisboa&has_photo=false'), ['EDP-LSB-00003', 'EDP-LSB-00004']);
});

test('API: the filters narrow text and place searches too', async () => {
  const env = world();
  assert.deepEqual(await ids(env, '/api/v1/stations?q=posto&opc=EZC3&has_photo=false'), ['EZC-AMD-00002']);
  assert.deepEqual(
    await ids(env, '/api/v1/stations?lat=38.7&lon=-9.2&radius=1000&has_photo=false'),
    ['EZC-AMD-00002'],
  );
});

test('API: a filters-only listing is paged by id', async () => {
  const env = world();
  const first = await (await get(env, '/api/v1/stations?has_photo=false&limit=2')).json() as { results: { id: string }[]; next: string | null };
  assert.deepEqual(first.results.map((r) => r.id), ['EDP-LSB-00003', 'EDP-LSB-00004']);
  assert.equal(first.next, 'EDP-LSB-00004');
  const second = await (await get(env, `/api/v1/stations?has_photo=false&limit=2&after=${first.next}`)).json() as { results: { id: string }[]; next: string | null };
  assert.deepEqual(second.results.map((r) => r.id), ['EZC-AMD-00002']);
  assert.equal(second.next, null);
});

test('API: bad filters and a search with nothing to search for are 400', async () => {
  const env = world();
  for (const q of ['has_photo=maybe', "opc=a'b", 'lat=1&lon=1&has_photo=x']) {
    const res = await get(env, `/api/v1/stations?${q}`);
    assert.equal(res.status, 400, q);
    assert.equal(((await res.json()) as { error: string }).error, 'bad_filter');
  }
  const none = await get(env, '/api/v1/stations');
  assert.equal(none.status, 400);
  assert.equal(((await none.json()) as { error: string }).error, 'q_required');
});

test('page: «sem foto» lists the stations, filters by town and operator, in both languages', async () => {
  const env = world();
  const pt = await (await get(env, '/postos/sem-foto')).text();
  assert.match(pt, /<h1>Postos sem foto<\/h1>/);
  assert.match(pt, /Há 3 postos sem foto/);
  assert.ok(pt.includes('href="/postos/EDP-LSB-00003"'));
  assert.ok(pt.includes('href="/enviar?posto=EDP-LSB-00003"'));
  assert.equal(pt.includes('EZC-AMD-00001'), false);
  assert.equal(pt.includes('OOP-NEW'), false);
  assert.ok(pt.includes('<option value="Amadora">1 sem foto</option>'));
  assert.ok(pt.includes('<option value="EDP Comercial">2 sem foto</option>'));
  assert.ok(pt.includes('list="f-op-list"'));
  // The operator box sends the name; an operator code (older links) still works.
  for (const op of ['EDP', 'edp+comercial']) {
    const lisboa = await (await get(env, `/postos/sem-foto?concelho=Lisboa&operador=${op}`)).text();
    assert.equal(lisboa.includes('EZC-AMD-00002'), false, op);
    assert.ok(lisboa.includes('EDP-LSB-00004'), op);
    assert.ok(lisboa.includes('id="f-town" name="concelho" type="search" value="Lisboa"'), op);
    assert.ok(lisboa.includes('name="operador" type="search" value="EDP Comercial"'), op);
  }
  const nobody = await (await get(env, '/postos/sem-foto?operador=Ningu%C3%A9m+Lda')).text();
  assert.match(nobody, /Nenhum posto sem foto com estes filtros/);
  const en = await get(env, '/en/stations/without-photo?municipality=Amadora');
  assert.equal(en.status, 200);
  assert.equal(en.headers.get('content-language'), 'en');
  const enHtml = await en.text();
  assert.match(enHtml, /<h1>Stations without a photo<\/h1>/);
  assert.ok(enHtml.includes('EZC-AMD-00002') && !enHtml.includes('EDP-LSB-00003'));
  assert.ok(enHtml.includes('href="/en/upload?posto=EZC-AMD-00002"'));
  // «sem-foto» is not read as a station id.
  assert.equal((await get(env, '/postos/sem-foto')).status, 200);
});

test('page: «sem foto» searches by text within the filters', async () => {
  const env = world();
  const hit = await (await get(env, '/postos/sem-foto?q=00004')).text();
  assert.ok(hit.includes('href="/postos/EDP-LSB-00004"'));
  assert.equal(hit.includes('href="/postos/EDP-LSB-00003"'), false);
  assert.ok(hit.includes('name="q" type="search" value="00004"'));
  assert.ok(hit.includes('q=00004'));
  // The search never lists a station that has a photo, and keeps the filters.
  const posto = await (await get(env, '/postos/sem-foto?q=posto&operador=EZC3')).text();
  assert.ok(posto.includes('href="/postos/EZC-AMD-00002"'));
  assert.equal(posto.includes('href="/postos/EZC-AMD-00001"'), false);
  assert.equal(posto.includes('href="/postos/EDP-LSB-00003"'), false);
});

test('page: the list is linked from the home page and the upload page', async () => {
  const env = world();
  assert.ok((await (await get(env, '/')).text()).includes('href="/postos/sem-foto"'));
  assert.ok((await (await get(env, '/en/')).text()).includes('href="/en/stations/without-photo"'));
  const upload = await (await get(env, '/enviar')).text();
  assert.ok(upload.includes('href="/postos/sem-foto"'));
});

test('page: everything photographed says thank you', async () => {
  const env = world();
  (env.DB as ReturnType<typeof d1>).sql.exec(`
    INSERT INTO selections (target, station_id, photo_id, chosen_at, published_at) VALUES ('EDP-LSB-00004', 'EDP-LSB-00004', 'p3', 'x', 'x');
    UPDATE selections SET published_at = 'x', lost_at = NULL WHERE target IN ('EDP-LSB-00003', 'EZC-AMD-00002');
    UPDATE photos SET status = 'published' WHERE id = 'p2';
  `);
  assert.match(await (await get(env, '/postos/sem-foto')).text(), /Todos os postos têm foto/);
});
