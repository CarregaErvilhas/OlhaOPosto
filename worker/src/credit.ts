// The credit: the name that goes with a person's photos (Docs/arquitetura.md,
// *Crédito*). By default it is the OSM name; on the account page the person
// can choose a pseudonym instead, or go back to the OSM name.
//
// A change rewrites the credit everywhere it lives:
//   - photos.credit, read by the pages and the API (one UPDATE);
//   - the XMP of the three copies in `pictures` of each main photo of the
//     person (rewritten in place, then purged from the edge cache);
//   - the OlhaOPosto|author tag of each photo on Panoramax (one PATCH each).
// The last two are many requests, so they are marks in D1
// (selections.credit_pending, photos.author_tag_old) worked off in small
// batches: right after the change, and again by the cron every 6 hours
// until none are left. Each step is safe to repeat.
import { isCleanJpeg, stripMetadata } from '../public/jpeg.js';
import { CACHE_CONTROL, SIZES, pictureUrls, purgeUrls, withXmp, xmpPacket, type PublishEnv } from './publish.ts';
import { PANORAMAX_URL } from './pages.ts';
import { nameKey } from './types.ts';

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

interface Stmt {
  bind(...values: unknown[]): Stmt;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes: number } }>;
}
export interface CreditDb {
  prepare(sql: string): Stmt;
  batch(stmts: Stmt[]): Promise<unknown[]>;
}
interface R2Body {
  etag: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}
interface PicturesBucket {
  get(key: string): Promise<R2Body | null>;
  put(key: string, value: Uint8Array, options: {
    httpMetadata: { contentType: string; cacheControl: string };
    onlyIf?: { etagMatches: string };
  }): Promise<unknown | null>;
}

const db = (env: PublishEnv) => env.DB as unknown as CreditDb;

export const MIN_LEN = 2;
export const MAX_LEN = 40;
export const CHANGE_EVERY_MS = 24 * 3600 * 1000;
export const AUTHOR_TAG = 'OlhaOPosto|author';

// Names nobody gets as a pseudonym: they would read as the site or its team.
const RESERVED = new Set(['olhaoposto', 'olhoposto', 'admin', 'administrador', 'administrator', 'moderador', 'moderator',
  'moderacao', 'moderation', 'panoramax', 'openstreetmap', 'osm', 'mobie', 'anonimo', 'anonymous']);

