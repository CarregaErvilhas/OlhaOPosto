import assert from 'node:assert/strict';
import { test } from 'node:test';

import { decide, queuePage, stagingImage, type QueueRow } from '../src/moderation.ts';
import type { PhotoEnv } from '../src/photos.ts';

const ID = '11111111-2222-3333-4444-555555555555';
const NOW = new Date('2026-11-25T12:00:00Z');

interface World {
  env: PhotoEnv;
  photo: { status: string; panoramax_set: string | null; approved_by?: unknown };
  r2: Set<string>;
  calls: { url: string; method: string; body?: string }[];
}

function world(opts: { role?: string | null; status?: string; set?: string | null } = {}): World {
  const w: World = {
    env: {} as PhotoEnv,
    photo: { status: opts.status ?? 'pending', panoramax_set: opts.set === undefined ? 'set-1' : opts.set },
    r2: new Set([`${ID}/main.jpg`, `${ID}/thumb.jpg`]),
    calls: [],
  };
  const role = opts.role === undefined ? 'moderator' : opts.role;
  const stmt = (sql: string) => {
    let args: unknown[] = [];
    const s = {
      bind(...a: unknown[]) { args = a; return s; },
      async first<T>(): Promise<T | null> {
        if (sql.includes('FROM sessions')) return (role ? { id: 'mod', name: 'Mo', role } : null) as T;
        if (sql.includes('FROM photos')) {
          return (w.photo.status === 'pending' && args[0] === ID ? { panoramax_set: w.photo.panoramax_set, station_status: 'active' } : null) as T;
        }
        return null;
      },
      async run() {
        const to = sql.match(/SET status = '(\w+)'/)?.[1];
        if (sql.startsWith('UPDATE photos') && to && w.photo.status === 'pending' && args[args.length - 1] === ID) {
          w.photo.status = to;
          w.photo.approved_by = args[0];
          return { meta: { changes: 1 } };
        }
        return { meta: { changes: 0 } };
      },
      async all() { return { results: [] }; },
    };
    return s;
  };
  w.env = {
    DB: { prepare: stmt, batch: async () => {} },
    PANORAMAX_TOKEN: 'token', PANORAMAX_URL: 'https://pano.test',
    STAGING: {
      async get(k: string) { return w.r2.has(k) ? { body: new Blob(['jpeg']).stream(), httpEtag: '"e"' } : null; },
      async delete(keys: string[]) { for (const k of keys) w.r2.delete(k); },
    },
  } as unknown as PhotoEnv;
  return w;
}

const fetcher = (w: World, status = 200) => async (url: string, init?: RequestInit) => {
  w.calls.push({ url, method: init?.method ?? 'GET', body: init?.body as string | undefined });
  return new Response('{}', { status });
};

const post = (fields: Record<string, string>, origin = 'https://olhaoposto.ocarroeletrico.com') =>
  new Request('https://olhaoposto.ocarroeletrico.com/admin/decidir', {
    method: 'POST', headers: { origin, cookie: '__Host-oop_session=t' }, body: new URLSearchParams(fields),
  });

test('approve: upload set made public, then published with who and when', async () => {
  const w = world();
  const res = await decide(post({ photo: ID, action: 'approve', lang: 'pt' }), w.env, fetcher(w), NOW);
  assert.equal(res.headers.get('location'), '/admin/fila?ok=approve');
  assert.deepEqual(w.calls.map((c) => [c.method, c.url, c.body]), [
    ['PATCH', 'https://pano.test/api/upload_sets/set-1', '{"visibility":"anyone"}'],
  ]);
  assert.equal(w.photo.status, 'published');
  assert.equal(w.photo.approved_by, 'mod');
  assert.equal(w.r2.size, 2);   // staging copies wait for the main-photo step
});

