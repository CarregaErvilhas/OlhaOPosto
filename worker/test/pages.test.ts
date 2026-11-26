import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BRAND, esc, evseChoicePage, homePage, notFoundPage, searchPage, stationPage } from '../src/pages.ts';
import { sitemapXml } from '../src/sitemap.ts';
import { compactCode, ftsQuery, type PointRow, type SearchRow, type StationRow } from '../src/types.ts';

const station = (extra: Partial<StationRow> = {}): StationRow => ({
  id: 'EZC-AMD-00051', code: 'AMD-00051', opc: 'EZC3', operator: 'EZ - CHARG3, Lda', name: null,
  address: 'Estrada Santo Eloi, 25', municipality: 'Amadora', region: 'CONT', lat: 38.78791, lon: -9.226767,
  status: 'active', osm_ref: 'node/1', updated_at: '2000-01-02T00:00:00+00:00', source: 'nap', codes: null, ...extra,
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
  // The only script tags are ours.
  assert.deepEqual(page.match(/<script[^>]*>/gi), ['<script src="/theme.js">', '<script src="/install.js" defer>', '<script src="/site.js" defer>']);
});

test('station page: static links, socket anchors, pt-PT power', () => {
  const page = stationPage('pt', station(), [point(), point({ point_id: '2', evse_id: null, evse_compact: null, connector: 'CCS', max_kw: 50, dc: 1 })]);
  assert.ok(page.includes('data-base="https://pictures.ocarroeletrico.com/EZC-AMD-00051"'));
  assert.ok(page.includes('data-base="https://pictures.ocarroeletrico.com/PTEZCEAMD000511"'));
  assert.ok(page.includes('id="t-PTEZCEAMD000511"'));
  assert.ok(page.includes('7,4 kW'));
  assert.ok(page.includes('Sem código EVSE no NAP'));
  assert.ok(page.includes('href="https://www.openstreetmap.org/node/1"'));
  assert.ok(page.includes('<link rel="canonical" href="https://olhaoposto.ocarroeletrico.com/postos/EZC-AMD-00051">'));
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
  const m = { station_id: 'A-1', name: null, opc: null, operator: null, point_id: '1', evse_id: 'PT*X*E1', evse_compact: 'PTXE1', connector: null, max_kw: null, dc: 0, status: 'active', updated_at: '', lat: 0, lon: 0, socket_photo: 0, socket_credit: null, socket_pano: null, station_photo: 0, station_credit: null, station_pano: null };
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
    assert.ok(page.includes(`<link rel="canonical" href="https://olhaoposto.ocarroeletrico.com${self}">`));
    assert.ok(page.includes(`<meta property="og:url" content="https://olhaoposto.ocarroeletrico.com${self}">`));
    assert.ok(page.includes('hreflang="pt-PT" href="https://olhaoposto.ocarroeletrico.com/postos/EZC-AMD-00051"'));
    assert.ok(page.includes('hreflang="en" href="https://olhaoposto.ocarroeletrico.com/en/stations/EZC-AMD-00051"'));
    assert.ok(page.includes('hreflang="x-default" href="https://olhaoposto.ocarroeletrico.com/postos/EZC-AMD-00051"'));
  }
  const home = homePage('en');
  assert.ok(home.includes('<html lang="en">') && home.includes('href="https://olhaoposto.ocarroeletrico.com/en/"'));
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
  const m = { station_id: 'A-1', name: null, opc: null, operator: null, point_id: '1', evse_id: 'PT*X*E1', evse_compact: 'PTXE1', connector: null, max_kw: null, dc: 0, status: 'active', updated_at: '', lat: 0, lon: 0, socket_photo: 0, socket_credit: null, socket_pano: null, station_photo: 0, station_credit: null, station_pano: null };
  const choice = evseChoicePage('en', 'PTXE1', [m, m]);
  assert.ok(choice.includes('<meta name="robots" content="noindex">') && !choice.includes('rel="canonical"'));
  assert.ok(choice.includes('href="/en/stations/A-1#t-PTXE1"'));
  assert.ok(!notFoundPage('pt', 'x').includes('rel="canonical"'));
});

