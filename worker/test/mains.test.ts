import assert from 'node:assert/strict';
import { test } from 'node:test';

import { tokenHash } from '../src/auth.ts';
import worker from '../src/index.ts';
import { lostPage, lostTargets, promoteMain } from '../src/mains.ts';
import { queuePage } from '../src/moderation.ts';
import { publishMain, type PublishEnv } from '../src/publish.ts';
import { d1 } from './d1.ts';

const SITE = 'https://olhaoposto.ocarroeletrico.com';
const NOW = new Date('2026-11-26T12:00:00Z');
// OLD was the main photo of the socket and of the station, and is gone.
const OLD = '00000000-0000-0000-0000-000000000001';
const SOCK = '00000000-0000-0000-0000-000000000002';    // another photo of that socket
const GEN = '00000000-0000-0000-0000-000000000003';     // a photo of the station in general
const OTHER = '00000000-0000-0000-0000-000000000004';   // a photo of the second socket

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

async function world(opts: { name?: string; credit?: string; hd?: number } = {}) {
  const db = d1();
  const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
  db.sql.exec(`
    INSERT INTO stations (id, code, opc, operator, name, lat, lon, status, updated_at)
      VALUES ('EZC-AMD-00051', 'AMD-00051', 'EZC3', 'EZ', ${q(opts.name ?? 'Posto')}, 38.5, -9.25, 'active', 'x');
    INSERT INTO evses (station_id, point_id, evse_id, evse_compact, dc, updated_at) VALUES
      ('EZC-AMD-00051', 'AMD-00051-1', 'PT*EZC*E*AMD*00051*1', 'PTEZCEAMD000511', 0, 'x'),
      ('EZC-AMD-00051', 'AMD-00051-2', 'PT*EZC*E*AMD*00051*2', 'PTEZCEAMD000512', 0, 'x');
    INSERT INTO users (id, osm_uid, osm_name, role, created_at, last_login_at) VALUES
      ('mod', 1, 'Mo', 'moderator', 'x', 'x'), ('ana', 2, 'Ana', 'contributor', 'x', 'x');
    INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES ('${await tokenHash('t')}', 'mod', 'x', '2999-01-01');
    INSERT INTO photos (id, station_id, evse_compact, panoramax_set, panoramax_id, credit, uploader_id, status, approved_at, created_at) VALUES
      ('${OLD}', 'EZC-AMD-00051', 'PTEZCEAMD000511', 's1', 'pic-1', 'Ana', 'ana', 'removed', '2026-01-01', '2026-01-01'),
      ('${SOCK}', 'EZC-AMD-00051', 'PTEZCEAMD000511', 's2', 'pic-2', ${q(opts.credit ?? 'Bea')}, 'ana', 'published', '2026-02-01', '2026-02-01'),
      ('${GEN}', 'EZC-AMD-00051', NULL, 's3', 'pic-3', 'Cid', 'ana', 'published', '2026-03-01', '2026-03-01'),
      ('${OTHER}', 'EZC-AMD-00051', 'PTEZCEAMD000512', 's4', 'pic-4', 'Dia', 'ana', 'published', '2026-04-01', '2026-04-01');
    INSERT INTO selections (target, station_id, photo_id, chosen_at, published_at, lost_at) VALUES
      ('PTEZCEAMD000511', 'EZC-AMD-00051', '${OLD}', 'x', NULL, '2026-11-25T10:00:00.000Z'),
      ('EZC-AMD-00051', 'EZC-AMD-00051', '${OLD}', 'x', NULL, '2026-11-25T10:00:00.000Z'),
      ('PTEZCEAMD000512', 'EZC-AMD-00051', '${OTHER}', 'x', '2026-04-01', NULL);
  `);
  const r2 = new Set<string>();
  const staging = new Map<string, Uint8Array>();
  for (const id of [SOCK, GEN, OTHER]) {
    staging.set(`${id}/main.jpg`, jpeg(1024, 768));
    staging.set(`${id}/thumb.jpg`, jpeg(400, 300));
  }
  const calls: string[] = [];
  const fetcher = async (url: string) => {
    calls.push(url);
    if (url.endsWith('/hd.jpg')) return opts.hd ? new Response('no', { status: opts.hd }) : new Response(jpeg(2048, 1536));
    return new Response('{}');
  };
  const env = {
    DB: db,
    PANORAMAX_TOKEN: 'token',
    PANORAMAX_URL: 'https://pano.test',
    CF_ZONE_ID: 'zone',
    CF_CACHE_PURGE_TOKEN: 'purge',
    PICTURES: {
      async put(k: string) { r2.add(k); },
      async delete(keys: string[]) { for (const k of keys) r2.delete(k); },
    },
    STAGING: {
      async get(k: string) { const b = staging.get(k); return b ? { arrayBuffer: async () => b.buffer, body: new Blob([b]).stream(), httpEtag: '"e"' } : null; },
      async delete() {},
    },
  } as unknown as PublishEnv;
  return { db, env, r2, calls, fetcher };
}
type World = Awaited<ReturnType<typeof world>>;

