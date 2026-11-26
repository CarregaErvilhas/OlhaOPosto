import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  checkMissing, compactEvse, diff, sqlValue, toRows, toSql, validateFeed,
  type CurrentEvse, type CurrentStation, type Feed,
} from '../scripts/lib/stations.ts';

const site = (id: string, extra: object = {}) => ({
  id, code: id.slice(4), operatorId: 'EZC3', operator: 'EZ - CHARG3, Lda', city: 'Amadora',
  address: 'Estrada Santo Eloi, 25', region: 'CONT', lat: 38.78791, lon: -9.226767,
  osm: { element: 'node/1' },
  points: [{ id: `${id.slice(4)}-1`, kw: 11, connector: 'T2', dc: false }],
  ...extra,
});
const feed = (...sites: object[]): Feed => ({ schema: 1, generatedAt: '2000-01-02T00:00:00+00:00', sites } as Feed);

const asCurrent = (f: Feed, status = 'active') => {
  const r = toRows(f);
  return {
    stations: r.stations.map((s) => ({ ...s, source: 'nap', status })) as CurrentStation[],
    evses: r.evses.map((e) => ({ ...e, status })) as CurrentEvse[],
  };
};

test('validateFeed rejects anything but schema 1', () => {
  assert.throws(() => validateFeed({ schema: '1', generatedAt: 'x', sites: [] }));
  assert.throws(() => validateFeed({ schema: 2, generatedAt: 'x', sites: [] }));
  assert.throws(() => validateFeed(null));
  assert.equal(validateFeed(feed()).sites.length, 0);
});

test('toRows maps the feed and skips sites without id or coordinates', () => {
  const r = toRows(feed(site('EZC-AMD-00051'), { id: '', lat: 1, lon: 1 }, site('X-1', { lat: null }),
    site('EZC-AMD-00051')));
  assert.equal(r.stations.length, 1);
  assert.deepEqual(r.skipped, ['(no id)', 'X-1', 'EZC-AMD-00051']);
  assert.deepEqual(r.stations[0], {
    id: 'EZC-AMD-00051', code: 'AMD-00051', opc: 'EZC3', operator: 'EZ - CHARG3, Lda', name: null,
    address: 'Estrada Santo Eloi, 25', municipality: 'Amadora', region: 'CONT',
    lat: 38.78791, lon: -9.226767, osm_ref: 'node/1',
  });
  assert.deepEqual(r.evses, [{
    station_id: 'EZC-AMD-00051', point_id: 'AMD-00051-1', evse_id: null, evse_compact: null,
    connector: 'T2', max_kw: 11, dc: 0,
  }]);
});

test('the NAP EVSE code is kept as published, plus a form without the `*`', () => {
  const r = toRows(feed(site('EZC-AMD-00051', { points: [
    { id: 'AMD-00051-1', evse: ' PT*EZC*E*AMD*00051*01 ' },
    { id: 'AMD-00051-2', evse: 'PT*VIA*EMOBI-CSC-00189-3' },
    { id: 'AMD-00051-3', evse: '' },
  ] })));
  assert.deepEqual(r.evses.map((e) => [e.evse_id, e.evse_compact]), [
    ['PT*EZC*E*AMD*00051*01', 'PTEZCEAMD0005101'],
    ['PT*VIA*EMOBI-CSC-00189-3', 'PTVIAEMOBI-CSC-00189-3'],
    [null, null],
  ]);
  assert.equal(compactEvse('***'), null);
});

test('an EVSE code showing up on an existing point is an update', () => {
  const before = feed(site('EZC-AMD-00051'));
  const after = feed(site('EZC-AMD-00051', { points: [{ id: 'AMD-00051-1', kw: 11, connector: 'T2', evse: 'PT*EZC*E*AMD*00051*1' }] }));
  const d = diff(toRows(after), asCurrent(before));
  assert.deepEqual(d.updateEvses.map((e) => e.evse_compact), ['PTEZCEAMD000511']);
  assert.match(toSql(d, after.generatedAt)[0], /evse_compact = excluded\.evse_compact/);
});

