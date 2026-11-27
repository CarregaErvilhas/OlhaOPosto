// The photo endpoints of the API, as plain functions the handlers in index.ts
// stay thin around (and the MCP server can call later):
//
//   getPhoto      GET    /api/v1/photos/{id}
//   exportPhotos  GET    /api/v1/photos.json   (every published photo, for reusers)
//   deletePhoto   DELETE /api/v1/photos/{id}   (the author, or a moderator)
//
// Public reads show a photo only once it is published. Its author, and
// moderators, can also read the others they may act on, with the status.
import { currentUser, type SessionUser } from './auth.ts';
import { canModerate } from './moderation.ts';
import { BRAND, PANORAMAX_URL, PICTURES, SITE, photoPath, socketAnchor, stationPath } from './pages.ts';
import { LICENSE, LICENSE_URL, SIZE_PX, reportPath } from './photolinks.ts';
import { bearer, tokenUser, type TokenDb } from './tokens.ts';
import { cleanNote, isReason, type Reason } from './reasons.ts';
import { removePhoto, type TakedownEnv } from './takedown.ts';
import { isPublic, PUBLIC_SQL } from './types.ts';

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

interface Stmt {
  bind(...values: unknown[]): Stmt;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
}
const db = (env: { DB: unknown }) => env.DB as { prepare(sql: string): Stmt };

export const PHOTO_ID = /^[A-Za-z0-9-]{1,64}$/;

export interface PhotoRow {
  id: string;
  origin: string;
  station_id: string;
  evse_compact: string | null;
  kind?: string | null;
  uploader_id: string | null;
  panoramax_set: string | null;
  panoramax_id: string | null;
  credit: string | null;
  license: string;
  taken_at: string | null;
  approved_at: string | null;
  created_at: string;
  status: string;
  refusal_reason: string | null;
  refusal_note: string | null;
  // The photo is the published main photo of its target (0/1 from SQLite).
  is_main: number;
  station_name: string | null;
  station_code: string | null;
  opc: string | null;
  operator: string | null;
  municipality: string | null;
  lat: number;
  lon: number;
  station_status: string;
  // Only for photos that live at their origin (origin <> 'olhaoposto').
  external_src: string | null;
  source_url: string | null;
}

const SELECT = `SELECT p.id, p.origin, p.station_id, p.evse_compact, p.kind, p.uploader_id, p.panoramax_set, p.panoramax_id,
       p.credit, p.license, p.taken_at, p.approved_at, p.created_at, p.status, p.refusal_reason, p.refusal_note,
       EXISTS (SELECT 1 FROM selections sel
                WHERE sel.target = coalesce(p.evse_compact, p.station_id)
                  AND sel.photo_id = p.id AND sel.published_at IS NOT NULL AND sel.lost_at IS NULL) AS is_main,
       s.name AS station_name, s.code AS station_code, s.opc, s.operator, s.municipality, s.lat, s.lon,
       s.status AS station_status, p.external_src, p.source_url
  FROM photos p JOIN stations s ON s.id = p.station_id`;

const pano = (r: Pick<PhotoRow, 'panoramax_id'>) => (r.panoramax_id ? `${PANORAMAX_URL}/api/pictures/${encodeURIComponent(r.panoramax_id)}` : null);

// The main photo has the stable static links, with known sizes. Another
// published photo is served by Panoramax only (its own thumbnail and the
// 2048 px version), the same images the credit page shows.
function sizesOf(r: PhotoRow): Record<string, { url: string; maxPx: number | null }> | null {
  const target = r.evse_compact ?? r.station_id;
  if (r.is_main) {
    const base = `${PICTURES}/${encodeURIComponent(target)}`;
    return {
      thumb: { url: `${base}.thumb.jpg`, maxPx: SIZE_PX.thumb },
      main: { url: `${base}.jpg`, maxPx: SIZE_PX.main },
      full: { url: `${base}.full.jpg`, maxPx: SIZE_PX.full },
    };
  }
  const p = pano(r);
  return p ? { thumb: { url: `${p}/thumb.jpg`, maxPx: null }, main: { url: `${p}/sd.jpg`, maxPx: null } } : null;
}

