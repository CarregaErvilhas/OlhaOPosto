import assert from 'node:assert/strict';
import { test } from 'node:test';

import { accountAction, accountHtml } from '../src/account.ts';
import { tokenHash, type AuthEnv } from '../src/auth.ts';
import { apiCaller, bearer, createToken, listTokens, parseNewToken, revokeToken, tokenUser } from '../src/tokens.ts';
import { d1 } from './d1.ts';

const NOW = new Date('2026-11-25T10:00:00Z');
const SITE = 'https://olhaoposto.ocarroeletrico.com';

async function setup(role = 'contributor') {
  const db = d1();
  db.sql.prepare(`INSERT INTO users (id, osm_uid, osm_name, role, created_at, last_login_at) VALUES ('ana', 1, 'Ana', ?, 'x', 'x')`).run(role);
  db.sql.prepare(`INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, 'ana', 'x', '2999-01-01')`)
    .run(await tokenHash('sess'));
  const env = { DB: db, OSM_CLIENT_ID: 'id', OSM_CLIENT_SECRET: 's' } as unknown as AuthEnv;
  return { db, env };
}

const form = (fields: [string, string][]) => {
  const f = new FormData();
  for (const [k, v] of fields) f.append(k, v);
  return f;
};

test('parseNewToken: name, scopes allowed for the role, validity', () => {
  const ok = form([['name', '  phone  script '], ['scope', 'photos:write'], ['days', '90']]);
  assert.deepEqual(parseNewToken(ok, 'contributor'), { name: 'phone script', scopes: ['photos:write'], days: 90 });
  assert.equal(parseNewToken(form([['name', 'x'], ['scope', 'selections:write'], ['days', '90']]), 'contributor'), 'scope');
  assert.equal(parseNewToken(form([['name', 'x'], ['scope', 'selections:write'], ['days', '90']]), 'trusted'), 'scope');
  assert.deepEqual(
    parseNewToken(form([['name', 'x'], ['scope', 'selections:write'], ['days', '30']]), 'moderator'),
    { name: 'x', scopes: ['selections:write'], days: 30 },
  );
  assert.equal(parseNewToken(form([['name', ''], ['scope', 'photos:write'], ['days', '90']]), 'admin'), 'name');
  assert.equal(parseNewToken(form([['name', 'x'], ['days', '90']]), 'admin'), 'scope');
  assert.equal(parseNewToken(form([['name', 'x'], ['scope', 'photos:write'], ['days', '7']]), 'admin'), 'days');
});

test('tokens: only the hash is kept, they expire, they can be revoked', async () => {
  const { db } = await setup();
  const made = await createToken(db, 'ana', { name: 'a', scopes: ['photos:write'], days: 30 }, NOW);
  assert.ok(typeof made === 'object' && made.token.startsWith('oop_'));
  const stored = db.sql.prepare('SELECT token_hash, prefix FROM api_tokens').get() as { token_hash: string; prefix: string };
  assert.notEqual(stored.token_hash, made.token);
  assert.equal(stored.token_hash, await tokenHash(made.token));
  assert.ok(made.token.startsWith(stored.prefix));

  assert.deepEqual(await tokenUser(db, made.token, NOW), { user: { id: 'ana', name: 'Ana', role: 'contributor' }, scopes: ['photos:write'] });
  assert.equal(await tokenUser(db, made.token, new Date(NOW.getTime() + 31 * 86_400_000)), null);
  assert.equal(await tokenUser(db, 'oop_nope', NOW), null);
  assert.equal((await listTokens(db, 'ana', NOW)).length, 1);
  assert.equal(await revokeToken(db, 'someone-else', made.id, NOW), false);
  assert.equal(await revokeToken(db, 'ana', made.id, NOW), true);
  assert.equal(await tokenUser(db, made.token, NOW), null);
  assert.equal((await listTokens(db, 'ana', NOW)).length, 0);
});

test('tokens: at most five active', async () => {
  const { db } = await setup();
  for (let i = 0; i < 5; i++) await createToken(db, 'ana', { name: `t${i}`, scopes: ['photos:write'], days: 30 }, NOW);
  assert.equal(await createToken(db, 'ana', { name: 't6', scopes: ['photos:write'], days: 30 }, NOW), 'too_many');
});

