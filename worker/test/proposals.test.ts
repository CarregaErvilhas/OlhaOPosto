import assert from 'node:assert/strict';
import { test } from 'node:test';

import { tokenHash } from '../src/auth.ts';
import { decide, queuePage } from '../src/moderation.ts';
import type { PhotoEnv } from '../src/photos.ts';
import { decideProposal, parseProposal, pendingProposals, proposeStation, proposedBy } from '../src/proposals.ts';
import { d1 } from './d1.ts';

const SITE = 'https://olhaoposto.ocarroeletrico.com';
const NOW = new Date('2026-11-25T10:00:00Z');

async function setup() {
  const db = d1();
  db.sql.exec(`INSERT INTO users (id, osm_uid, osm_name, role, created_at, last_login_at) VALUES
    ('ana', 1, 'Ana', 'contributor', 'x', 'x'), ('mod', 2, 'Mo', 'moderator', 'x', 'x')`);
  db.sql.prepare(`INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, 'ana', 'x', '2999-01-01'), (?, 'mod', 'x', '2999-01-01')`)
    .run(await tokenHash('ana-s'), await tokenHash('mod-s'));
  db.sql.exec(`INSERT INTO stations (id, lat, lon, updated_at) VALUES ('EZC-AMD-00051', 38.78791, -9.226767, 'x')`);
  const env = { DB: db, OSM_CLIENT_ID: 'id', OSM_CLIENT_SECRET: 's', PANORAMAX_TOKEN: 't', PANORAMAX_URL: 'https://pano.test' } as unknown as PhotoEnv;
  return { db, env };
}

const body = { name: 'Garagem Central', operator: 'Operador X', code: 'LSB-00999', lat: 38.79, lon: -9.24, note: 'Ao lado do café' };
const post = (b: unknown, query = '', session = 'ana-s', origin = SITE) => new Request(`${SITE}/api/v1/stations${query}`, {
  method: 'POST', body: JSON.stringify(b), headers: { origin, cookie: `__Host-oop_session=${session}`, 'content-type': 'application/json' },
});

test('parseProposal: name, operator, code and a position in Portugal', () => {
  assert.deepEqual(parseProposal({ ...body, lat: 38.123456789 }), { ...body, lat: 38.12346 });
  assert.equal(parseProposal({ ...body, operator: '' }), 'name_and_operator');
  assert.equal(parseProposal({ ...body, code: 'a b<' }), 'bad_code');
  assert.equal(parseProposal({ ...body, lat: 48.85, lon: 2.35 }), 'bad_position');   // Paris
  assert.equal(parseProposal({ ...body, lat: '38.7' }), 'bad_position');
  assert.equal(parseProposal(null), 'bad_body');
  assert.equal((parseProposal({ ...body, name: '  a\u0000b  ' }) as { name: string }).name, 'a b');
});

test('proposeStation: a hidden station and a queue entry; only its author may send photos', async () => {
  const { db, env } = await setup();
  assert.equal((await proposeStation(post(body, '', 'ana-s', 'https://evil.example'), env, NOW)).status, 403);
  const r = await proposeStation(post(body), env, NOW);
  assert.equal(r.status, 201);
  const { id } = await r.json() as { id: string };
  assert.match(id, /^OOP-[0-9A-F]{10}$/);
  const s = db.sql.prepare('SELECT status, source, name, operator, code FROM stations WHERE id = ?').get(id);
  assert.deepEqual({ ...s }, { status: 'pending_review', source: 'community', name: 'Garagem Central', operator: 'Operador X', code: 'LSB-00999' });
  assert.equal(await proposedBy(env, id, 'ana'), true);
  assert.equal(await proposedBy(env, id, 'mod'), false);
  assert.equal((await pendingProposals(env)).length, 1);
});

test('proposeStation: a station within 60 m asks first, ?force=1 goes ahead', async () => {
  const { env } = await setup();
  const near = { ...body, lat: 38.7881, lon: -9.2268 };
  const r = await proposeStation(post(near), env, NOW);
  assert.equal(r.status, 409);
  const j = await r.json() as { error: string; stations: { id: string }[] };
  assert.equal(j.error, 'station_nearby');
  assert.deepEqual(j.stations.map((s) => s.id), ['EZC-AMD-00051']);
  assert.equal((await proposeStation(post(near, '?force=1'), env, NOW)).status, 201);
});

