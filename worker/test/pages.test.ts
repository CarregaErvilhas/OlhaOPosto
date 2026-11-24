import assert from 'node:assert/strict';
import { test } from 'node:test';

import { esc, evseChoicePage, homePage, notFoundPage, stationPage } from '../src/pages.ts';
import { sitemapXml } from '../src/sitemap.ts';
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
  const page = stationPage('pt', station({ name: evil, address: evil, operator: evil, municipality: evil }), [
    point({ connector: evil, evse_id: evil }),
  ]);
  assert.ok(!page.includes('<script>alert'));
  assert.ok(page.includes('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&#39;&amp;'));
  // The only script tag is ours.
  assert.equal(page.match(/<script/g)?.length, 1);
});

test('station page: static links, socket anchors, pt-PT power', () => {
  const page = stationPage('pt', station(), [point(), point({ point_id: '2', evse_id: null, evse_compact: null, connector: 'CCS', max_kw: 50, dc: 1 })]);
  assert.ok(page.includes('data-base="https://pictures.ocarroeletrico.com/EZC-AMD-00051"'));
  assert.ok(page.includes('data-base="https://pictures.ocarroeletrico.com/PTEZCEAMD000511"'));
  assert.ok(page.includes('id="t-PTEZCEAMD000511"'));
  assert.ok(page.includes('7,4 kW'));
  assert.ok(page.includes('Sem código EVSE no NAP'));
  assert.ok(page.includes('href="https://www.openstreetmap.org/node/1"'));
  assert.ok(page.includes('<link rel="canonical" href="https://voltframe.ocarroeletrico.com/postos/EZC-AMD-00051">'));
});

test('an odd osm_ref is not linked; the map at the coordinates is', () => {
  const page = stationPage('pt', station({ osm_ref: 'javascript:alert(1)' }), []);
  assert.ok(!page.includes('openstreetmap.org/javascript'));
  assert.ok(page.includes('?mlat=38.78791&amp;mlon=-9.226767'));
});

test('stations gone from the NAP say so', () => {
  const page = stationPage('pt', station({ status: 'missing_from_nap' }), []);
  assert.ok(page.includes('Fora do NAP'));
  assert.ok(!page.includes('No NAP<'));
});

test('a repeated EVSE code lists every station', () => {
  const m = { station_id: 'A-1', name: null, opc: null, operator: null, point_id: '1', evse_id: 'PT*X*E1', evse_compact: 'PTXE1', connector: null, max_kw: null, dc: 0, status: 'active', updated_at: '' };
  const page = evseChoicePage('pt', 'PTXE1', [m, { ...m, station_id: 'B-1' }]);
  assert.ok(page.includes('href="/postos/A-1#t-PTXE1"') && page.includes('href="/postos/B-1#t-PTXE1"'));
});

test('compactCode accepts the code with or without the *, in any case', () => {
  assert.equal(compactCode('pt*ezc*e*amd*00051*1'), 'PTEZCEAMD000511');
  assert.equal(compactCode('PT*VIA*EMOBI-CSC-00189-3'), 'PTVIAEMOBI-CSC-00189-3');
  assert.equal(compactCode('<x>'), null);
});

test('each language has its own canonical and the full hreflang set', () => {
  for (const [lang, self] of [['pt', '/postos/EZC-AMD-00051'], ['en', '/en/stations/EZC-AMD-00051']] as const) {
    const page = stationPage(lang, station(), [point()]);
    assert.ok(page.includes(`<link rel="canonical" href="https://voltframe.ocarroeletrico.com${self}">`));
    assert.ok(page.includes(`<meta property="og:url" content="https://voltframe.ocarroeletrico.com${self}">`));
    assert.ok(page.includes('hreflang="pt-PT" href="https://voltframe.ocarroeletrico.com/postos/EZC-AMD-00051"'));
    assert.ok(page.includes('hreflang="en" href="https://voltframe.ocarroeletrico.com/en/stations/EZC-AMD-00051"'));
    assert.ok(page.includes('hreflang="x-default" href="https://voltframe.ocarroeletrico.com/postos/EZC-AMD-00051"'));
  }
  const home = homePage('en');
  assert.ok(home.includes('<html lang="en">') && home.includes('href="https://voltframe.ocarroeletrico.com/en/"'));
});

test('English page: English UI, NAP text marked as Portuguese', () => {
  const page = stationPage('en', station({ name: 'Estação' }), [point()]);
  assert.ok(page.includes('<html lang="en">'));
  assert.ok(page.includes('Type 2 · 7.4 kW · AC'));
  assert.ok(page.includes('Mainland Portugal'));
  assert.ok(page.includes('<p class="operator"><span lang="pt-PT">EZ - CHARG3, Lda</span></p>'));
  assert.ok(page.includes('<span lang="pt-PT">Estação · Estrada Santo Eloi, 25, Amadora</span>'));
  assert.ok(page.includes('href="/postos/EZC-AMD-00051" hreflang="pt-PT" lang="pt-PT">Português</a>'));
  assert.ok(!page.includes('Tomadas'));
});

test('pages that should not be indexed have no canonical', () => {
  const m = { station_id: 'A-1', name: null, opc: null, operator: null, point_id: '1', evse_id: 'PT*X*E1', evse_compact: 'PTXE1', connector: null, max_kw: null, dc: 0, status: 'active', updated_at: '' };
  const choice = evseChoicePage('en', 'PTXE1', [m, m]);
  assert.ok(choice.includes('<meta name="robots" content="noindex">') && !choice.includes('rel="canonical"'));
  assert.ok(choice.includes('href="/en/stations/A-1#t-PTXE1"'));
  assert.ok(!notFoundPage('pt', 'x').includes('rel="canonical"'));
});

test('sitemap lists both languages and escapes ids', () => {
  const xml = sitemapXml([{ id: 'A_1', lastmod: '2000-01-02T00:00:00+00:00' }]);
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  assert.equal(xml.match(/<url>/g)?.length, 4);
  assert.ok(xml.includes('<loc>https://voltframe.ocarroeletrico.com/en/stations/A_1</loc><lastmod>2000-01-02T00:00:00+00:00</lastmod>'));
  assert.ok(xml.includes('<loc>https://voltframe.ocarroeletrico.com/</loc></url>'));
});
