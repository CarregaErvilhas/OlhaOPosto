// Personal access tokens for the API (Docs/arquitetura.md, *Tokens de API*).
//
// A signed-in person creates a token on the account page, with a name, the
// scopes it may use and how long it lasts. The token is shown once; D1 keeps
// only its SHA-256, like the sessions. Scripts and agents send it as
// `Authorization: Bearer oop_…` and act as that person, with that person's
// role and limits: a token never carries more than its account can do, and a
// demotion applies to every token at once, since the role is read on each
// request.
import { currentUser, randomToken, sameOrigin, tokenHash, type AuthEnv, type SessionUser } from './auth.ts';

interface Stmt {
  bind(...values: unknown[]): Stmt;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes: number } }>;
}
export interface TokenDb {
  prepare(sql: string): Stmt;
}

export const TOKEN_PREFIX = 'oop_';
// What a token may do. Reading the API needs no token at all.
export const SCOPES = ['photos:write', 'selections:write'] as const;
export type Scope = (typeof SCOPES)[number];
// selections:write only makes sense for the roles that may choose main photos:
// moderators and admins (a trusted account publishes directly, but does not
// pick which photo is the main one).
export const canChooseMain = (role: string) => role === 'moderator' || role === 'admin';
export const scopesFor = (role: string): Scope[] => (canChooseMain(role) ? [...SCOPES] : ['photos:write']);

export const TTL_DAYS = [30, 90, 365] as const;
export const MAX_ACTIVE = 5;
const DAY = 86_400_000;
// last_used_at is for the account page, not an audit log: one write an hour.
const TOUCH_EVERY = 3_600_000;

export interface TokenRow {
  id: string;
  prefix: string;
  name: string;
  scopes: string;
  created_at: string;
  expires_at: string;
  last_used_at: string | null;
}

export interface NewToken {
  name: string;
  scopes: Scope[];
  days: number;
}

// The create form, checked against the person's role. A string is an error code.
export function parseNewToken(form: FormData, role: string): NewToken | string {
  const name = String(form.get('name') ?? '').trim().replace(/\s+/g, ' ');
  if (!name || name.length > 60) return 'name';
  const allowed = scopesFor(role);
  const asked = form.getAll('scope').map(String);
  if (asked.length === 0) return 'scope';
  if (asked.some((s) => !(allowed as string[]).includes(s))) return 'scope';
  const days = Number(form.get('days'));
  if (!(TTL_DAYS as readonly number[]).includes(days)) return 'days';
  return { name, scopes: [...new Set(asked)] as Scope[], days };
}

export async function listTokens(db: TokenDb, userId: string, now = new Date()): Promise<TokenRow[]> {
  const { results } = await db.prepare(
    `SELECT id, prefix, name, scopes, created_at, expires_at, last_used_at FROM api_tokens
      WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?
      ORDER BY created_at DESC`,
  ).bind(userId, now.toISOString()).all<TokenRow>();
  return results;
}

// Returns the token in clear, the only time it exists outside the caller.
export async function createToken(
  db: TokenDb, userId: string, t: NewToken, now = new Date(),
): Promise<{ token: string; id: string } | 'too_many'> {
  const active = await db.prepare(
    'SELECT COUNT(*) AS n FROM api_tokens WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?',
  ).bind(userId, now.toISOString()).first<{ n: number }>();
  if ((active?.n ?? 0) >= MAX_ACTIVE) return 'too_many';
  const token = TOKEN_PREFIX + randomToken(32);
  const id = crypto.randomUUID();
  // Expired and revoked tokens of this person go when a new one is made.
  await db.prepare('DELETE FROM api_tokens WHERE user_id = ? AND (expires_at <= ? OR revoked_at IS NOT NULL)')
    .bind(userId, now.toISOString()).run();
  await db.prepare(
    `INSERT INTO api_tokens (id, user_id, token_hash, prefix, name, scopes, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id, userId, await tokenHash(token), token.slice(0, TOKEN_PREFIX.length + 6), t.name, t.scopes.join(' '),
    now.toISOString(), new Date(now.getTime() + t.days * DAY).toISOString(),
  ).run();
  return { token, id };
}

export async function revokeToken(db: TokenDb, userId: string, id: string, now = new Date()): Promise<boolean> {
  const r = await db.prepare(
    'UPDATE api_tokens SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL',
  ).bind(now.toISOString(), id, userId).run();
  return r.meta.changes === 1;
}

// The bearer token of a request, if it looks like one of ours.
export function bearer(request: Request): string | null {
  const h = request.headers.get('authorization') ?? '';
  const m = h.match(/^Bearer\s+(\S+)$/i);
  return m && m[1].startsWith(TOKEN_PREFIX) && m[1].length < 200 ? m[1] : null;
}

export type TokenAuth = { user: SessionUser; scopes: Scope[] } | null;

// The account behind a bearer token, or null: unknown, expired or revoked.
export async function tokenUser(db: TokenDb, token: string, now = new Date()): Promise<TokenAuth> {
  const row = await db.prepare(
    `SELECT t.id AS token_id, t.scopes, t.last_used_at, u.id, COALESCE(u.pseudonym, u.osm_name) AS name, u.role
       FROM api_tokens t JOIN users u ON u.id = t.user_id
      WHERE t.token_hash = ? AND t.revoked_at IS NULL AND t.expires_at > ?`,
  ).bind(await tokenHash(token), now.toISOString())
    .first<{ token_id: string; scopes: string; last_used_at: string | null; id: string; name: string; role: string }>();
  if (!row) return null;
  if (!row.last_used_at || now.getTime() - Date.parse(row.last_used_at) > TOUCH_EVERY) {
    await db.prepare('UPDATE api_tokens SET last_used_at = ? WHERE id = ?').bind(now.toISOString(), row.token_id).run()
      .catch(() => undefined);
  }
  // A scope the role lost (a trusted account demoted) stops working at once.
  const allowed = scopesFor(row.role) as string[];
  const scopes = row.scopes.split(' ').filter((s) => allowed.includes(s)) as Scope[];
  return { user: { id: row.id, name: row.name, role: row.role }, scopes };
}

// Who is calling a write endpoint of the API. A bearer token must carry the
// scope; without one, the session cookie works only from our own pages
// (the same-origin check that /auth/logout uses). viaToken tells the caller
// to skip what only a browser can do (Turnstile).
export type ApiSigner = { user: SessionUser; viaToken: boolean };
export type ApiCaller =
  | ApiSigner
  | { error: 'sign_in_required' | 'missing_scope' | 'cross_site'; status: 401 | 403 };

export async function apiCaller(request: Request, env: AuthEnv, scope: Scope, now = new Date()): Promise<ApiCaller> {
  const token = bearer(request);
  if (token) {
    const auth = await tokenUser(env.DB as unknown as TokenDb, token, now).catch(() => null);
    if (!auth) return { error: 'sign_in_required', status: 401 };
    if (!auth.scopes.includes(scope)) return { error: 'missing_scope', status: 403 };
    return { user: auth.user, viaToken: true };
  }
  if (request.headers.has('authorization')) return { error: 'sign_in_required', status: 401 };
  if (!sameOrigin(request)) return { error: 'cross_site', status: 403 };
  const user = await currentUser(request, env).catch(() => null);
  return user ? { user, viaToken: false } : { error: 'sign_in_required', status: 401 };
}
