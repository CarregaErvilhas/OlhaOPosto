import assert from 'node:assert/strict';
import { test } from 'node:test';

import { tokenHash } from '../src/auth.ts';
import worker from '../src/index.ts';
import { lostTargets } from '../src/mains.ts';
import { deletePhoto, exportPhotos, getPhoto } from '../src/photoapi.ts';
import { ranking } from '../src/points.ts';
import { createToken } from '../src/tokens.ts';
import { d1 } from './d1.ts';

const SITE = 'https://olhaoposto.ocarroeletrico.com';
const NOW = new Date('2026-11-26T12:00:00Z');
const MAIN = '00000000-0000-0000-0000-000000000001';    // Ana's main photo of the station
const GALLERY = '00000000-0000-0000-0000-000000000002'; // Bea's other published photo
const WAIT = '00000000-0000-0000-0000-000000000003';    // Ana's, waiting for a moderator
const HIDDEN_ST = '00000000-0000-0000-0000-000000000004'; // a photo of a proposed (not public) station

async function world() {
  const db = d1();
  db.sql.exec(`
    INSERT INTO stations (id, code, opc, operator, name, municipality, lat, lon, status, updated_at) VALUES
      ('EZC-AMD-00051', 'AMD-00051', 'EZC3', 'EZ', 'Posto', 'Amadora', 38.5, -9.25, 'active', 'x'),
      ('OOP-NEW', NULL, NULL, 'EZ', 'Novo', 'Amadora', 38.6, -9.3, 'pending_review', 'x');
    INSERT INTO evses (station_id, point_id, evse_id, evse_compact, dc, updated_at) VALUES
      ('EZC-AMD-00051', 'AMD-00051-1', 'PT*EZC*E*AMD*00051*1', 'PTEZCEAMD000511', 0, 'x');
    INSERT INTO users (id, osm_uid, osm_name, role, created_at, last_login_at) VALUES
      ('ana', 1, 'Ana', 'contributor', 'x', 'x'), ('bea', 2, 'Bea', 'contributor', 'x', 'x'),
      ('mod', 3, 'Mo', 'moderator', 'x', 'x');
    INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES ('${await tokenHash('s-mod')}', 'mod', 'x', '2999-01-01');
    INSERT INTO photos (id, station_id, evse_compact, panoramax_set, panoramax_id, credit, uploader_id, status, approved_at, taken_at, created_at) VALUES
      ('${MAIN}', 'EZC-AMD-00051', NULL, 'set-1', 'pic-1', 'Ana', 'ana', 'published', '2026-01-01', '2026-01-01', '2026-01-01'),
      ('${GALLERY}', 'EZC-AMD-00051', 'PTEZCEAMD000511', 'set-2', 'pic-2', 'Bea', 'bea', 'published', '2026-02-01', NULL, '2026-02-01'),
      ('${WAIT}', 'EZC-AMD-00051', NULL, 'set-3', 'pic-3', 'Ana', 'ana', 'pending', NULL, NULL, '2026-03-01'),
      ('${HIDDEN_ST}', 'OOP-NEW', NULL, 'set-4', 'pic-4', 'Ana', 'ana', 'published', '2026-04-01', NULL, '2026-04-01');
    INSERT INTO selections (target, station_id, photo_id, chosen_at, published_at) VALUES
      ('EZC-AMD-00051', 'EZC-AMD-00051', '${MAIN}', 'x', '2026-01-01');
    INSERT INTO points (user_id, photo_id, points, reason, month, created_at) VALUES
      ('ana', '${MAIN}', 1, 'approved', '2026-01', 'x'), ('ana', '${MAIN}', 3, 'first_photo', '2026-01', 'x'),
      ('bea', '${GALLERY}', 1, 'approved', '2026-02', 'x');
  `);
  const ana = await createToken(db, 'ana', { name: 'a', scopes: ['photos:write'], days: 30 }, NOW);
  const bea = await createToken(db, 'bea', { name: 'b', scopes: ['photos:write'], days: 30 }, NOW);
  if (typeof ana === 'string' || typeof bea === 'string') throw new Error('token');
  const deleted: string[][] = [];
  const staged: string[][] = [];
  const calls: { url: string; method: string }[] = [];
  const fetcher = async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? 'GET' });
    return new Response('{}');
  };
  const env = {
    DB: db,
    PANORAMAX_TOKEN: 'pt', PANORAMAX_URL: 'https://pano.test', CF_ZONE_ID: 'z', CF_CACHE_PURGE_TOKEN: 'c',
    PICTURES: { async delete(k: string[]) { deleted.push(k); } },
    STAGING: { async delete(k: string[]) { staged.push(k); } },
  };
  return { db, env, ana: ana.token, bea: bea.token, deleted, staged, calls, fetcher };
}
type World = Awaited<ReturnType<typeof world>>;
const photoRow = (w: World, id: string) =>
  ({ ...w.db.sql.prepare('SELECT status, refusal_reason, refusal_note, refused_by, approved_by FROM photos WHERE id = ?').get(id) }) as Record<string, string | null>;