const row = (w: World, target: string) =>
  ({ ...w.db.sql.prepare('SELECT photo_id, published_at, lost_at, chosen_by FROM selections WHERE target = ?').get(target) }) as
    { photo_id: string; published_at: string | null; lost_at: string | null; chosen_by: string | null };
const promote = (w: World, fields: Record<string, string>, headers: Record<string, string> = {}) =>
  promoteMain(new Request(`${SITE}/admin/principal`, {
    method: 'POST',
    headers: { origin: SITE, cookie: '__Host-oop_session=t', ...headers },
    body: new URLSearchParams({ lang: 'pt', back: 'lost', ...fields }),
  }), w.env, w.fetcher, NOW);
const get = (w: World, path: string) =>
  worker.fetch(new Request(SITE + path, { headers: { cookie: '__Host-oop_session=t' } }), w.env as never, {} as never);

test('lostTargets: lost rows only, each with the photos chooseMain would take', async () => {
  const w = await world();
  const lost = await lostTargets(w.env);
  assert.deepEqual(lost.map((l) => l.target), ['EZC-AMD-00051', 'PTEZCEAMD000511']);
  // The station takes only the photo of the station in general, the socket only its own.
  assert.deepEqual(lost[0].photos.map((p) => p.id), [GEN]);
  assert.deepEqual(lost[1].photos.map((p) => p.id), [SOCK]);
});

test('promote: a moderator picks the next main photo by hand, through chooseMain', async () => {
  const w = await world();
  const res = await promote(w, { target: 'PTEZCEAMD000511', photo: SOCK });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/admin/sem-principal?principal=ok#sem-principal');
  assert.deepEqual([...w.r2].sort(), ['PTEZCEAMD000511.full.jpg', 'PTEZCEAMD000511.jpg', 'PTEZCEAMD000511.thumb.jpg']);
  const r = row(w, 'PTEZCEAMD000511');
  assert.deepEqual([r.photo_id, r.lost_at, r.chosen_by, r.published_at], [SOCK, null, 'mod', NOW.toISOString()]);
  assert.ok(w.calls.some((c) => c.includes('purge_cache')));
  // The station is still without one: nothing passes on by itself.
  assert.equal(row(w, 'EZC-AMD-00051').lost_at, '2026-11-25T10:00:00.000Z');
  assert.deepEqual((await lostTargets(w.env)).map((l) => l.target), ['EZC-AMD-00051']);
  // The socket's static link is in the API again.
  const api = await (await worker.fetch(new Request(`${SITE}/api/v1/evses/PTEZCEAMD000511`), w.env as never, {} as never)).json() as Record<string, any>;
  assert.ok(JSON.stringify(api).includes('PTEZCEAMD000511.jpg'));
  // A second moderator on the same target is told it was filled.
  assert.equal((await promote(w, { target: 'PTEZCEAMD000511', photo: SOCK })).headers.get('location'),
    '/admin/sem-principal?principal=stale#sem-principal');
});

