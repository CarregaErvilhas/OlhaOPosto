import assert from 'node:assert/strict';
import { test } from 'node:test';

import { tokenHash } from '../src/auth.ts';
import { decisionsHtml } from '../src/decisions.ts';
import { decide, queuePage } from '../src/moderation.ts';
import type { PhotoEnv } from '../src/photos.ts';
import { cleanNote, reasonForReport } from '../src/reasons.ts';
import { ownThumbnail, stateOf, uploadsHtml, UPLOADS_PAGE_SIZE } from '../src/uploads.ts';
import { d1 } from './d1.ts';

const SITE = 'https://olhaoposto.ocarroeletrico.com';
const NOW = new Date('2026-11-25T10:00:00Z');
const P1 = '11111111-2222-3333-4444-555555555551';
const P2 = '11111111-2222-3333-4444-555555555552';

async function setup() {
  const db = d1();
  db.sql.exec(`INSERT INTO users (id, osm_uid, osm_name, role, created_at, last_login_at) VALUES
    ('ana', 1, 'Ana', 'contributor', 'x', 'x'), ('bea', 3, 'Bea', 'contributor', 'x', 'x'), ('mod', 2, 'Mo', 'moderator', 'x', 'x')`);
  const ins = db.sql.prepare(`INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, 'x', '2999-01-01')`);
  for (const u of ['ana', 'bea', 'mod']) ins.run(await tokenHash(`${u}-s`), u);
  db.sql.exec(`INSERT INTO stations (id, name, lat, lon, updated_at) VALUES ('EZC-AMD-00051', 'Posto A', 38.78, -9.22, 'x')`);
  const put = db.sql.prepare(`INSERT INTO photos (id, station_id, uploader_id, status, created_at) VALUES (?, 'EZC-AMD-00051', ?, 'pending', ?)`);
  put.run(P1, 'ana', '2026-11-20T10:00:00Z');
  put.run(P2, 'bea', '2026-11-21T10:00:00Z');
  db.sql.exec(`UPDATE photos SET panoramax_set = 'set-' || id`);
  const staged = new Set([`${P1}/thumb.jpg`]);
  const env = {
    DB: db, OSM_CLIENT_ID: 'id', OSM_CLIENT_SECRET: 's', PANORAMAX_TOKEN: 't', PANORAMAX_URL: 'https://pano.test',
    STAGING: {
      async get(k: string) { return staged.has(k) ? { body: new Blob(['jpeg']).stream(), httpEtag: '"e"' } : null; },
      async delete(keys: string[]) { for (const k of keys) staged.delete(k); },
    },
  } as unknown as PhotoEnv;
  return { db, env };
}

const req = (path: string, session: string) => new Request(`${SITE}${path}`, { headers: { cookie: `__Host-oop_session=${session}` } });
const post = (fields: Record<string, string>) => new Request(`${SITE}/admin/decidir`, {
  method: 'POST', headers: { origin: SITE, cookie: '__Host-oop_session=mod-s' }, body: new URLSearchParams(fields),
});
const ok = async () => new Response('{}');
const row = (db: ReturnType<typeof d1>, id: string) => db.sql.prepare('SELECT * FROM photos WHERE id = ?').get(id) as Record<string, unknown>;

test('rejecting needs a reason from the list; the note is optional and cleaned', async () => {
  const { db, env } = await setup();
  for (const fields of [{}, { reason: '' }, { reason: 'because' }] as Record<string, string>[]) {
    const res = await decide(post({ photo: P1, action: 'reject', ...fields }), env, ok, NOW);
    assert.equal(res.headers.get('location'), '/admin/fila?erro=reason');
  }
  assert.equal(row(db, P1).status, 'pending');
  const res = await decide(post({ photo: P1, action: 'reject', reason: 'privacy', note: '  cara\n visível ' }), env, ok, NOW);
  assert.equal(res.headers.get('location'), '/admin/fila?ok=reject');
  const r = row(db, P1);
  assert.equal(r.status, 'removed');
  assert.equal(r.refusal_reason, 'privacy');
  assert.equal(r.refusal_note, 'cara visível');
  assert.equal(r.refused_by, 'mod');
  assert.equal(cleanNote('   '), null);
  assert.equal(cleanNote('x'.repeat(500))!.length, 200);
});

test('the database refuses a reason outside the list', async () => {
  const { db } = await setup();
  assert.throws(() => db.sql.prepare(`UPDATE photos SET refusal_reason = 'nope' WHERE id = ?`).run(P1));
});

test('the queue page has a required reason select on every photo', () => {
  const html = queuePage('pt', [{
    id: P1, station_id: 'S', station_name: 'Posto', operator: null, evse_compact: null, credit: 'Ana', taken_at: null,
    exif_lat: null, exif_lon: null, distance_m: null, created_at: '2026-11-20T10:00:00Z',
  }], {});
  assert.match(html, /<select id="reason-[^"]+" name="reason" required>/);
  for (const code of ['wrong_station', 'privacy', 'quality', 'duplicate', 'advertising', 'other']) assert.match(html, new RegExp(`value="${code}"`));
  assert.match(html, /\/admin\/decisoes/);
});

