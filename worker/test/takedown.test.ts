import assert from 'node:assert/strict';
import { test } from 'node:test';

import { tokenHash } from '../src/auth.ts';
import worker from '../src/index.ts';
import { chooseMain } from '../src/publish.ts';
import { decideTakedown, parseAsked, submitTakedown, takedownPage, takedownsPage, type TakedownEnv, type TakedownRow } from '../src/takedown.ts';
import { d1 } from './d1.ts';

const SITE = 'https://olhaoposto.ocarroeletrico.com';
const NOW = new Date('2026-11-25T12:00:00Z');
const PHOTO = '11111111-2222-3333-4444-555555555555';
const PIC = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function jpeg(width: number, height: number): Uint8Array {
  const seg = (m: number, p: number[]) => [0xff, m, (p.length + 2) >> 8, (p.length + 2) & 0xff, ...p];
  return Uint8Array.from([
    0xff, 0xd8,
    ...seg(0xe0, [74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]),
    ...seg(0xdb, new Array(65).fill(1)),
    ...seg(0xc0, [8, height >> 8, height & 0xff, width >> 8, width & 0xff, 1, 1, 0x11, 0]),
    0xff, 0xda, 0, 8, 1, 1, 0, 0, 0x3f, 0, 0x12, 0x34, 0xff, 0xd9,
  ]);
}

// A station with two sockets; the station and the first socket have a main photo.
async function world(opts: { purge?: boolean; photo?: boolean } = {}) {
  const db = d1();
  db.sql.exec(`
    INSERT INTO stations (id, code, opc, operator, name, lat, lon, status, updated_at)
      VALUES ('EZC-AMD-00051', 'AMD-00051', 'EZC3', 'EZ', 'Posto', 38.5, -9.25, 'active', 'x');
    INSERT INTO evses (station_id, point_id, evse_id, evse_compact, dc, updated_at) VALUES
      ('EZC-AMD-00051', 'AMD-00051-1', 'PT*EZC*E*AMD*00051*1', 'PTEZCEAMD000511', 0, 'x'),
      ('EZC-AMD-00051', 'AMD-00051-2', 'PT*EZC*E*AMD*00051*2', 'PTEZCEAMD000512', 0, 'x');
    INSERT INTO users (id, osm_uid, osm_name, role, created_at, last_login_at) VALUES ('mod', 1, 'Mo', 'moderator', 'x', 'x');
    INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES ('${await tokenHash('t')}', 'mod', 'x', '2999-01-01');
  `);
  if (opts.photo !== false) {
    db.sql.exec(`
      INSERT INTO photos (id, station_id, evse_compact, panoramax_set, panoramax_id, credit, status, created_at)
        VALUES ('${PHOTO}', 'EZC-AMD-00051', 'PTEZCEAMD000511', 'set-1', '${PIC}', 'Ana', 'published', 'x');
      INSERT INTO selections (target, station_id, photo_id, chosen_at, published_at) VALUES
        ('PTEZCEAMD000511', 'EZC-AMD-00051', '${PHOTO}', 'x', 'x'),
        ('EZC-AMD-00051', 'EZC-AMD-00051', '${PHOTO}', 'x', 'x');
    `);
  }
  const r2 = new Set(['PTEZCEAMD000511.jpg', 'PTEZCEAMD000511.thumb.jpg', 'PTEZCEAMD000511.full.jpg',
    'EZC-AMD-00051.jpg', 'EZC-AMD-00051.thumb.jpg', 'EZC-AMD-00051.full.jpg']);
  const staging = new Map([[`${PHOTO}/main.jpg`, jpeg(1024, 768)], [`${PHOTO}/thumb.jpg`, jpeg(400, 300)]]);
  const calls: { url: string; method: string; body?: string }[] = [];
  let action = 'takedown';
  const fetcher = async (url: string, init?: RequestInit) => {
    const body = typeof init?.body === 'string' ? init.body : undefined;
    calls.push({ url, method: init?.method ?? 'GET', body });
    if (url.includes('siteverify')) {
      return Response.json({ success: true, hostname: 'olhaoposto.ocarroeletrico.com', action });
    }
    if (url.endsWith('/hd.jpg')) return new Response(jpeg(2048, 1536));
    return new Response('{}');
  };
  const env = {
    DB: db,
    PANORAMAX_TOKEN: 'token',
    PANORAMAX_URL: 'https://pano.test',
    TURNSTILE_SITEKEY: 'site',
    TURNSTILE_SECRET: 'secret',
    ...(opts.purge === false ? {} : { CF_ZONE_ID: 'zone', CF_CACHE_PURGE_TOKEN: 'purge' }),
    PICTURES: {
      async put(k: string) { r2.add(k); },
      async delete(keys: string[]) { for (const k of keys) r2.delete(k); },
    },
    STAGING: {
      async get(k: string) { const b = staging.get(k); return b ? { arrayBuffer: async () => b.buffer } : null; },
      async put() {},
      async delete(keys: string[]) { for (const k of keys) staging.delete(k); },
    },
  } as unknown as TakedownEnv;
  return { db, env, r2, staging, calls, fetcher, setAction: (a: string) => { action = a; } };
}

