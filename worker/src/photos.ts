// Photo uploads: POST /api/v1/photos and the upload page route.
//
// The browser has already blurred the photo, removed its metadata and made
// three sizes (public/upload.js). The Worker never trusts that: it checks the
// session, the origin, the daily limit, the target, that every file is a
// clean JPEG of the right size, and only then stores the photo. The 2048 px
// master goes to our Panoramax server, hidden (owner-only) until a moderator
// approves it; the 1024 and 400 px copies wait in the private bucket
// pictures-staging. The D1 row is written first, so a failure halfway is
// always traceable and cleaned up.
//
// Closed (503) until sign-in is on, the Panoramax token exists and the
// staging bucket is bound, so this can ship before uploads open.
import { isCleanJpeg, jpegSize } from '../public/jpeg.js';
import { currentUser, loginEnabled, page, type AuthEnv, type Db, type Waiter } from './auth.ts';
import { apiCaller, type ApiSigner } from './tokens.ts';
import { PANORAMAX_URL, type Lang } from './pages.ts';
import { distanceM, FAR_M, PUBLIC_SQL, STATION_ID } from './types.ts';
import { TURNSTILE_ACTION, presetSocket, presetStation, uploadPage } from './upload.ts';
import { allowed, type RateEnv } from './ratelimit.ts';
import { awardApproval, type PointsDb } from './points.ts';

// The slice of R2 used here, so the tests typecheck under Node.
export interface Bucket {
  put(key: string, value: Uint8Array, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  delete(keys: string | string[]): Promise<void>;
}

export interface PhotoEnv extends AuthEnv, RateEnv {
  STAGING?: Bucket;
  PANORAMAX_TOKEN?: string;
  PANORAMAX_URL?: string;
  // Cache purge on pictures.* when swapping a main photo.
  CF_ZONE_ID?: string;
  CF_CACHE_PURGE_TOKEN?: string;
  // Turnstile on the upload form. Both are Worker secrets: the site key is
  // public in the page, but it is a Cloudflare resource id and stays out of
  // the repository.
  TURNSTILE_SITEKEY?: string;
  TURNSTILE_SECRET?: string;
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export { PANORAMAX_URL };
// Per person and UTC day. Contributors are moderated anyway; the cap keeps a
// runaway script or a stolen session from filling the queue.
export const DAILY_LIMIT: Record<string, number> = { contributor: 50 };
const DAILY_LIMIT_OTHERS = 500;

// Longest side and largest file for each size the page makes.
const SIZES = {
  full: { max: 2048, bytes: 6_000_000 },
  main: { max: 1024, bytes: 2_000_000 },
  thumb: { max: 400, bytes: 500_000 },
} as const;
type SizeName = keyof typeof SIZES;
export const MAX_BODY = 9_000_000;
const MIN_SIDE = 100;

export const uploadsOpen = (env: PhotoEnv) =>
  loginEnabled(env) && Boolean(env.PANORAMAX_TOKEN && env.STAGING && env.TURNSTILE_SITEKEY && env.TURNSTILE_SECRET);

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const SITE_HOST = 'olhaoposto.ocarroeletrico.com';

// Turnstile's answer for this token. Tokens are single use and last 300 s;
// the hostname and action stop a token made for another site or form.
export async function turnstileOk(
  env: PhotoEnv, fetcher: Fetch, token: unknown, ip: string | null, action: string = TURNSTILE_ACTION,
): Promise<boolean> {
  if (typeof token !== 'string' || !token || token.length > 2048) return false;
  const body = new FormData();
  body.append('secret', env.TURNSTILE_SECRET ?? '');
  body.append('response', token);
  if (ip) body.append('remoteip', ip);
  try {
    const r = await fetcher(SITEVERIFY, { method: 'POST', body });
    if (!r.ok) return false;
    const out = await r.json() as { success?: boolean; hostname?: string; action?: string };
    return out.success === true && out.hostname === SITE_HOST && out.action === action;
  } catch {
    return false;
  }
}

export async function uploadHtml(lang: Lang, request: Request, env: PhotoEnv, headers: Record<string, string>) {
  const enabled = loginEnabled(env);
  // A D1 hiccup reads as signed out, never as a 500.
  const user = enabled ? await currentUser(request, env).catch(() => null) : null;
  const sending = uploadsOpen(env);
  const params = new URL(request.url).searchParams;
  const station = presetStation(params.get('posto'));
  const socket = station ? presetSocket(params.get('tomada')) : null;
  return page(lang, uploadPage(lang, { user, enabled, sending, sitekey: sending ? env.TURNSTILE_SITEKEY : undefined, station, socket }), 200, headers);
}

const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

export interface PhotoMeta {
  station: string;
  target: string;
  taken_at: string | null;
  exif_lat: number | null;
  exif_lon: number | null;
}

const TAKEN_AT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})([+-]\d{2}:\d{2}|Z)?$/;
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// The JSON part of the upload. Both consents must be true; the rest is
// checked for shape here and against D1 later.
export function parseMeta(raw: unknown, now = new Date()): PhotoMeta | string {
  if (typeof raw !== 'string' || raw.length > 2000) return 'bad_meta';
  let m: Record<string, unknown>;
  try {
    m = JSON.parse(raw);
  } catch {
    return 'bad_meta';
  }
  if (!m || typeof m !== 'object') return 'bad_meta';
  if (m.license !== true || m.no_people !== true) return 'consent_required';
  if (typeof m.station !== 'string' || !STATION_ID.test(m.station)) return 'bad_target';
  if (typeof m.target !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(m.target)) return 'bad_target';
  let taken: string | null = null;
  if (m.taken_at != null) {
    if (typeof m.taken_at !== 'string' || !TAKEN_AT.test(m.taken_at)) return 'bad_meta';
    const t = Date.parse(m.taken_at.length === 19 ? `${m.taken_at}Z` : m.taken_at);
    // A day of slack for a camera clock in another time zone.
    if (!Number.isFinite(t) || t > now.getTime() + 86_400_000 || t < Date.UTC(2000, 0, 1)) return 'bad_meta';
    taken = m.taken_at;
  }
  const lat = num(m.exif_lat);
  const lon = num(m.exif_lon);
  if ((m.exif_lat != null || m.exif_lon != null) && (lat === null || lon === null)) return 'bad_meta';
  if (lat !== null && lon !== null && (Math.abs(lat) > 90 || Math.abs(lon) > 180)) return 'bad_meta';
  return { station: m.station, target: m.target, taken_at: taken, exif_lat: lat, exif_lon: lon };
}