test('a demoted account loses selections:write on its tokens at once', async () => {
  const { db } = await setup('trusted');
  const made = await createToken(db, 'ana', { name: 'a', scopes: ['photos:write', 'selections:write'], days: 30 }, NOW);
  assert.ok(typeof made === 'object');
  db.sql.exec(`UPDATE users SET role = 'contributor'`);
  assert.deepEqual((await tokenUser(db, made.token, NOW))?.scopes, ['photos:write']);
});

test('apiCaller: bearer with scope, or the session from our own pages only', async () => {
  const { db, env } = await setup();
  const made = await createToken(db, 'ana', { name: 'a', scopes: ['photos:write'], days: 30 }, NOW);
  assert.ok(typeof made === 'object');
  const req = (headers: Record<string, string>) => new Request(`${SITE}/api/v1/photos`, { method: 'POST', headers });
  assert.equal(bearer(req({ authorization: `Bearer ${made.token}` })), made.token);
  assert.equal(bearer(req({ authorization: 'Basic abc' })), null);

  const viaToken = await apiCaller(req({ authorization: `Bearer ${made.token}`, origin: 'https://evil.example' }), env, 'photos:write', NOW);
  assert.ok('user' in viaToken && viaToken.viaToken && viaToken.user.id === 'ana');
  assert.deepEqual(await apiCaller(req({ authorization: `Bearer ${made.token}` }), env, 'selections:write', NOW), { error: 'missing_scope', status: 403 });
  assert.deepEqual(await apiCaller(req({ authorization: 'Bearer oop_wrong' }), env, 'photos:write', NOW), { error: 'sign_in_required', status: 401 });
  assert.deepEqual(await apiCaller(req({ authorization: 'Bearer other' }), env, 'photos:write', NOW), { error: 'sign_in_required', status: 401 });
  const cookie = '__Host-oop_session=sess';
  assert.deepEqual(await apiCaller(req({ cookie, origin: 'https://evil.example' }), env, 'photos:write', NOW), { error: 'cross_site', status: 403 });
  const viaCookie = await apiCaller(req({ cookie, origin: SITE }), env, 'photos:write', NOW);
  assert.ok('user' in viaCookie && !viaCookie.viaToken);
});

test('account page: create shows the token once, revoke, leave the ranking', async () => {
  const { db, env } = await setup();
  const post = (fields: [string, string][], origin = SITE) => accountAction(new Request(`${SITE}/conta/acao`, {
    method: 'POST', body: form(fields), headers: { cookie: '__Host-oop_session=sess', origin },
  }), env, {}, undefined, NOW);

  assert.equal((await post([['action', 'create_token']], 'https://evil.example')).status, 403);
  const created = await post([['lang', 'pt'], ['action', 'create_token'], ['name', 'script'], ['scope', 'photos:write'], ['days', '90']]);
  assert.equal(created.status, 200);
  assert.equal(created.headers.get('cache-control'), 'no-store');
  const html = await created.text();
  const token = html.match(/oop_[A-Za-z0-9_-]+/)?.[0];
  assert.ok(token && (await tokenUser(db, token, NOW)));
  assert.ok(html.includes('não volta a aparecer'));

  // The account page lists it without the token.
  const page = await (await accountHtml('pt', new Request(`${SITE}/conta`, { headers: { cookie: '__Host-oop_session=sess' } }), env, {})).text();
  assert.ok(page.includes('script'));
  assert.ok(!page.includes(token));
  const id = (db.sql.prepare('SELECT id FROM api_tokens').get() as { id: string }).id;
  const revoked = await post([['lang', 'pt'], ['action', 'revoke_token'], ['token', id]]);
  assert.equal(revoked.status, 303);
  assert.match(revoked.headers.get('location')!, /ok=revoked/);

  const bad = await post([['lang', 'en'], ['action', 'create_token'], ['name', ''], ['scope', 'photos:write'], ['days', '90']]);
  assert.match(bad.headers.get('location')!, /^\/en\/account\?erro=name/);

  await post([['lang', 'pt'], ['action', 'ranking_out']]);
  assert.equal((db.sql.prepare('SELECT ranking_opt_out AS o FROM users').get() as { o: number }).o, 1);
});
