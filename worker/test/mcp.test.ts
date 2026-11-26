// The MCP tools (src/mcp.ts) and the sign-in parts that run under Node
// (src/mcpauth.ts), over the SDK's in-memory transport and the real SQL.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { InMemoryTransport } from '@modelcontextprotocol/server';

import { WRITE_TOOLS, imageBytes, mcpServer, type McpCaller } from '../src/mcp.ts';
import {
  callerFromProps, chosenScopes, consentLang, consentPage, defaultScopes, liveScopes, wantsWrite, type UserDb,
} from '../src/mcpauth.ts';
import { d1 } from './d1.ts';

function world() {
  const db = d1();
  db.sql.exec(`
    INSERT INTO users (id, osm_uid, osm_name, role, created_at, last_login_at) VALUES
      ('u', 1, 'Ana', 'contributor', '2000-01-01', '2000-01-01'),
      ('m', 2, 'Rui', 'moderator', '2000-01-01', '2000-01-01');
    INSERT INTO stations (id, code, opc, operator, name, municipality, status, lat, lon, updated_at) VALUES
      ('EZC-AMD-00051', 'AMD-00051', 'EZC3', 'EZCharge', 'Amadora Centro', 'Amadora', 'active', 38.7879, -9.2268, '2000-01-01'),
      ('EZC-SNT-00001', 'SNT-00001', 'EZC3', 'EZCharge', 'Sintra Vila', 'Sintra', 'active', 38.80, -9.38, '2000-01-01'),
      ('MOB-SNT-00002', 'SNT-00002', 'MOB1', 'Outro', 'Sintra Estação', 'Sintra', 'active', 38.801, -9.381, '2000-01-01'),
      ('OOP-HIDDEN', NULL, NULL, 'X', 'Proposto', 'Sintra', 'merged', 38.81, -9.39, '2000-01-01');
    INSERT INTO evses (station_id, point_id, evse_id, evse_compact, connector, max_kw, status, dc, updated_at) VALUES
      ('EZC-AMD-00051', 'AMD-00051-1', 'PT*EZC*E*AMD*00051*1', 'PTEZCEAMD000511', 'CCS', 50, 'active', 1, '2000-01-01'),
      ('EZC-AMD-00051', 'AMD-00051-2', 'PT*EZC*E*AMD*00051*2', 'PTEZCEAMD000512', 'T2', 22, 'active', 0, '2000-01-01');
    INSERT INTO photos (id, station_id, evse_compact, credit, status, panoramax_id, created_at) VALUES
      ('p1', 'EZC-AMD-00051', NULL, 'Ana', 'published', 'pano-1', '2026-03-05'),
      ('p2', 'EZC-AMD-00051', 'PTEZCEAMD000511', 'Ana', 'published', 'pano-2', '2026-03-05');
    INSERT INTO selections (target, station_id, photo_id, chosen_at, published_at) VALUES
      ('EZC-AMD-00051', 'EZC-AMD-00051', 'p1', '2026-03-05', '2026-03-05'),
      ('PTEZCEAMD000511', 'EZC-AMD-00051', 'p2', '2026-03-05', '2026-03-05');
  `);
  return db;
}

type Rpc = { id: number; result?: { content: { text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean; tools?: { name: string; description: string }[] }; error?: unknown };

// A bare JSON-RPC client over the in-memory pair: no client package needed.
async function connect(db: ReturnType<typeof d1>, caller: McpCaller | null = null, env: Record<string, unknown> = {}) {
  const server = mcpServer({ DB: db, ...env } as never, caller, { fetcher: async () => new Response('no', { status: 500 }) });
  const [client, side] = InMemoryTransport.createLinkedPair();
  const waiting = new Map<number, (m: Rpc) => void>();
  client.onmessage = (m) => {
    const r = m as unknown as Rpc;
    if (typeof r.id === 'number') waiting.get(r.id)?.(r);
  };
  await server.connect(side);
  await client.start();
  let next = 1;
  const request = (method: string, params: Record<string, unknown> = {}) => new Promise<Rpc>((resolve) => {
    const id = next++;
    waiting.set(id, resolve);
    void client.send({ jsonrpc: '2.0', id, method, params } as never);
  });
  const init = await request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  await client.send({ jsonrpc: '2.0', method: 'notifications/initialized' } as never);
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = await request('tools/call', { name, arguments: args });
    assert.ok(r.result, JSON.stringify(r.error));
    return { data: JSON.parse(r.result.content[0].text) as Record<string, any>, isError: r.result.isError === true };
  };
  return { request, call, init: init.result as unknown as { serverInfo: Record<string, any> } };
}

