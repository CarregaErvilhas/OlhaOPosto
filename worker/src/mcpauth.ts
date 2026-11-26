// The parts of the MCP sign-in that do not need the Workers runtime, so the
// tests run them under Node: the consent page, the scopes a grant gets, who
// a grant or token belongs to now, and which anonymous calls must sign in.
// src/oauth.ts wires them to the OAuth provider and the transport.
import type { SessionUser } from './auth.ts';
import type { McpCaller } from './mcp.ts';
import { WRITE_TOOLS } from './mcp.ts';
import { accountPath, BRAND, esc, layout, privacyPath, termsPath, type Lang } from './pages.ts';
import { SCOPES, scopesFor, type Scope } from './tokens.ts';

interface Stmt {
  bind(...values: unknown[]): Stmt;
  first<T>(): Promise<T | null>;
}
export interface UserDb {
  prepare(sql: string): Stmt;
}

// What an OAuth grant stores (encrypted by the provider) and hands back on
// each request: who, and what the person ticked on the consent page. Never
// the role: that is read from D1 on every request, like the tokens.
export interface GrantProps {
  userId: string;
  scopes: string[];
}

export const AUTHORIZE_PATH = '/oauth/authorize';

// The scopes a caller may use now: what was granted, minus what the role lost.
export function liveScopes(granted: readonly string[], role: string): Scope[] {
  const allowed = scopesFor(role) as string[];
  return [...new Set(granted)].filter((s) => allowed.includes(s)) as Scope[];
}

export async function callerFromProps(db: UserDb, props: unknown): Promise<McpCaller | null> {
  const p = props as Partial<GrantProps> | null;
  if (!p || typeof p.userId !== 'string' || !Array.isArray(p.scopes)) return null;
  const user = await db.prepare('SELECT id, COALESCE(pseudonym, osm_name) AS name, role FROM users WHERE id = ?')
    .bind(p.userId).first<SessionUser>();
  return user ? { user, scopes: liveScopes(p.scopes.map(String), user.role) } : null;
}

// Is this JSON-RPC message (or batch) a call to a tool that writes? Those get
// the OAuth challenge when nobody signed in.
export function wantsWrite(body: unknown): boolean {
  const msgs = Array.isArray(body) ? body : [body];
  return msgs.some((m) => {
    if (!m || typeof m !== 'object') return false;
    const r = m as { method?: unknown; params?: { name?: unknown } };
    return r.method === 'tools/call' && typeof r.params?.name === 'string' && Object.hasOwn(WRITE_TOOLS, r.params.name);
  });
}

export const consentLang = (acceptLanguage: string | null): Lang =>
  /^\s*en\b/i.test(acceptLanguage ?? '') ? 'en' : 'pt';

// The scopes ticked on the form, kept to what the role allows.
export function chosenScopes(form: FormData, role: string): Scope[] {
  return liveScopes(form.getAll('scope').map(String), role);
}

// Ticked by default: what the client asked for, or sending photos when it
// asked for nothing we know.
export function defaultScopes(requested: readonly string[], role: string): Scope[] {
  const asked = liveScopes(requested.filter((s) => (SCOPES as readonly string[]).includes(s)), role);
  return asked.length ? asked : ['photos:write'];
}

export interface ConsentView {
  clientName: string;
  clientDomain?: string;
  redirectHost: string;
  redirectIsLoopback: boolean;
  requested: string[];
}