// One size: a clean JPEG whose longest side fits.
export function checkImage(bytes: Uint8Array, size: SizeName): { width: number; height: number } | null {
  if (bytes.length > SIZES[size].bytes || !isCleanJpeg(bytes)) return null;
  const s = jpegSize(bytes);
  if (!s) return null;
  const long = Math.max(s.width, s.height);
  if (long > SIZES[size].max || Math.min(s.width, s.height) < 1 || long < Math.min(MIN_SIDE, SIZES[size].max)) return null;
  return s;
}

// The three sizes must be the same picture: the same shape, within rounding.
export function sameShape(a: { width: number; height: number }, b: { width: number; height: number }): boolean {
  return Math.abs(a.width / a.height - b.width / b.height) < 0.02 * (a.width / a.height) + 2 / Math.min(b.width, b.height);
}

interface StationTarget {
  lat: number;
  lon: number;
  status: string;
  evse_id: string | null;
}

// A public station, or one that left the NAP but keeps its page.
async function findTarget(env: PhotoEnv, meta: PhotoMeta): Promise<StationTarget | null> {
  const db = env.DB;
  const station = await db.prepare(
    `SELECT lat, lon, status FROM stations WHERE id = ? AND status IN ${PUBLIC_SQL}`,
  ).bind(meta.station).first<{ lat: number; lon: number; status: string }>();
  if (!station) return null;
  if (meta.target === meta.station) return { ...station, evse_id: null };
  const socket = await db.prepare(
    'SELECT evse_id FROM evses WHERE station_id = ? AND evse_compact = ? LIMIT 1',
  ).bind(meta.station, meta.target).first<{ evse_id: string }>();
  return socket ? { ...station, evse_id: socket.evse_id } : null;
}

class PanoramaxError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`panoramax ${status}`);
    this.status = status;
  }
}