test('the server names itself with the mascot, not the apex icon', async () => {
  const { init } = await connect(world());
  assert.equal(init.serverInfo.name, 'OlhaOPosto');
  assert.equal(init.serverInfo.websiteUrl, 'https://olhaoposto.ocarroeletrico.com');
  const srcs = (init.serverInfo.icons as { src: string }[]).map((i) => i.src);
  assert.ok(srcs.length && srcs.every((s) => s.startsWith('https://olhaoposto.ocarroeletrico.com/')));
});

test('lists every tool, read and write, with English descriptions', async () => {
  const { request } = await connect(world());
  const r = await request('tools/list');
  const names = r.result!.tools!.map((t) => t.name).sort();
  assert.deepEqual(names, [
    'delete_photo', 'get_photo', 'get_photo_link', 'get_ranking', 'get_station', 'list_main_photos', 'list_missing_photos',
    'search_stations', 'set_primary_photo', 'submit_photo',
  ]);
  for (const name of Object.keys(WRITE_TOOLS)) assert.ok(names.includes(name));
});

test('search_stations: words, place, filters, and never a hidden station', async () => {
  const { call } = await connect(world());
  const words = await call('search_stations', { q: 'sintra' });
  assert.deepEqual(words.data.results.map((r: { id: string }) => r.id).sort(), ['EZC-SNT-00001', 'MOB-SNT-00002']);
  const byOperator = await call('search_stations', { q: 'sintra', operator: 'EZC3' });
  assert.deepEqual(byOperator.data.results.map((r: { id: string }) => r.id), ['EZC-SNT-00001']);
  const near = await call('search_stations', { lat: 38.80, lon: -9.38, radius_m: 500 });
  assert.equal(near.data.results[0].id, 'EZC-SNT-00001');
  assert.equal(near.data.results[0].distance_m, 0);
  const without = await call('search_stations', { has_photo: false });
  assert.deepEqual(without.data.results.map((r: { id: string }) => r.id).sort(), ['EZC-SNT-00001', 'MOB-SNT-00002']);
  const withPhoto = await call('search_stations', { has_photo: true });
  assert.deepEqual(withPhoto.data.results.map((r: { id: string }) => r.id), ['EZC-AMD-00051']);
  const direct = await call('search_stations', { q: 'PT*EZC*E*AMD*00051*2' });
  assert.equal(direct.data.results[0].id, 'EZC-AMD-00051');
  assert.equal((await call('search_stations', {})).data.error, 'filter_required');
  assert.equal((await call('search_stations', { q: 'x', lat: 1, lon: 1 })).data.error, 'q_or_coordinates');
});

test('get_station: by id or socket code, with photos, credit and licence', async () => {
  const { call } = await connect(world());
  const s = await call('get_station', { id: 'PT*EZC*E*AMD*00051*1' });
  assert.equal(s.data.id, 'EZC-AMD-00051');
  assert.equal(s.data.socket.compact, 'PTEZCEAMD000511');
  assert.equal(s.data.license, 'CC-BY-SA-4.0');
  assert.equal(s.data.photo.attribution, "© Ana, CC BY-SA 4.0, via olh'o'posto");
  assert.equal(s.data.points.find((p: { compact: string }) => p.compact === 'PTEZCEAMD000512').photo, null);
  const hidden = await call('get_station', { id: 'OOP-HIDDEN' });
  assert.equal(hidden.isError, true);
  assert.equal(hidden.data.error, 'not_found');
});

