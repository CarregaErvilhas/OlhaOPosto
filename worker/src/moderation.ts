// The moderation queue: moderators and admins see the pending photos and
// approve or reject them (Docs/plan.md, *Fluxo de upload*, step 7).
//
// Approve: the photo's upload set becomes public on Panoramax (the picture's
// own visibility is not enough, the stricter of set and picture wins), then
// the row turns `published`. The 1024 and 400 px copies stay in
// pictures-staging until the main-photo step publishes one to `pictures`.
// Reject: the upload set is deleted on Panoramax, the staging copies are
// deleted, and the row turns `removed` (the privacy policy promises both).
//
// approved_by/approved_at record who decided and when, for either outcome.
// Every decision is a compare-and-set on status = 'pending', so two
// moderators on the same photo cannot both act on it.

import { currentUser, page, sameOrigin, type SessionUser } from './auth.ts';
import { BRAND, accountPath, esc, layout, stationPath, type Lang } from './pages.ts';
import { PANORAMAX_URL, type PhotoEnv } from './photos.ts';
import { FAR_M } from './types.ts';
import { publishMain } from './publish.ts';

export const queuePath = (lang: Lang) => (lang === 'pt' ? '/admin/fila' : '/en/admin/queue');
// One POST for both languages; the form says which page to go back to.
export const DECIDE_ACTION = '/admin/decidir';
// Moderator-only view of the private staging copies.
export const STAGING_PREFIX = '/admin/staging/';

export const canModerate = (role: string) => role === 'moderator' || role === 'admin';

export { FAR_M };
const QUEUE_LIMIT = 50;

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

// The slices of D1 and R2 used here, so the tests typecheck under Node.
interface Stmt {
  bind(...values: unknown[]): Stmt;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes: number } }>;
}
interface StagingObject {
  body: ReadableStream;
  httpEtag: string;
}
const db = (env: PhotoEnv) => env.DB as unknown as { prepare(sql: string): Stmt };
const staging = (env: PhotoEnv) =>
  env.STAGING as unknown as { get(key: string): Promise<StagingObject | null>; delete(keys: string[]): Promise<void> };

const T = {
  pt: {
    title: 'Fila de moderação',
    intro: `Fotos à espera de decisão, da mais antiga para a mais recente. Aprovar torna a foto pública no Panoramax; recusar apaga-a do Panoramax e do armazenamento privado. Fotos a mais de ${FAR_M} m do posto ou sem GPS podem ser de outro posto: confirma antes de aprovar.`,
    empty: 'Não há fotos à espera.',
    station: 'Posto',
    socket: 'Tomada',
    sentBy: 'Enviada por',
    sentAt: 'Enviada em',
    takenAt: 'Tirada em',
    gps: 'GPS da foto',
    noGps: 'Sem GPS: confirma o posto pela imagem.',
    far: (m: number) => `A ${m} m do posto: pode ser de outro.`,
    near: (m: number) => `A ${m} m do posto.`,
    unknown: 'desconhecida',
    approve: 'Aprovar',
    reject: 'Recusar',
    ok: { approve: 'Foto aprovada.', main: 'Foto aprovada e publicada como foto principal: o link estático já a mostra.', reject: 'Foto recusada e apagada.' } as Record<string, string>,
    errors: {
      stale: 'Esta foto já foi decidida por outra pessoa.',
      panoramax: 'O Panoramax não respondeu. Nada mudou; tenta outra vez.',
      closed: 'A ligação ao Panoramax não está configurada.',
      bad: 'Pedido inválido.',
      publish: 'Mas a cópia para o link estático falhou; a próxima aprovação deste posto tenta outra vez.',
    } as Record<string, string>,
    forbidden: 'Esta página é só para moderadores e administradores.',
    back: 'Voltar à conta',
    more: (n: number) => `Mostra-se só as ${n} mais antigas.`,
  },
  en: {
    title: 'Moderation queue',
    intro: `Photos waiting for a decision, oldest first. Approving makes the photo public on Panoramax; rejecting deletes it from Panoramax and from the private storage. Photos more than ${FAR_M} m from the station, or without GPS, may be of another station: check before approving.`,
    empty: 'No photos waiting.',
    station: 'Station',
    socket: 'Socket',
    sentBy: 'Sent by',
    sentAt: 'Sent on',
    takenAt: 'Taken on',
    gps: 'Photo GPS',
    noGps: 'No GPS: check the station from the picture.',
    far: (m: number) => `${m} m from the station: it may be another one.`,
    near: (m: number) => `${m} m from the station.`,
    unknown: 'unknown',
    approve: 'Approve',
    reject: 'Reject',
    ok: { approve: 'Photo approved.', main: 'Photo approved and published as the main photo: the static link shows it now.', reject: 'Photo rejected and deleted.' } as Record<string, string>,
    errors: {
      stale: 'Someone else already decided on this photo.',
      panoramax: 'Panoramax did not answer. Nothing changed; try again.',
      closed: 'The Panoramax connection is not configured.',
      bad: 'Invalid request.',
      publish: 'But copying it to the static link failed; the next approval for this station tries again.',
    } as Record<string, string>,
    forbidden: 'This page is only for moderators and admins.',
    back: 'Back to account',
    more: (n: number) => `Only the ${n} oldest are shown.`,
  },
};

