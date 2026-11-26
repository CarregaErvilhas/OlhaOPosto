import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  clearCookie, langOf, OAUTH_COOKIE, SESSION_COOKIE, login, logout, packOAuth, parseCookies, pkceChallenge, safeNext, sameOrigin, setCookie,
  unpackOAuth, type AuthEnv, type Db,
} from '../src/auth.ts';
import { accountPage } from '../src/pages.ts';

const SITE = 'https://olhaoposto.ocarroeletrico.com';
const noDb = {} as Db;

test('PKCE S256 matches the RFC 7636 example', async () => {
  assert.equal(await pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
});

test('safeNext keeps only paths on this site', () => {
  assert.equal(safeNext('/en/account'), '/en/account');
  assert.equal(safeNext('/postos/EZC-AMD-00051?x=1'), '/postos/EZC-AMD-00051?x=1');
  for (const bad of [null, '', 'https://evil.example/', '//evil.example', '/\\evil.example', 'javascript:alert(1)', '/a\nb']) {
    assert.equal(safeNext(bad), '/conta', String(bad));
  }
});

test('langOf follows the /en/ prefix', () => {
  assert.equal(langOf('/en/account'), 'en');
  assert.equal(langOf('/en'), 'en');
  assert.equal(langOf('/conta'), 'pt');
  assert.equal(langOf('/entrar'), 'pt');
});

test('the state cookie round-trips and rejects junk', () => {
  const packed = packOAuth('s1', 'v1', '/en/stations/EZC-AMD-00051');
  assert.deepEqual(unpackOAuth(packed), { state: 's1', verifier: 'v1', next: '/en/stations/EZC-AMD-00051' });
  assert.equal(unpackOAuth(undefined), null);
  assert.equal(unpackOAuth('only.two'), null);
  assert.equal(unpackOAuth('..x'), null);
  // A next that is not ours falls back to the account page.
  assert.equal(unpackOAuth(packOAuth('s', 'v', '//evil.example'))?.next, '/conta');
});

test('cookies are __Host-safe and parse back', () => {
  const c = setCookie('__Host-oop_session', 'abc', 60);
  for (const part of ['Path=/', 'HttpOnly', 'Secure', 'SameSite=Lax', 'Max-Age=60']) assert.ok(c.includes(part), part);
  assert.ok(!/domain=/i.test(c));
  assert.ok(clearCookie('x').includes('Max-Age=0'));
  assert.equal(parseCookies('a=1; __Host-oop_session=t.o-k_en; b').get('__Host-oop_session'), 't.o-k_en');
  assert.equal(parseCookies(null).size, 0);
});

test('sameOrigin wants our Origin, or a same-origin fetch without one', () => {
  const req = (h: Record<string, string>) => new Request(`${SITE}/auth/logout`, { method: 'POST', headers: h });
  assert.ok(sameOrigin(req({ origin: SITE })));
  assert.ok(!sameOrigin(req({ origin: 'https://evil.example' })));
  assert.ok(!sameOrigin(req({ origin: 'null' })));
  assert.ok(sameOrigin(req({ origin: 'null', 'sec-fetch-site': 'same-origin' })));
  assert.ok(!sameOrigin(req({ origin: 'null', 'sec-fetch-site': 'cross-site' })));
  assert.ok(sameOrigin(req({ 'sec-fetch-site': 'same-origin' })));
  assert.ok(!sameOrigin(req({ 'sec-fetch-site': 'cross-site' })));
  assert.ok(!sameOrigin(req({})));
});

test('login is off until the OSM secrets exist', async () => {
  const res = await login(new Request(`${SITE}/auth/osm/login`), { DB: noDb }, {});
  assert.equal(res.status, 503);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('set-cookie'), null);
});

test('login sends the browser to OSM with PKCE and a state cookie', async () => {
  const env: AuthEnv = { DB: noDb, OSM_CLIENT_ID: 'cid', OSM_CLIENT_SECRET: 'secret' };
  const res = await login(new Request(`${SITE}/auth/osm/login?next=/en/account`), env, {});
  assert.equal(res.status, 302);
  const to = new URL(res.headers.get('location')!);
  assert.equal(to.origin + to.pathname, 'https://www.openstreetmap.org/oauth2/authorize');
  assert.equal(to.searchParams.get('scope'), 'read_prefs');
  assert.equal(to.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(to.searchParams.get('redirect_uri'), `${SITE}/auth/osm/callback`);
  assert.ok(!to.search.includes('secret'));
  const cookie = res.headers.get('set-cookie')!;
  const saved = unpackOAuth(parseCookies(cookie.split(';')[0]).get('__Host-oop_oauth'));
  assert.equal(saved?.state, to.searchParams.get('state'));
  assert.equal(saved?.next, '/en/account');
  assert.equal(await pkceChallenge(saved!.verifier), to.searchParams.get('code_challenge'));
});

test('logout refuses a cross-site POST', async () => {
  const res = await logout(new Request(`${SITE}/auth/logout`, { method: 'POST', headers: { origin: 'https://evil.example' } }), { DB: noDb });
  assert.equal(res.status, 403);
});

test('the account page escapes the OSM name and never links out by form', () => {
  const out = accountPage('pt', { user: { name: '<b>x</b>', role: 'contributor' }, enabled: true });
  assert.ok(out.includes('&lt;b&gt;x&lt;/b&gt;'));
  assert.ok(out.includes('action="/auth/logout?next=%2Fconta"'));
  assert.ok(out.includes('noindex'));
  const anon = accountPage('en', { user: null, enabled: true, error: 'denied' });
  assert.ok(anon.includes('href="/auth/osm/login?next=%2Fen%2Faccount"'));
  assert.ok(anon.includes('role="alert"'));
  assert.ok(!/<form[^>]*openstreetmap/.test(anon));
  // An unknown error key shows nothing rather than echoing the query string.
  assert.ok(!accountPage('pt', { user: null, enabled: true, error: '<script>' }).includes('<script>'));
});

test('the privacy page exists in both languages, indexable, and every page links to it', async () => {
  const { privacyPage } = await import('../src/privacy.ts');
  const { homePage } = await import('../src/pages.ts');
  for (const [lang, path, other] of [['pt', '/privacidade', '/en/privacy'], ['en', '/en/privacy', '/privacidade']] as const) {
    const out = privacyPage(lang);
    assert.ok(!out.includes('noindex'), lang);
    assert.ok(out.includes(`<link rel="canonical" href="https://olhaoposto.ocarroeletrico.com${path}">`), lang);
    assert.ok(out.includes(`href="https://olhaoposto.ocarroeletrico.com${other}"`), lang);
    // The controller and both cookies are named, so the text matches the code.
    for (const must of ['info@ocarroeletrico.com', OAUTH_COOKIE, SESSION_COOKIE]) assert.ok(out.includes(must), `${lang}: ${must}`);
    assert.ok(homePage(lang).includes(`href="${path}"`), `${lang} footer`);
  }
  assert.ok(accountPage('pt', { user: null, enabled: true }).includes('href="/privacidade"'));
});