// The upload set API, as in panoramax/trial_upload.sh (Docs/infra.md, section 9).
async function sendToPanoramax(
  env: PhotoEnv, fetcher: Fetch, id: string, bytes: Uint8Array,
  p: { lat: number; lon: number; takenAt: string; semantics: { key: string; value: string }[] },
  onSet: (setId: string) => void,
): Promise<string> {
  const base = env.PANORAMAX_URL ?? PANORAMAX_URL;
  const auth = { authorization: `Bearer ${env.PANORAMAX_TOKEN}`, 'user-agent': 'OlhaOPosto' };
  const call = async (path: string, init: RequestInit) => {
    const r = await fetcher(base + path, { ...init, headers: { ...auth, ...(init.headers ?? {}) } });
    if (!r.ok) throw new PanoramaxError(r.status);
    return r.json() as Promise<Record<string, unknown>>;
  };
  const set = await call('/api/upload_sets', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: `OlhaOPosto ${id}`, estimated_nb_files: 1, no_split: true, visibility: 'owner-only' }),
  });
  const setId = String(set.id ?? '');
  if (!setId) throw new PanoramaxError(502);
  onSet(setId);
  const form = new FormData();
  // Panoramax only takes .jpg file names.
  form.append('file', new Blob([bytes], { type: 'image/jpeg' }), `${id}.jpg`);
  form.append('override_latitude', String(p.lat));
  form.append('override_longitude', String(p.lon));
  form.append('override_capture_time', p.takenAt);
  form.append('isBlurred', 'true');
  form.append('semantics', new Blob([JSON.stringify(p.semantics)], { type: 'application/json' }));
  const file = await call(`/api/upload_sets/${encodeURIComponent(setId)}/files`, { method: 'POST', body: form });
  const pictureId = String(file.picture_id ?? '');
  if (!pictureId) throw new PanoramaxError(502);
  await call(`/api/upload_sets/${encodeURIComponent(setId)}/complete`, { method: 'POST' });
  return pictureId;
}

