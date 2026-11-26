// Main photos and static links (Docs/plan.md, *Publicação dos links estáticos*).
//
// When a moderator approves a photo, it becomes the main photo of its target
// (the socket, or the station for a photo of the station in general) if that
// target has none yet. A socket photo also becomes the station's main photo
// when the station has none: most uploads pick a socket, and the station link
// is the one apps use most.
//
// Publishing copies three sizes into the public bucket `pictures`, served by
// pictures.ocarroeletrico.com without a Worker:
//   <target>.jpg        1024 px, from pictures-staging
//   <target>.thumb.jpg   400 px, from pictures-staging
//   <target>.full.jpg   2048 px, from Panoramax (the only copy of that size)
// Each copy gets an XMP packet with the author and the licence (and nothing
// else: the 2048 px copy loses the EXIF Panoramax wrote into it): R2 cannot
// send headers of its own, and CC BY-SA needs the credit to travel with the
// file. No GPS, no other metadata.
//
// No cache purge is needed for a first photo: the Cache Rule on pictures.*
// never stores a 4xx (Docs/cloudflare.md, section 3). Replacing a main photo
// will need one; that is not built yet.

import { isCleanJpeg, stripMetadata } from '../public/jpeg.js';
import { PANORAMAX_URL, type PhotoEnv } from './photos.ts';
import { PICTURES, SITE, photoPath } from './pages.ts';
import { STATION_ID } from './types.ts';
import { awardRefresh, type PointsDb } from './points.ts';

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

interface PublicBucket {
  put(key: string, value: Uint8Array, options: { httpMetadata: { contentType: string; cacheControl: string } }): Promise<unknown>;
  delete(keys: string[]): Promise<void>;
}
interface StagingBucket {
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
}
interface Stmt {
  bind(...values: unknown[]): Stmt;
  first<T>(): Promise<T | null>;
  run(): Promise<{ meta: { changes: number } }>;
}
export interface PublishEnv extends PhotoEnv {
  PICTURES?: unknown;
}
const db = (env: PublishEnv) => env.DB as unknown as { prepare(sql: string): Stmt };

const LICENSE_URL = 'https://creativecommons.org/licenses/by-sa/4.0/';
const CACHE_CONTROL = 'public, max-age=86400';
export const SIZES = [
  { suffix: '', staged: 'main' },
  { suffix: '.thumb', staged: 'thumb' },
  { suffix: '.full', staged: null },
] as const;

const xml = (s: string) => s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);

// An XMP packet with creator, rights, licence and where the credit lives.
export function xmpPacket(p: { author: string; photoId: string }): string {
  const author = xml(p.author);
  const page = xml(SITE + photoPath('pt', p.photoId));
  return `<?xpacket begin="\u{FEFF}" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmpRights="http://ns.adobe.com/xap/1.0/rights/" xmlns:cc="http://creativecommons.org/ns#">
<dc:creator><rdf:Seq><rdf:li>${author}</rdf:li></rdf:Seq></dc:creator>
<dc:rights><rdf:Alt><rdf:li xml:lang="x-default">© ${author}, CC BY-SA 4.0, via olh'o'posto</rdf:li></rdf:Alt></dc:rights>
<xmpRights:Marked>True</xmpRights:Marked>
<xmpRights:WebStatement>${page}</xmpRights:WebStatement>
<cc:license rdf:resource="${LICENSE_URL}"/>
<cc:attributionName>${author}</cc:attributionName>
</rdf:Description></rdf:RDF></x:xmpmeta>
<?xpacket end="r"?>`;
}

const XMP_NS = 'http://ns.adobe.com/xap/1.0/\0';

// The JPEG with an APP1 XMP segment after SOI (and after APP0 JFIF, which
// must stay first). The input is a clean JPEG from the upload checks.
export function withXmp(jpeg: Uint8Array, packet: string): Uint8Array {
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error('not a jpeg');
  const payload = new TextEncoder().encode(XMP_NS + packet);
  const length = payload.length + 2;
  if (length > 0xffff) throw new Error('xmp too large');
  let at = 2;
  if (jpeg[2] === 0xff && jpeg[3] === 0xe0) at = 4 + ((jpeg[4] << 8) | jpeg[5]);
  const out = new Uint8Array(jpeg.length + 2 + length);
  out.set(jpeg.subarray(0, at), 0);
  out.set([0xff, 0xe1, length >> 8, length & 0xff], at);
  out.set(payload, at + 4);
  out.set(jpeg.subarray(at), at + 2 + length);
  return out;
}

