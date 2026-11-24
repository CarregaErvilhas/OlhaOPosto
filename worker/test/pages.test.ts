import assert from 'node:assert/strict';
import { test } from 'node:test';

import { esc, evseChoicePage, stationPage } from '../src/pages.ts';
import { compactCode, type PointRow, type StationRow } from '../src/types.ts';

const station = (extra: Partial<StationRow> = {}): StationRow => ({
  id: 'EZC-AMD-00051', code: 'AMD-00051', opc: 'EZC3', operator: 'EZ - CHARG3, Lda', name: null,
  address: 'Estrada Santo Eloi, 25', municipality: 'Amadora', region: 'CONT', lat: 38.78791, lon: -9.226767,
  status: 'active', osm_ref: 'node/1', updated_at: '2000-01-02T00:00:00+00:00', ...extra,
});
const point = (extra: Partial<PointRow> = {}): PointRow => ({
  point_id: 'AMD-00051-1', evse_id: 'PT*EZC*E*AMD*00051*1', evse_compact: 'PTEZCEAMD000511',
  connector: 'T2', max_kw: 7.4, dc: 0, status: 'active', ...extra,
});

test('esc covers text and attribute contexts', () => {
  assert.equal(esc(`<script>"&'`), '&lt;script&gt;&quot;&amp;&#39;');
  assert.equal(esc(null), '');
});

test('third-party text never reaches the page unescaped', () => {
  const evil = `<script>alert("x")</script>'&`;
  const page = stationPage(station({ name: evil, address: evil, operator: evil, municipality: evil }), [
    point({ connector: evil, evse_id: evil }),
  ]);
  assert.ok(!page.includes('<script>alert'));
  assert.ok(page.includes('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&#39;&amp;'));
  // The only script tag is ours.
  assert.equal(page.match(/<script/g)?.length, 1);
});

test('station page: static links, socket anchors, pt-PT power', () => {
  const page = stationPage(station(), [point(), point({ point_id: '2', evse_id: null, evse_compact: null, connector: 'CCS', max_kw: 50, dc: 1 })]);
  assert.ok(page.includes('data-base="https://pictures.ocarroeletrico.com/EZC-AMD-00051"'));
  assert.ok(page.includes('data-base="https://pictures.ocarroeletrico.com/PTEZCEAMD000511"'));
  assert.ok(page.includes('id="t-PTEZCEAMD000511"'));
  assert.ok(page.includes('7,4 kW'));
  assert.ok(page.includes('Sem código EVSE no NAP'));
  assert.ok(page.includes('href="https://www.openstreetmap.org/node/1"'));
  assert.ok(page.includes('<link rel="canonical" href="https://voltframe.ocarroeletrico.com/postos/EZC-AMD-00051">'));
});

test('an odd osm_ref is not linked; the map at the coordinates is', () => {
  const page = stationPage(station({ osm_ref: 'javascript:alert(1)' }), []);
  assert.ok(!page.includes('openstreetmap.org/javascript'));
  assert.ok(page.includes('?mlat=38.78791&amp;mlon=-9.226767'));
});

test('stations gone from the NAP say so', () => {
  const page = stationPage(station({ status: 'missing_from_nap' }), []);
  assert.ok(page.includes('Fora do NAP'));
  assert.ok(!page.includes('No NAP<'));
});

test('a repeated EVSE code lists every station', () => {
  const m = { station_id: 'A-1', name: null, opc: null, operator: null, point_id: '1', evse_id: 'PT*X*E1', evse_compact: 'PTXE1', connector: null, max_kw: null, dc: 0, status: 'active', updated_at: '' };
  const page = evseChoicePage('PTXE1', [m, { ...m, station_id: 'B-1' }]);
  assert.ok(page.includes('href="/postos/A-1#t-PTXE1"') && page.includes('href="/postos/B-1#t-PTXE1"'));
});

test('compactCode accepts the code with or without the *, in any case', () => {
  assert.equal(compactCode('pt*ezc*e*amd*00051*1'), 'PTEZCEAMD000511');
  assert.equal(compactCode('PT*VIA*EMOBI-CSC-00189-3'), 'PTVIAEMOBI-CSC-00189-3');
  assert.equal(compactCode('<x>'), null);
});
