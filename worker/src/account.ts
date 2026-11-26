// The account page (/conta, /en/account): who is signed in, the name their
// photos are credited with, their points and medal, leaving the ranking, and
// their API tokens and the agents connected to the MCP server. The page itself is in
// pages.ts (accountPage); this file reads D1 for the signed-in parts and
// handles the one POST they share (ACCOUNT_ACTION).
import { currentUser, loginEnabled, page, sameOrigin, type AuthEnv } from './auth.ts';
import { accountPage, accountPath, esc, medalBadge, rankingPath, termsPath, type Lang } from './pages.ts';
import {
  MAX_LEN, MIN_LEN, changeCredit, creditState, nextChangeAt, syncCredits, type CreditDb,
} from './credit.ts';
import type { PublishEnv } from './publish.ts';
import { MEDALS, myPoints, setRankingOptOut, type MyPoints, type PointsDb } from './points.ts';
import type { AgentGrant, AgentGrants } from './mcpauth.ts';
import {
  MAX_ACTIVE, TTL_DAYS, createToken, listTokens, parseNewToken, revokeToken, scopesFor, type TokenDb, type TokenRow,
} from './tokens.ts';

export const ACCOUNT_ACTION = '/conta/acao';

const T = {
  pt: {
    creditH: 'Nome a mostrar',
    creditIntro: 'É o crédito das tuas fotos: vai com elas nas páginas dos postos, no ranking, no Panoramax e nos metadados dos links estáticos. Por defeito é o teu nome no OpenStreetMap.',
    creditLabel: 'Nome a mostrar',
    creditHint: `De ${MIN_LEN} a ${MAX_LEN} caracteres: letras, números, espaços e pontuação simples, sem links. Não pode ser igual ao nome de outra pessoa (ignorando maiúsculas e acentos). Podes mudar uma vez por dia; as fotos já publicadas atualizam-se nas horas seguintes.`,
    creditSave: 'Guardar o nome',
    creditReset: (osm: string) => `Voltar ao nome OSM (<span lang="">${esc(osm)}</span>)`,
    creditNext: (at: string) => `Podes voltar a mudar a partir de ${at} (UTC).`,
    pointsH: 'Pontos',
    points: (p: MyPoints) => `${p.total} ${p.total === 1 ? 'ponto' : 'pontos'} no total, ${p.month} este mês, com ${p.photos} ${p.photos === 1 ? 'foto aprovada' : 'fotos aprovadas'}.`,
    nextMedal: (n: number) => `Faltam ${n} pontos para a próxima medalha.`,
    rankingLink: 'Ver o ranking',
    inRanking: 'Apareces no ranking com o teu nome.',
    outRanking: 'Não apareces no ranking. As tuas fotos continuam a contar pontos.',
    leave: 'Sair do ranking',
    join: 'Voltar ao ranking',
    tokensH: 'Tokens de API',
    tokensIntro: `Para enviar fotos ou escolher fotos principais a partir de um programa, com <code>Authorization: Bearer &lt;token&gt;</code>. O token age em teu nome, com o teu papel e os teus limites, e segue as <a href="${termsPath('pt')}">condições de utilização</a>. Ler a API não precisa de token.`,
    none: 'Ainda não tens tokens.',
    name: 'Nome',
    nameHint: 'Para saberes onde o usas, por exemplo «script do telemóvel».',
    scopes: 'Pode',
    scope: { 'photos:write': 'enviar fotos (<code>photos:write</code>)', 'selections:write': 'escolher fotos principais (<code>selections:write</code>)' } as Record<string, string>,
    days: 'Validade',
    daysOpt: (d: number) => (d === 365 ? '1 ano' : `${d} dias`),
    create: 'Criar token',
    revoke: 'Revogar',
    created: 'Criado em',
    expires: 'expira em',
    used: 'último uso',
    never: 'nunca usado',
    shownOnce: 'O teu token novo. Copia-o agora: não volta a aparecer.',
    max: `Podes ter até ${MAX_ACTIVE} tokens ativos.`,
    agentsH: 'Agentes ligados (MCP)',
    agentsIntro: `Assistentes de IA que autorizaste a usar o servidor MCP (<code>/mcp</code>) em teu nome, com o teu papel e os teus limites. Ler não precisa de autorização; desligar um agente apaga a autorização e os tokens dele.`,
    agentsNone: 'Nenhum agente ligado.',
    agentSince: 'Ligado em',
    disconnect: 'Desligar',
    ok: {
      agent_revoked: 'Agente desligado.',
      revoked: 'Token revogado.', ranking_out: 'Saíste do ranking.', ranking_in: 'Voltaste ao ranking.',
      credit: 'Nome guardado. As fotos já publicadas atualizam-se nas horas seguintes.',
    } as Record<string, string>,
    errors: {
      credit_length: `O nome tem de ter de ${MIN_LEN} a ${MAX_LEN} caracteres.`,
      credit_chars: 'O nome só pode ter letras, números, espaços e pontuação simples (. , \' ( ) ! ? & + _ -).',
      credit_url: 'O nome não pode ser um link nem um endereço.',
      credit_reserved: 'Esse nome está reservado. Escolhe outro.',
      credit_taken: 'Esse nome já é de outra pessoa. Escolhe outro.',
      credit_daily: 'Já mudaste o nome nas últimas 24 horas. Tenta mais tarde.',
      credit_same: 'Esse já é o teu nome.',
      name: 'Dá um nome ao token, até 60 caracteres.',
      scope: 'Escolhe o que o token pode fazer.',
      days: 'Escolhe a validade.',
      too_many: `Já tens ${MAX_ACTIVE} tokens ativos. Revoga um antes de criar outro.`,
      stale: 'Esse token já não existe.',
    } as Record<string, string>,
  },
  en: {
    creditH: 'Display name',
    creditIntro: 'It is the credit on your photos: it goes with them on the station pages, the ranking, Panoramax and in the metadata of the static links. By default it is your OpenStreetMap name.',
    creditLabel: 'Display name',
    creditHint: `${MIN_LEN} to ${MAX_LEN} characters: letters, digits, spaces and simple punctuation, no links. It cannot be the same as someone else’s name (ignoring case and accents). You can change it once a day; photos already published are updated over the next few hours.`,
    creditSave: 'Save name',
    creditReset: (osm: string) => `Go back to the OSM name (<span lang="">${esc(osm)}</span>)`,
    creditNext: (at: string) => `You can change it again from ${at} (UTC).`,
    pointsH: 'Points',
    points: (p: MyPoints) => `${p.total} ${p.total === 1 ? 'point' : 'points'} in total, ${p.month} this month, from ${p.photos} approved ${p.photos === 1 ? 'photo' : 'photos'}.`,
    nextMedal: (n: number) => `${n} points to the next medal.`,
    rankingLink: 'See the ranking',
    inRanking: 'You appear in the ranking with your name.',
    outRanking: 'You do not appear in the ranking. Your photos still earn points.',
    leave: 'Leave the ranking',
    join: 'Rejoin the ranking',
    tokensH: 'API tokens',
    tokensIntro: `To upload photos or choose main photos from a program, with <code>Authorization: Bearer &lt;token&gt;</code>. The token acts on your behalf, with your role and limits, and follows the <a href="${termsPath('en')}">terms of use</a>. Reading the API needs no token.`,
    none: 'You have no tokens yet.',
    name: 'Name',
    nameHint: 'So you know where you use it, for example “phone script”.',
    scopes: 'Can',
    scope: { 'photos:write': 'upload photos (<code>photos:write</code>)', 'selections:write': 'choose main photos (<code>selections:write</code>)' } as Record<string, string>,
    days: 'Valid for',
    daysOpt: (d: number) => (d === 365 ? '1 year' : `${d} days`),
    create: 'Create token',
    revoke: 'Revoke',
    created: 'Created on',
    expires: 'expires on',
    used: 'last used',
    never: 'never used',
    shownOnce: 'Your new token. Copy it now: it will not be shown again.',
    max: `You can have up to ${MAX_ACTIVE} active tokens.`,
    agentsH: 'Connected agents (MCP)',
    agentsIntro: `AI assistants you authorised to use the MCP server (<code>/mcp</code>) on your behalf, with your role and your limits. Reading needs no authorisation; disconnecting an agent deletes its authorisation and its tokens.`,
    agentsNone: 'No agents connected.',
    agentSince: 'Connected on',
    disconnect: 'Disconnect',
    ok: {
      agent_revoked: 'Agent disconnected.',
      revoked: 'Token revoked.', ranking_out: 'You left the ranking.', ranking_in: 'You are back in the ranking.',
      credit: 'Name saved. Photos already published are updated over the next few hours.',
    } as Record<string, string>,
    errors: {
      credit_length: `The name must be ${MIN_LEN} to ${MAX_LEN} characters long.`,
      credit_chars: 'The name can only have letters, digits, spaces and simple punctuation (. , \' ( ) ! ? & + _ -).',
      credit_url: 'The name cannot be a link or an address.',
      credit_reserved: 'That name is reserved. Choose another.',
      credit_taken: 'That name already belongs to someone else. Choose another.',
      credit_daily: 'You changed your name in the last 24 hours. Try again later.',
      credit_same: 'That is already your name.',
      name: 'Give the token a name, up to 60 characters.',
      scope: 'Choose what the token can do.',
      days: 'Choose how long it lasts.',
      too_many: `You already have ${MAX_ACTIVE} active tokens. Revoke one before creating another.`,
      stale: 'That token no longer exists.',
    } as Record<string, string>,
  },
};