test('point ids may repeat across stations', () => {
  const r = toRows(feed(site('AAA-X-1', { points: [{ id: '97' }] }), site('BBB-X-1', { points: [{ id: '97' }] })));
  assert.equal(r.evses.length, 2);
});

test('an unchanged feed writes nothing but the import state', () => {
  const f = feed(site('EZC-AMD-00051'));
  const d = diff(toRows(f), asCurrent(f));
  assert.deepEqual([d.insertStations, d.updateStations, d.missingStations, d.insertEvses, d.updateEvses, d.missingEvses],
    [[], [], [], [], [], []]);
  assert.equal(toSql(d, f.generatedAt).length, 1);
});

test('changes, disappearances and returns are detected', () => {
  const before = feed(site('EZC-AMD-00051'), site('EZC-AMD-00052'));
  const cur = asCurrent(before);
  cur.stations.push({ ...cur.stations[0], id: 'EZC-AMD-00099', status: 'missing_from_nap' });
  const after = feed(site('EZC-AMD-00051', { address: 'Nova morada' }), site('EZC-AMD-00099'), site('EZC-AMD-00100'));
  const d = diff(toRows(after), cur);
  assert.deepEqual(d.insertStations.map((s) => s.id), ['EZC-AMD-00100']);
  assert.deepEqual(d.updateStations.map((s) => s.id).sort(), ['EZC-AMD-00051', 'EZC-AMD-00099']);
  assert.deepEqual(d.missingStations, ['EZC-AMD-00052']);
  assert.deepEqual(d.missingEvses.map((e) => e.station_id), ['EZC-AMD-00052']);
});

test('rows of another source are never touched by the NAP import', () => {
  const f = feed(site('EZC-AMD-00051'));
  const cur = asCurrent(f);
  cur.stations[0].source = 'osm';
  cur.stations.push({ ...cur.stations[0], id: 'OSM-w1', source: 'osm', status: 'active' });
  const d = diff(toRows(f), cur);
  assert.deepEqual(d.conflicts, ['EZC-AMD-00051']);
  assert.deepEqual([d.updateStations, d.missingStations, d.insertEvses, d.updateEvses], [[], [], [], []]);
});

test('the mass-missing guard trips above 5%', () => {
  const f = feed(...Array.from({ length: 20 }, (_, i) => site(`EZC-AMD-${String(i).padStart(5, '0')}`)));
  const cur = asCurrent(f);
  assert.equal(checkMissing(diff(toRows(feed(...f.sites.slice(1))), cur), cur.stations), null);
  assert.match(checkMissing(diff(toRows(feed(...f.sites.slice(2))), cur), cur.stations) ?? '', /refusing/);
});

test('sqlValue escapes quotes and refuses odd values', () => {
  assert.equal(sqlValue("Rua d'Ouro"), "'Rua d''Ouro'");
  assert.equal(sqlValue('a\u0000b'), "'ab'");
  assert.equal(sqlValue(null), 'NULL');
  assert.equal(sqlValue(1.5), '1.5');
  assert.throws(() => sqlValue(Number.NaN));
  assert.throws(() => sqlValue({}));
});

test('toSql batches inserts and keeps stations before points', () => {
  const f = feed(...Array.from({ length: 250 }, (_, i) => site(`EZC-AMD-${String(i).padStart(5, '0')}`)));
  const sql = toSql(diff(toRows(f), { stations: [], evses: [] }), f.generatedAt);
  const stations = sql.filter((s) => s.startsWith('INSERT INTO stations'));
  const evses = sql.filter((s) => s.startsWith('INSERT INTO evses'));
  assert.equal(stations.length, 3);
  assert.equal(evses.length, 3);
  assert.ok(sql.indexOf(stations[2]) < sql.indexOf(evses[0]));
  assert.ok(sql.every((s) => s.length < 100_000));
});