// `signedIn` is for callers that have already checked who is sending (the
// MCP server, src/mcp.ts, with an OAuth grant or a token): everything after
// the sign-in check is the same.
export async function submitPhoto(
  request: Request, env: PhotoEnv, ctx: Waiter, fetcher: Fetch = fetch, now = new Date(),
  signedIn?: ApiSigner,
): Promise<Response> {
  if (!uploadsOpen(env)) return reply(503, { error: 'uploads_closed' });
  // A bearer token with photos:write (scripts and agents, src/tokens.ts), or
  // the session cookie from our own upload page. The cookie is SameSite=Lax,
  // which still lets another site post a form here; apiCaller's origin check
  // closes that, as on /auth/logout.
  const caller = signedIn ?? await apiCaller(request, env, 'photos:write', now);
  if ('error' in caller) return reply(caller.status, { error: caller.error });
  const { user, viaToken } = caller;
  // Before the body is read: a burst of uploads from one account is a script.
  if (!(await allowed(env.UPLOAD_LIMIT, user.id))) return reply(429, { error: 'too_fast' });
  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > MAX_BODY) return reply(413, { error: 'too_large' });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return reply(400, { error: 'bad_form' });
  }
  // Before anything is read or written: the cheap checks above stop most
  // junk, this one stops scripts with a stolen or scripted session. A token
  // is the person's own say-so that a program sends for them: no Turnstile,
  // the same limits and checks on the files.
  if (!viaToken && !(await turnstileOk(env, fetcher, form.get('turnstile'), request.headers.get('cf-connecting-ip')))) {
    return reply(403, { error: 'turnstile' });
  }
  const meta = parseMeta(form.get('meta'), now);
  if (typeof meta === 'string') return reply(400, { error: meta });

  const files = {} as Record<SizeName, Uint8Array>;
  const shapes = {} as Record<SizeName, { width: number; height: number }>;
  for (const name of Object.keys(SIZES) as SizeName[]) {
    const f = form.get(name);
    if (!f || typeof f === 'string') return reply(400, { error: 'bad_photo' });
    if (f.size > SIZES[name].bytes) return reply(413, { error: 'too_large' });
    files[name] = new Uint8Array(await f.arrayBuffer());
    const s = checkImage(files[name], name);
    if (!s) return reply(400, { error: 'bad_photo' });
    shapes[name] = s;
  }
  if (!sameShape(shapes.full, shapes.main) || !sameShape(shapes.full, shapes.thumb)) {
    return reply(400, { error: 'bad_photo' });
  }

  const target = await findTarget(env, meta);
  if (!target) return reply(400, { error: 'bad_target' });

  const dayStart = `${now.toISOString().slice(0, 10)}T00:00:00.000Z`;
  const count = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM photos WHERE uploader_id = ? AND created_at >= ?',
  ).bind(user.id, dayStart).first<{ n: number }>();
  if ((count?.n ?? 0) >= (DAILY_LIMIT[user.role] ?? DAILY_LIMIT_OTHERS)) return reply(429, { error: 'daily_limit' });

  const id = crypto.randomUUID();
  const createdAt = now.toISOString();
  const distance = meta.exif_lat !== null && meta.exif_lon !== null
    ? Math.round(distanceM(meta.exif_lat, meta.exif_lon, target.lat, target.lon))
    : null;
  const evse = meta.target === meta.station ? null : meta.target;
  // Trusted accounts publish directly when the station is active and the photo
  // was taken on site. Otherwise it goes to the moderation queue.
  const autoApprove = user.role === 'trusted'
    && target.status === 'active'
    && distance !== null
    && distance <= FAR_M;
  await env.DB.prepare(
    `INSERT INTO photos (id, station_id, evse_compact, uploader_id, taken_at, exif_lat, exif_lon, distance_m,
       credit, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'uploading', ?)`,
  ).bind(id, meta.station, evse, user.id, meta.taken_at, meta.exif_lat, meta.exif_lon, distance, user.name, createdAt).run();

  const staged = [`${id}/main.jpg`, `${id}/thumb.jpg`];
  let setId: string | null = null;
  try {
    const jpeg = { httpMetadata: { contentType: 'image/jpeg' } };
    await env.STAGING!.put(staged[0], files.main, jpeg);
    await env.STAGING!.put(staged[1], files.thumb, jpeg);
    const semantics = [
      ...(target.evse_id ? [{ key: 'osm|ref:EU:EVSE', value: target.evse_id }] : []),
      { key: 'OlhaOPosto|site', value: meta.station },
      { key: 'OlhaOPosto|author', value: user.name },
    ];
    // Panoramax gets the station's position, never the photographer's.
    const pictureId = await sendToPanoramax(env, fetcher, id, files.full, {
      lat: target.lat, lon: target.lon, takenAt: captureTime(meta.taken_at, now), semantics,
    }, (s) => { setId = s; });
    const finalStatus = autoApprove ? 'published' : 'pending';
    await env.DB.batch([
      env.DB.prepare(`UPDATE photos SET status = ?, panoramax_set = ?, panoramax_id = ?, approved_by = ?, approved_at = ? WHERE id = ?`)
        .bind(finalStatus, setId, pictureId, autoApprove ? user.id : null, autoApprove ? createdAt : null, id),
      env.DB.prepare('UPDATE users SET license_accepted_at = COALESCE(license_accepted_at, ?) WHERE id = ?')
        .bind(createdAt, user.id),
    ]);
    if (autoApprove) {
      // Make the set public and publish the static links, like a moderator
      // approving it (src/moderation.ts + src/publish.ts).
      const base = env.PANORAMAX_URL ?? PANORAMAX_URL;
      const headers = { authorization: `Bearer ${env.PANORAMAX_TOKEN}`, 'user-agent': 'OlhaOPosto' };
      if (setId) {
        await fetcher(`${base}/api/upload_sets/${encodeURIComponent(setId)}`, {
          method: 'PATCH',
          headers: { ...headers, 'content-type': 'application/json' },
          body: JSON.stringify({ visibility: 'anyone' }),
        }).catch(() => {});
      }
      try {
        const { publishMain } = await import('./publish.ts');
        await publishMain(env, id, user.id, fetcher, now);
      } catch {
        // The photo stays published; the link may be missing. A later
        // approval of the same target retries (publishMain is idempotent).
      }
      await awardApproval(env.DB as unknown as PointsDb, id, now).catch(() => []);
    }
  } catch (err) {
    // Leave nothing behind but the failed row.
    ctx.waitUntil(cleanUp(env, fetcher, staged, setId, id));
    if (err instanceof PanoramaxError && err.status === 409) return reply(409, { error: 'duplicate' });
    return reply(502, { error: 'upload_failed' });
  }
  return reply(201, { id, status: autoApprove ? 'published' : 'pending' });
}

// Panoramax wants a time zone. EXIF often has none; then it is the phone's
// local time, which in Portugal is at most an hour off UTC.
function captureTime(takenAt: string | null, now: Date): string {
  if (!takenAt) return now.toISOString();
  return takenAt.length === 19 ? `${takenAt}Z` : takenAt;
}

async function cleanUp(env: PhotoEnv, fetcher: Fetch, staged: string[], setId: string | null, id: string) {
  await env.STAGING!.delete(staged).catch(() => {});
  if (setId) {
    await fetcher(`${env.PANORAMAX_URL ?? PANORAMAX_URL}/api/upload_sets/${encodeURIComponent(setId)}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${env.PANORAMAX_TOKEN}`, 'user-agent': 'OlhaOPosto' },
    }).catch(() => {});
  }
  await env.DB.prepare(`UPDATE photos SET status = 'failed' WHERE id = ?`).bind(id).run().catch(() => {});
}