const T = {
  pt: {
    title: 'Ligar um agente à tua conta',
    intro: (name: string) => `A aplicação <strong lang="">${name}</strong> quer usar o ${BRAND} em teu nome, pelo servidor MCP.`,
    unverified: 'O nome é o que a aplicação diz de si própria; não foi verificado.',
    domain: (d: string) => `Domínio verificado da aplicação: <strong>${d}</strong>.`,
    redirect: (h: string) => `Depois de autorizares, voltas para <strong>${h}</strong>.`,
    loopback: 'Atenção: esse endereço é um programa neste computador. Só autorizes se fores tu a ligá-lo agora.',
    signedIn: (n: string) => `Entraste como <strong lang="">${n}</strong>.`,
    readAll: 'Ler postos, fotos e o ranking não precisa de autorização. O agente vai poder também:',
    scope: {
      'photos:write': 'enviar fotos e propor postos novos, que passam pela moderação como as tuas',
      'selections:write': 'escolher a foto principal de um posto ou tomada',
    } as Record<Scope, string>,
    rules: `O agente age como tu: com o teu papel, os teus limites e o teu nome nas fotos, e segue as <a href="${termsPath('pt')}">condições de utilização</a>. Podes desligá-lo a qualquer momento na <a href="${accountPath('pt')}#h-agents">tua conta</a>. O que guardamos está na <a href="${privacyPath('pt')}">política de privacidade</a>.`,
    approve: 'Autorizar',
    deny: 'Recusar',
  },
  en: {
    title: 'Connect an agent to your account',
    intro: (name: string) => `The application <strong lang="">${name}</strong> wants to use ${BRAND} on your behalf, through the MCP server.`,
    unverified: 'The name is what the application says about itself; it has not been verified.',
    domain: (d: string) => `The application’s verified domain: <strong>${d}</strong>.`,
    redirect: (h: string) => `After you authorise it, you go back to <strong>${h}</strong>.`,
    loopback: 'Careful: that address is a program on this computer. Only authorise it if you are connecting it right now.',
    signedIn: (n: string) => `Signed in as <strong lang="">${n}</strong>.`,
    readAll: 'Reading stations, photos and the ranking needs no authorisation. The agent will also be able to:',
    scope: {
      'photos:write': 'send photos and propose new stations, moderated like yours',
      'selections:write': 'choose the main photo of a station or socket',
    } as Record<Scope, string>,
    rules: `The agent acts as you: with your role, your limits and your name on the photos, and follows the <a href="${termsPath('en')}">terms of use</a>. You can disconnect it at any time on <a href="${accountPath('en')}#h-agents">your account</a>. What we keep is in the <a href="${privacyPath('en')}">privacy policy</a>.`,
    approve: 'Authorise',
    deny: 'Decline',
  },
};

export function consentPage(lang: Lang, v: ConsentView, user: SessionUser, handle: string): string {
  const t = T[lang];
  const allowed = scopesFor(user.role);
  const ticked = defaultScopes(v.requested, user.role);
  const boxes = allowed.map((s, i) =>
    `<p class="check"><input type="checkbox" id="scope-${i}" name="scope" value="${s}"${ticked.includes(s) ? ' checked' : ''}> <label for="scope-${i}">${t.scope[s]} (<code>${s}</code>)</label></p>`,
  ).join('\n');
  const body = `<div class="page-msg prose">
<h1>${t.title}</h1>
<p>${t.intro(esc(v.clientName))}</p>
<p class="hint">${v.clientDomain ? t.domain(esc(v.clientDomain)) : t.unverified}</p>
<p>${t.redirect(esc(v.redirectHost))}</p>
${v.redirectIsLoopback ? `<p class="notice" role="alert">${t.loopback}</p>` : ''}
<p>${t.signedIn(esc(user.name))}</p>
<form method="post" action="${AUTHORIZE_PATH}">
<input type="hidden" name="handle" value="${esc(handle)}">
<input type="hidden" name="lang" value="${lang}">
<fieldset><legend>${t.readAll}</legend>
${boxes}
</fieldset>
<p>${t.rules}</p>
<p><button type="submit" name="decision" value="approve" class="button">${t.approve}</button>
<button type="submit" name="decision" value="deny" class="button secondary">${t.deny}</button></p>
</form>
</div>`;
  return layout({ lang, title: t.title, description: t.title, noindex: true, body });
}

// The account page's list of connected agents (src/account.ts).
export interface AgentGrant {
  id: string;
  client: string;
  scopes: string[];
  createdAt: string;
}

export interface AgentGrants {
  list(userId: string): Promise<AgentGrant[]>;
  revoke(grantId: string, userId: string): Promise<void>;
}