const user = (id: string, role = 'contributor') => ({ id, name: id, role });

test('getPhoto: a published photo is public, with credit, licence, station and sizes', async () => {
  const w = await world();
  const r = await getPhoto(w.env, MAIN);
  assert.ok('photo' in r && !r.private);
  const p = (r as { photo: Record<string, any> }).photo;
  assert.equal(p.id, MAIN);
  assert.equal(p.target, 'EZC-AMD-00051');
  assert.equal(p.socket, null);
  assert.equal(p.credit, 'Ana');
  assert.equal(p.license, 'CC-BY-SA-4.0');
  assert.equal(p.attribution, "© Ana, CC BY-SA 4.0, via olh'o'posto");
  assert.equal(p.isMain, true);
  assert.equal(p.station.id, 'EZC-AMD-00051');
  assert.equal(p.station.lat, 38.5);
  assert.equal(p.sizes.full.url, 'https://pictures.ocarroeletrico.com/EZC-AMD-00051.full.jpg');
  assert.equal(p.sizes.thumb.maxPx, 400);
  assert.equal(p.panoramaxId, 'pic-1');
  assert.equal(p.creditPage, `${SITE}/p/${MAIN}`);
  // The public view has no status and no GPS of the photo.
  assert.equal('status' in p, false);
  assert.equal(JSON.stringify(p).includes('exif'), false);
});

test('getPhoto: a gallery photo has Panoramax images, not the static links', async () => {
  const w = await world();
  const { photo } = await getPhoto(w.env, GALLERY) as { photo: Record<string, any> };
  assert.equal(photo.isMain, false);
  assert.equal(photo.socket, 'PTEZCEAMD000511');
  assert.equal(photo.sizes.main.url, 'https://panoramax.ocarroeletrico.com/api/pictures/pic-2/sd.jpg');
  assert.equal(photo.sizes.main.maxPx, null);
});

test('getPhoto: others\' pending photos and unknown ids are 404; the author and moderators see the status', async () => {
  const w = await world();
  assert.deepEqual(await getPhoto(w.env, WAIT), { notFound: true });
  assert.deepEqual(await getPhoto(w.env, WAIT, user('bea')), { notFound: true });
  assert.deepEqual(await getPhoto(w.env, 'nope'), { notFound: true });
  assert.deepEqual(await getPhoto(w.env, '../x'), { notFound: true });
  // A published photo of a station that is not public yet stays private too.
  assert.deepEqual(await getPhoto(w.env, HIDDEN_ST), { notFound: true });
  for (const u of [user('ana'), user('mod', 'moderator')]) {
    const r = await getPhoto(w.env, WAIT, u) as { photo: Record<string, any>; private: boolean };
    assert.equal(r.photo.status, 'pending');
    assert.equal(r.private, true);
    assert.equal(r.photo.sizes, null);
    assert.equal(r.photo.panoramax, null);
  }
  // Refused: the author reads the reason.
  w.db.sql.exec(`UPDATE photos SET status = 'removed', refusal_reason = 'quality', refusal_note = 'blurry' WHERE id = '${WAIT}'`);
  const refused = await getPhoto(w.env, WAIT, user('ana')) as { photo: Record<string, any> };
  assert.deepEqual(refused.photo.refusal, { reason: 'quality', note: 'blurry' });
});

test('exportPhotos: every published photo of a public station, gallery included', async () => {
  const w = await world();
  const out = await exportPhotos(w.env);
  assert.equal(out.license, 'CC-BY-SA-4.0');
  assert.equal(out.count, 2);
  assert.deepEqual(out.photos.map((p) => p.id).sort(), [MAIN, GALLERY].sort());
  const gallery = out.photos.find((p) => p.id === GALLERY)!;
  assert.equal(gallery.station.municipality, 'Amadora');
  assert.equal(gallery.panoramaxId, 'pic-2');
  assert.equal(gallery.isMain, false);
});