const form = (path: string, fields: Record<string, string>) =>
  new Request(SITE + path, {
    method: 'POST',
    headers: { origin: SITE, cookie: '__Host-oop_session=t', 'cf-connecting-ip': '192.0.2.1' },
    body: new URLSearchParams(fields),
  });
const ask = (asked: string, extra: Record<string, string> = {}) =>
  form('/takedown', { alvo: asked, motivo: 'face', 'cf-turnstile-response': 'tok', lang: 'pt', ...extra });
const status = (w: Awaited<ReturnType<typeof world>>) =>
  (w.db.sql.prepare('SELECT status FROM photos WHERE id = ?').get(PHOTO) as { status: string }).status;

// --- What people type ---

test('parseAsked: codes, our links, pictures.* and Panoramax', () => {
  assert.deepEqual(parseAsked(' EZC-AMD-00051 '), { target: 'EZC-AMD-00051' });
  assert.deepEqual(parseAsked('PT*EZC*E*AMD*00051*1'), { target: 'PTEZCEAMD000511' });
  assert.deepEqual(parseAsked('https://pictures.ocarroeletrico.com/PTEZCEAMD000511.thumb.jpg'), { target: 'PTEZCEAMD000511' });
  assert.deepEqual(parseAsked(`${SITE}/postos/EZC-AMD-00051`), { target: 'EZC-AMD-00051' });
  assert.deepEqual(parseAsked(`${SITE}/postos/EZC-AMD-00051#t-PTEZCEAMD000511`), { target: 'PTEZCEAMD000511' });
  assert.deepEqual(parseAsked(`${SITE}/tomadas/PT*EZC*E*AMD*00051*1`), { target: 'PTEZCEAMD000511' });
  assert.deepEqual(parseAsked(`https://panoramax.ocarroeletrico.com/viewer?focus=map&pic=${PIC.toUpperCase()}`), { picture: PIC });
  assert.deepEqual(parseAsked(`https://panoramax.ocarroeletrico.com/api/pictures/${PIC}/sd.jpg`), { picture: PIC });
  assert.deepEqual(parseAsked('https://example.com/x'), {});
  assert.deepEqual(parseAsked('<script>'), {});
});

// --- Photos in the API ---

test('station API: photo on the station and on each socket, null where none', async () => {
  const w = await world();
  const res = await worker.fetch(new Request(`${SITE}/api/v1/stations/EZC-AMD-00051`), w.env as never, {} as never);
  const body = await res.json() as Record<string, any>;
  assert.equal(body.photo.credit, 'Ana');
  assert.equal(body.photo.license, 'CC-BY-SA-4.0');
  assert.equal(body.photo.attribution, "© Ana, CC BY-SA 4.0, via olh'o'posto");
  assert.deepEqual(body.photo.sizes.thumb, { url: 'https://pictures.ocarroeletrico.com/EZC-AMD-00051.thumb.jpg', maxPx: 400 });
  assert.equal(body.photo.sizes.full.maxPx, 2048);
  assert.equal(body.photo.page, `${SITE}/postos/EZC-AMD-00051`);
  assert.equal(body.photo.panoramax, `https://panoramax.ocarroeletrico.com/viewer?focus=map&map=19/38.5/-9.25&pic=${PIC}`);
  assert.equal(body.photo.takedown, `${SITE}/takedown?alvo=EZC-AMD-00051`);
  assert.equal(body.points[0].photo.page, `${SITE}/postos/EZC-AMD-00051#t-PTEZCEAMD000511`);
  assert.equal(body.points[1].photo, null);
});

