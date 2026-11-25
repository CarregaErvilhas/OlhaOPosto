import assert from 'node:assert/strict';
import { test } from 'node:test';

import { assignableRoles, setRole, usersPage, type UserRow } from '../src/admin.ts';
import type { AuthEnv } from '../src/auth.ts';

const admin = { id: 'a', role: 'admin' };
const mod = { id: 'm', role: 'moderator' };

test('assignableRoles: admins give any role, moderators only contributor <-> trusted', () => {
  assert.deepEqual(assignableRoles(admin, { id: 'x', role: 'contributor' }), ['trusted', 'moderator', 'admin']);
  assert.deepEqual(assignableRoles(admin, { id: 'x', role: 'admin' }), ['contributor', 'trusted', 'moderator']);
  assert.deepEqual(assignableRoles(mod, { id: 'x', role: 'contributor' }), ['trusted']);
  assert.deepEqual(assignableRoles(mod, { id: 'x', role: 'trusted' }), ['contributor']);
  assert.deepEqual(assignableRoles(mod, { id: 'x', role: 'moderator' }), []);
  assert.deepEqual(assignableRoles(mod, { id: 'x', role: 'admin' }), []);
  assert.deepEqual(assignableRoles({ id: 't', role: 'trusted' }, { id: 'x', role: 'contributor' }), []);
});

test('assignableRoles: nobody changes their own role', () => {
  assert.deepEqual(assignableRoles(admin, { id: 'a', role: 'admin' }), []);
  assert.deepEqual(assignableRoles(mod, { id: 'm', role: 'moderator' }), []);
});

const row = (over: Partial<UserRow>): UserRow => ({
  id: 'u1', osm_name: 'Ana', role: 'contributor', last_login_at: '2026-11-25T10:00:00Z',
  promoted_at: null, promoted_by_name: null, ...over,
});

test('usersPage: escapes names, no form on your own row', () => {
  const html = usersPage('pt', { id: 'a', name: 'Eu', role: 'admin' }, [
    row({ id: 'a', osm_name: 'Eu', role: 'admin' }),
    row({ osm_name: '<b>x</b>' }),
  ], { q: '"><script>' });
  assert.ok(!html.includes('<b>x</b>'));
  assert.ok(!html.includes('"><script>'));
  assert.equal(html.match(/<form method="post"/g)?.length, 1);
  assert.ok(html.includes('value="moderator"'));
});

// --- setRole with a fake D1 ---

function env(actorRole: string | null, changes = 1) {
  const writes: unknown[][] = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first() {
              return actorRole ? { id: 'a', name: 'Eu', role: actorRole } : null;
            },
            async run() {
              assert.match(sql, /^UPDATE users SET role/);
              writes.push(args);
              return { meta: { changes } };
            },
          };
        },
      };
    },
  };
  return { env: { DB: db } as unknown as AuthEnv, writes };
}

function post(fields: Record<string, string>, origin = 'https://olhaoposto.ocarroeletrico.com') {
  return new Request('https://olhaoposto.ocarroeletrico.com/admin/papel', {
    method: 'POST',
    headers: { origin, cookie: '__Host-oop_session=t' },
    body: new URLSearchParams(fields),
  });
}

const NOW = new Date('2026-11-25T12:00:00Z');

test('setRole: an admin appoints a moderator, recorded with who and when', async () => {
  const { env: e, writes } = env('admin');
  const res = await setRole(post({ user: 'u1', from: 'contributor', role: 'moderator', lang: 'pt' }), e, NOW);
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/admin/utilizadores?ok=1');
  assert.deepEqual(writes, [['moderator', 'a', NOW.toISOString(), 'u1', 'contributor']]);
});

test('setRole: refuses what the role does not allow, without writing', async () => {
  const m = env('moderator');
  const res = await setRole(post({ user: 'u1', from: 'contributor', role: 'admin', lang: 'en' }), m.env, NOW);
  assert.equal(res.headers.get('location'), '/en/admin/users?erro=forbidden');
  const c = env('contributor');
  await setRole(post({ user: 'u1', from: 'contributor', role: 'trusted' }), c.env, NOW);
  const self = env('admin');
  await setRole(post({ user: 'a', from: 'admin', role: 'contributor' }), self.env, NOW);
  const bad = env('admin');
  const r = await setRole(post({ user: 'u1', from: 'contributor', role: 'root' }), bad.env, NOW);
  assert.equal(r.headers.get('location'), '/admin/utilizadores?erro=bad');
  assert.deepEqual([...m.writes, ...c.writes, ...self.writes, ...bad.writes], []);
});

test('setRole: cross-site posts and stale pages', async () => {
  const x = env('admin');
  const res = await setRole(post({ user: 'u1', from: 'contributor', role: 'trusted' }, 'https://evil.example'), x.env, NOW);
  assert.equal(res.status, 403);
  assert.deepEqual(x.writes, []);
  const stale = env('admin', 0);
  const r = await setRole(post({ user: 'u1', from: 'contributor', role: 'trusted' }), stale.env, NOW);
  assert.equal(r.headers.get('location'), '/admin/utilizadores?erro=stale');
});
