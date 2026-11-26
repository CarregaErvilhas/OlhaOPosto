// The account page (/conta, /en/account): who is signed in, their points and
// medal, leaving the ranking, and their API tokens. The page itself is in
// pages.ts (accountPage); this file reads D1 for the signed-in parts and
// handles the one POST they share (ACCOUNT_ACTION).
import { currentUser, loginEnabled, page, sameOrigin, type AuthEnv } from './auth.ts';
import { accountPage, accountPath, esc, medalBadge, rankingPath, termsPath, type Lang } from './pages.ts';
import { MEDALS, myPoints, setRankingOptOut, type MyPoints, type PointsDb } from './points.ts';
import {
  MAX_ACTIVE, TTL_DAYS, createToken, listTokens, parseNewToken, revokeToken, scopesFor, type TokenDb, type TokenRow,
} from './tokens.ts';

export const ACCOUNT_ACTION = '/conta/acao';

const T = {
  pt: {
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
    ok: { revoked: 'Token revogado.', ranking_out: 'Saíste do ranking.', ranking_in: 'Voltaste ao ranking.' } as Record<string, string>,
    errors: {
      name: 'Dá um nome ao token, até 60 caracteres.',
      scope: 'Escolhe o que o token pode fazer.',
      days: 'Escolhe a validade.',
      too_many: `Já tens ${MAX_ACTIVE} tokens ativos. Revoga um antes de criar outro.`,
      stale: 'Esse token já não existe.',
    } as Record<string, string>,
  },
  en: {
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
    ok: { revoked: 'Token revoked.', ranking_out: 'You left the ranking.', ranking_in: 'You are back in the ranking.' } as Record<string, string>,
    errors: {
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

interface Notes {
  ok?: string;
  error?: string;
  fresh?: string;
}

async function render(lang: Lang, request: Request, env: AuthEnv, headers: Record<string, string>, notes: Notes, status = 200) {
  const enabled = loginEnabled(env);
  // A D1 hiccup (or a missing migration) reads as signed out, never as a 500.
  const user = enabled ? await currentUser(request, env).catch(() => null) : null;
  let sections: string | undefined;
  if (user) {
    const t = T[lang];
    const db = env.DB as unknown as PointsDb & TokenDb;
    const [points, tokens] = await Promise.all([
      myPoints(db, user.id).catch(() => null),
      listTokens(db, user.id).catch(() => null),
    ]);
    const msgs = [
      notes.ok && t.ok[notes.ok] ? `<p class="notice" role="status">${t.ok[notes.ok]}</p>` : '',
      notes.error && t.errors[notes.error] ? `<p class="notice" role="alert">${t.errors[notes.error]}</p>` : '',
    ].join('');
    sections = msgs + (points ? pointsSection(lang, points) : '') + (tokens ? tokensSection(lang, user.role, tokens, notes.fresh) : '');
  }
  const loginError = notes.error && !user ? notes.error : undefined;
  return page(lang, accountPage(lang, { user, enabled, error: loginError, sections }), status, headers);
}

export async function accountHtml(lang: Lang, request: Request, env: AuthEnv, headers: Record<string, string>) {
  const q = new URL(request.url).searchParams;
  return render(lang, request, env, headers, { ok: q.get('ok') ?? undefined, error: q.get('erro') ?? undefined });
}

const back = (lang: Lang, q: string, anchor = 'h-tokens') =>
  new Response(null, { status: 303, headers: { location: `${accountPath(lang)}?${q}#${anchor}`, 'cache-control': 'no-store' } });

// POST /conta/acao: create or revoke a token, leave or rejoin the ranking.
export async function accountAction(request: Request, env: AuthEnv, headers: Record<string, string>, now = new Date()) {
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
  if (action === 'ranking_out' || action === 'ranking_in') {
    await setRankingOptOut(db, user.id, action === 'ranking_out');
    return back(lang, `ok=${action}`, 'h-points');
  }
  if (action === 'revoke_token') {
    const ok = await revokeToken(db, user.id, String(form.get('token') ?? ''), now);
    return back(lang, ok ? 'ok=revoked' : 'erro=stale');
  }
  if (action === 'create_token') {
    const t = parseNewToken(form, user.role);
    if (typeof t === 'string') return back(lang, `erro=${t}`);
    const made = await createToken(db, user.id, t, now);
    if (made === 'too_many') return back(lang, 'erro=too_many');
    // The token goes in this response only: never in a URL, a log or a redirect.
    return render(lang, request, env, headers, { fresh: made.token });
  }
  return back(lang, 'erro=bad');
}
