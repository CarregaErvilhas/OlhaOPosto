/// <reference types="@cloudflare/workers-types" />
// Station aliases (re-keys): a station that left the NAP can be mapped to its
// replacement; the old id then answers 301 to the new station page
// (Docs/plan.md, *Mudanças de código (re-key)*).

import { currentUser, page, sameOrigin, type AuthEnv, type SessionUser } from './auth.ts';
import { BRAND, accountPath, esc, layout, stationPath, type Lang } from './pages.ts';
interface Env { DB: D1Database; }
import { canModerate } from './moderation.ts';



export async function getStationAlias(env: Env, oldId: string): Promise<string | null> {
  const row = await env.DB.prepare(
    `SELECT new_id FROM station_aliases WHERE old_id = ?`,
  ).bind(oldId).first() as any;
  return (row?.new_id as string) ?? null;
}

export interface MissingStation {
  id: string;
  name: string | null;
  operator: string | null;
  photo_count: number;
  alias: string | null;
}

export async function missingStationsWithPhotos(env: Env): Promise<MissingStation[]> {
  const { results } = await env.DB.prepare(
    `SELECT s.id, s.name, s.operator,
            (SELECT COUNT(*) FROM photos p WHERE p.station_id = s.id AND p.status IN ('pending', 'published', 'hidden')) AS photo_count,
            a.new_id AS alias
       FROM stations s
       LEFT JOIN station_aliases a ON a.old_id = s.id
      WHERE s.status = 'missing_from_nap'
        AND EXISTS (SELECT 1 FROM photos p WHERE p.station_id = s.id AND p.status IN ('pending', 'published', 'hidden'))
      ORDER BY s.id`,
  ).all() as any;
  return results as MissingStation[];
}

export const ALIAS_ACTION = '/admin/rekey';
export const aliasPath = (lang: Lang) => (lang === 'pt' ? '/admin/postos-fora-do-nap' : '/en/admin/stations-missing');
// Aliases kept for compatibility with alternate names.
export const aliasesPath = aliasPath;
export const rekeyPath = aliasPath;
export const missingStationsPath = aliasPath;

interface Stmt {
  bind(...values: unknown[]): Stmt;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes: number } }>;
}
const db = (env: Env) => env.DB as unknown as { prepare(sql: string): Stmt };

const T = {
  pt: {
    title: 'Postos fora do NAP',
    intro: 'Postos que deixaram de aparecer no NAP mas ainda têm fotos. Escreve o código do posto novo para o link antigo passar a responder 301.',
    empty: 'Nenhum posto fora do NAP com fotos.',
    station: 'Posto',
    photos: 'Fotos',
    alias: 'Alias actual',
    newCode: 'Código novo',
    save: 'Criar alias',
    forbidden: 'Esta página é só para moderadores e administradores.',
    back: 'Voltar à conta',
    ok: 'Alias criado.',
    errors: { forbidden: 'Não podes criar aliases.', bad: 'Pedido inválido.', missing: 'Posto novo não encontrado ou não está activo.', stale: 'Já existe um alias para este posto.', self: 'O código novo tem de ser diferente.' } as Record<string, string>,
  },
  en: {
    title: 'Stations missing from the NAP',
    intro: 'Stations that left the NAP but still have photos. Write the new station code so the old link answers 301.',
    empty: 'No missing stations with photos.',
    station: 'Station',
    photos: 'Photos',
    alias: 'Current alias',
    newCode: 'New code',
    save: 'Create alias',
    forbidden: 'This page is only for moderators and administrators.',
    back: 'Back to account',
    ok: 'Alias created.',
    errors: { forbidden: 'You cannot create aliases.', bad: 'Invalid request.', missing: 'New station not found or not active.', stale: 'An alias already exists for this station.', self: 'The new code must be different.' } as Record<string, string>,
  },
};

function forbiddenPage(lang: Lang): string {
  const t = T[lang];
  return layout({
    lang,
    title: `${t.title} · ${BRAND}`,
    description: t.title,
    noindex: true,
    body: `<div class="page-msg">\n<h1>${t.title}</h1>\n<p>${t.forbidden}</p>\n<p><a href="${accountPath(lang)}">${t.back}</a></p>\n</div>`,
  });
}

const redirect = (location: string, status = 302) =>
  new Response(null, { status, headers: { location, 'cache-control': 'no-store' } });