// Letters, combining marks (after NFC, only where no precomposed form
// exists), digits, spaces and simple punctuation. Nothing that makes a link
// (no @, /, :) or that hides (fillers that look like a space).
const ALLOWED = /^[\p{L}\p{M}\p{N} .,'’()!?&+_-]+$/u;
const INVISIBLE_LETTERS = /[\u115F\u1160\u3164\uFFA0]/u;
const TOO_MANY_MARKS = /\p{M}{3}/u;
// A scheme, www. or something that looks like a domain (word.word).
const URL_LIKE = /(?:[a-z][a-z0-9+.-]*:\/\/|www\.|[\p{L}\p{N}-]{2,}\.[\p{L}]{2,})/iu;

// The name as stored: NFC, every run of whitespace one space, no control
// or format characters (zero-width spaces, direction marks), trimmed.
export function normalizeName(raw: string): string {
  return raw.normalize('NFC')
    .replace(/[\t\n\v\f\r\p{Z}]+/gu, ' ')
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .replace(/ {2,}/g, ' ')
    .trim();
}

export type CreditError =
  | 'credit_length' | 'credit_chars' | 'credit_url' | 'credit_reserved'
  | 'credit_taken' | 'credit_daily' | 'credit_same';

// The shape rules only: what D1 decides (taken, daily) is in changeCredit.
export function parseCredit(raw: unknown): { name: string; key: string } | CreditError {
  if (typeof raw !== 'string' || raw.length > 400) return 'credit_length';
  const name = normalizeName(raw);
  const len = [...name].length;
  if (len < MIN_LEN || len > MAX_LEN) return 'credit_length';
  // Links first: «ftp://x» is better told it is a link than that ':' is out.
  if (URL_LIKE.test(name)) return 'credit_url';
  if (!ALLOWED.test(name) || INVISIBLE_LETTERS.test(name) || TOO_MANY_MARKS.test(name)) return 'credit_chars';
  const key = nameKey(name);
  // At least two letters or digits: «-.» is not a name.
  if ([...key].length < 2) return 'credit_chars';
  if (RESERVED.has(key)) return 'credit_reserved';
  return { name, key };
}

interface Me {
  osm_name: string;
  pseudonym: string | null;
  pseudonym_changed_at: string | null;
}

export async function creditState(d: CreditDb, userId: string): Promise<Me | null> {
  return d.prepare('SELECT osm_name, pseudonym, pseudonym_changed_at FROM users WHERE id = ?').bind(userId).first<Me>();
}

// When the next change is allowed, or null when it is allowed now.
export function nextChangeAt(me: Pick<Me, 'pseudonym_changed_at'>, now: Date): Date | null {
  if (!me.pseudonym_changed_at) return null;
  const next = new Date(Date.parse(me.pseudonym_changed_at) + CHANGE_EVERY_MS);
  return next > now ? next : null;
}

// Is this key someone else's OSM name or pseudonym? Accounts from before
// osm_key existed get it here, once.
async function taken(d: CreditDb, userId: string, key: string): Promise<boolean> {
  const { results: missing } = await d.prepare('SELECT id, osm_name FROM users WHERE osm_key IS NULL LIMIT 2000')
    .all<{ id: string; osm_name: string }>();
  let clash = false;
  if (missing.length) {
    const fill: Stmt[] = [];
    for (const u of missing) {
      const k = nameKey(u.osm_name);
      if (u.id !== userId && k === key) clash = true;
      fill.push(d.prepare('UPDATE users SET osm_key = ? WHERE id = ? AND osm_key IS NULL').bind(k, u.id));
    }
    await d.batch(fill).catch(() => {});
  }
  if (clash) return true;
  const row = await d.prepare('SELECT 1 AS x FROM users WHERE id != ?1 AND (pseudonym_key = ?2 OR osm_key = ?2) LIMIT 1')
    .bind(userId, key).first<{ x: number }>();
  return row !== null;
}

// Sets the pseudonym (raw text from the form) or, with null, goes back to the
// OSM name. Writes the new credit on every photo of the person and marks the
// copies and tags to redo, all in one D1 transaction. Returns the new credit.
export async function changeCredit(
  d: CreditDb, userId: string, raw: unknown | null, now = new Date(),
): Promise<{ credit: string } | CreditError> {
  const me = await creditState(d, userId);
  if (!me) return 'credit_same';
  if (nextChangeAt(me, now)) return 'credit_daily';
  const current = me.pseudonym ?? me.osm_name;
  let pseudonym: string | null = null;
  let key: string | null = null;
  if (raw === null) {
    if (me.pseudonym === null) return 'credit_same';
  } else {
    const p = parseCredit(raw);
    if (typeof p === 'string') return p;
    if (p.name === current) return 'credit_same';
    // The OSM name itself, maybe in other case or accents, is theirs to use.
    if (p.key !== nameKey(me.osm_name) && await taken(d, userId, p.key)) return 'credit_taken';
    // Exactly the OSM name: no pseudonym at all.
    if (p.name !== me.osm_name) {
      pseudonym = p.name;
      key = p.key;
    }
  }
  const credit = pseudonym ?? me.osm_name;
  const at = now.toISOString();
  const cutoff = new Date(now.getTime() - CHANGE_EVERY_MS).toISOString();
  // The photo updates only apply if the users row took this change: a second
  // submit racing this one changes nothing.
  const mine = 'EXISTS (SELECT 1 FROM users WHERE id = ?2 AND pseudonym_changed_at = ?3)';
  let results: unknown[];
  try {
    results = await d.batch([
      d.prepare(
        `UPDATE users SET pseudonym = ?1, pseudonym_key = ?2, pseudonym_changed_at = ?3
         WHERE id = ?4 AND (pseudonym_changed_at IS NULL OR pseudonym_changed_at <= ?5)`,
      ).bind(pseudonym, key, at, userId, cutoff),
      d.prepare(
        `UPDATE selections SET credit_pending = 1
         WHERE photo_id IN (SELECT id FROM photos WHERE uploader_id = ?1) AND ${mine.replace('?2', '?1').replace('?3', '?2')}`,
      ).bind(userId, at),
      // Photos still on Panoramax keep the value that is there now (the first
      // old one, if an earlier change is not done yet) to swap it.
      d.prepare(
        `UPDATE photos SET
           author_tag_old = CASE WHEN status IN ('uploading', 'pending', 'published', 'hidden')
             THEN COALESCE(author_tag_old, credit) ELSE NULL END,
           credit = ?1
         WHERE uploader_id = ?2 AND ${mine}`,
      ).bind(credit, userId, at),
    ]);
  } catch {
    // The unique index on pseudonym_key: someone took it a moment ago.
    return 'credit_taken';
  }
  const first = results[0] as { meta?: { changes?: number } } | undefined;
  if (first?.meta && first.meta.changes === 0) return 'credit_daily';
  return { credit };
}

// Per run, within the Free plan's 50 subrequests (shared with the takedown
// reconcile in the cron) and its CPU time: a JPEG rewrite is a copy of a few
// MB, a tag is one small PATCH.
export const COPY_BATCH = 5;
export const TAG_BATCH = 25;

interface PendingCopy {
  target: string;
  photo_id: string;
  station_id: string;
  credit: string | null;
  status: string;
}

// Rewrites the XMP of the copies whose credit changed, and purges them.
async function syncCopies(env: PublishEnv, fetcher: Fetch): Promise<number> {
  const d = db(env);
  const { results } = await d.prepare(
    `SELECT s.target, s.photo_id, p.station_id, p.credit, p.status
     FROM selections s JOIN photos p ON p.id = s.photo_id
     WHERE s.credit_pending = 1 AND s.lost_at IS NULL ORDER BY s.chosen_at LIMIT ?`,
  ).bind(COPY_BATCH).all<PendingCopy>();
  if (!results.length) return 0;
  const pictures = env.PICTURES as PicturesBucket | undefined;
  const done: PendingCopy[] = [];
  const purge: string[] = [];
  for (const row of results) {
    // A photo being hidden (src/takedown.ts) keeps its copies out of reach:
    // never write them back.
    if (row.status !== 'published') {
      done.push(row);
      continue;
    }
    if (!pictures) continue;
    try {
      const packet = xmpPacket({ author: row.credit ?? 'olh\'o\'posto', photoId: row.photo_id });
      for (const size of SIZES) {
        const key = `${row.target}${size.suffix}.jpg`;
        const obj = await pictures.get(key);
        if (!obj) continue;
        const clean = stripMetadata(new Uint8Array(await obj.arrayBuffer()));
        if (!clean || !isCleanJpeg(clean)) throw new Error(`${key} not a jpeg`);
        // Only over the bytes just read: if a new main photo landed in the
        // meantime (src/publish.ts chooseMain), it already has the credit.
        await pictures.put(key, withXmp(clean, packet), {
          httpMetadata: { contentType: 'image/jpeg', cacheControl: CACHE_CONTROL },
          onlyIf: { etagMatches: obj.etag },
        });
      }
      purge.push(...pictureUrls(row.target));
      done.push(row);
    } catch {
      // Left marked: the next run tries again.
    }
  }
  // Without the purge the edge keeps the old credit for up to 30 days; keep
  // the marks so the next run purges again. With no purge secrets (local
  // runs) there is nothing to wait for.
  const purgeable = Boolean(env.CF_ZONE_ID && env.CF_CACHE_PURGE_TOKEN);
  const purged = await purgeUrls(env, purge, fetcher);
  const clear = done.filter((r) => r.status !== 'published' || purged || !purgeable);
  if (clear.length) {
    // Only if the credit is still the one written: a later change marks again.
    await d.batch(clear.map((r) => d.prepare(
      `UPDATE selections SET credit_pending = 0
       WHERE target = ? AND photo_id = ? AND (SELECT credit FROM photos WHERE id = ?) IS ?`,
    ).bind(r.target, r.photo_id, r.photo_id, r.credit)));
  }
  return results.length;
}

interface PendingTag {
  id: string;
  panoramax_id: string;
  credit: string | null;
  author_tag_old: string;
}

// Swaps the OlhaOPosto|author tag on Panoramax for the photos whose credit
// changed. Deleting the new value before adding it makes a retry after a
// lost reply harmless (Panoramax refuses a duplicate tag).
async function syncTags(env: PublishEnv, fetcher: Fetch): Promise<number> {
  const d = db(env);
  // Rejected or failed photos are gone from Panoramax: nothing to swap.
  await d.prepare(
    `UPDATE photos SET author_tag_old = NULL
     WHERE author_tag_old IS NOT NULL AND (status IN ('failed', 'removed') OR credit IS author_tag_old)`,
  ).run();
  if (!env.PANORAMAX_TOKEN) return 0;
  const { results } = await d.prepare(
    `SELECT id, panoramax_id, credit, author_tag_old FROM photos
     WHERE author_tag_old IS NOT NULL AND panoramax_id IS NOT NULL AND credit IS NOT NULL
       AND status IN ('pending', 'published', 'hidden')
     ORDER BY created_at LIMIT ?`,
  ).bind(TAG_BATCH).all<PendingTag>();
  const base = env.PANORAMAX_URL ?? PANORAMAX_URL;
  const done: PendingTag[] = [];
  for (const p of results) {
    const credit = p.credit!;
    const r = await fetcher(`${base}/api/pictures/${encodeURIComponent(p.panoramax_id)}`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${env.PANORAMAX_TOKEN}`, 'user-agent': 'OlhaOPosto', 'content-type': 'application/json' },
      body: JSON.stringify({
        semantics: [
          { action: 'delete', key: AUTHOR_TAG, value: p.author_tag_old },
          { action: 'delete', key: AUTHOR_TAG, value: credit },
          { action: 'add', key: AUTHOR_TAG, value: credit },
        ],
      }),
    }).catch(() => null);
    // 404: the picture is gone, nothing left to tag.
    if (r && (r.ok || r.status === 404)) done.push(p);
  }
  if (done.length) {
    // If the credit changed again meanwhile, what is on Panoramax now is the
    // value just written: that is the one to swap next.
    await d.batch(done.map((p) => d.prepare(
      'UPDATE photos SET author_tag_old = CASE WHEN credit IS ?1 THEN NULL ELSE ?1 END WHERE id = ?2',
    ).bind(p.credit, p.id)));
  }
  return results.length;
}

// One batch of each. Called after a change (in waitUntil) and by the cron.
export async function syncCredits(env: PublishEnv, fetcher: Fetch = fetch): Promise<{ copies: number; tags: number }> {
  const copies = await syncCopies(env, fetcher).catch(() => 0);
  const tags = await syncTags(env, fetcher).catch(() => 0);
  return { copies, tags };
}