test('EVSE API: socket and station photos; a socket without one is still found', async () => {
  const w = await world();
  const get = async (code: string) =>
    (await worker.fetch(new Request(`${SITE}/api/v1/evses/${code}`), w.env as never, {} as never)).json() as Promise<Record<string, any>>;
  const one = await get('PTEZCEAMD000511');
  assert.equal(one.photo.sizes.main.url, 'https://pictures.ocarroeletrico.com/PTEZCEAMD000511.jpg');
  assert.equal(one.station.photo.target, 'EZC-AMD-00051');
  const two = await get('PTEZCEAMD000512');
  assert.equal(two.compact, 'PTEZCEAMD000512');
  assert.equal(two.photo, null);
  assert.equal(two.station.photo.target, 'EZC-AMD-00051');
});

// --- The public form ---

test('takedown: hidden at once in D1, pictures.* and Panoramax, with purges', async () => {
  const w = await world();
  const res = await submitTakedown(ask(`${SITE}/postos/EZC-AMD-00051`, { contacto: 'a@b.pt' }), w.env, w.fetcher, NOW);
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/takedown?ok=1');
  assert.equal(status(w), 'hidden');
  assert.equal(w.r2.size, 0);
  assert.equal((w.db.sql.prepare('SELECT count(*) n FROM selections').get() as { n: number }).n, 0);
  const patch = w.calls.find((c) => c.method === 'PATCH');
  assert.deepEqual([patch?.url, patch?.body], ['https://pano.test/api/upload_sets/set-1', '{"visibility":"owner-only"}']);
  const purge = JSON.parse(w.calls.find((c) => c.url.includes('purge_cache'))!.body!).files as string[];
  assert.equal(purge.length, 9);
  assert.ok(purge.includes('https://pictures.ocarroeletrico.com/EZC-AMD-00051.full.jpg'));
  assert.ok(purge.includes(`https://panoramax.ocarroeletrico.com/api/pictures/${PIC}/sd.jpg`));
  const row = w.db.sql.prepare('SELECT * FROM takedowns').get() as Record<string, unknown>;
  assert.equal(row.photo_id, PHOTO);
  assert.equal(row.contact, 'a@b.pt');
  assert.equal(row.hide_failed, null);
  // The API stops showing it.
  const api = await (await worker.fetch(new Request(`${SITE}/api/v1/stations/EZC-AMD-00051`), w.env as never, {} as never)).json() as Record<string, any>;
  assert.equal(api.photo, null);
  assert.equal(api.points[0].photo, null);
});

test('takedown: the form stays closed without the purge secrets', async () => {
  const w = await world({ purge: false });
  const page = await (await worker.fetch(new Request(`${SITE}/takedown`), w.env as never, {} as never)).text();
  assert.ok(page.includes('info@ocarroeletrico.com') && !page.includes('cf-turnstile'));
  const res = await submitTakedown(ask('EZC-AMD-00051'), w.env, w.fetcher, NOW);
  assert.equal(res.headers.get('location'), '/takedown?erro=bad');
  assert.equal(status(w), 'published');
});

test('takedown: a failed purge is recorded for moderators, the photo still hidden', async () => {
  const w = await world();
  const failing = async (url: string, init?: RequestInit) =>
    url.includes('purge_cache') ? new Response('{}', { status: 500 }) : w.fetcher(url, init);
  await submitTakedown(ask('EZC-AMD-00051'), w.env, failing, NOW);
  assert.equal(status(w), 'hidden');
  const row = w.db.sql.prepare('SELECT hide_failed FROM takedowns').get() as { hide_failed: string };
  assert.deepEqual(JSON.parse(row.hide_failed), ['purge']);
});

test('takedown: a second request by code finds the photo the first one hid', async () => {
  const w = await world();
  await submitTakedown(ask('PTEZCEAMD000511'), w.env, w.fetcher, NOW);
  await submitTakedown(ask('ptezceamd000511'), w.env, w.fetcher, NOW);
  const rows = w.db.sql.prepare('SELECT photo_id FROM takedowns').all() as { photo_id: string }[];
  assert.deepEqual(rows.map((r) => r.photo_id), [PHOTO, PHOTO]);
});

test('takedown: unknown code gets the same answer, recorded without a photo', async () => {
  const w = await world();
  const res = await submitTakedown(ask('XYZ-NOPE-1'), w.env, w.fetcher, NOW);
  assert.equal(res.headers.get('location'), '/takedown?ok=1');
  assert.equal(status(w), 'published');
  assert.deepEqual(w.calls.map((c) => c.url), ['https://challenges.cloudflare.com/turnstile/v0/siteverify']);
  assert.equal((w.db.sql.prepare('SELECT photo_id FROM takedowns').get() as { photo_id: unknown }).photo_id, null);
});