const day = (iso: string) => esc(iso.slice(0, 10));
const hidden = (name: string, value: string) => `<input type="hidden" name="${name}" value="${esc(value)}">`;

interface CreditView {
  osm_name: string;
  pseudonym: string | null;
  pseudonym_changed_at: string | null;
}

function creditSection(lang: Lang, me: CreditView, now: Date): string {
  const t = T[lang];
  const next = nextChangeAt(me, now);
  const wait = next ? `<p class="hint">${t.creditNext(esc(next.toISOString().slice(0, 16).replace('T', ' ')))}</p>` : '';
  const off = next ? ' disabled' : '';
  return `<section class="card account-section" aria-labelledby="h-credit">
<h2 id="h-credit">${t.creditH}</h2>
<p>${t.creditIntro}</p>
<form method="post" action="${ACCOUNT_ACTION}">${hidden('lang', lang)}${hidden('action', 'set_credit')}
<label for="credit-name">${t.creditLabel}</label>
<input id="credit-name" name="credit" required minlength="${MIN_LEN}" maxlength="${MAX_LEN}" autocomplete="nickname" spellcheck="false" lang=""
  value="${esc(me.pseudonym ?? me.osm_name)}" aria-describedby="credit-hint"${off}>
<p id="credit-hint" class="hint">${t.creditHint}</p>
${wait}<p><button type="submit" class="button"${off}>${t.creditSave}</button></p>
</form>
${me.pseudonym !== null ? `<form method="post" action="${ACCOUNT_ACTION}">${hidden('lang', lang)}${hidden('action', 'reset_credit')}
<button type="submit" class="button secondary"${off}>${t.creditReset(me.osm_name)}</button></form>` : ''}
</section>`;
}

