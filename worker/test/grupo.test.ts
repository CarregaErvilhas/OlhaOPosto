import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { GROUP, groupPage } from '../src/grupo.ts';
import { homePage } from '../src/pages.ts';

// The order every site of the group uses (brand/group.json).
const ORDER = ['carro', 'ohmigo', 'voltaria', 'ceme', 'nap', 'oop', 'pano', 'ampere'];

for (const [lang, path, here] of [['pt', '/grupo', 'Estás aqui'], ['en', '/en/group', 'You are here']] as const) {
  test(`group page (${lang}): every site in order, this one "here", AmpereArchive without a site`, () => {
    const h = groupPage(lang);
    assert.match(h, new RegExp(`<link rel="canonical" href="https://olhaoposto\\.ocarroeletrico\\.com${path}">`));
    assert.deepEqual([...h.matchAll(/<li class="mate m-(\w+)">/g)].map((m) => m[1]), ORDER);
    assert.equal([...h.matchAll(/class="here"/g)].length, 1);
    assert.ok(h.includes(here));
    assert.doesNotMatch(h, /href="https:\/\/olhaoposto\.ocarroeletrico\.com\/"/, 'no link to itself');
    assert.doesNotMatch(h, /href="https:\/\/ohm-age\./, 'AmpereArchive has no page');
    assert.ok(h.includes('href="https://panoramax.ocarroeletrico.com/"'));
    assert.doesNotMatch(h, /<img\b[^>]*\bsrc="(https?:)?\/\//, 'images from another domain');
    // JSON-LD parses and cannot close its script element.
    const ld = h.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1];
    assert.equal(JSON.parse(ld)['@type'], 'CollectionPage');
  });
}

test('group page: each image is in public/grupo, with its viewBox size', () => {
  for (const g of GROUP) {
    const svg = readFileSync(join(import.meta.dirname, '..', 'public', 'grupo', `${g.id}.svg`), 'utf8');
    const [, w, h] = svg.match(/viewBox="[\d.-]+ [\d.-]+ ([\d.]+) ([\d.]+)"/)!;
    assert.equal(Math.round(Number(w)), g.mascot.width, g.id);
    assert.equal(Math.round(Number(h)), g.mascot.height, g.id);
  }
});

test('every page links to the group from the footer', () => {
  assert.ok(homePage('pt').includes('<a href="/grupo">O grupo</a>'));
  assert.ok(homePage('en').includes('<a href="/en/group">The group</a>'));
});