test('takedown: a Turnstile token made for the upload form is refused', async () => {
  const w = await world();
  w.setAction('upload');
  const res = await submitTakedown(ask('EZC-AMD-00051'), w.env, w.fetcher, NOW);
  assert.equal(res.headers.get('location'), '/takedown?erro=turnstile');
  assert.equal(status(w), 'published');
  assert.equal((w.db.sql.prepare('SELECT count(*) n FROM takedowns').get() as { n: number }).n, 0);
});

test('takedown: cross-site posts and missing reasons are refused', async () => {
  const w = await world();
  const cross = new Request(`${SITE}/takedown`, { method: 'POST', headers: { origin: 'https://evil.test' }, body: new URLSearchParams({ alvo: 'x' }) });
  assert.equal((await submitTakedown(cross, w.env, w.fetcher, NOW)).status, 403);
  const res = await submitTakedown(ask('EZC-AMD-00051', { motivo: 'boredom' }), w.env, w.fetcher, NOW);
  assert.equal(res.headers.get('location'), '/takedown?erro=bad');
});

test('takedown page: closed without Turnstile, escaped prefill when open', () => {
  assert.ok(takedownPage('pt', { open: false }).includes('info@ocarroeletrico.com'));
  const open = takedownPage('en', { open: true, sitekey: 'k', asked: '"><script>' });
  assert.ok(open.includes('data-action="takedown"'));
  assert.ok(!open.includes('"><script>'));
});

// --- Moderator decisions ---

test('remove: Panoramax set deleted, every open request for the photo closed, contacts cleared', async () => {
  const w = await world();
  await submitTakedown(ask('EZC-AMD-00051', { contacto: 'a@b.pt' }), w.env, w.fetcher, NOW);
  await submitTakedown(ask(`https://panoramax.ocarroeletrico.com/viewer?pic=${PIC}`), w.env, w.fetcher, NOW);
  const ids = w.db.sql.prepare('SELECT id, photo_id FROM takedowns').all() as { id: string; photo_id: string }[];
  assert.deepEqual(ids.map((r) => r.photo_id), [PHOTO, PHOTO]);   // the second one finds it hidden
  w.calls.length = 0;
  const res = await decideTakedown(form('/admin/remocao', { pedido: ids[0].id, action: 'remove', lang: 'pt' }), w.env, w.fetcher, NOW);
  assert.equal(res.headers.get('location'), '/admin/remocoes?ok=remove');
  assert.deepEqual(w.calls.map((c) => [c.method, c.url]), [['DELETE', 'https://pano.test/api/upload_sets/set-1']]);
  assert.equal(status(w), 'removed');
  assert.equal(w.staging.size, 0);
  const rows = w.db.sql.prepare('SELECT status, contact, decided_by FROM takedowns').all();
  assert.deepEqual(rows.map((r) => ({ ...r })), [
    { status: 'removed', contact: null, decided_by: 'mod' }, { status: 'removed', contact: null, decided_by: 'mod' },
  ]);
  // A second click on the same request is stale.
  const again = await decideTakedown(form('/admin/remocao', { pedido: ids[1].id, action: 'restore', lang: 'pt' }), w.env, w.fetcher, NOW);
  assert.equal(again.headers.get('location'), '/admin/remocoes?erro=stale');
});

test('restore: set public again, photo published, empty static links refilled', async () => {
  const w = await world();
  await submitTakedown(ask('EZC-AMD-00051'), w.env, w.fetcher, NOW);
  const { id } = w.db.sql.prepare('SELECT id FROM takedowns').get() as { id: string };
  w.calls.length = 0;
  const res = await decideTakedown(form('/admin/remocao', { pedido: id, action: 'restore', lang: 'en' }), w.env, w.fetcher, NOW);
  assert.equal(res.headers.get('location'), '/en/admin/takedowns?ok=restore');
  assert.deepEqual([w.calls[0].method, w.calls[0].body], ['PATCH', '{"visibility":"anyone"}']);
  assert.equal(status(w), 'published');
  assert.equal(w.r2.size, 6);
  const targets = w.db.sql.prepare('SELECT target FROM selections ORDER BY target').all().map((r) => r.target);
  assert.deepEqual(targets, ['EZC-AMD-00051', 'PTEZCEAMD000511']);
});