function pointsSection(lang: Lang, p: MyPoints): string {
  const t = T[lang];
  const next = [...MEDALS].reverse().find((m) => p.total < m.min);
  return `<section class="card account-section" aria-labelledby="h-points">
<h2 id="h-points">${t.pointsH} ${medalBadge(lang, p.medal)}</h2>
<p>${t.points(p)}</p>
${next ? `<p class="hint">${t.nextMedal(next.min - p.total)}</p>` : ''}
<p>${p.optOut ? t.outRanking : t.inRanking} <a href="${rankingPath(lang)}">${t.rankingLink}</a>.</p>
<form method="post" action="${ACCOUNT_ACTION}">${hidden('lang', lang)}${hidden('action', p.optOut ? 'ranking_in' : 'ranking_out')}
<button type="submit" class="button secondary">${p.optOut ? t.join : t.leave}</button></form>
</section>`;
}

function tokenItem(lang: Lang, r: TokenRow): string {
  const t = T[lang];
  return `<li class="token-item">
<div><strong lang="">${esc(r.name)}</strong> <code>${esc(r.prefix)}…</code></div>
<div class="hint">${r.scopes.split(' ').map((s) => esc(s)).join(', ')} · ${t.created} ${day(r.created_at)}, ${t.expires} ${day(r.expires_at)} · ${r.last_used_at ? `${t.used} ${day(r.last_used_at)}` : t.never}</div>
<form method="post" action="${ACCOUNT_ACTION}">${hidden('lang', lang)}${hidden('action', 'revoke_token')}${hidden('token', r.id)}
<button type="submit" class="button secondary">${t.revoke}</button></form>
</li>`;
}