export interface QueueRow {
  id: string;
  station_id: string;
  station_name: string | null;
  operator: string | null;
  evse_compact: string | null;
  credit: string | null;
  taken_at: string | null;
  exif_lat: number | null;
  exif_lon: number | null;
  distance_m: number | null;
  created_at: string;
}

function card(lang: Lang, r: QueueRow): string {
  const t = T[lang];
  const warn = r.distance_m === null
    ? `<p class="notice">${t.noGps}</p>`
    : r.distance_m > FAR_M
      ? `<p class="notice">${t.far(r.distance_m)}</p>`
      : `<p>${t.near(r.distance_m)}</p>`;
  const gps = r.exif_lat !== null && r.exif_lon !== null
    ? `<a href="https://www.openstreetmap.org/?mlat=${r.exif_lat}&amp;mlon=${r.exif_lon}#map=19/${r.exif_lat}/${r.exif_lon}" target="_blank" rel="noopener">${r.exif_lat.toFixed(5)}, ${r.exif_lon.toFixed(5)}</a>`
    : '—';
  const img = `${STAGING_PREFIX}${encodeURIComponent(r.id)}/`;
  const decide = (action: 'approve' | 'reject', cls: string) =>
    `<form method="post" action="${DECIDE_ACTION}">` +
    `<input type="hidden" name="photo" value="${esc(r.id)}">` +
    `<input type="hidden" name="action" value="${action}">` +
    `<input type="hidden" name="lang" value="${lang}">` +
    `<button type="submit" class="${cls}">${t[action]}</button></form>`;
  return `<article class="queue-item">
<a href="${img}main.jpg" target="_blank" rel="noopener"><img src="${img}thumb.jpg" alt="" loading="lazy"></a>
<div>
<p><strong>${t.station}:</strong> <a href="${stationPath(lang, r.station_id)}" target="_blank" rel="noopener">${esc(r.station_name ?? r.station_id)}</a> <span class="muted">${esc(r.station_id)}${r.operator ? ` · ${esc(r.operator)}` : ''}</span></p>
${r.evse_compact ? `<p><strong>${t.socket}:</strong> ${esc(r.evse_compact)}</p>` : ''}
<p><strong>${t.sentBy}:</strong> <span lang="">${esc(r.credit ?? '—')}</span> · <strong>${t.sentAt}:</strong> ${esc(r.created_at.slice(0, 16).replace('T', ' '))}</p>
<p><strong>${t.takenAt}:</strong> ${esc(r.taken_at ? r.taken_at.slice(0, 16).replace('T', ' ') : t.unknown)} · <strong>${t.gps}:</strong> ${gps}</p>
${warn}
<div class="queue-actions">${decide('approve', 'button')}${decide('reject', 'button secondary')}</div>
</div>
</article>`;
}