test('get_photo_link: one size and the attribution, or where to send one', async () => {
  const { call } = await connect(world());
  const l = await call('get_photo_link', { id: 'PTEZCEAMD000511', size: 'thumb' });
  assert.equal(l.data.url, 'https://pictures.ocarroeletrico.com/PTEZCEAMD000511.thumb.jpg');
  assert.equal(l.data.maxPx, 400);
  assert.equal(l.data.credit, 'Ana');
  assert.match(l.data.attribution, /CC BY-SA 4\.0/);
  const none = await call('get_photo_link', { id: 'EZC-SNT-00001' });
  assert.equal(none.data.has_photo, false);
  assert.match(none.data.upload_page, /\/enviar\?posto=EZC-SNT-00001$/);
});

test('list_missing_photos: stations and sockets, by municipality and operator', async () => {
  const { call } = await connect(world());
  const st = await call('list_missing_photos', { municipality: 'SINTRA' });
  assert.deepEqual(st.data.results.map((r: { id: string }) => r.id).sort(), ['EZC-SNT-00001', 'MOB-SNT-00002']);
  const op = await call('list_missing_photos', { municipality: 'sintra', operator: 'MOB1' });
  assert.deepEqual(op.data.results.map((r: { id: string }) => r.id), ['MOB-SNT-00002']);
  const sockets = await call('list_missing_photos', { kind: 'socket' });
  assert.deepEqual(sockets.data.results.map((r: { compact: string }) => r.compact), ['PTEZCEAMD000512']);
});

test('get_photo: a published photo is public; delete_photo needs sign-in', async () => {
  const { call } = await connect(world());
  const p = await call('get_photo', { id: 'p1' });
  assert.equal(p.isError, false);
  assert.equal((await call('get_photo', { id: 'nope' })).data.error, 'not_found');
  assert.equal((await call('delete_photo', { id: 'p1' })).data.error, 'sign_in_required');
});

test('list_main_photos and get_ranking', async () => {
  const { call } = await connect(world());
  const m = await call('list_main_photos', {});
  assert.equal(m.data.total, 2);
  assert.equal(m.data.license, 'CC-BY-SA-4.0');
  const r = await call('get_ranking', { period: 'all' });
  assert.equal(r.data.period, 'all');
  assert.ok(Array.isArray(r.data.contributors));
});

const ana = (scopes: McpCaller['scopes']): McpCaller => ({ user: { id: 'u', name: 'Ana', role: 'contributor' }, scopes });
const photoArgs = { station: 'EZC-SNT-00001', full: 'AAAAAAAA', main: 'AAAAAAAA', thumb: 'AAAAAAAA', license: true, no_people: true };

test('write tools: sign-in, scope and role before anything else', async () => {
  const db = world();
  const anon = await connect(db);
  const a = await anon.call('submit_photo', photoArgs);
  assert.equal(a.isError, true);
  assert.equal(a.data.error, 'sign_in_required');
  const noScope = await connect(db, ana([]));
  assert.equal((await noScope.call('submit_photo', photoArgs)).data.error, 'missing_scope');
  const contributor = await connect(db, { ...ana(['photos:write']), scopes: ['photos:write', 'selections:write'] });
  assert.equal((await contributor.call('set_primary_photo', { target: 'EZC-AMD-00051', photo: 'p1' })).data.error, 'forbidden');
  // Uploads are closed without the Panoramax token and the staging bucket:
  // the same answer as POST /api/v1/photos.
  const writer = await connect(db, ana(['photos:write']));
  assert.equal((await writer.call('submit_photo', photoArgs)).data.error, 'uploads_closed');
});