// One published photo, the same shape in GET /photos/{id} and in the export.
// The position is the station's: the photo's own GPS is for moderators only.
export const isExternal = (r: Pick<PhotoRow, 'origin'>) => r.origin !== 'olhaoposto';

// A photo that lives at its origin (a Panoramax picture or a Commons file
// linked from OSM): we keep a reference, never a copy. It has no credit page,
// no static links and no removal request here: `sourceUrl` is where it lives
// and where its author, licence and any removal are handled.
function externalPhoto(r: PhotoRow) {
  const credit = r.credit ?? r.origin;
  return {
    id: r.id,
    origin: r.origin,
    kind: 'photo',
    target: r.station_id,
    socket: null,
    station: stationOf(r),
    credit,
    license: r.license,
    licenseUrl: null,
    attribution: `© ${credit}, ${r.license}`,
    takenAt: r.taken_at,
    publishedAt: r.approved_at ?? r.created_at,
    isMain: false,
    sizes: r.external_src ? { thumb: { url: r.external_src, maxPx: null } } : null,
    page: `${SITE}${stationPath('pt', r.station_id)}`,
    sourceUrl: r.source_url,
    creditPage: null,
    panoramaxId: null,
    panoramax: null,
    report: null,
  };
}

const stationOf = (r: PhotoRow) => ({
  id: r.station_id,
  code: r.station_code,
  name: r.station_name,
  operator: { id: r.opc, name: r.operator },
  municipality: r.municipality,
  lat: r.lat,
  lon: r.lon,
});

export function publicPhoto(r: PhotoRow) {
  if (isExternal(r)) return externalPhoto(r);
  const credit = r.credit ?? BRAND;
  const target = r.evse_compact ?? r.station_id;
  const ccBySa = r.license === LICENSE;
  return {
    id: r.id,
    origin: r.origin,
    // `plate`: a charger's rating plate (gallery only, never the main photo).
    kind: r.kind ?? 'photo',
    target,
    socket: r.evse_compact,
    station: stationOf(r),
    credit,
    license: r.license,
    licenseUrl: ccBySa ? LICENSE_URL : null,
    attribution: ccBySa ? `© ${credit}, CC BY-SA 4.0, via ${BRAND}` : `© ${credit}, ${r.license}, via ${BRAND}`,
    sourceUrl: null,
    takenAt: r.taken_at,
    publishedAt: r.approved_at ?? r.created_at,
    isMain: r.is_main === 1,
    sizes: sizesOf(r),
    page: `${SITE}${stationPath('pt', r.station_id)}${r.evse_compact ? socketAnchor(r.evse_compact) : ''}`,
    creditPage: `${SITE}${photoPath('pt', r.id)}`,
    panoramaxId: r.panoramax_id,
    panoramax: r.panoramax_id
      ? `${PANORAMAX_URL}/viewer?focus=map&map=19/${r.lat}/${r.lon}&pic=${encodeURIComponent(r.panoramax_id)}`
      : null,
    report: SITE + reportPath(target),
  };
}

// Who is asking, if anyone, for the reads that are open to all: a bearer
// token (any scope) or the site's session cookie. Never an error: a bad
// token only means the read stays public.
export async function optionalCaller(request: Request, env: { DB: unknown }): Promise<SessionUser | null> {
  const token = bearer(request);
  if (token) return (await tokenUser(env.DB as TokenDb, token).catch(() => null))?.user ?? null;
  if (request.headers.has('authorization')) return null;
  return currentUser(request, env as never).catch(() => null);
}

const canSee = (user: SessionUser | null, r: PhotoRow) =>
  user !== null && (canModerate(user.role) || (r.uploader_id !== null && r.uploader_id === user.id));

export type PhotoResult =
  | { photo: ReturnType<typeof publicPhoto> & { status?: string }; private: boolean }
  | { notFound: true };