test('deletePhoto: the author removes their own published main photo end to end', async () => {
  const w = await world();
  const r = await deletePhoto(w.env as never, user('ana'), MAIN, {}, w.fetcher, NOW);
  assert.deepEqual(r, { ok: true });
  assert.deepEqual(photoRow(w, MAIN), { status: 'removed', refusal_reason: null, refusal_note: null, refused_by: null, approved_by: null });
  // Static copies are gone, the cache purged, Panoramax's upload set deleted.
  assert.deepEqual(w.deleted.flat().sort(), ['EZC-AMD-00051.full.jpg', 'EZC-AMD-00051.jpg', 'EZC-AMD-00051.thumb.jpg']);
  assert.ok(w.calls.some((c) => c.url.includes('purge_cache') && c.method === 'POST'));
  assert.ok(w.calls.some((c) => c.url === 'https://pano.test/api/upload_sets/set-1' && c.method === 'DELETE'));
  assert.deepEqual(w.staged.flat(), [`${MAIN}/main.jpg`, `${MAIN}/thumb.jpg`]);
  // The station is now without a main photo, for a moderator to choose.
  assert.deepEqual((await lostTargets(w.env as never)).map((l) => l.target), ['EZC-AMD-00051']);
  // Its points stop counting; Bea's stay.
  assert.deepEqual((await ranking(w.db, 'all', NOW)).map((x) => [x.name, x.points]), [['Bea', 1]]);
  // It is gone from the API and the export; a second call is a 404.
  assert.deepEqual(await getPhoto(w.env, MAIN), { notFound: true });
  assert.equal((await exportPhotos(w.env)).count, 1);
  assert.deepEqual(await deletePhoto(w.env as never, user('ana'), MAIN, {}, w.fetcher, NOW), { error: 'not_found', status: 404 });
});

test('deletePhoto: the author can withdraw a photo that is still waiting', async () => {
  const w = await world();
  assert.deepEqual(await deletePhoto(w.env as never, user('ana'), WAIT, {}, w.fetcher, NOW), { ok: true });
  assert.equal(photoRow(w, WAIT).status, 'removed');
  assert.ok(w.calls.some((c) => c.url.endsWith('/upload_sets/set-3') && c.method === 'DELETE'));
  // Nothing was public: no static copy touched.
  assert.deepEqual(w.deleted, []);
});

test('deletePhoto: not someone else\'s photo; 403 if public, 404 if not', async () => {
  const w = await world();
  assert.deepEqual(await deletePhoto(w.env as never, user('bea'), MAIN, {}, w.fetcher, NOW), { error: 'forbidden', status: 403 });
  assert.deepEqual(await deletePhoto(w.env as never, user('bea'), WAIT, {}, w.fetcher, NOW), { error: 'not_found', status: 404 });
  assert.deepEqual(await deletePhoto(w.env as never, user('bea'), 'nope', {}, w.fetcher, NOW), { error: 'not_found', status: 404 });
  assert.equal(photoRow(w, MAIN).status, 'published');
  assert.deepEqual(w.calls, []);
});

test('deletePhoto: a moderator removes any photo, with a reason the author sees', async () => {
  const w = await world();
  assert.deepEqual(await deletePhoto(w.env as never, user('mod', 'moderator'), GALLERY, { reason: 'nonsense' }, w.fetcher, NOW), { error: 'bad_reason', status: 400 });
  assert.equal(photoRow(w, GALLERY).status, 'published');
  assert.deepEqual(await deletePhoto(w.env as never, user('mod', 'moderator'), GALLERY, { reason: 'privacy', note: ' a face ' }, w.fetcher, NOW), { ok: true });
  assert.deepEqual(photoRow(w, GALLERY), { status: 'removed', refusal_reason: 'privacy', refusal_note: 'a face', refused_by: 'mod', approved_by: 'mod' });
  // The gallery photo was not the main one: the main photo stays.
  assert.deepEqual(await lostTargets(w.env as never), []);
  assert.deepEqual(w.deleted, []);
  // Without a reason it is «other».
  assert.deepEqual(await deletePhoto(w.env as never, user('mod', 'moderator'), MAIN, {}, w.fetcher, NOW), { ok: true });
  assert.equal(photoRow(w, MAIN).refusal_reason, 'other');
});

