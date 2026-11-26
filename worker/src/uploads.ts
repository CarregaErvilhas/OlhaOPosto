// "Os meus envios" (/conta/envios, /en/account/uploads): the signed-in
// author's own photos with their state and, for a refused or removed one,
// the reason. Only the author's rows are read (WHERE uploader_id = them).
// The thumbnail comes from the private staging bucket through a route that
// checks the photo is the viewer's own.
import { currentUser, page, type AuthEnv } from './auth.ts';
import { BRAND, accountPath, esc, layout, stationPath, uploadPath, type Lang } from './pages.ts';
import { REASON_TEXT, isReason } from './reasons.ts';

export const uploadsPath = (lang: Lang) => (lang === 'pt' ? '/conta/envios' : '/en/account/uploads');
export const OWN_THUMB_PREFIX = '/conta/envios/miniatura/';
export const UPLOADS_PAGE_SIZE = 20;

interface Stmt {
  bind(...values: unknown[]): Stmt;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
}
const db = (env: AuthEnv) => env.DB as unknown as { prepare(sql: string): Stmt };

export interface UploadRow {
  id: string;
  station_id: string;
  station_name: string | null;
  evse_compact: string | null;
  status: string;
  created_at: string;
  refusal_reason: string | null;
  refusal_note: string | null;
  refused_by: string | null;
  is_main: number;
}

export type UploadState = 'pending' | 'published' | 'main' | 'refused' | 'removed' | 'hidden';

export function stateOf(r: Pick<UploadRow, 'status' | 'refused_by' | 'is_main'>): UploadState {
  if (r.status === 'pending') return 'pending';
  if (r.status === 'hidden') return 'hidden';
  if (r.status === 'removed') return r.refused_by ? 'refused' : 'removed';
  return r.is_main ? 'main' : 'published';
}

const T = {
  pt: {
    title: 'Os meus envios',
    desc: `As fotos que enviaste para o ${BRAND}, com o estado de cada uma.`,
    intro: 'As tuas fotos, da mais recente para a mais antiga. Só tu as vês aqui.',
    empty: 'Ainda não enviaste fotos.',
    upload: 'Enviar fotos',
    station: 'Posto',
    socket: 'Tomada',
    sent: 'Enviada em',
    state: 'Estado',
    reason: 'Motivo',
    states: {
      pending: 'À espera de um moderador',
      published: 'Publicada',
      main: 'Publicada, e é a foto principal',
      refused: 'Recusada',
      removed: 'Removida',
      hidden: 'Oculta, à espera da decisão sobre um pedido de remoção',
    } as Record<UploadState, string>,
    noReason: 'Sem motivo registado.',
    prev: 'Mais recentes',
    next: 'Mais antigas',
    back: 'Voltar à conta',
    link: 'Os meus envios',
    login: 'Inicia sessão para ver os teus envios.',
  },
  en: {
    title: 'My uploads',
    desc: `The photos you sent to ${BRAND}, with the state of each.`,
    intro: 'Your photos, newest first. Only you see them here.',
    empty: 'You have not sent any photos yet.',
    upload: 'Upload photos',
    station: 'Station',
    socket: 'Socket',
    sent: 'Sent on',
    state: 'State',
    reason: 'Reason',
    states: {
      pending: 'Waiting for a moderator',
      published: 'Published',
      main: 'Published, and it is the main photo',
      refused: 'Refused',
      removed: 'Removed',
      hidden: 'Hidden, waiting for a decision on a removal request',
    } as Record<UploadState, string>,
    noReason: 'No reason recorded.',
    prev: 'Newer',
    next: 'Older',
    back: 'Back to account',
    link: 'My uploads',
    login: 'Sign in to see your uploads.',
  },
};

export const uploadsLinkText = (lang: Lang) => T[lang].link;