test('sitemap lists both languages and escapes ids', () => {
  const xml = sitemapXml([{ id: 'A_1', lastmod: '2000-01-02T00:00:00+00:00' }]);
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  // Home, privacy, terms and the group in both languages, plus the station in both.
  assert.equal(xml.match(/<url>/g)?.length, 10);
  assert.ok(xml.includes('<loc>https://olhaoposto.ocarroeletrico.com/condicoes</loc></url>'));
  assert.ok(xml.includes('<loc>https://olhaoposto.ocarroeletrico.com/en/privacy</loc></url>'));
  assert.ok(xml.includes('<loc>https://olhaoposto.ocarroeletrico.com/grupo</loc></url>'));
  assert.ok(xml.includes('<loc>https://olhaoposto.ocarroeletrico.com/en/stations/A_1</loc><lastmod>2000-01-02T00:00:00+00:00</lastmod>'));
  assert.ok(xml.includes('<loc>https://olhaoposto.ocarroeletrico.com/</loc></url>'));
});

test('ftsQuery: words as quoted prefixes, never FTS syntax', () => {
  assert.equal(ftsQuery('Lisboa'), '"Lisboa"*');
  assert.equal(ftsQuery('EZC-AMD-00051'), '"EZC"* AND "AMD"* AND "00051"*');
  assert.equal(ftsQuery('Açores'), '"Açores"*');
  assert.equal(ftsQuery('a "b" * NEAR( name:x OR y'), '"NEAR"* AND "name"* AND "OR"*');
  assert.equal(ftsQuery(' " * : '), null);
  assert.equal(ftsQuery('a b'), null);
  assert.equal(ftsQuery('um dois três quatro cinco seis sete oito')?.split(' AND ').length, 6);
  for (const q of ['"', '*', 'x"y', 'name:"', '-amd']) assert.ok(!(ftsQuery(q) ?? '').match(/"[^"]*"[^*\s]/));
});

test('search page: escapes the query, links each language, is not indexed', () => {
  const r: SearchRow = { id: 'EZC-AMD-00051', name: null, opc: 'EZC3', operator: 'EZ', address: 'Rua', municipality: 'Amadora', region: 'CONT', lat: 0, lon: 0, status: 'missing_from_nap', source: 'nap' };
  const evil = '<script>"x"';
  const page = searchPage('pt', evil, [r], 20);
  assert.ok(!page.includes('<script>"x"'));
  assert.ok(page.includes('value="&lt;script&gt;&quot;x&quot;"'));
  assert.ok(page.includes(`<title>Pesquisa: &lt;script&gt;&quot;x&quot; · ${esc(BRAND)}</title>`));
  assert.ok(page.includes('<meta name="robots" content="noindex">') && !page.includes('rel="canonical"'));
  assert.ok(page.includes('href="/en/search?q=%3Cscript%3E%22x%22"'));
  assert.ok(page.includes('href="/postos/EZC-AMD-00051"') && page.includes('Fora do NAP'));
  const en = searchPage('en', 'nada', [], 20);
  assert.ok(en.includes('No stations found for “nada”.') && en.includes('action="/en/search"'));
  assert.ok(searchPage('pt', 'a', null, 20).includes('pelo menos duas'));
  assert.ok(searchPage('pt', 'x', Array(20).fill(r), 20).includes('Primeiros 20 postos'));
});

test('home page has a search form with a visible label', () => {
  const home = homePage('pt');
  assert.ok(home.includes('<form class="search" action="/pesquisa" method="get" role="search">'));
  assert.ok(home.includes('<label for="q">Procurar um posto</label>'));
});

test('every page has the theme picker, hidden until theme.js shows it', () => {
  for (const [page, label] of [[homePage('pt'), 'Tema'], [notFoundPage('en', 'x'), 'Theme']] as const) {
    assert.ok(page.includes('<script src="/theme.js"></script>'));
    assert.ok(page.includes('<div class="theme" hidden>'));
    assert.ok(page.includes(`<label for="theme">${label}</label>`));
    assert.ok(page.includes('<option value="auto">') && page.includes('<option value="dark">'));
  }
});

test('stationPage: main photo with credit, socket thumbnails, upload link when empty', () => {
  const withPhoto = stationPage('pt', station(), [point()], {
    'EZC-AMD-00051': { credit: '<b>Ana</b>' }, PTEZCEAMD000511: { credit: 'Ana' },
  });
  assert.ok(withPhoto.includes('src="https://pictures.ocarroeletrico.com/EZC-AMD-00051.jpg"'));
  assert.ok(withPhoto.includes('&lt;b&gt;Ana&lt;/b&gt;'));
  assert.ok(withPhoto.includes('CC BY-SA 4.0'));
  assert.ok(withPhoto.includes('PTEZCEAMD000511.thumb.jpg'));
  assert.ok(withPhoto.includes('Com foto'));
  const empty = stationPage('en', station(), [point()]);
  assert.ok(empty.includes('href="/en/upload"'));
  assert.ok(!empty.includes('.thumb.jpg'));
});

test('stationPage: see also links to the NAP dashboard, and to Panoramax once there is a photo', () => {
  const none = stationPage('pt', station(), [point()]);
  assert.ok(none.includes('href="https://nap.ocarroeletrico.com/?posto=AMD-00051"'));
  assert.ok(!none.includes('panoramax.ocarroeletrico.com/viewer'));
  const withPhoto = stationPage('en', station(), [point()], {
    'EZC-AMD-00051': { credit: 'Ana', panoramax_id: '0f0e-"x"' },
  });
  assert.ok(withPhoto.includes(
    'href="https://panoramax.ocarroeletrico.com/viewer?focus=map&amp;map=19/38.78791/-9.226767&amp;pic=0f0e-%22x%22"'));
  // Gone from the NAP: the dashboard has nothing to show, and no photo means no card at all.
  const gone = stationPage('pt', station({ status: 'missing_from_nap' }), []);
  assert.ok(!gone.includes('nap.ocarroeletrico.com/?posto='));
  assert.ok(!gone.includes('Ver também'));
});

test('station page: add-to-OSM tag and iD link only with a main photo on Panoramax', () => {
  const mains = { 'EZC-AMD-00051': { credit: 'Ana', panoramax_id: 'abc-"1"' } };
  const linked = stationPage('pt', station({ osm_ref: 'way/7' }), [point()], mains);
  assert.match(linked, /<code id="osm-tag">panoramax=abc-&quot;1&quot;<\/code>/);
  assert.match(linked, /data-target="osm-tag"/);
  assert.match(linked, /href="https:\/\/www\.openstreetmap\.org\/edit\?editor=id&amp;way=7">Abrir o elemento no editor iD/);
  assert.doesNotMatch(linked, /ainda não está ligado a um elemento: procura/);

  const unlinked = stationPage('en', station({ osm_ref: null }), [point()], mains);
  assert.match(unlinked, /edit\?editor=id#map=19\//);
  assert.match(unlinked, /Open the place in the iD editor/);
  assert.match(unlinked, /not linked to an element yet/);

  assert.doesNotMatch(stationPage('pt', station(), [point()]), /osm-tag/);
  assert.doesNotMatch(stationPage('pt', station(), [point()], { 'EZC-AMD-00051': { credit: 'Ana', panoramax_id: null } }), /osm-tag/);
});

test('station under construction: banner, codes, gallery, no static links or sockets, not indexed', () => {
  const s = station({ id: 'OSM-w1551836005', code: 'ALM-00114', opc: null, source: 'osm', codes: 'ALM-00114 ALM-00155', osm_ref: 'way/1551836005' });
  const empty = stationPage('pt', s, []);
  assert.match(empty, /Em construção segundo o OpenStreetMap/);
  assert.match(empty, /<code>ALM-00155<\/code>/);
  assert.match(empty, /enviar\?posto=OSM-w1551836005/);
  assert.ok(!empty.includes('Links estáticos'));
  assert.ok(!empty.includes('pictures.ocarroeletrico.com/OSM-w1551836005'));
  assert.ok(!empty.includes('nap.ocarroeletrico.com/?posto='));
  assert.match(empty, /<meta name="robots" content="noindex">/);
  const withPhotos = stationPage('en', s, [], {}, [], [{ id: 'ph1', credit: 'Ana', panoramax_id: 'pano-1' }]);
  assert.match(withPhotos, /panoramax\.ocarroeletrico\.com\/api\/pictures\/pano-1\/thumb\.jpg/);
  assert.match(withPhotos, /href="\/en\/p\/ph1"/);
  assert.match(withPhotos, /Under construction according to OpenStreetMap/);
  const gone = stationPage('pt', { ...s, status: 'missing_from_osm' }, []);
  assert.match(gone, /saiu da lista de obras que vem do OpenStreetMap/);
});