test('promote: wrong photo, no photo, other roles and other sites are refused', async () => {
  const w = await world();
  const loc = async (f: Record<string, string>) => (await promote(w, f)).headers.get('location');
  // A socket photo is not a photo of the station in general.
  assert.equal(await loc({ target: 'EZC-AMD-00051', photo: SOCK }), '/admin/sem-principal?principal=photo#sem-principal');
  assert.equal(await loc({ target: 'EZC-AMD-00051' }), '/admin/sem-principal?principal=bad#sem-principal');
  assert.equal(await loc({ target: '<x>', photo: GEN }), '/admin/sem-principal?principal=bad#sem-principal');
  // A target with a live main photo is not replaced from here.
  assert.equal(await loc({ target: 'PTEZCEAMD000512', photo: OTHER }), '/admin/sem-principal?principal=stale#sem-principal');
  // The way back is one of ours, never a free URL.
  assert.equal(await loc({ target: '<x>', back: 'https://evil.example/' }), '/admin/sem-principal?principal=bad#sem-principal');
  assert.equal(await loc({ target: '<x>', back: 'takedowns', lang: 'en' }), '/en/admin/takedowns?principal=bad#sem-principal');
  assert.equal(w.r2.size, 0);
  assert.equal((await promote(w, { target: 'EZC-AMD-00051', photo: GEN }, { origin: 'https://evil.example' })).status, 403);
  w.db.sql.exec(`UPDATE users SET role = 'trusted' WHERE id = 'mod'`);
  assert.equal((await promote(w, { target: 'EZC-AMD-00051', photo: GEN })).status, 403);
  assert.equal((await get(w, '/admin/sem-principal')).status, 403);
  assert.equal(row(w, 'EZC-AMD-00051').lost_at, '2026-11-25T10:00:00.000Z');
});

test('promote: a failed copy leaves the target lost', async () => {
  const w = await world({ hd: 500 });
  assert.equal((await promote(w, { target: 'EZC-AMD-00051', photo: GEN })).headers.get('location'),
    '/admin/sem-principal?principal=publish#sem-principal');
  assert.equal(w.r2.size, 0);
  assert.equal(row(w, 'EZC-AMD-00051').photo_id, OLD);
  assert.equal(row(w, 'EZC-AMD-00051').lost_at, '2026-11-25T10:00:00.000Z');
});

test('publishMain: a newly approved photo fills a lost target; a failure puts it back as lost', async () => {
  const bad = await world({ hd: 500 });
  await assert.rejects(publishMain(bad.env, GEN, 'mod', bad.fetcher, NOW));
  assert.deepEqual(row(bad, 'EZC-AMD-00051'), { photo_id: OLD, published_at: null, lost_at: '2026-11-25T10:00:00.000Z', chosen_by: null });
  const w = await world();
  assert.deepEqual(await publishMain(w.env, GEN, 'mod', w.fetcher, NOW), ['EZC-AMD-00051']);
  assert.deepEqual(row(w, 'EZC-AMD-00051'), { photo_id: GEN, published_at: NOW.toISOString(), lost_at: null, chosen_by: 'mod' });
  // A live main photo is still left alone.
  assert.deepEqual(await publishMain(w.env, OTHER, 'mod', w.fetcher, NOW), []);
});

test('page: galleries with a radio per photo, a target without other photos says so, text escaped', async () => {
  const evil = `<script>alert("x")</script>'`;
  const w = await world({ name: evil, credit: evil });
  w.db.sql.exec(`UPDATE photos SET status = 'hidden' WHERE id = '${GEN}'`);
  const res = await get(w, '/admin/sem-principal');
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(!html.includes('<script>alert'));
  assert.ok(html.includes('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&#39;'));
  const [station, socket] = html.split('<article class="lost-item">').slice(1);
  assert.ok(station.includes('Não há outras fotos publicadas') && !station.includes('<form'));
  assert.ok(socket.includes(`type="radio" name="photo" value="${SOCK}"`));
  assert.ok(socket.includes(`/admin/staging/${SOCK}/thumb.jpg`));
  assert.ok(socket.includes('name="target" value="PTEZCEAMD000511"') && socket.includes('action="/admin/principal"'));
  assert.ok(!html.includes(OTHER));   // a socket with its main photo is not listed
  assert.ok(lostPage('en', [], {}).includes('No station or socket is without a main photo.'));
});

test('the queue and the removal panel show the list only when there is one', async () => {
  const w = await world();
  const queue = await (await get(w, '/admin/fila?principal=ok')).text();
  assert.ok(queue.includes('id="sem-principal"') && queue.includes('name="back" value="queue"'));
  assert.ok(queue.includes('Foto principal escolhida'));
  w.db.sql.exec(`DELETE FROM selections WHERE lost_at IS NOT NULL`);
  assert.ok(!(await (await get(w, '/admin/fila')).text()).includes('id="sem-principal"'));
  assert.ok(!queuePage('pt', [], {}).includes('sem-principal'));
});