test('deletePhoto: if Panoramax does not answer nothing is lost, and repeating works', async () => {
  const w = await world();
  const down = async (url: string, init?: RequestInit) =>
    url.includes('/upload_sets/') ? new Response('no', { status: 500 }) : w.fetcher(url, init);
  assert.deepEqual(await deletePhoto(w.env as never, user('ana'), MAIN, {}, down, NOW), { error: 'panoramax', status: 502 });
  // Already hidden (copies gone) but not removed: the row can still be removed.
  assert.equal(photoRow(w, MAIN).status, 'hidden');
  assert.deepEqual(await deletePhoto(w.env as never, user('ana'), MAIN, {}, w.fetcher, NOW), { ok: true });
  assert.equal(photoRow(w, MAIN).status, 'removed');
});

// --- Through the Worker: auth, status codes, headers ---

async function api(w: World, path: string, init: RequestInit & { token?: string } = {}) {
  const { token, ...rest } = init;
  const headers = { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(rest.headers as Record<string, string> | undefined) };
  return worker.fetch(new Request(SITE + path, { ...rest, headers }), w.env as never, { waitUntil() {} } as never);
}

test('GET /api/v1/photos/{id}: public, cached; a pending one is only for its author', async () => {
  const w = await world();
  const res = await api(w, `/api/v1/photos/${MAIN}`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'public, max-age=300');
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  assert.equal(((await res.json()) as { id: string }).id, MAIN);
  assert.equal((await api(w, `/api/v1/photos/${WAIT}`)).status, 404);
  assert.equal((await api(w, `/api/v1/photos/${WAIT}`, { token: w.bea })).status, 404);
  const own = await api(w, `/api/v1/photos/${WAIT}`, { token: w.ana });
  assert.equal(own.status, 200);
  assert.equal(own.headers.get('cache-control'), 'private, no-store');
  assert.equal(((await own.json()) as { status: string }).status, 'pending');
  // A bad token only means the read stays public.
  assert.equal((await api(w, `/api/v1/photos/${MAIN}`, { token: 'oop_nope' })).status, 200);
  assert.equal((await api(w, '/api/v1/photos/%E0%A4%A')).status, 404);
});

test('GET /api/v1/photos.json: the whole gallery, cached for a day', async () => {
  const w = await world();
  const res = await api(w, '/api/v1/photos.json');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'public, max-age=86400');
  const body = await res.json() as { count: number; photos: { id: string }[] };
  assert.equal(body.count, 2);
  assert.equal(body.photos.length, 2);
});

test('DELETE /api/v1/photos/{id}: token or session, scope and ownership', async () => {
  const w = await world();
  const real = globalThis.fetch;
  globalThis.fetch = (async (u: string, i?: RequestInit) => w.fetcher(u, i)) as typeof fetch;
  try {
    assert.equal((await api(w, `/api/v1/photos/${MAIN}`, { method: 'DELETE' })).status, 403);   // cookie-less, cross-site check
    assert.equal((await api(w, `/api/v1/photos/${MAIN}`, { method: 'DELETE', token: 'oop_nope' })).status, 401);
    const forbidden = await api(w, `/api/v1/photos/${MAIN}`, { method: 'DELETE', token: w.bea });
    assert.equal(forbidden.status, 403);
    assert.deepEqual(await forbidden.json(), { error: 'forbidden' });
    assert.equal((await api(w, `/api/v1/photos/${MAIN}`, { method: 'DELETE', token: w.ana, body: '{oops' })).status, 400);
    const ok = await api(w, `/api/v1/photos/${MAIN}`, { method: 'DELETE', token: w.ana });
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await ok.json(), { removed: true });
    assert.equal((await api(w, `/api/v1/photos/${MAIN}`, { method: 'DELETE', token: w.ana })).status, 404);
    // A moderator with the session cookie, from the site's own pages.
    const mod = await api(w, `/api/v1/photos/${GALLERY}`, {
      method: 'DELETE', headers: { origin: SITE, cookie: '__Host-oop_session=s-mod', 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'duplicate' }),
    });
    assert.equal(mod.status, 200);
    assert.equal(photoRow(w, GALLERY).refusal_reason, 'duplicate');
  } finally {
    globalThis.fetch = real;
  }
});