export function queuePage(lang: Lang, rows: QueueRow[], p: { ok?: string; error?: string }): string {
  const t = T[lang];
  const parts = [`<h1>${t.title}</h1>`, `<p>${t.intro}</p>`];
  const ok = p.ok ? t.ok[p.ok] : undefined;
  if (ok) parts.push(`<p class="notice" role="status">${ok}</p>`);
  const err = p.error ? t.errors[p.error] : undefined;
  if (err) parts.push(`<p class="notice" role="alert">${esc(err)}</p>`);
  if (rows.length === 0) parts.push(`<p>${t.empty}</p>`);
  else {
    parts.push(rows.map((r) => card(lang, r)).join('\n'));
    if (rows.length >= QUEUE_LIMIT) parts.push(`<p class="muted">${t.more(QUEUE_LIMIT)}</p>`);
  }
  parts.push(`<p><a href="${accountPath(lang)}">${t.back}</a></p>`);
  return layout({
    lang,
    title: `${t.title} · ${BRAND}`,
    description: t.title,
    noindex: true,
    switchTo: { pt: queuePath('pt'), en: queuePath('en') },
    body: parts.join('\n'),
  });
}

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
const noStore = (body: string, status: number) =>
  new Response(body, { status, headers: { 'cache-control': 'no-store' } });

async function moderator(request: Request, env: PhotoEnv): Promise<SessionUser | null> {
  const user = await currentUser(request, env).catch(() => null);
  return user && canModerate(user.role) ? user : null;
}

export async function queueHtml(lang: Lang, request: Request, env: PhotoEnv, headers: Record<string, string>): Promise<Response> {
  const user = await currentUser(request, env).catch(() => null);
  if (!user) return redirect(`/auth/osm/login?next=${encodeURIComponent(queuePath(lang))}`);
  if (!canModerate(user.role)) return page(lang, forbiddenPage(lang), 403, headers);
  const { results } = await db(env).prepare(
    `SELECT p.id, p.station_id, s.name AS station_name, s.operator, p.evse_compact, p.credit,
            p.taken_at, p.exif_lat, p.exif_lon, p.distance_m, p.created_at
       FROM photos p JOIN stations s ON s.id = p.station_id
      WHERE p.status = 'pending'
      ORDER BY p.created_at
      LIMIT ${QUEUE_LIMIT}`,
  ).all<QueueRow>();
  const url = new URL(request.url);
  return page(lang, queuePage(lang, results ?? [], {
    ok: url.searchParams.get('ok') ?? undefined,
    error: url.searchParams.get('erro') ?? undefined,
  }), 200, headers);
}

// GET /admin/staging/{photo id}/{main|thumb}.jpg, moderators only.
export async function stagingImage(request: Request, env: PhotoEnv, rest: string): Promise<Response> {
  const m = rest.match(/^([0-9a-f-]{36})\/(main|thumb)\.jpg$/);
  if (!m) return noStore('not found', 404);
  if (!(await moderator(request, env))) return noStore('forbidden', 403);
  if (!env.STAGING) return noStore('not found', 404);
  const obj = await staging(env).get(`${m[1]}/${m[2]}.jpg`);
  if (!obj) return noStore('not found', 404);
  return new Response(obj.body, {
    headers: {
      'content-type': 'image/jpeg',
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
      etag: obj.httpEtag,
    },
  });
}

