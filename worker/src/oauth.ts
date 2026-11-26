// The MCP endpoint and its OAuth (Docs/arquitetura.md, *Servidor MCP*).
//
// /mcp is Streamable HTTP through the Agents SDK's stateless handler
// (createMcpHandler: a fresh server per request, no Durable Object, since no
// tool keeps state between calls). Who is calling:
//
// - nobody: the read tools work; a call to a write tool gets the OAuth
//   challenge (401 with WWW-Authenticate), so the client signs in and repeats it;
// - `Authorization: Bearer oop_…`: an API token from the account page
//   (src/tokens.ts), checked here, with its scopes;
// - any other bearer: an access token of workers-oauth-provider, which also
//   serves the metadata, the dynamic client registration (/oauth/register)
//   and /oauth/token. Its grants live in the OAUTH_KV namespace, hashed or
//   encrypted. The consent page (/oauth/authorize) is ours: it needs the OSM
//   sign-in of the site and lists what the agent may do.
//
// Either way the role is read from D1 on every request: a grant or a token
// never does more than the account can do now.
//
// Until OAUTH_KV is bound, OAuth answers 503 and only reading and the tokens work.
import { OAuthProvider, getOAuthApi, type OAuthHelpers, type OAuthProviderOptions } from '@cloudflare/workers-oauth-provider';
import { createMcpHandler } from 'agents/mcp/server';
import { currentUser, sameOrigin } from './auth.ts';
import { MCP_PATH, mcpServer, type McpCaller, type McpEnv } from './mcp.ts';
import {
  AUTHORIZE_PATH, callerFromProps, chosenScopes, consentLang, consentPage, wantsWrite,
  type AgentGrants, type GrantProps, type UserDb,
} from './mcpauth.ts';
import { SITE, type Lang } from './pages.ts';
import { SCOPES, bearer, tokenUser, type TokenDb } from './tokens.ts';

export interface OAuthEnv extends McpEnv {
  OAUTH_KV?: KVNamespace;
  OAUTH_PROVIDER?: OAuthHelpers;
}

export const RESOURCE = SITE + MCP_PATH;
const TOKEN_PATH = '/oauth/token';
const REGISTER_PATH = '/oauth/register';
const DAY = 86_400;

// A fresh server per request, as the stateless handler wants.
function serve(request: Request, env: OAuthEnv, ctx: ExecutionContext, caller: McpCaller | null): Promise<Response> {
  return createMcpHandler(() => mcpServer(env, caller, { ctx }), { route: MCP_PATH })(request, env, ctx);
}

const jsonError = (status: number, error: string, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify({ error }), {
    status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });

const options: OAuthProviderOptions<OAuthEnv> = {
  apiRoute: MCP_PATH,
  apiHandler: {
    async fetch(request, env, ctx) {
      const caller = await callerFromProps(env.DB as unknown as UserDb, (ctx as unknown as { props?: unknown }).props)
        .catch(() => null);
      // The account behind the grant is gone: the token is no good.
      if (!caller) return jsonError(401, 'invalid_token', { 'www-authenticate': 'Bearer error="invalid_token"' });
      return serve(request, env, ctx, caller);
    },
  },
  defaultHandler: { fetch: (request, env) => authorize(request, env as OAuthEnv) },
  authorizeEndpoint: AUTHORIZE_PATH,
  tokenEndpoint: TOKEN_PATH,
  clientRegistrationEndpoint: REGISTER_PATH,
  scopesSupported: [...SCOPES],
  accessTokenTTL: 3600,
  // The agent stays connected while it is used; a month idle and it must ask again.
  refreshTokenTTL: 365 * DAY,
  refreshTokenIdleTTL: 30 * DAY,
  resourceMetadata: { resource: RESOURCE, resource_name: 'OlhaOPosto' },
};
const provider = new OAuthProvider<OAuthEnv>(options);

export async function mcpFetch(request: Request, env: OAuthEnv, ctx: ExecutionContext): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (pathname === MCP_PATH) {
    const token = bearer(request);
    if (token) {
      const auth = await tokenUser(env.DB as unknown as TokenDb, token).catch(() => null);
      if (!auth) return jsonError(401, 'invalid_token', { 'www-authenticate': 'Bearer error="invalid_token"' });
      return serve(request, env, ctx, { user: auth.user, scopes: auth.scopes });
    }
    if (!request.headers.has('authorization')) {
      if (request.method !== 'POST') return serve(request, env, ctx, null);
      // Read the body once to see whether it calls a write tool.
      const text = await request.text();
      let body: unknown = null;
      try { body = JSON.parse(text); } catch { /* the handler answers the parse error */ }
      const again = new Request(request, { body: text });
      if (!wantsWrite(body)) return serve(again, env, ctx, null);
      // The provider's 401 names the metadata, so the client knows where to sign in.
      if (!env.OAUTH_KV) return serve(again, env, ctx, null);
      return provider.fetch(again, env, ctx);
    }
  }
  if (!env.OAUTH_KV) return jsonError(503, 'oauth_unavailable');
  return provider.fetch(request, env, ctx);
}

