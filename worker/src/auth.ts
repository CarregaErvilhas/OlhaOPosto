// Sign-in with OpenStreetMap: OAuth2 Authorization Code with PKCE, scope
// read_prefs only (enough for user/details, no email, no editing). The OSM
// token is used once to read who the person is, then revoked: the Worker
// keeps only its own session, as a SHA-256 in D1.
//
// Until OSM_CLIENT_ID and OSM_CLIENT_SECRET exist as Worker secrets, every
// route here answers "not available yet", so this can ship before the OSM
// application is registered.
import { accountPage, accountPath, type Lang } from './pages.ts';

// The slices of D1 and ExecutionContext used here, so the tests typecheck
// under Node without the Workers types. The real ones fit these shapes.
interface Stmt {
  bind(...values: unknown[]): Stmt;
  first<T>(): Promise<T | null>;
  run(): Promise<unknown>;
}
export interface Db {
  prepare(sql: string): Stmt;
  batch(statements: Stmt[]): Promise<unknown>;
}
export interface Waiter {
  waitUntil(promise: Promise<unknown>): void;
}

export interface AuthEnv {
  DB: Db;
  OSM_CLIENT_ID?: string;
  OSM_CLIENT_SECRET?: string;
  // Only for local tests against the OSM dev server or a mock; set it in
  // .dev.vars, never in wrangler.json.
  OSM_URL?: string;
}

export const OAUTH_COOKIE = '__Host-vf_oauth';
export const SESSION_COOKIE = '__Host-vf_session';
const OAUTH_TTL = 600; // seconds to finish the OSM screen
export const SESSION_TTL = 30 * 24 * 3600;

export const loginEnabled = (env: AuthEnv) => Boolean(env.OSM_CLIENT_ID && env.OSM_CLIENT_SECRET);
const oauthBase = (env: AuthEnv) => env.OSM_URL ?? 'https://www.openstreetmap.org';
const apiBase = (env: AuthEnv) => env.OSM_URL ?? 'https://api.openstreetmap.org';

// --- small pure helpers (tested under Node) ---

export function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export const randomToken = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));

const sha256 = async (text: string) =>
  new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));

export const pkceChallenge = async (verifier: string) => b64url(await sha256(verifier));
export const tokenHash = async (token: string) => b64url(await sha256(token));

export function parseCookies(header: string | null): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out.set(part.slice(0, i).trim(), part.slice(i + 1).trim());
  }
  return out;
}

// __Host- cookies: Secure, Path=/, no Domain, so no other subdomain of
// ocarroeletrico.com can set or read them. Lax, not Strict: the OAuth
// callback is a navigation from openstreetmap.org and must carry the cookie.
export const setCookie = (name: string, value: string, maxAge: number) =>
  `${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
export const clearCookie = (name: string) => setCookie(name, '', 0);

// Only a path on this site: "//evil.example" and "/\evil.example" are
// other hosts to a browser.
export function safeNext(raw: string | null, fallback = accountPath('pt')): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return fallback;
  if (/[\u0000-\u001f\\]/.test(raw)) return fallback;
  return raw;
}

export const langOf = (path: string): Lang => (path === '/en' || path.startsWith('/en/') ? 'en' : 'pt');

// For state-changing POSTs. SameSite=Lax already keeps the session cookie off
// cross-site POSTs; this is the second lock.
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (origin) return origin === new URL(request.url).origin;
  return request.headers.get('sec-fetch-site') === 'same-origin';
}

// The state cookie: state, PKCE verifier and where to go back to.
export const packOAuth = (state: string, verifier: string, next: string) =>
  `${state}.${verifier}.${b64url(new TextEncoder().encode(next))}`;

export function unpackOAuth(raw: string | undefined): { state: string; verifier: string; next: string } | null {
  const parts = (raw ?? '').split('.');
  if (parts.length !== 3 || !parts[0] || !parts[1]) return null;
  try {
    const bin = atob(parts[2].replace(/-/g, '+').replace(/_/g, '/'));
    const next = new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
    return { state: parts[0], verifier: parts[1], next: safeNext(next) };
  } catch {
    return null;
  }
}

// --- responses ---

function page(lang: Lang, body: string, status: number, headers: Record<string, string>, cookies: string[] = []): Response {
  const h = new Headers({ ...headers, 'content-language': lang === 'pt' ? 'pt-PT' : 'en', 'cache-control': 'no-store' });
  for (const c of cookies) h.append('set-cookie', c);
  return new Response(body, { status, headers: h });
}

function redirect(location: string, cookies: string[] = [], status = 302): Response {
  const h = new Headers({ location, 'cache-control': 'no-store' });
  for (const c of cookies) h.append('set-cookie', c);
  return new Response(null, { status, headers: h });
}

// --- sessions ---

export interface SessionUser {
  id: string;
  name: string;
  role: string;
}

export async function currentUser(request: Request, env: AuthEnv): Promise<SessionUser | null> {
  const token = parseCookies(request.headers.get('cookie')).get(SESSION_COOKIE);
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT u.id, COALESCE(u.pseudonym, u.osm_name) AS name, u.role
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ?`,
  ).bind(await tokenHash(token), new Date().toISOString()).first<SessionUser>();
  return row ?? null;
}

// --- routes ---