test('imageBytes: base64, data URL, https with a cap', async () => {
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
  const b64 = Buffer.from(jpeg).toString('base64');
  const never = async () => { throw new Error('no fetch'); };
  assert.deepEqual(await imageBytes(b64, never, 100), jpeg);
  assert.deepEqual(await imageBytes(`data:image/jpeg;base64,${b64}`, never, 100), jpeg);
  assert.equal(await imageBytes('data:image/png;base64,AAAA', never, 100), 'bad_url');
  assert.equal(await imageBytes('http://example.org/a.jpg', never, 100), 'bad_url');
  assert.equal(await imageBytes('not base64!', never, 100), 'bad_base64');
  assert.equal(await imageBytes('A'.repeat(400), never, 100), 'too_large');
  const served = async () => new Response(jpeg);
  assert.deepEqual(await imageBytes('https://example.org/a.jpg', served, 100), jpeg);
  const big = async () => new Response(new Uint8Array(200));
  assert.equal(await imageBytes('https://example.org/a.jpg', big, 100), 'too_large');
  const missing = async () => new Response('x', { status: 404 });
  assert.equal(await imageBytes('https://example.org/a.jpg', missing, 100), 'fetch_failed');
});

test('wantsWrite: only calls to write tools, also in a batch', () => {
  assert.equal(wantsWrite({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'submit_photo' } }), true);
  assert.equal(wantsWrite({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_station' } }), false);
  assert.equal(wantsWrite({ jsonrpc: '2.0', id: 1, method: 'tools/list' }), false);
  assert.equal(wantsWrite([{ method: 'tools/list' }, { method: 'tools/call', params: { name: 'set_primary_photo' } }]), true);
  assert.equal(wantsWrite({ method: 'tools/call', params: { name: 'toString' } }), false);
  assert.equal(wantsWrite(null), false);
});

test('scopes follow the role now, not the role at the grant', async () => {
  assert.deepEqual(liveScopes(['photos:write', 'selections:write'], 'contributor'), ['photos:write']);
  assert.deepEqual(liveScopes(['selections:write', 'bogus'], 'trusted'), ['selections:write']);
  const db = world() as unknown as UserDb;
  const m = await callerFromProps(db, { userId: 'm', scopes: ['photos:write', 'selections:write'] });
  assert.deepEqual(m?.scopes, ['photos:write', 'selections:write']);
  assert.equal(m?.user.role, 'moderator');
  const u = await callerFromProps(db, { userId: 'u', scopes: ['photos:write', 'selections:write'] });
  assert.deepEqual(u?.scopes, ['photos:write']);
  assert.equal(await callerFromProps(db, { userId: 'gone', scopes: [] }), null);
  assert.equal(await callerFromProps(db, { scopes: [] }), null);
  const form = new FormData();
  form.append('scope', 'photos:write');
  form.append('scope', 'selections:write');
  assert.deepEqual(chosenScopes(form, 'contributor'), ['photos:write']);
  assert.deepEqual(defaultScopes([], 'moderator'), ['photos:write']);
  assert.deepEqual(defaultScopes(['selections:write'], 'moderator'), ['selections:write']);
});

test('consent page: escapes what the client says, offers only what the role allows', () => {
  const html = consentPage('pt', {
    clientName: '<script>x</script>', redirectHost: 'evil.example', redirectIsLoopback: true, requested: [],
  }, { id: 'u', name: 'Ana', role: 'contributor' }, 'h"1');
  assert.ok(!html.includes('<script>x'));
  assert.ok(html.includes('&lt;script&gt;x'));
  assert.ok(html.includes('evil.example'));
  assert.ok(html.includes('role="alert"'));
  assert.ok(html.includes('value="h&quot;1"'));
  assert.ok(html.includes('value="photos:write" checked'));
  assert.ok(!html.includes('selections:write"'));
  assert.ok(html.includes('noindex'));
  assert.equal(consentLang('en-GB,en;q=0.9'), 'en');
  assert.equal(consentLang('pt-PT'), 'pt');
  assert.equal(consentLang(null), 'pt');
});

test('HTML pages point agents at llms.txt', async () => {
  const { default: worker } = await import('../src/index.ts');
  const res = await worker.fetch(new Request('https://olhaoposto.ocarroeletrico.com/privacidade'), { DB: d1() } as never, { waitUntil() {} } as never);
  assert.equal(res.headers.get('link'), '</llms.txt>; rel="describedby"; type="text/markdown"');
});