test('close: a request that matched nothing is closed without touching photos', async () => {
  const w = await world();
  await submitTakedown(ask('XYZ-NOPE-1'), w.env, w.fetcher, NOW);
  const { id } = w.db.sql.prepare('SELECT id FROM takedowns').get() as { id: string };
  const res = await decideTakedown(form('/admin/remocao', { pedido: id, action: 'close', lang: 'pt' }), w.env, w.fetcher, NOW);
  assert.equal(res.headers.get('location'), '/admin/remocoes?ok=close');
  assert.equal(status(w), 'published');
});

test('the admin panel is for moderators only', async () => {
  const w = await world();
  w.db.sql.exec(`UPDATE users SET role = 'trusted'`);
  const res = await worker.fetch(new Request(`${SITE}/admin/remocoes`, { headers: { cookie: '__Host-oop_session=t' } }), w.env as never, {} as never);
  assert.equal(res.status, 403);
  const post = await decideTakedown(form('/admin/remocao', { pedido: 'x', action: 'close', lang: 'pt' }), w.env, w.fetcher, NOW);
  assert.equal(post.status, 403);
});

// --- chooseMain on a socket (a compact EVSE code also passes STATION_ID) ---

test('chooseMain publishes a socket photo on the socket target', async () => {
  const w = await world();
  w.db.sql.exec(`DELETE FROM selections`);
  w.r2.clear();
  const targets = await chooseMain(w.env, 'PTEZCEAMD000511', PHOTO, 'mod', w.fetcher, NOW);
  assert.deepEqual(targets, ['PTEZCEAMD000511']);
  assert.ok(w.r2.has('PTEZCEAMD000511.full.jpg'));
  // A socket photo is not a station photo.
  assert.deepEqual(await chooseMain(w.env, 'EZC-AMD-00051', PHOTO, 'mod', w.fetcher, NOW), []);
});

test('admin panel: anonymous text escaped, the right buttons per request, overdue shown', () => {
  const evil = `<script>alert("x")</script>'`;
  const row = (extra: Partial<TakedownRow>): TakedownRow => ({
    id: 'k1', asked: evil, photo_id: PHOTO, reason: 'face', details: evil, contact: `${evil}@x.pt`, status: 'open',
    hide_failed: null, created_at: '2026-11-21T12:00:00.000Z', decided_at: null, station_id: 'EZC-AMD-00051',
    station_name: evil, evse_compact: 'PTEZCEAMD000511', photo_status: 'hidden', ...extra,
  });
  const html = takedownsPage('pt', [
    row({}),
    row({ id: 'k2', photo_id: null, station_id: null, created_at: '2026-11-25T11:00:00.000Z' }),
    row({ id: 'k3', hide_failed: '["purge"]', created_at: '2026-11-25T11:00:00.000Z' }),
  ], [], {}, NOW);
  assert.ok(!html.includes('<script>alert'));
  assert.ok(html.includes('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&#39;'));
  const article = (id: string) => html.split('<article').find((a) => a.includes(`value="${id}"`))!;
  assert.ok(article('k1').includes('value="remove"') && article('k1').includes('value="restore"'));
  assert.ok(!article('k1').includes('value="retry"') && !article('k1').includes('value="close"'));
  assert.ok(article('k1').includes('Atrasado 24 h'));
  assert.ok(article('k2').includes('value="close"') && !article('k2').includes('value="remove"'));
  assert.ok(article('k2').includes('Faltam 71 h'));
  assert.ok(article('k3').includes('value="retry"') && article('k3').includes('limpeza da cache'));
});

test('decided requests older than 2 years are deleted, open ones never', async () => {
  const w = await world();
  w.db.sql.exec(`
    INSERT INTO takedowns (id, asked, reason, status, created_at, decided_at) VALUES
      ('old', 'x', 'other', 'closed', '2024-01-01T00:00:00.000Z', '2024-01-02T00:00:00.000Z'),
      ('recent', 'x', 'other', 'closed', '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z'),
      ('open', 'x', 'other', 'open', '2024-01-01T00:00:00.000Z', NULL);
  `);
  await submitTakedown(ask('XYZ-NOPE-1'), w.env, w.fetcher, NOW);
  const ids = w.db.sql.prepare(`SELECT id FROM takedowns WHERE id IN ('old', 'recent', 'open') ORDER BY id`).all().map((r) => r.id);
  assert.deepEqual(ids, ['open', 'recent']);
});