// A published photo of a public station is open to everyone. Its author and
// the moderators also see their other photos, with the status; a refused
// one carries the reason. Anyone else gets 404 for those, as for an id that
// does not exist.
export async function getPhoto(env: { DB: unknown }, id: string, user: SessionUser | null = null): Promise<PhotoResult> {
  if (!PHOTO_ID.test(id)) return { notFound: true };
  const row = await db(env).prepare(`${SELECT} WHERE p.id = ?`).bind(id).first<PhotoRow>();
  if (!row) return { notFound: true };
  const open = row.status === 'published' && isPublic({ status: row.station_status });
  if (open && !user) return { photo: publicPhoto(row), private: false };
  if (!canSee(user, row) && !open) return { notFound: true };
  const base = publicPhoto(row);
  if (open) return { photo: { ...base, status: row.status }, private: user !== null };
  // Not public: what the author needs to follow their upload, no image links.
  return {
    photo: {
      ...base,
      sizes: null,
      panoramax: null,
      status: row.status,
      ...(row.refusal_reason ? { refusal: { reason: row.refusal_reason, note: row.refusal_note } } : {}),
    },
    private: true,
  };
}

// Every published photo of a public station, gallery included, for reusers:
// ours, and the references to photos that live elsewhere (origin tells them apart).
// Thousands of rows at most for a long while; the Worker caches the answer.
export async function exportPhotos(env: { DB: unknown }) {
  const { results } = await db(env).prepare(
    `${SELECT} WHERE p.status = 'published' AND s.status IN ${PUBLIC_SQL}
     ORDER BY p.station_id, p.evse_compact, p.approved_at, p.id`,
  ).all<PhotoRow>();
  return { license: LICENSE, licenseUrl: LICENSE_URL, count: results.length, photos: results.map(publicPhoto) };
}

export type DeleteResult =
  | { ok: true }
  | { error: 'not_found' | 'forbidden' | 'bad_reason' | 'panoramax'; status: 404 | 403 | 400 | 502 };

const REMOVABLE = ['pending', 'published', 'hidden'];

// The author removes their own photo; a moderator or admin any. The same
// path as a removal request (removePhoto in src/takedown.ts): the static
// copies and the cache go, a lost main photo shows up in «Sem foto
// principal», the upload set leaves Panoramax. A moderator may give a reason
// (a fixed code) and a note; the author's own removal needs none. 404 for a
// photo that is not theirs and not public, like an id that does not exist.
export async function deletePhoto(
  env: TakedownEnv, user: SessionUser, id: string,
  opts: { reason?: unknown; note?: unknown } = {}, fetcher: Fetch = fetch, now = new Date(),
): Promise<DeleteResult> {
  if (!PHOTO_ID.test(id)) return { error: 'not_found', status: 404 };
  const row = await db(env).prepare(`${SELECT} WHERE p.id = ?`).bind(id).first<PhotoRow>();
  // An external photo is only a reference: it is removed at its origin.
  if (!row || isExternal(row) || !REMOVABLE.includes(row.status)) return { error: 'not_found', status: 404 };
  const own = row.uploader_id !== null && row.uploader_id === user.id;
  const moderator = canModerate(user.role);
  if (!own && !moderator) return row.status === 'published' ? { error: 'forbidden', status: 403 } : { error: 'not_found', status: 404 };
  let removal: { reason: Reason | null; note: string | null; decidedBy: string | null } = { reason: null, note: null, decidedBy: null };
  // A moderator's removal of someone else's photo is a decision: it has a
  // reason, and the author sees it on «os meus envios».
  if (moderator && !own) {
    if (opts.reason !== undefined && !isReason(opts.reason)) return { error: 'bad_reason', status: 400 };
    removal = { reason: (opts.reason as Reason | undefined) ?? 'other', note: cleanNote(opts.note), decidedBy: user.id };
  }
  const r = await removePhoto(env, row, fetcher, now, removal);
  return r === 'ok' ? { ok: true } : { error: 'panoramax', status: 502 };
}