export function uploadsPage(lang: Lang, rows: UploadRow[], pageNo: number, more: boolean): string {
  const t = T[lang];
  const item = (r: UploadRow) => {
    const state = stateOf(r);
    // Staging copies exist while the photo does; refused and removed ones are gone.
    const img = state === 'refused' || state === 'removed'
      ? '<div aria-hidden="true"></div>'
      : `<img src="${OWN_THUMB_PREFIX}${encodeURIComponent(r.id)}.jpg" alt="" loading="lazy">`;
    const why = (state === 'refused' || state === 'removed')
      ? `<p><strong>${t.reason}:</strong> ${isReason(r.refusal_reason) ? esc(REASON_TEXT[lang][r.refusal_reason]) : t.noReason}` +
        `${r.refusal_note ? ` — <span lang="">${esc(r.refusal_note)}</span>` : ''}</p>`
      : '';
    return `<li class="queue-item">${img}
<div>
<p><strong>${t.station}:</strong> <a href="${stationPath(lang, r.station_id)}">${esc(r.station_name ?? r.station_id)}</a> <span class="muted">${esc(r.station_id)}</span></p>
${r.evse_compact ? `<p><strong>${t.socket}:</strong> ${esc(r.evse_compact)}</p>` : ''}
<p><strong>${t.sent}:</strong> ${esc(r.created_at.slice(0, 10))} · <strong>${t.state}:</strong> ${t.states[state]}</p>
${why}
</div></li>`;
  };
  const here = uploadsPath(lang);
  const nav = [
    pageNo > 1 ? `<a href="${here}${pageNo > 2 ? `?pagina=${pageNo - 1}` : ''}">${t.prev}</a>` : '',
    more ? `<a href="${here}?pagina=${pageNo + 1}">${t.next}</a>` : '',
  ].filter(Boolean).join(' · ');
  const body = [
    `<h1>${t.title}</h1>`,
    rows.length === 0
      ? `<p>${t.empty}</p><p><a class="button" href="${uploadPath(lang)}">${t.upload}</a></p>`
      : `<p>${t.intro}</p>\n<ul class="plain-list uploads">${rows.map(item).join('\n')}</ul>`,
    nav ? `<p>${nav}</p>` : '',
    `<p><a href="${accountPath(lang)}">${t.back}</a></p>`,
  ].join('\n');
  return layout({
    lang, title: `${t.title} · ${BRAND}`, description: t.desc, noindex: true,
    switchTo: { pt: uploadsPath('pt'), en: uploadsPath('en') },
    body: `<div class="page-msg">\n${body}\n</div>`,
  });
}

export async function uploadsHtml(lang: Lang, request: Request, env: AuthEnv, headers: Record<string, string>): Promise<Response> {
  const user = await currentUser(request, env).catch(() => null);
  if (!user) {
    return new Response(null, { status: 302, headers: { location: `/auth/osm/login?next=${encodeURIComponent(uploadsPath(lang))}`, 'cache-control': 'no-store' } });
  }
  const n = Number(new URL(request.url).searchParams.get('pagina'));
  const pageNo = Number.isInteger(n) && n >= 1 && n <= 10000 ? n : 1;
  // One row more than the page, to know whether there is a next page.
  const { results } = await db(env).prepare(
    `SELECT p.id, p.station_id, s.name AS station_name, p.evse_compact, p.status, p.created_at,
            p.refusal_reason, p.refusal_note, p.refused_by,
            EXISTS (SELECT 1 FROM selections sel WHERE sel.photo_id = p.id) AS is_main
       FROM photos p JOIN stations s ON s.id = p.station_id
      WHERE p.uploader_id = ? AND p.status NOT IN ('uploading', 'failed')
      ORDER BY p.created_at DESC, p.id
      LIMIT ? OFFSET ?`,
  ).bind(user.id, UPLOADS_PAGE_SIZE + 1, (pageNo - 1) * UPLOADS_PAGE_SIZE).all<UploadRow>();
  return page(lang, uploadsPage(lang, results.slice(0, UPLOADS_PAGE_SIZE), pageNo, results.length > UPLOADS_PAGE_SIZE), 200, headers);
}

// GET /conta/envios/miniatura/{photo id}.jpg: the author's own staging thumbnail.
export async function ownThumbnail(request: Request, env: AuthEnv & { STAGING?: unknown }, rest: string): Promise<Response> {
  const noStore = (body: string, status: number) => new Response(body, { status, headers: { 'cache-control': 'no-store' } });
  const m = rest.match(/^([0-9a-f-]{36})\.jpg$/);
  if (!m) return noStore('not found', 404);
  const user = await currentUser(request, env).catch(() => null);
  if (!user) return noStore('forbidden', 403);
  const own = await db(env).prepare(`SELECT 1 AS ok FROM photos WHERE id = ? AND uploader_id = ? AND status IN ('pending', 'published', 'hidden')`)
    .bind(m[1], user.id).first<{ ok: number }>();
  const bucket = env.STAGING as { get(key: string): Promise<{ body: ReadableStream; httpEtag: string } | null> } | undefined;
  if (!own || !bucket) return noStore('not found', 404);
  const obj = await bucket.get(`${m[1]}/thumb.jpg`);
  if (!obj) return noStore('not found', 404);
  return new Response(obj.body, {
    headers: { 'content-type': 'image/jpeg', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', etag: obj.httpEtag },
  });
}
