/// <reference types="@cloudflare/workers-types" />
// Station aliases (re-keys): a station that left the NAP can be mapped to its
// replacement; the old id then answers 301 to the new station page
// (Docs/plan.md, *Mudanças de código (re-key)*). A station under construction
// that the import could not merge on its own is merged here by hand: the
// same statements as the import (src/merge.ts), photos included.

import { currentUser, page, sameOrigin, type AuthEnv, type SessionUser } from './auth.ts';
import { BRAND, accountPath, esc, layout, stationPath, type Lang } from './pages.ts';
interface Env { DB: D1Database; }
import { canModerate } from './moderation.ts';
import { MERGE_SQL, mergeBinds } from './merge.ts';
import { distanceM } from './types.ts';



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
  source: string;
  status: string;
  // A NAP station that may be this one under construction: same OSM element,
  // one of its codes, or less than SUGGEST_M away.
  suggest: string | null;
}

export const SUGGEST_M = 60;
const WITH_PHOTOS = `EXISTS (SELECT 1 FROM photos p WHERE p.station_id = s.id AND p.origin = 'olhaoposto' AND p.status IN ('pending', 'published', 'hidden'))`;

// The NAP station a station under construction probably became, if any.
async function suggestion(env: Env, r: { osm_ref: string | null; codes: string | null; lat: number; lon: number }): Promise<string | null> {
  const codes = (r.codes ?? '').split(' ').filter(Boolean);
  const d = 0.001;
  const { results } = await db(env).prepare(
    // The box alone, so the stations_lat_lon index does the work; the same
    // OSM element is scored below (a NAP station linked to it is this close).
    `SELECT id, code, osm_ref, lat, lon FROM stations
      WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ? AND source = 'nap' AND status = 'active'`,
  ).bind(r.lat - d, r.lat + d, r.lon - d * 1.3, r.lon + d * 1.3)
    .all<{ id: string; code: string | null; osm_ref: string | null; lat: number; lon: number }>();
  const score = (n: (typeof results)[number]) =>
    (n.osm_ref && n.osm_ref === r.osm_ref ? 2 : 0) + (n.code && codes.includes(n.code) ? 1 : 0);
  const near = results
    .map((n) => ({ ...n, score: score(n), dist: distanceM(r.lat, r.lon, n.lat, n.lon) }))
    .filter((n) => n.score > 0 || n.dist <= SUGGEST_M)
    .sort((a, b) => b.score - a.score || a.dist - b.dist);
  return near[0]?.id ?? null;
}