function tokensSection(lang: Lang, role: string, rows: TokenRow[], fresh?: string): string {
  const t = T[lang];
  const scopes = scopesFor(role);
  const parts = [
    `<section class="card account-section" aria-labelledby="h-tokens">`,
    `<h2 id="h-tokens">${t.tokensH}</h2>`,
    `<p>${t.tokensIntro}</p>`,
  ];
  if (fresh) {
    parts.push(`<div class="notice" role="status"><p>${t.shownOnce}</p><p><code class="token-new">${esc(fresh)}</code></p></div>`);
  }
  parts.push(rows.length ? `<ul class="plain-list tokens">${rows.map((r) => tokenItem(lang, r)).join('\n')}</ul>` : `<p>${t.none}</p>`);
  if (rows.length < MAX_ACTIVE) {
    parts.push(`<form method="post" action="${ACCOUNT_ACTION}" class="token-form">${hidden('lang', lang)}${hidden('action', 'create_token')}
<label for="token-name">${t.name}</label>
<input id="token-name" name="name" required maxlength="60" autocomplete="off" aria-describedby="token-name-hint">
<p id="token-name-hint" class="hint">${t.nameHint}</p>
<fieldset><legend>${t.scopes}</legend>
${scopes.map((s, i) => `<p class="check"><input type="checkbox" id="scope-${i}" name="scope" value="${s}"${s === 'photos:write' ? ' checked' : ''}> <label for="scope-${i}">${t.scope[s]}</label></p>`).join('\n')}
</fieldset>
<label for="token-days">${t.days}</label>
<select id="token-days" name="days">${TTL_DAYS.map((d) => `<option value="${d}"${d === 90 ? ' selected' : ''}>${t.daysOpt(d)}</option>`).join('')}</select>
<p><button type="submit" class="button">${t.create}</button></p>
</form>`);
  } else {
    parts.push(`<p class="hint">${t.max}</p>`);
  }
  parts.push('</section>');
  return parts.join('\n');
}

function agentsSection(lang: Lang, rows: AgentGrant[]): string {
  const t = T[lang];
  const item = (g: AgentGrant) => `<li class="token-item">
<div><strong lang="">${esc(g.client)}</strong></div>
<div class="hint">${g.scopes.map((s) => `<code>${esc(s)}</code>`).join(', ') || '—'} · ${t.agentSince} ${day(g.createdAt)}</div>
<form method="post" action="${ACCOUNT_ACTION}">${hidden('lang', lang)}${hidden('action', 'revoke_grant')}${hidden('grant', g.id)}
<button type="submit" class="button secondary">${t.disconnect}</button></form>
</li>`;
  return `<section class="card account-section" aria-labelledby="h-agents">
<h2 id="h-agents">${t.agentsH}</h2>
<p>${t.agentsIntro}</p>
${rows.length ? `<ul class="plain-list tokens">${rows.map(item).join('\n')}</ul>` : `<p>${t.agentsNone}</p>`}
</section>`;
}

interface Notes {
  ok?: string;
  error?: string;
  fresh?: string;
}

async function render(
  lang: Lang, request: Request, env: AuthEnv, headers: Record<string, string>, notes: Notes, status = 200, now = new Date(),
  agents?: AgentGrants,
) {
  const enabled = loginEnabled(env);
  // A D1 hiccup (or a missing migration) reads as signed out, never as a 500.
  const user = enabled ? await currentUser(request, env).catch(() => null) : null;
  let sections: string | undefined;
  if (user) {
    const t = T[lang];
    const db = env.DB as unknown as PointsDb & TokenDb & CreditDb;
    const [credit, points, tokens, grants] = await Promise.all([
      creditState(db, user.id).catch(() => null),
      myPoints(db, user.id).catch(() => null),
      listTokens(db, user.id).catch(() => null),
      agents ? agents.list(user.id).catch(() => null) : Promise.resolve(null),
    ]);
    const msgs = [
      notes.ok && t.ok[notes.ok] ? `<p class="notice" role="status">${t.ok[notes.ok]}</p>` : '',
      notes.error && t.errors[notes.error] ? `<p class="notice" role="alert">${t.errors[notes.error]}</p>` : '',
    ].join('');
    sections = msgs + (credit ? creditSection(lang, credit, now) : '') + (points ? pointsSection(lang, points) : '') + (tokens ? tokensSection(lang, user.role, tokens, notes.fresh) : '')
      + (grants ? agentsSection(lang, grants) : '');
  }
  const loginError = notes.error && !user ? notes.error : undefined;
  return page(lang, accountPage(lang, { user, enabled, error: loginError, sections }), status, headers);
}