test('proposeStation: five a day for contributors', async () => {
  const { env } = await setup();
  for (let i = 0; i < 5; i++) assert.equal((await proposeStation(post({ ...body, lat: 38 + i / 10 }), env, NOW)).status, 201);
  assert.equal((await proposeStation(post({ ...body, lat: 39.9 }), env, NOW)).status, 429);
});

test('decideProposal: approve makes it public; reject takes its waiting photos along', async () => {
  const { db, env } = await setup();
  const a = (await (await proposeStation(post(body), env, NOW)).json() as { id: string }).id;
  const b = (await (await proposeStation(post({ ...body, lat: 38.9 }), env, NOW)).json() as { id: string }).id;
  db.sql.prepare(`INSERT INTO photos (id, station_id, uploader_id, status, panoramax_set, created_at) VALUES ('ph', ?, 'ana', 'pending', 'set-9', 'x')`).run(b);
  assert.deepEqual(await decideProposal(env, a, true, 'mod', NOW), []);
  assert.equal((db.sql.prepare('SELECT status FROM stations WHERE id = ?').get(a) as { status: string }).status, 'active');
  assert.equal(await decideProposal(env, a, false, 'mod', NOW), null);   // already decided

  // Through the queue page's POST: the photo of the rejected station goes too.
  const calls: string[] = [];
  const fetcher = async (url: string, init?: RequestInit) => { calls.push(`${init?.method} ${url}`); return new Response('{}'); };
  const res = await decide(new Request(`${SITE}/admin/decidir`, {
    method: 'POST', headers: { origin: SITE, cookie: '__Host-oop_session=mod-s' },
    body: new URLSearchParams({ station: b, action: 'reject_station', lang: 'pt' }),
  }), env, fetcher, NOW);
  assert.match(res.headers.get('location')!, /ok=station_rejected/);
  assert.equal((db.sql.prepare('SELECT status FROM stations WHERE id = ?').get(b) as { status: string }).status, 'rejected');
  assert.deepEqual({ ...db.sql.prepare(`SELECT status, refusal_reason, refused_by FROM photos WHERE id = 'ph'`).get() }, { status: 'removed', refusal_reason: 'wrong_station', refused_by: 'mod' });
  assert.deepEqual(calls, ['DELETE https://pano.test/api/upload_sets/set-9']);
});

test('a photo of a proposed station cannot be approved before the station', async () => {
  const { db, env } = await setup();
  const id = (await (await proposeStation(post(body), env, NOW)).json() as { id: string }).id;
  db.sql.prepare(`INSERT INTO photos (id, station_id, uploader_id, status, panoramax_set, created_at) VALUES ('ph', ?, 'ana', 'pending', 'set-9', 'x')`).run(id);
  const res = await decide(new Request(`${SITE}/admin/decidir`, {
    method: 'POST', headers: { origin: SITE, cookie: '__Host-oop_session=mod-s' },
    body: new URLSearchParams({ photo: 'ph', action: 'approve', lang: 'pt' }),
  }), env, async () => new Response('{}'), NOW);
  assert.match(res.headers.get('location')!, /erro=station_pending/);
  assert.equal((db.sql.prepare(`SELECT status FROM photos WHERE id = 'ph'`).get() as { status: string }).status, 'pending');
});

test('queuePage: proposals first, escaped', async () => {
  const html = queuePage('pt', [], {
    proposals: [{
      queue_id: 'q', station_id: 'OOP-1', photos: 2, proposer: '<i>Ana</i>', created_at: '2026-11-25T10:00:00Z',
      payload: JSON.stringify({ ...body, name: '<script>x</script>' }),
    }],
  });
  assert.ok(html.indexOf('Postos propostos') < html.indexOf('<h2>Fotos</h2>'));
  assert.ok(!html.includes('<script>x'));
  assert.ok(!html.includes('<i>Ana</i>'));
  assert.ok(html.includes('2 fotos à espera'));
  assert.ok(html.includes('value="approve_station"'));
});
