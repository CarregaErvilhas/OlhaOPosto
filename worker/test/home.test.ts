import assert from 'node:assert/strict';
import { test } from 'node:test';

import worker from '../src/index.ts';
import { recentPhotoStations } from '../src/data.ts';
import { homePage } from '../src/pages.ts';
import { d1 } from './d1.ts';

function world() {
  const db = d1();
  for (const [id, status] of [['A-1', 'active'], ['B-1', 'active'], ['C-1', 'missing_from_nap'], ['D-1', 'active'], ['M-1', 'merged']]) {
    db.sql.prepare(`INSERT INTO stations (id, name, municipality, lat, lon, status, updated_at) VALUES (?, '<b>x</b>', 'Amadora', 38, -9, ?, 'x')`)
      .run(id, status);
  }
  const photo = (id: string, station: string, day: number, status = 'published', kind = 'photo', pano: string | null = `pic-${id}`) =>
    db.sql.prepare(`INSERT INTO photos (id, station_id, credit, status, kind, panoramax_id, approved_at, created_at) VALUES (?, ?, '<i>Ana</i>', ?, ?, ?, ?, 'x')`)
      .run(id, station, status, kind, pano, `2000-01-${String(day).padStart(2, '0')}`);
  photo('d', 'D-1', 1);
  photo('c', 'C-1', 2);
  photo('b', 'B-1', 3);
  for (let n = 1; n <= 5; n++) photo(`a${n}`, 'A-1', 3 + n);
  // None of these counts.
  photo('hidden', 'D-1', 20, 'hidden');
  photo('removed', 'D-1', 21, 'removed');
  photo('plate', 'D-1', 22, 'published', 'plate');
  photo('nopano', 'D-1', 23, 'published', 'photo', null);
  photo('merged', 'M-1', 24);
  return { DB: db };
}

test('recent stations: three, newest first, four photos each, only public ones', async () => {
  const recent = await recentPhotoStations(world() as never);
  assert.deepEqual(recent.map((s) => [s.id, s.photos.map((p) => p.id)]), [
    ['A-1', ['a5', 'a4', 'a3', 'a2']], ['B-1', ['b']], ['C-1', ['c']],
  ]);
});

test('home page: thumbnails link to the credit page, text is escaped, Panoramax allowed', async () => {
  const get = (env: unknown, path: string) =>
    worker.fetch(new Request(`https://olhaoposto.ocarroeletrico.com${path}`), env as never, {} as never);
  for (const [path, station, photo] of [['/', '/postos/A-1', '/p/a5'], ['/en/', '/en/stations/A-1', '/en/p/a5']]) {
    const res = await get(world(), path);
    const page = await res.text();
    assert.ok(page.includes(`href="${station}"`) && page.includes(`href="${photo}"`));
    assert.ok(page.includes('src="https://panoramax.ocarroeletrico.com/api/pictures/pic-a5/thumb.jpg"'));
    assert.ok(page.includes('&lt;i&gt;Ana&lt;/i&gt;') && !page.includes('<b>x</b>'));
    assert.ok(res.headers.get('content-security-policy')?.includes("img-src 'self' https://panoramax.ocarroeletrico.com"));
  }
  const empty = await get({ DB: d1() }, '/');
  assert.ok(!(await empty.text()).includes('class="recent"'));
  assert.ok(!empty.headers.get('content-security-policy')?.includes('panoramax'));
  assert.ok(!homePage('pt').includes('class="recent"'));
});