export async function decide(request: Request, env: PhotoEnv, fetcher: Fetch = fetch, now = new Date()): Promise<Response> {
  if (!sameOrigin(request)) return noStore('forbidden', 403);
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return noStore('bad request', 400);
  }
  const lang: Lang = form.get('lang') === 'en' ? 'en' : 'pt';
  const back = (q: string) => redirect(`${queuePath(lang)}?${q}`, 303);
  const user = await currentUser(request, env).catch(() => null);
  if (!user) return redirect(`/auth/osm/login?next=${encodeURIComponent(queuePath(lang))}`, 303);
  if (!canModerate(user.role)) return noStore('forbidden', 403);
  const id = form.get('photo');
  const action = form.get('action');
  if (typeof id !== 'string' || (action !== 'approve' && action !== 'reject')) return back('erro=bad');
  if (!env.PANORAMAX_TOKEN) return back('erro=closed');

  const photo = await db(env).prepare(
    `SELECT panoramax_set, station_id, evse_compact FROM photos WHERE id = ? AND status = 'pending'`,
  ).bind(id).first<{ panoramax_set: string | null; station_id: string; evse_compact: string | null }>();
  if (!photo) return back('erro=stale');

  const base = env.PANORAMAX_URL ?? PANORAMAX_URL;
  const headers = { authorization: `Bearer ${env.PANORAMAX_TOKEN}`, 'user-agent': 'OlhaOPosto' };
  const set = photo.panoramax_set ? `${base}/api/upload_sets/${encodeURIComponent(photo.panoramax_set)}` : null;

  if (action === 'approve') {
    if (!set) return back('erro=panoramax');
    const r = await fetcher(set, {
      method: 'PATCH',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ visibility: 'anyone' }),
    }).catch(() => null);
    if (!r?.ok) return back('erro=panoramax');
  } else if (set) {
    // 404: already gone on Panoramax, which is what we want anyway.
    const r = await fetcher(set, { method: 'DELETE', headers }).catch(() => null);
    if (!r || (!r.ok && r.status !== 404)) return back('erro=panoramax');
  }

  const status = action === 'approve' ? 'published' : 'removed';
  const res = await db(env).prepare(
    `UPDATE photos SET status = ?, approved_by = ?, approved_at = ? WHERE id = ? AND status = 'pending'`,
  ).bind(status, user.id, now.toISOString(), id).run();
  if (res.meta.changes !== 1) return back('erro=stale');
  if (action === 'approve') {
    // Award points (Docs/plan.md, *Gamificação*).
    try {
      const target = photo.evse_compact ?? photo.station_id;
      const others = await db(env).prepare(
        `SELECT COUNT(*) AS n FROM photos WHERE station_id = ? AND evse_compact IS ? AND id <> ? AND status = 'published'`,
      ).bind(photo.station_id, photo.evse_compact, id).first<{ n: number }>();
      const isFirst = (others?.n ?? 0) === 0;
      const month = now.toISOString().slice(0, 7);
      const stmts = [db(env).prepare(
        `INSERT INTO points (user_id, photo_id, points, reason, month, created_at) VALUES (?, ?, 1, 'approved', ?, ?)`,
      ).bind(user.id, id, month, now.toISOString())];
      if (isFirst) stmts.push(db(env).prepare(
        `INSERT INTO points (user_id, photo_id, points, reason, month, created_at) VALUES (?, ?, 3, 'first_photo', ?, ?)`,
      ).bind(user.id, id, month, now.toISOString()));
      await env.DB.batch(stmts);
    } catch {
      // Points are best-effort; never block an approval.
    }
    // Main photo of its socket and station when they have none (src/publish.ts).
    // The approval stands either way; a failed publish only loses the link.
    try {
      const targets = await publishMain(env, id, user.id, fetcher, now);
      if (targets.length) return back('ok=main');
    } catch {
      return back('ok=approve&erro=publish');
    }
  }
  if (action === 'reject' && env.STAGING) {
    await staging(env).delete([`${id}/main.jpg`, `${id}/thumb.jpg`]).catch(() => {});
  }
  return back(`ok=${action}`);
}