export async function aliasesHtml(lang: Lang, request: Request, env: Env & AuthEnv, headers: Record<string, string>): Promise<Response> {
  const user = await currentUser(request, env).catch(() => null);
  if (!user) return redirect(`/auth/osm/login?next=${encodeURIComponent(aliasPath(lang))}`);
  if (!canModerate(user.role)) return page(lang, forbiddenPage(lang), 403, headers);
  const rows = await missingStationsWithPhotos(env);
  const url = new URL(request.url);
  const ok = url.searchParams.get('ok') === '1';
  const error = url.searchParams.get('erro') ?? undefined;
  const t = T[lang];
  const parts: string[] = [`<h1>${t.title}</h1>`, `<p>${t.intro}</p>`];
  if (ok) parts.push(`<p class="notice" role="status">${t.ok}</p>`);
  const err = error ? t.errors[error] : undefined;
  if (err) parts.push(`<p class="notice" role="alert">${esc(err)}</p>`);
  if (rows.length === 0) parts.push(`<p>${t.empty}</p>`);
  else {
    const items = rows.map((r) => {
      const alias = r.alias ? `<span>${esc(r.alias)}</span>` : '—';
      return `<article class="alias-item">
<p><strong>${t.station}:</strong> <a href="${stationPath(lang, r.id)}">${esc(r.id)}</a>${r.name ? ` · ${esc(r.name)}` : ''}${r.operator ? ` · ${esc(r.operator)}` : ''}</p>
<p>${t.photos}: ${r.photo_count} · ${t.alias}: ${alias}</p>
<form method="post" action="${ALIAS_ACTION}" class="alias-form">
<input type="hidden" name="old" value="${esc(r.id)}">
<input type="hidden" name="lang" value="${lang}">
<label>${t.newCode} <input name="new" required maxlength="64"></label>
<button type="submit" class="button secondary">${t.save}</button>
</form>
</article>`;
    });
    parts.push(items.join('\n'));
  }
  parts.push(`<p><a href="${accountPath(lang)}">${t.back}</a></p>`);
  return page(lang, layout({
    lang,
    title: `${t.title} · ${BRAND}`,
    description: t.title,
    noindex: true,
    switchTo: { pt: aliasPath('pt'), en: aliasPath('en') },
    body: parts.join('\n'),
  }), 200, headers);
}

// Compatibility aliases for function names.
export const aliasHtml = aliasesHtml;
export const rekeyHtml = aliasesHtml;
export const missingStationsHtml = aliasesHtml;

export async function rekey(request: Request, env: Env & AuthEnv, now = new Date()): Promise<Response> {
  if (!sameOrigin(request)) return new Response('forbidden', { status: 403, headers: { 'cache-control': 'no-store' } });
  let form: FormData;
  try { form = await request.formData(); } catch { return new Response('bad request', { status: 400, headers: { 'cache-control': 'no-store' } }); }
  const lang: Lang = form.get('lang') === 'en' ? 'en' : 'pt';
  const back = (q: string) => redirect(`${aliasPath(lang)}?${q}`, 303);
  const user = await currentUser(request, env).catch(() => null);
  if (!user) return redirect(`/auth/osm/login?next=${encodeURIComponent(aliasPath(lang))}`, 303);
  if (!canModerate(user.role)) return new Response('forbidden', { status: 403, headers: { 'cache-control': 'no-store' } });
  const oldId = form.get('old');
  const newId = form.get('new');
  if (typeof oldId !== 'string' || typeof newId !== 'string') return back('erro=bad');
  const old = oldId.trim();
  const nw = newId.trim();
  if (!old || !nw) return back('erro=bad');
  if (old === nw) return back('erro=self');

  // old must exist and be missing from NAP
  const oldRow = await db(env).prepare(`SELECT status FROM stations WHERE id = ?`).bind(old).first<{ status: string }>();
  if (!oldRow || oldRow.status !== 'missing_from_nap') return back('erro=bad');

  const newRow = await db(env).prepare(`SELECT status FROM stations WHERE id = ?`).bind(nw).first<{ status: string }>();
  if (!newRow || (newRow.status !== 'active' && newRow.status !== 'missing_from_nap')) return back('erro=missing');

  const existing = await getStationAlias(env, old);
  if (existing) return back('erro=stale');

  try {
    await db(env).prepare(
      `INSERT INTO station_aliases (old_id, new_id, created_by, created_at) VALUES (?, ?, ?, ?)`,
    ).bind(old, nw, user.id, now.toISOString()).run();
  } catch {
    return back('erro=stale');
  }
  return back('ok=1');
}

// Compatibility aliases.
export const createAlias = rekey;
export const setAlias = rekey;
export const aliasAction = rekey;