interface Approved {
  id: string;
  station_id: string;
  evse_compact: string | null;
  credit: string | null;
  panoramax_id: string | null;
}

// Targets this approval makes main, already claimed in `selections`.
async function claim(env: PublishEnv, p: Approved, userId: string, now: string): Promise<string[]> {
  const targets = p.evse_compact ? [p.evse_compact, p.station_id] : [p.station_id];
  const won: string[] = [];
  for (const target of targets) {
    const r = await db(env).prepare(
      `INSERT OR IGNORE INTO selections (target, station_id, photo_id, chosen_by, chosen_at) VALUES (?, ?, ?, ?, ?)`,
    ).bind(target, p.station_id, p.id, userId, now).run();
    if (r.meta.changes === 1) won.push(target);
  }
  return won;
}

// Publishes an approved photo as main where its targets have none. Returns
// the targets published. On a failure the claims are released, so the next
// approval of that target can try again, and the error goes up.
export async function publishMain(
  env: PublishEnv, photoId: string, userId: string, fetcher: Fetch = fetch, now = new Date(),
): Promise<string[]> {
  if (!env.PICTURES || !env.STAGING) return [];
  const p = await db(env).prepare(
    `SELECT id, station_id, evse_compact, credit, panoramax_id FROM photos WHERE id = ? AND status = 'published'`,
  ).bind(photoId).first<Approved>();
  if (!p) return [];
  const targets = await claim(env, p, userId, now.toISOString());
  if (targets.length === 0) return [];
  const pictures = env.PICTURES as PublicBucket;
  const staging = env.STAGING as unknown as StagingBucket;
  const written: string[] = [];
  try {
    const bytes: Record<string, Uint8Array> = {};
    for (const size of SIZES) {
      if (size.staged) {
        const obj = await staging.get(`${p.id}/${size.staged}.jpg`);
        if (!obj) throw new Error(`staging ${size.staged} missing`);
        bytes[size.suffix] = new Uint8Array(await obj.arrayBuffer());
      } else {
        if (!p.panoramax_id) throw new Error('no panoramax id');
        const base = env.PANORAMAX_URL ?? PANORAMAX_URL;
        const r = await fetcher(`${base}/api/pictures/${encodeURIComponent(p.panoramax_id)}/hd.jpg`, {
          headers: { authorization: `Bearer ${env.PANORAMAX_TOKEN}`, 'user-agent': 'OlhaOPosto' },
        });
        if (!r.ok) throw new Error(`panoramax hd ${r.status}`);
        // Panoramax writes its own EXIF into hd.jpg (the station's position,
        // the capture time): strip it, like the browser did for our copies.
        const clean = stripMetadata(new Uint8Array(await r.arrayBuffer()));
        if (!clean || !isCleanJpeg(clean)) throw new Error('panoramax hd not clean');
        bytes[size.suffix] = clean;
      }
    }
    const packet = xmpPacket({ author: p.credit ?? 'olh\'o\'posto', photoId: p.id });
    for (const target of targets) {
      for (const size of SIZES) {
        const key = `${target}${size.suffix}.jpg`;
        await pictures.put(key, withXmp(bytes[size.suffix], packet), {
          httpMetadata: { contentType: 'image/jpeg', cacheControl: CACHE_CONTROL },
        });
        written.push(key);
      }
      await db(env).prepare('UPDATE selections SET published_at = ? WHERE target = ? AND photo_id = ?')
        .bind(now.toISOString(), target, p.id).run();
    }
    return targets;
  } catch (err) {
    await pictures.delete(written).catch(() => {});
    for (const target of targets) {
      await db(env).prepare('DELETE FROM selections WHERE target = ? AND photo_id = ?').bind(target, p.id).run().catch(() => {});
    }
    throw err;
  }
}