// Stations gone from the NAP with photos, and stations under construction
// with photos that the import did not merge: gone from OSM, or with a NAP
// station that looks like them.
export async function missingStationsWithPhotos(env: Env): Promise<MissingStation[]> {
  const { results } = await db(env).prepare(
    `SELECT s.id, s.name, s.operator, s.source, s.status, s.osm_ref, s.codes, s.lat, s.lon,
            (SELECT COUNT(*) FROM photos p WHERE p.station_id = s.id AND p.origin = 'olhaoposto' AND p.status IN ('pending', 'published', 'hidden')) AS photo_count,
            a.new_id AS alias
       FROM stations s
       LEFT JOIN station_aliases a ON a.old_id = s.id
      WHERE (s.status = 'missing_from_nap' OR (s.source = 'osm' AND s.status IN ('active', 'missing_from_osm')))
        AND ${WITH_PHOTOS}
      ORDER BY s.id`,
  ).all<Omit<MissingStation, 'suggest'> & { osm_ref: string | null; codes: string | null; lat: number; lon: number }>();
  const out: MissingStation[] = [];
  for (const r of results) {
    const suggest = r.source === 'osm' ? await suggestion(env, r) : null;
    // Still under construction and nothing in the NAP yet: nothing to do.
    if (r.source === 'osm' && r.status === 'active' && !suggest) continue;
    out.push({ id: r.id, name: r.name, operator: r.operator, photo_count: r.photo_count, alias: r.alias, source: r.source, status: r.status, suggest });
  }
  return out;
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
    intro: 'Postos que deixaram de aparecer no NAP mas ainda têm fotos, e postos em construção com fotos que o import não juntou sozinho a um posto do NAP. Escreve o código do posto novo para o link antigo passar a responder 301. Num posto em construção, as fotos passam também para o posto do NAP.',
    building: 'Em construção (OSM)',
    buildingGone: 'Fora da lista de obras do OSM',
    suggest: 'Sugestão',
    merge: 'Juntar ao posto do NAP',
    empty: 'Nenhum posto fora do NAP com fotos.',
    station: 'Posto',
    photos: 'Fotos',
    alias: 'Alias actual',
    newCode: 'Código novo',
    save: 'Criar alias',
    forbidden: 'Esta página é só para moderadores e administradores.',
    back: 'Voltar à conta',
    ok: 'Alias criado.',
    merged: 'Posto juntado: o link antigo responde 301 e as fotos passaram para o posto do NAP.',
    errors: { forbidden: 'Não podes criar aliases.', bad: 'Pedido inválido.', missing: 'Posto novo não encontrado ou não está activo.', stale: 'Já existe um alias para este posto.', self: 'O código novo tem de ser diferente.' } as Record<string, string>,
  },
  en: {
    title: 'Stations missing from the NAP',
    intro: 'Stations that left the NAP but still have photos, and stations under construction with photos that the import did not merge into a NAP station on its own. Write the new station code so the old link answers 301. For a station under construction, its photos move to the NAP station too.',
    building: 'Under construction (OSM)',
    buildingGone: 'Off the OSM works list',
    suggest: 'Suggestion',
    merge: 'Merge into the NAP station',
    empty: 'No missing stations with photos.',
    station: 'Station',
    photos: 'Photos',
    alias: 'Current alias',
    newCode: 'New code',
    save: 'Create alias',
    forbidden: 'This page is only for moderators and administrators.',
    back: 'Back to account',
    ok: 'Alias created.',
    merged: 'Station merged: the old link answers 301 and the photos moved to the NAP station.',
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
  const ok = url.searchParams.get('ok');
  const error = url.searchParams.get('erro') ?? undefined;
  const t = T[lang];
  const parts: string[] = [`<h1>${t.title}</h1>`, `<p>${t.intro}</p>`];
  if (ok) parts.push(`<p class="notice" role="status">${ok === 'merged' ? t.merged : t.ok}</p>`);
  const err = error ? t.errors[error] : undefined;
  if (err) parts.push(`<p class="notice" role="alert">${esc(err)}</p>`);
  if (rows.length === 0) parts.push(`<p>${t.empty}</p>`);
  else {
    const items = rows.map((r) => {
      const alias = r.alias ? `<span>${esc(r.alias)}</span>` : '—';
      const building = r.source === 'osm';
      const mark = building ? ` <span class="chip warn">${r.status === 'missing_from_osm' ? t.buildingGone : t.building}</span>` : '';
      const suggest = r.suggest ? ` · ${t.suggest}: <a href="${stationPath(lang, r.suggest)}">${esc(r.suggest)}</a>` : '';
      return `<article class="alias-item">
<p><strong>${t.station}:</strong> <a href="${stationPath(lang, r.id)}">${esc(r.id)}</a>${r.name ? ` · ${esc(r.name)}` : ''}${r.operator ? ` · ${esc(r.operator)}` : ''}${mark}</p>
<p>${t.photos}: ${r.photo_count} · ${t.alias}: ${alias}${suggest}</p>
<form method="post" action="${ALIAS_ACTION}" class="alias-form">
<input type="hidden" name="old" value="${esc(r.id)}">
<input type="hidden" name="lang" value="${lang}">
<label>${t.newCode} <input name="new" required maxlength="64"${r.suggest ? ` value="${esc(r.suggest)}"` : ''}></label>
<button type="submit" class="button secondary">${building ? t.merge : t.save}</button>
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

  // old must exist and be missing from the NAP, or be under construction
  const oldRow = await db(env).prepare(`SELECT source, status FROM stations WHERE id = ?`).bind(old).first<{ source: string; status: string }>();
  const building = oldRow?.source === 'osm' && (oldRow.status === 'active' || oldRow.status === 'missing_from_osm');
  if (!oldRow || (oldRow.status !== 'missing_from_nap' && !building)) return back('erro=bad');

  const newRow = await db(env).prepare(`SELECT source, status FROM stations WHERE id = ?`).bind(nw).first<{ source: string; status: string }>();
  if (!newRow || (newRow.status !== 'active' && newRow.status !== 'missing_from_nap')) return back('erro=missing');
  // A station under construction only merges into an active NAP station.
  if (building && (newRow.source !== 'nap' || newRow.status !== 'active')) return back('erro=missing');

  const existing = await getStationAlias(env, old);
  if (existing) return back('erro=stale');

  if (building) {
    // One transaction: the alias, the photos and the status move together.
    const at = now.toISOString();
    await env.DB.batch(MERGE_SQL.map((q) => env.DB.prepare(q).bind(...mergeBinds(q, [old, nw, user.id, at]))));
    return back('ok=merged');
  }
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