test('takedown report categories map to a reason', () => {
  assert.equal(reasonForReport('blur_missing'), 'privacy');
  assert.equal(reasonForReport('picture_low_quality'), 'quality');
  assert.equal(reasonForReport('mislocated'), 'wrong_station');
  assert.equal(reasonForReport('copyright'), 'other');
  assert.equal(reasonForReport(undefined), 'other');
});

test('stateOf: pending, published, main, refused, removed, hidden', () => {
  assert.equal(stateOf({ status: 'pending', refused_by: null, is_main: 0 }), 'pending');
  assert.equal(stateOf({ status: 'published', refused_by: null, is_main: 0 }), 'published');
  assert.equal(stateOf({ status: 'published', refused_by: null, is_main: 1 }), 'main');
  assert.equal(stateOf({ status: 'removed', refused_by: 'mod', is_main: 0 }), 'refused');
  assert.equal(stateOf({ status: 'removed', refused_by: null, is_main: 0 }), 'removed');
  assert.equal(stateOf({ status: 'hidden', refused_by: null, is_main: 0 }), 'hidden');
});

test('"os meus envios" shows the author their own photos and the reason, nobody else’s', async () => {
  const { db, env } = await setup();
  await decide(post({ photo: P1, action: 'reject', reason: 'duplicate', note: 'igual à de ontem' }), env, ok, NOW);
  const res = await uploadsHtml('pt', req('/conta/envios', 'ana-s'), env, {});
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(html, /Recusada/);
  assert.match(html, /Já temos uma foto igual/);
  assert.match(html, /igual à de ontem/);
  assert.doesNotMatch(html, new RegExp(P2));
  const bea = await (await uploadsHtml('en', req('/en/account/uploads', 'bea-s'), env, {})).text();
  assert.match(bea, /Waiting for a moderator/);
  assert.doesNotMatch(bea, /duplicate|same or a very similar/);
  assert.equal((await uploadsHtml('pt', new Request(`${SITE}/conta/envios`), env, {})).status, 302);
  assert.ok(db);
});

test('"os meus envios" marks the main photo and pages the list', async () => {
  const { db, env } = await setup();
  db.sql.exec(`UPDATE photos SET status = 'published' WHERE id = '${P1}'`);
  db.sql.exec(`INSERT INTO selections (target, station_id, photo_id, chosen_at) VALUES ('EZC-AMD-00051', 'EZC-AMD-00051', '${P1}', 'x')`);
  const html = await (await uploadsHtml('pt', req('/conta/envios', 'ana-s'), env, {})).text();
  assert.match(html, /é a foto principal/);
  const ins = db.sql.prepare(`INSERT INTO photos (id, station_id, uploader_id, status, created_at) VALUES (?, 'EZC-AMD-00051', 'ana', 'pending', ?)`);
  for (let i = 0; i < UPLOADS_PAGE_SIZE + 2; i++) ins.run(`22222222-2222-3333-4444-${String(i).padStart(12, '0')}`, `2026-12-01T10:${String(i).padStart(2, '0')}:00Z`);
  const first = await (await uploadsHtml('pt', req('/conta/envios', 'ana-s'), env, {})).text();
  assert.equal((first.match(/class="queue-item"/g) ?? []).length, UPLOADS_PAGE_SIZE);
  assert.match(first, /\?pagina=2/);
  const second = await (await uploadsHtml('pt', req('/conta/envios?pagina=2', 'ana-s'), env, {})).text();
  assert.equal((second.match(/class="queue-item"/g) ?? []).length, 3);
  assert.doesNotMatch(second, /\?pagina=3/);
});

test('own thumbnail: only the author’s, only while the photo exists', async () => {
  const { env } = await setup();
  assert.equal((await ownThumbnail(req('/x', 'ana-s'), env, `${P1}.jpg`)).status, 200);
  assert.equal((await ownThumbnail(req('/x', 'bea-s'), env, `${P1}.jpg`)).status, 404);
  assert.equal((await ownThumbnail(new Request(SITE), env, `${P1}.jpg`)).status, 403);
  assert.equal((await ownThumbnail(req('/x', 'ana-s'), env, 'x.jpg')).status, 404);
});

test('decisions history: moderators only, with who, when and reason', async () => {
  const { db, env } = await setup();
  await decide(post({ photo: P1, action: 'reject', reason: 'quality' }), env, ok, NOW);
  await decide(post({ photo: P2, action: 'approve' }), env, ok, new Date('2026-11-25T11:00:00Z'));
  const res = await decisionsHtml('pt', req('/admin/decisoes', 'mod-s'), env, {});
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(html, /Mo/);
  assert.match(html, /Qualidade fraca/);
  assert.match(html, /Recusada/);
  assert.match(html, /Aprovada/);
  assert.ok(html.indexOf('2026-11-25 11:00') < html.indexOf('2026-11-25 10:00'));   // newest first
  assert.equal((await decisionsHtml('pt', req('/admin/decisoes', 'ana-s'), env, {})).status, 403);
  assert.ok(db);
});