// Choose (or replace) the main photo of a target. Trusted or moderator only
// (enforced by the caller). Copies the three sizes over the existing keys and
// purges the cache. Returns the targets published.
export async function chooseMain(
  env: PublishEnv, target: string, photoId: string, userId: string,
  fetcher: Fetch = fetch, now = new Date(),
): Promise<string[]> {
  if (!env.PICTURES || !env.STAGING || !STATION_ID.test(target)) return [];
  const p = await db(env).prepare(
    `SELECT id, station_id, evse_compact, credit, panoramax_id FROM photos WHERE id = ? AND status = 'published'`,
  ).bind(photoId).first<Approved>();
  // The target comes from the photo, not from its shape: a compact EVSE code
  // (PTEZCEAMD000511) also passes STATION_ID. A station takes only a photo of
  // the station in general; a socket, only a photo of that socket.
  if (!p) return [];
  const stationId = p.station_id;
  const ok = p.evse_compact ? target === p.evse_compact : target === p.station_id;
  if (!ok) return [];

  const old = await db(env).prepare(
    `SELECT photo_id, published_at FROM selections WHERE target = ?`,
  ).bind(target).first<{ photo_id: string; published_at: string | null }>();

  const targets = [target];
  const pictures = env.PICTURES as PublicBucket;
  const staging = env.STAGING as unknown as StagingBucket;
  const written: string[] = [];
  try {
    const bytes: Record<string, Uint8Array> = {};
    for (const size of SIZES) {
      if (size.staged) {
        const obj = await staging.get(`${p.id}/${size.staged}.jpg`);
        if (!obj) throw new Error(`staging ${size.staged} missing`);
        bytes[size.suffix] = new Uint8Array(await obj.arrayBuffer());
      } else {
        if (!p.panoramax_id) throw new Error('no panoramax id');
        const base = env.PANORAMAX_URL ?? PANORAMAX_URL;
        const r = await fetcher(`${base}/api/pictures/${encodeURIComponent(p.panoramax_id)}/hd.jpg`, {
          headers: { authorization: `Bearer ${env.PANORAMAX_TOKEN}`, 'user-agent': 'OlhaOPosto' },
        });
        if (!r.ok) throw new Error(`panoramax hd ${r.status}`);
        const clean = stripMetadata(new Uint8Array(await r.arrayBuffer()));
        if (!clean || !isCleanJpeg(clean)) throw new Error('panoramax hd not clean');
        bytes[size.suffix] = clean;
      }
    }
    const packet = xmpPacket({ author: p.credit ?? 'olh\'o\'posto', photoId: p.id });
    for (const t of targets) {
      for (const size of SIZES) {
        const key = `${t}${size.suffix}.jpg`;
        await pictures.put(key, withXmp(bytes[size.suffix], packet), {
          httpMetadata: { contentType: 'image/jpeg', cacheControl: CACHE_CONTROL },
        });
        written.push(key);
      }
    }
    const nowIso = now.toISOString();
    await db(env).prepare(
      `INSERT INTO selections (target, station_id, photo_id, chosen_by, chosen_at, published_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(target) DO UPDATE SET photo_id=excluded.photo_id, chosen_by=excluded.chosen_by, chosen_at=excluded.chosen_at, published_at=excluded.published_at`,
    ).bind(target, stationId, photoId, userId, nowIso, nowIso).run();

    // Purge the cache for the three keys.
    await purgeCache(env, targets, fetcher).catch(() => {});

    // +2 for the author when the replaced main photo was over 12 months old.
    if (old && old.photo_id !== photoId) {
      await awardRefresh(env.DB as unknown as PointsDb, photoId, old.published_at, now).catch(() => false);
    }
    return targets;
  } catch (err) {
    await pictures.delete(written).catch(() => {});
    throw err;
  }
}

// The three public URLs of a target on pictures.*.
export const pictureUrls = (target: string) =>
  SIZES.map((size) => `${PICTURES}/${encodeURIComponent(target)}${size.suffix}.jpg`);

async function purgeCache(env: PublishEnv, targets: string[], fetcher: Fetch): Promise<void> {
  await purgeUrls(env, targets.flatMap(pictureUrls), fetcher);
}

// Purges URLs from the zone's edge cache. False when the secrets are missing
// or Cloudflare says no: the caller decides whether that matters (a takedown
// records it, since the Cache Rule keeps a 200 for 30 days).
export async function purgeUrls(env: PublishEnv, files: string[], fetcher: Fetch): Promise<boolean> {
  if (!env.CF_ZONE_ID || !env.CF_CACHE_PURGE_TOKEN) return false;
  if (files.length === 0) return true;
  try {
    const r = await fetcher(`https://api.cloudflare.com/client/v4/zones/${env.CF_ZONE_ID}/purge_cache`, {
      method: 'POST',
      headers: { authorization: `Bearer ${env.CF_CACHE_PURGE_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ files }),
    });
    return r.ok;
  } catch {
    return false;
  }
}