const HTML = (redirectOrigin: string | null): Record<string, string> => ({
  'content-type': 'text/html; charset=utf-8',
  // The approval redirects to the client: form-action must allow its origin.
  'content-security-policy':
    "default-src 'none'; style-src 'self'; font-src 'self'; script-src 'self'; img-src 'self'; " +
    `base-uri 'none'; form-action 'self'${redirectOrigin ? ` ${redirectOrigin}` : ''}; frame-ancestors 'none'`,
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'strict-transport-security': 'max-age=31536000',
  'cache-control': 'no-store',
});

function htmlResponse(lang: Lang, body: string, status: number, headers: Record<string, string>, extra?: Headers): Response {
  const h = new Headers({ ...headers, 'content-language': lang === 'pt' ? 'pt-PT' : 'en' });
  extra?.forEach((v, k) => {
    const key = k.toLowerCase();
    // Ours already says frame-ancestors 'none', and much more.
    if (key === 'content-security-policy') return;
    if (key === 'set-cookie') h.append(k, v);
    else h.set(k, v);
  });
  return new Response(body, { status, headers: h });
}

const plain = (status: number, pt: string, en: string) =>
  new Response(`${pt}\n${en}\n`, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });

function redirect(location: string, extra?: Headers): Response {
  const h = new Headers();
  extra?.forEach((v, k) => (k.toLowerCase() === 'set-cookie' ? h.append(k, v) : h.set(k, v)));
  h.set('location', location);
  h.set('cache-control', 'no-store');
  return new Response(null, { status: 302, headers: h });
}

function originOf(uri: string): string | null {
  try {
    const u = new URL(uri);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.origin : null;
  } catch {
    return null;
  }
}

// GET shows the consent page, POST takes the answer. Everything else that
// reaches the default handler is not ours.
async function authorize(request: Request, env: OAuthEnv): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname !== AUTHORIZE_PATH) return jsonError(404, 'not_found');
  const helpers = env.OAUTH_PROVIDER!;
  if (request.method === 'GET') {
    let authReq;
    try {
      authReq = await helpers.parseAuthRequest(request);
    } catch (err) {
      const to = (err as { redirectTo?: string }).redirectTo;
      if (to) return redirect(to);
      return plain(400, 'Pedido de autorização inválido.', 'Invalid authorisation request.');
    }
    const user = await currentUser(request, env).catch(() => null);
    if (!user) {
      // Back here after the OSM sign-in, with the same request.
      return redirect(`/auth/osm/login?next=${encodeURIComponent(url.pathname + url.search)}`);
    }
    const desc = await helpers.describeConsent(authReq);
    const consent = await helpers.beginConsent(authReq);
    const lang = consentLang(request.headers.get('accept-language'));
    const page = consentPage(lang, {
      clientName: desc.clientName, clientDomain: desc.clientDomain, redirectHost: desc.redirectHost,
      redirectIsLoopback: desc.redirectIsLoopback, requested: desc.scope,
    }, user, consent.handle);
    return htmlResponse(lang, page, 200, HTML(originOf(desc.redirectUri)), consent.headers);
  }
  if (request.method !== 'POST') return jsonError(405, 'method_not_allowed');
  if (!sameOrigin(request)) return plain(403, 'Pedido de outro site.', 'Cross-site request.');
  const form = await request.formData().catch(() => null);
  const handle = String(form?.get('handle') ?? '');
  if (!form || !handle) return plain(400, 'Pedido de autorização inválido.', 'Invalid authorisation request.');
  const user = await currentUser(request, env).catch(() => null);
  if (!user) return plain(401, 'A sessão terminou: volta à aplicação e liga outra vez.', 'Your session ended: go back to the application and connect again.');
  try {
    if (form.get('decision') !== 'approve') {
      const denied = await helpers.denyConsent(request, handle);
      return redirect(denied.redirectTo, denied.headers);
    }
    const scopes = chosenScopes(form, user.role);
    const approved = await helpers.approveConsent(request, handle, { scope: scopes });
    const desc = await helpers.describeConsent(approved.request).catch(() => null);
    const props: GrantProps = { userId: user.id, scopes };
    const { redirectTo } = await helpers.completeAuthorization({
      request: approved.request,
      userId: user.id,
      metadata: { client: desc?.clientName ?? approved.request.clientId },
      scope: scopes,
      props,
    });
    return redirect(redirectTo, approved.headers);
  } catch {
    return plain(400, 'O pedido expirou ou já foi usado: volta à aplicação e liga outra vez.', 'The request expired or was already used: go back to the application and connect again.');
  }
}

// The account page's "connected agents" (src/account.ts).
export function agentGrants(env: OAuthEnv): AgentGrants | undefined {
  if (!env.OAUTH_KV) return undefined;
  const api = () => getOAuthApi(options, env);
  return {
    async list(userId) {
      const out = [];
      let cursor: string | undefined;
      do {
        const page = await api().listUserGrants(userId, { cursor });
        for (const g of page.items) {
          out.push({
            id: g.id,
            client: typeof g.metadata?.client === 'string' ? g.metadata.client : g.clientId,
            scopes: g.scope,
            createdAt: new Date(g.createdAt * 1000).toISOString(),
          });
        }
        cursor = page.cursor;
      } while (cursor && out.length < 100);
      return out;
    },
    revoke: (grantId, userId) => api().revokeGrant(grantId, userId),
  };
}

// The cron: expired grants and tokens out of KV.
export async function purgeOAuth(env: OAuthEnv): Promise<void> {
  if (env.OAUTH_KV) await getOAuthApi(options, env).purgeExpiredData({ batchSize: 50 });
}