// `agents`: the OAuth grants of the MCP server (src/oauth.ts), when OAuth is on.
export async function accountHtml(
  lang: Lang, request: Request, env: AuthEnv, headers: Record<string, string>, now = new Date(), agents?: AgentGrants,
) {
  const q = new URL(request.url).searchParams;
  return render(lang, request, env, headers, { ok: q.get('ok') ?? undefined, error: q.get('erro') ?? undefined }, 200, now, agents);
}

const back = (lang: Lang, q: string, anchor = 'h-tokens') =>
  new Response(null, { status: 303, headers: { location: `${accountPath(lang)}?${q}#${anchor}`, 'cache-control': 'no-store' } });

// POST /conta/acao: change the credit, create or revoke a token, leave or
// rejoin the ranking. Only from our own pages (sameOrigin).
export async function accountAction(
  request: Request, env: PublishEnv, headers: Record<string, string>,
  ctx?: { waitUntil(p: Promise<unknown>): void }, now = new Date(), fetcher: typeof fetch = fetch, agents?: AgentGrants,
) {
  if (!sameOrigin(request)) return new Response('forbidden', { status: 403, headers: { 'cache-control': 'no-store' } });
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return new Response('bad request', { status: 400, headers: { 'cache-control': 'no-store' } });
  }
  const lang: Lang = form.get('lang') === 'en' ? 'en' : 'pt';
  const user = await currentUser(request, env).catch(() => null);
  if (!user) return new Response(null, { status: 303, headers: { location: `/auth/osm/login?next=${encodeURIComponent(accountPath(lang))}` } });
  const db = env.DB as unknown as PointsDb & TokenDb;
  const action = form.get('action');
  if (action === 'set_credit' || action === 'reset_credit') {
    const r = await changeCredit(env.DB as unknown as CreditDb, user.id, action === 'set_credit' ? form.get('credit') ?? '' : null, now);
    if (typeof r === 'string') return back(lang, `erro=${r}`, 'h-credit');
    // The copies and the Panoramax tags: a first batch now, the rest by the cron.
    ctx?.waitUntil(syncCredits(env, fetcher));
    return back(lang, 'ok=credit', 'h-credit');
  }
  if (action === 'ranking_out' || action === 'ranking_in') {
    await setRankingOptOut(db, user.id, action === 'ranking_out');
    return back(lang, `ok=${action}`, 'h-points');
  }
  if (action === 'revoke_token') {
    const ok = await revokeToken(db, user.id, String(form.get('token') ?? ''), now);
    return back(lang, ok ? 'ok=revoked' : 'erro=stale');
  }
  if (action === 'revoke_grant' && agents) {
    // revokeGrant only touches a grant of this user.
    const id = String(form.get('grant') ?? '');
    const ok = /^[A-Za-z0-9_-]{1,64}$/.test(id) && await agents.revoke(id, user.id).then(() => true, () => false);
    return back(lang, ok ? 'ok=agent_revoked' : 'erro=stale', 'h-agents');
  }
  if (action === 'create_token') {
    const t = parseNewToken(form, user.role);
    if (typeof t === 'string') return back(lang, `erro=${t}`);
    const made = await createToken(db, user.id, t, now);
    if (made === 'too_many') return back(lang, 'erro=too_many');
    // The token goes in this response only: never in a URL, a log or a redirect.
    return render(lang, request, env, headers, { fresh: made.token }, 200, now, agents);
  }
  return back(lang, 'erro=bad');
}