test('reject: upload set and staging copies deleted, row removed', async () => {
  const w = world();
  const res = await decide(post({ photo: ID, action: 'reject', reason: 'quality', lang: 'en' }), w.env, fetcher(w), NOW);
  assert.equal(res.headers.get('location'), '/en/admin/queue?ok=reject');
  assert.deepEqual(w.calls.map((c) => c.method), ['DELETE']);
  assert.equal(w.photo.status, 'removed');
  assert.equal(w.r2.size, 0);
  const gone = world();
  await decide(post({ photo: ID, action: 'reject', reason: 'quality' }), gone.env, fetcher(gone, 404), NOW);
  assert.equal(gone.photo.status, 'removed');   // already gone on Panoramax is fine
});

test('Panoramax failing changes nothing', async () => {
  for (const action of ['approve', 'reject']) {
    const w = world();
    const res = await decide(post({ photo: ID, action, reason: 'quality' }), w.env, fetcher(w, 500), NOW);
    assert.equal(res.headers.get('location'), '/admin/fila?erro=panoramax');
    assert.equal(w.photo.status, 'pending');
    assert.equal(w.r2.size, 2);
  }
});

test('refusals: role, origin, decided already, bad input', async () => {
  const c = world({ role: 'trusted' });
  assert.equal((await decide(post({ photo: ID, action: 'approve' }), c.env, fetcher(c), NOW)).status, 403);
  const x = world();
  assert.equal((await decide(post({ photo: ID, action: 'approve' }, 'https://evil.example'), x.env, fetcher(x), NOW)).status, 403);
  const done = world({ status: 'published' });
  assert.equal((await decide(post({ photo: ID, action: 'reject', reason: 'quality' }), done.env, fetcher(done), NOW)).headers.get('location'), '/admin/fila?erro=stale');
  const bad = world();
  assert.equal((await decide(post({ photo: ID, action: 'delete' }), bad.env, fetcher(bad), NOW)).headers.get('location'), '/admin/fila?erro=bad');
  const anon = world({ role: null });
  assert.match((await decide(post({ photo: ID, action: 'approve' }), anon.env, fetcher(anon), NOW)).headers.get('location')!, /^\/auth\/osm\/login/);
  assert.deepEqual([...c.calls, ...x.calls, ...done.calls, ...bad.calls, ...anon.calls], []);
});

test('staging images: moderators only, strict paths', async () => {
  const req = new Request('https://olhaoposto.ocarroeletrico.com/x', { headers: { cookie: '__Host-oop_session=t' } });
  const ok = await stagingImage(req, world().env, `${ID}/thumb.jpg`);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('content-type'), 'image/jpeg');
  assert.match(ok.headers.get('cache-control')!, /no-store/);
  assert.equal((await stagingImage(req, world({ role: 'contributor' }).env, `${ID}/thumb.jpg`)).status, 403);
  assert.equal((await stagingImage(req, world().env, `${ID}/full.jpg`)).status, 404);
  assert.equal((await stagingImage(req, world().env, `../${ID}/main.jpg`)).status, 404);
});

const row = (over: Partial<QueueRow>): QueueRow => ({
  id: ID, station_id: 'EZC-AMD-00051', station_name: 'Posto <b>', operator: 'EDP', evse_compact: null,
  credit: '<i>Ana</i>', taken_at: null, exif_lat: null, exif_lon: null, distance_m: null,
  created_at: '2026-11-25T10:00:00.000Z', ...over,
});

test('queuePage: escapes, warns on no GPS and far photos', () => {
  const html = queuePage('pt', [row({}), row({ distance_m: 1200, exif_lat: 38.7, exif_lon: -9.2 }), row({ distance_m: 40 })], {});
  assert.ok(!html.includes('<i>Ana</i>') && !html.includes('Posto <b>'));
  assert.ok(html.includes('Sem GPS'));
  assert.ok(html.includes('A 1200 m do posto: pode ser de outro.'));
  assert.ok(html.includes('A 40 m do posto.'));
  assert.equal(html.match(/action="\/admin\/decidir"/g)?.length, 6);
  assert.ok(queuePage('en', [], {}).includes('No photos waiting.'));
});