export async function accountHtml(lang: Lang, request: Request, env: AuthEnv, headers: Record<string, string>) {
  const enabled = loginEnabled(env);
  const user = enabled ? await currentUser(request, env) : null;
  const error = new URL(request.url).searchParams.get('erro') ?? undefined;
  return page(lang, accountPage(lang, { user, enabled, error }), 200, headers);
}

export async function login(request: Request, env: AuthEnv, headers: Record<string, string>): Promise<Response> {
  const url = new URL(request.url);
  const next = safeNext(url.searchParams.get('next'));
  const lang = langOf(next);
  if (!loginEnabled(env)) return page(lang, accountPage(lang, { user: null, enabled: false }), 503, headers);
  const state = randomToken(16);
  const verifier = randomToken(32);
  const auth = new URL('/oauth2/authorize', oauthBase(env));
  auth.search = new URLSearchParams({
    response_type: 'code',
    client_id: env.OSM_CLIENT_ID!,
    redirect_uri: new URL('/auth/osm/callback', url).href,
    scope: 'read_prefs',
    state,
    code_challenge: await pkceChallenge(verifier),
    code_challenge_method: 'S256',
  }).toString();
  return redirect(auth.href, [setCookie(OAUTH_COOKIE, packOAuth(state, verifier, next), OAUTH_TTL)]);
}

interface OsmUser {
  id: number;
  name: string;
}

async function osmUser(env: AuthEnv, code: string, verifier: string, redirectUri: string, ctx: Waiter): Promise<OsmUser | null> {
  const tokenRes = await fetch(new URL('/oauth2/token', oauthBase(env)), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: env.OSM_CLIENT_ID!,
      client_secret: env.OSM_CLIENT_SECRET!,
      code_verifier: verifier,
    }),
  });
  if (!tokenRes.ok) return null;
  const token = ((await tokenRes.json()) as { access_token?: string }).access_token;
  if (!token) return null;
  try {
    const res = await fetch(new URL('/api/0.6/user/details.json', apiBase(env)), {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
    });
    if (!res.ok) return null;
    const u = ((await res.json()) as { user?: { id?: unknown; display_name?: unknown } }).user;
    if (!u || !Number.isSafeInteger(u.id) || typeof u.display_name !== 'string' || !u.display_name) return null;
    return { id: u.id as number, name: u.display_name.slice(0, 255) };
  } finally {
    // OSM tokens do not expire on their own; this one has done its job.
    ctx.waitUntil(
      fetch(new URL('/oauth2/revoke', oauthBase(env)), {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token, client_id: env.OSM_CLIENT_ID!, client_secret: env.OSM_CLIENT_SECRET! }),
      }).then(() => undefined, () => undefined),
    );
  }
}

export async function callback(request: Request, env: AuthEnv, ctx: Waiter, headers: Record<string, string>): Promise<Response> {
  const url = new URL(request.url);
  const saved = unpackOAuth(parseCookies(request.headers.get('cookie')).get(OAUTH_COOKIE));
  const next = saved?.next ?? accountPath('pt');
  const lang = langOf(next);
  // The state cookie is single use, whatever happens next.
  const cleared = [clearCookie(OAUTH_COOKIE)];
  const fail = (error: string) => redirect(`${accountPath(lang)}?erro=${error}`, cleared);

  if (!loginEnabled(env)) return page(lang, accountPage(lang, { user: null, enabled: false }), 503, headers, cleared);
  if (url.searchParams.get('error')) return fail('denied');
  const code = url.searchParams.get('code');
  if (!saved || !code || url.searchParams.get('state') !== saved.state) return fail('expired');

  let user: OsmUser | null;
  try {
    user = await osmUser(env, code, saved.verifier, new URL('/auth/osm/callback', url).href, ctx);
  } catch {
    user = null;
  }
  if (!user) return fail('failed');

  const now = new Date();
  const token = randomToken(32);
  const hash = await tokenHash(token);
  // One round trip: the account (new or with a fresh OSM name), the session,
  // and the expired sessions out of the way.
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO users (id, osm_uid, osm_name, created_at, last_login_at) VALUES (?1, ?2, ?3, ?4, ?4)
       ON CONFLICT (osm_uid) DO UPDATE SET osm_name = excluded.osm_name, last_login_at = excluded.last_login_at`,
    ).bind(crypto.randomUUID(), user.id, user.name, now.toISOString()),
    env.DB.prepare(
      `INSERT INTO sessions (token_hash, user_id, created_at, expires_at)
       SELECT ?1, id, ?2, ?3 FROM users WHERE osm_uid = ?4`,
    ).bind(hash, now.toISOString(), new Date(now.getTime() + SESSION_TTL * 1000).toISOString(), user.id),
    env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(now.toISOString()),
  ]);
  // A clean URL: the one-time code does not stay in history or in a Referer.
  return redirect(next, [...cleared, setCookie(SESSION_COOKIE, token, SESSION_TTL)]);
}

export async function logout(request: Request, env: AuthEnv): Promise<Response> {
  if (!sameOrigin(request)) {
    return new Response('forbidden', { status: 403, headers: { 'cache-control': 'no-store' } });
  }
  const token = parseCookies(request.headers.get('cookie')).get(SESSION_COOKIE);
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await tokenHash(token)).run();
  const next = safeNext(new URL(request.url).searchParams.get('next'));
  // 303: the browser follows a POST with a GET.
  return redirect(next, [clearCookie(SESSION_COOKIE)], 303);
}
