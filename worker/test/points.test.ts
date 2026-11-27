import assert from 'node:assert/strict';
import { test } from 'node:test';

import { awardApproval, awardRefresh, medalFor, myPoints, ranking, setRankingOptOut } from '../src/points.ts';
import { rankingPage } from '../src/pages.ts';
import { d1 } from './d1.ts';

const NOW = new Date('2026-11-25T10:00:00Z');
const DAY = 86_400_000;

function setup() {
  const db = d1();
  db.sql.exec(`INSERT INTO stations (id, lat, lon, updated_at) VALUES ('S1', 38.7, -9.2, 'x'), ('S2', 38.8, -9.3, 'x')`);
  db.sql.exec(`INSERT INTO users (id, osm_uid, osm_name, created_at, last_login_at) VALUES
    ('ana', 1, 'Ana', 'x', 'x'), ('rui', 2, 'Rui', 'x', 'x'), ('mod', 3, 'Mod', 'x', 'x')`);
  let n = 0;
  const photo = (uploader: string, station: string, evse: string | null = null, status = 'published', kind = 'photo') => {
    const id = `p${++n}`;
    db.sql.prepare(`INSERT INTO photos (id, station_id, evse_compact, kind, uploader_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'x')`)
      .run(id, station, evse, kind, uploader, status);
    return id;
  };
  const rows = () => db.sql.prepare('SELECT user_id, photo_id, points, reason FROM points ORDER BY id').all().map((r) => ({ ...r }));
  return { db, photo, rows };
}

test('first approved photo of a target: +1 and +3, to the author', async () => {
  const { db, photo, rows } = setup();
  const p = photo('ana', 'S1', 'PTX1');
  assert.deepEqual(await awardApproval(db, p, NOW), ['approved', 'first_photo']);
  assert.deepEqual(rows(), [
    { user_id: 'ana', photo_id: p, points: 1, reason: 'approved' },
    { user_id: 'ana', photo_id: p, points: 3, reason: 'first_photo' },
  ]);
  // Calling it again awards nothing more.
  await awardApproval(db, p, NOW);
  assert.equal(rows().length, 2);
});

test('second photo of the same target by someone else: +1 only', async () => {
  const { db, photo } = setup();
  await awardApproval(db, photo('ana', 'S1'), NOW);
  assert.deepEqual(await awardApproval(db, photo('rui', 'S1'), NOW), ['approved']);
  // A socket of the same station is another target.
  assert.deepEqual(await awardApproval(db, photo('rui', 'S1', 'PTX1'), NOW), ['approved', 'first_photo']);
});

test('the same person on the same target within 30 days counts once', async () => {
  const { db, photo } = setup();
  await awardApproval(db, photo('ana', 'S1'), NOW);
  assert.deepEqual(await awardApproval(db, photo('ana', 'S1'), new Date(NOW.getTime() + 10 * DAY)), []);
  assert.deepEqual(await awardApproval(db, photo('ana', 'S1'), new Date(NOW.getTime() + 31 * DAY)), ['approved']);
});

test('pending photos and photos with no author earn nothing', async () => {
  const { db, photo } = setup();
  assert.deepEqual(await awardApproval(db, photo('ana', 'S1', null, 'pending'), NOW), []);
  db.sql.exec(`INSERT INTO photos (id, station_id, status, created_at) VALUES ('anon', 'S1', 'published', 'x')`);
  assert.deepEqual(await awardApproval(db, 'anon', NOW), []);
});

test('refresh: +2 only when the replaced main photo was over 12 months old', async () => {
  const { db, photo, rows } = setup();
  const p = photo('rui', 'S1');
  assert.equal(await awardRefresh(db, p, new Date(NOW.getTime() - 200 * DAY).toISOString(), NOW), false);
  assert.equal(await awardRefresh(db, p, null, NOW), false);
  assert.equal(await awardRefresh(db, p, new Date(NOW.getTime() - 400 * DAY).toISOString(), NOW), true);
  await awardRefresh(db, p, new Date(NOW.getTime() - 400 * DAY).toISOString(), NOW);
  assert.deepEqual(rows(), [{ user_id: 'rui', photo_id: p, points: 2, reason: 'refresh' }]);
});

test('ranking: published photos only, month or all time, opt-out hidden', async () => {
  const { db, photo } = setup();
  for (const s of ['S1', 'S2']) await awardApproval(db, photo('ana', s), NOW);
  await awardApproval(db, photo('rui', 'S1', 'PTX1'), new Date('2026-10-01T00:00:00Z'));
  const hidden = photo('rui', 'S2', 'PTX2');
  await awardApproval(db, hidden, NOW);
  db.sql.prepare(`UPDATE photos SET status = 'removed' WHERE id = ?`).run(hidden);

  assert.deepEqual(await ranking(db, 'all', NOW), [
    { name: 'Ana', points: 8, photos: 2, medal: null },
    { name: 'Rui', points: 4, photos: 1, medal: null },
  ]);
  assert.deepEqual(await ranking(db, 'month', NOW), [{ name: 'Ana', points: 8, photos: 2, medal: null }]);
  await setRankingOptOut(db, 'ana', true);
  assert.deepEqual((await ranking(db, 'all', NOW)).map((r) => r.name), ['Rui']);
  // Still counted on the account page.
  assert.deepEqual(await myPoints(db, 'ana', NOW), { total: 8, month: 8, photos: 2, medal: null, optOut: true });
});

test('medals from the total', () => {
  assert.equal(medalFor(0), null);
  assert.equal(medalFor(10), 'bronze');
  assert.equal(medalFor(199), 'silver');
  assert.equal(medalFor(200), 'gold');
});

test('rankingPage: a table with escaped names, medals and the rules', () => {
  const html = rankingPage('pt', 'all', [{ name: '<b>x</b>', points: 60, photos: 12, medal: 'silver' }]);
  assert.ok(html.includes('<table class="ranking">'));
  assert.ok(html.includes('&lt;b&gt;x&lt;/b&gt;'));
  assert.ok(html.includes('medal-silver'));
  assert.ok(html.includes('Como se ganham pontos'));
});

test('a rating plate counts apart from the photos of the same station', async () => {
  const { db, photo } = setup();
  const a = photo('ana', 'S1');
  assert.deepEqual(await awardApproval(db, a, NOW), ['approved', 'first_photo']);
  // Same person, same station, same day: a plate is another target for points.
  const plate = photo('ana', 'S1', null, 'published', 'plate');
  assert.deepEqual(await awardApproval(db, plate, NOW), ['approved', 'first_photo']);
  const plate2 = photo('rui', 'S1', null, 'published', 'plate');
  assert.deepEqual(await awardApproval(db, plate2, NOW), ['approved']);
});
