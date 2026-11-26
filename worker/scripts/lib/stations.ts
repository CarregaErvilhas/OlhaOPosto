// Pure part of the station import: feed -> rows -> diff against D1 -> SQL.
// No I/O here, so it can be unit tested (test/stations.test.ts).

import { createHash } from 'node:crypto';

export interface FeedPoint {
  id: string;
  evse?: string | null;   // NAP EVSE code as published, PT*EDP*E*LSB*90050*01
  kw?: number | null;
  connector?: string | null;
  dc?: boolean;
}

export interface FeedSite {
  id: string;
  code?: string | null;
  operatorId?: string | null;
  operator?: string | null;
  name?: string | null;
  address?: string | null;
  city?: string | null;
  region?: string | null;
  lat: number;
  lon: number;
  osm?: { element?: string | null } | null;
  points?: FeedPoint[];
  photos?: FeedPhoto[];
}

// A photo the NAP dashboard found through OSM tags (charger_photos.py). The
// thumbnail is published next to the dashboard; `page` is the source page.
export interface FeedPhoto {
  src?: string | null;       // photos/<hash>.jpg on nap.ocarroeletrico.com
  credit?: string | null;
  license?: string | null;
  page?: string | null;
  taken?: string | null;
  map?: string | null;       // our own photos carry their Panoramax map link here
  published?: string | null;
}

export interface Feed {
  schema: number;
  generatedAt: string;
  sites: FeedSite[];
}

export interface StationRow {
  id: string;
  code: string | null;
  opc: string | null;
  operator: string | null;
  name: string | null;
  address: string | null;
  municipality: string | null;
  region: string | null;
  lat: number;
  lon: number;
  osm_ref: string | null;
}

export interface EvseRow {
  station_id: string;
  point_id: string;
  evse_id: string | null;
  evse_compact: string | null;
  connector: string | null;
  max_kw: number | null;
  dc: 0 | 1;
}

// What D1 already has. Only the columns the import owns, plus status/source.
export interface CurrentStation extends StationRow {
  source: string;
  status: string;
}

export interface CurrentEvse extends EvseRow {
  status: string;
}

const STATION_FIELDS = ['code', 'opc', 'operator', 'name', 'address', 'municipality',
  'region', 'lat', 'lon', 'osm_ref'] as const;
const EVSE_FIELDS = ['evse_id', 'evse_compact', 'connector', 'max_kw', 'dc'] as const;

export const STATION_COLUMNS = ['id', ...STATION_FIELDS] as const;
export const EVSE_COLUMNS = ['station_id', 'point_id', ...EVSE_FIELDS] as const;

const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : null;

// The EVSE code without the `*` (PTEDPELSB9005001), for links. Nothing else is
// normalised: OSM's ref:EU:EVSE matches the NAP code as published, leading
// zeros included. Not unique: a few operators publish one code on two sites.
export const compactEvse = (evse: string | null): string | null =>
  evse === null ? null : evse.replace(/\*/g, '') || null;

export function validateFeed(feed: unknown): Feed {
  const f = feed as Feed;
  if (!f || f.schema !== 1 || !Array.isArray(f.sites) || typeof f.generatedAt !== 'string') {
    throw new Error('feed: unexpected shape (schema 1 with generatedAt and sites[] expected)');
  }
  return f;
}

export interface ExternalPhotoRow {
  id: string;
  station_id: string;
  origin: 'osm_panoramax' | 'commons';
  external_ref: string;
  external_src: string;
  source_url: string;
  credit: string | null;
  license: string;
  taken_at: string | null;
}

export const EXTERNAL_FIELDS = ['external_src', 'source_url', 'credit', 'license', 'taken_at'] as const;
export const EXTERNAL_COLUMNS = ['id', 'station_id', 'origin', 'external_ref', ...EXTERNAL_FIELDS] as const;

// Where the NAP dashboard publishes the thumbnails it copies.
export const THUMB_BASE = 'https://nap.ocarroeletrico.com/';
const THUMB_SRC = /^photos\/[A-Za-z0-9_-]+\.(?:jpe?g|png|webp)$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Our own pages and Panoramax server: those photos are ours, not external.
const OWN_HOSTS = new Set(['olhaoposto.ocarroeletrico.com', 'panoramax.ocarroeletrico.com']);

const url = (v: unknown): URL | null => {
  const s = str(v);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' ? u : null;
  } catch {
    return null;
  }
};

// The picture UUID in a Panoramax link (#focus=pic&pic=<uuid>, ?pic=<uuid>).
function panoramaxUuid(u: URL): string | null {
  const q = new URLSearchParams(u.hash.replace(/^#/, '')).get('pic') ?? u.searchParams.get('pic');
  return q && UUID.test(q) ? q.toLowerCase() : null;
}

// A deterministic id, so a rerun updates the same row and the API link is stable.
export const externalId = (stationId: string, origin: string, ref: string): string =>
  `ext_${createHash('sha256').update(`${stationId}\u0000${origin}\u0000${ref}`).digest('hex').slice(0, 24)}`;

// The external photos of the feed: Panoramax pictures and Commons files from
// OSM, with a thumbnail, a licence and a source link. Mapillary and anything
// unknown are left out, and so is any photo that is one of ours: its page is
// ours, or its Panoramax UUID is in ownPanoramax (photos.panoramax_id of
// origin olhaoposto).
export function toExternalPhotos(feed: Feed, ownPanoramax: ReadonlySet<string> = new Set()): ExternalPhotoRow[] {
  const out: ExternalPhotoRow[] = [];
  const seen = new Set<string>();
  for (const s of feed.sites) {
    const stationId = str(s.id);
    if (!stationId || !Number.isFinite(s.lat) || !Number.isFinite(s.lon)) continue;
    for (const p of s.photos ?? []) {
      const page = url(p.page);
      const src = str(p.src);
      const license = str(p.license);
      if (!page || !src || !license || !THUMB_SRC.test(src)) continue;
      const map = url(p.map);
      if (OWN_HOSTS.has(page.hostname) || (map && OWN_HOSTS.has(map.hostname))) continue;
      let origin: ExternalPhotoRow['origin'];
      let ref: string | null;
      if (page.hostname.endsWith('wikimedia.org') || page.hostname.endsWith('wikipedia.org')) {
        origin = 'commons';
        const file = /\/wiki\/(File:[^?#]+)/.exec(page.pathname)?.[1] ?? page.searchParams.get('title');
        ref = file ? decodeURIComponent(file).replace(/_/g, ' ') : null;
      } else if (page.hostname.includes('panoramax')) {
        origin = 'osm_panoramax';
        ref = panoramaxUuid(page);
        if (ref && ownPanoramax.has(ref)) continue;
      } else {
        continue;   // Mapillary (its API needs a key) and the rest
      }
      if (!ref) continue;
      const id = externalId(stationId, origin, ref);
      if (seen.has(id)) continue;
      seen.add(id);
      const taken = str(p.taken);
      out.push({
        id, station_id: stationId, origin, external_ref: ref,
        external_src: new URL(src, THUMB_BASE).href, source_url: page.href,
        credit: str(p.credit), license, taken_at: taken && /^\d{4}-\d{2}-\d{2}/.test(taken) ? taken : null,
      });
    }
  }
  return out;
}

export function toRows(feed: Feed): { stations: StationRow[]; evses: EvseRow[]; skipped: string[] } {
  const stations: StationRow[] = [];
  const evses: EvseRow[] = [];
  const skipped: string[] = [];
  const seen = new Set<string>();
  for (const s of feed.sites) {
    const id = str(s.id);
    // A site without an id or coordinates cannot get a page or a link.
    if (!id || !Number.isFinite(s.lat) || !Number.isFinite(s.lon) || seen.has(id)) {
      skipped.push(id ?? '(no id)');
      continue;
    }
    seen.add(id);
    stations.push({
      id,
      code: str(s.code),
      opc: str(s.operatorId),
      operator: str(s.operator),
      name: str(s.name),
      address: str(s.address),
      municipality: str(s.city),
      region: str(s.region),
      lat: s.lat,
      lon: s.lon,
      osm_ref: str(s.osm?.element),
    });
    const points = new Set<string>();
    for (const p of s.points ?? []) {
      const pid = str(p.id);
      if (!pid || points.has(pid)) continue;
      points.add(pid);
      const evse = str(p.evse);
      evses.push({
        station_id: id,
        point_id: pid,
        evse_id: evse,
        evse_compact: compactEvse(evse),
        connector: str(p.connector),
        max_kw: typeof p.kw === 'number' && Number.isFinite(p.kw) ? p.kw : null,
        dc: p.dc ? 1 : 0,
      });
    }
  }
  return { stations, evses, skipped };
}

export interface Diff {
  insertStations: StationRow[];
  updateStations: StationRow[];   // changed fields, or back from missing_from_nap
  missingStations: string[];      // active NAP stations no longer in the feed
  insertEvses: EvseRow[];
  updateEvses: EvseRow[];
  missingEvses: EvseRow[];
  conflicts: string[];            // feed ids that exist in D1 as community/pending rows
}

const evseKey = (e: { station_id: string; point_id: string }) => `${e.station_id}\u0000${e.point_id}`;

function changed<T extends object>(a: T, b: T, fields: readonly (keyof T)[]): boolean {
  return fields.some((f) => (a[f] ?? null) !== (b[f] ?? null));
}

export function diff(
  feed: { stations: StationRow[]; evses: EvseRow[] },
  current: { stations: CurrentStation[]; evses: CurrentEvse[] },
): Diff {
  const d: Diff = {
    insertStations: [], updateStations: [], missingStations: [],
    insertEvses: [], updateEvses: [], missingEvses: [], conflicts: [],
  };
  const cur = new Map(current.stations.map((s) => [s.id, s]));
  const inFeed = new Set<string>();
  for (const s of feed.stations) {
    inFeed.add(s.id);
    const c = cur.get(s.id);
    if (!c) d.insertStations.push(s);
    // The import only owns NAP rows. A community proposal that later shows up
    // in the NAP is for a moderator to merge, not for the import to overwrite.
    else if (c.source !== 'nap') d.conflicts.push(s.id);
    else if (c.status !== 'active' || changed(s, c, STATION_FIELDS)) d.updateStations.push(s);
  }
  for (const c of current.stations) {
    if (c.source === 'nap' && c.status === 'active' && !inFeed.has(c.id)) d.missingStations.push(c.id);
  }

  const conflicted = new Set(d.conflicts);
  const curE = new Map(current.evses.map((e) => [evseKey(e), e]));
  const inFeedE = new Set<string>();
  for (const e of feed.evses) {
    if (conflicted.has(e.station_id)) continue;
    const k = evseKey(e);
    inFeedE.add(k);
    const c = curE.get(k);
    if (!c) d.insertEvses.push(e);
    else if (c.status !== 'active' || changed(e, c, EVSE_FIELDS)) d.updateEvses.push(e);
  }
  for (const c of current.evses) {
    if (c.status === 'active' && !inFeedE.has(evseKey(c)) && !conflicted.has(c.station_id)) {
      const owner = cur.get(c.station_id);
      if (!owner || owner.source === 'nap') d.missingEvses.push(c);
    }
  }
  return d;
}

export function sqlValue(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error(`sql: non-finite number ${v}`);
    return String(v);
  }
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (typeof v === 'string') return `'${v.replace(/\u0000/g, '').replace(/'/g, "''")}'`;
  throw new Error(`sql: unsupported value ${typeof v}`);
}

function chunks<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

// D1 caps a statement at 100 KB; 100 rows of a few hundred bytes stay far below.
const ROWS_PER_INSERT = 100;
const IDS_PER_UPDATE = 200;

export function toSql(d: Diff, generatedAt: string): string[] {
  const at = sqlValue(generatedAt);
  const out: string[] = [];
  const row = (r: object, cols: readonly string[]) =>
    `(${cols.map((c) => sqlValue((r as Record<string, unknown>)[c])).join(', ')}, ${at})`;

  // Inserts and updates are both upserts: the diff decided what changed, and
  // ON CONFLICT keeps a rerun after a partial failure safe.
  const upsert = (table: string, cols: readonly string[], key: string, fields: readonly string[], rows: object[]) => {
    for (const part of chunks(rows, ROWS_PER_INSERT)) {
      out.push(
        `INSERT INTO ${table} (${cols.join(', ')}, updated_at) VALUES\n  ${part.map((r) => row(r, cols)).join(',\n  ')}\n` +
        `ON CONFLICT (${key}) DO UPDATE SET ${fields.map((f) => `${f} = excluded.${f}`).join(', ')}, ` +
        `status = 'active', updated_at = excluded.updated_at;`,
      );
    }
  };
  // Stations before points: evses.station_id references stations.id.
  upsert('stations', STATION_COLUMNS, 'id', STATION_FIELDS, [...d.insertStations, ...d.updateStations]);
  upsert('evses', EVSE_COLUMNS, 'station_id, point_id', EVSE_FIELDS, [...d.insertEvses, ...d.updateEvses]);

  for (const ids of chunks(d.missingStations, IDS_PER_UPDATE)) {
    out.push(`UPDATE stations SET status = 'missing_from_nap', updated_at = ${at} ` +
      `WHERE source = 'nap' AND status = 'active' AND id IN (${ids.map(sqlValue).join(', ')});`);
  }
  for (const e of d.missingEvses) {
    out.push(`UPDATE evses SET status = 'missing_from_nap', updated_at = ${at} ` +
      `WHERE station_id = ${sqlValue(e.station_id)} AND point_id = ${sqlValue(e.point_id)} AND status = 'active';`);
  }
  out.push(`INSERT INTO import_state (key, value) VALUES ('generated_at', ${at}) ` +
    `ON CONFLICT (key) DO UPDATE SET value = excluded.value;`);
  return out;
}

// Guard against a truncated or broken feed flagging the whole network as
// missing: refuse when it would drop more than this share of active stations.
export const MAX_MISSING_SHARE = 0.05;

export function checkMissing(d: Diff, current: CurrentStation[]): string | null {
  const active = current.filter((s) => s.source === 'nap' && s.status === 'active').length;
  if (active === 0) return null;
  const share = d.missingStations.length / active;
  return share > MAX_MISSING_SHARE
    ? `refusing: ${d.missingStations.length} of ${active} active stations would become missing_from_nap ` +
      `(over ${MAX_MISSING_SHARE * 100}%). Check the feed; rerun with --allow-mass-missing if it is right.`
    : null;
}

export interface ExternalDiff {
  upsert: ExternalPhotoRow[];   // new, or a field changed at the source
  removed: string[];            // ids no longer in the feed
}

// The references of D1 against the feed. Only rows of origin osm_panoramax or
// commons are touched; our own photos are never read here.
export function diffExternalPhotos(feed: ExternalPhotoRow[], current: ExternalPhotoRow[]): ExternalDiff {
  const cur = new Map(current.map((c) => [c.id, c]));
  const inFeed = new Set(feed.map((f) => f.id));
  return {
    upsert: feed.filter((f) => {
      const c = cur.get(f.id);
      return !c || changed(f, c, EXTERNAL_FIELDS);
    }),
    removed: current.filter((c) => !inFeed.has(c.id)).map((c) => c.id),
  };
}

// A feed that lost its photos by mistake (the collection step failed) must not
// wipe every reference: refuse when it would drop over half of a real set.
export function checkExternalRemovals(d: ExternalDiff, currentCount: number): string | null {
  return currentCount >= 10 && d.removed.length > currentCount / 2
    ? `refusing: ${d.removed.length} of ${currentCount} external photos would be removed. ` +
      'Check the feed; rerun with --allow-mass-missing if it is right.'
    : null;
}

export function externalSql(d: ExternalDiff, generatedAt: string): string[] {
  const out: string[] = [];
  const at = sqlValue(generatedAt);
  for (const part of chunks(d.upsert, ROWS_PER_INSERT)) {
    out.push(
      `INSERT INTO photos (${EXTERNAL_COLUMNS.join(', ')}, status, created_at) VALUES\n  ` +
      part.map((r) => `(${EXTERNAL_COLUMNS.map((c) => sqlValue((r as unknown as Record<string, unknown>)[c])).join(', ')}, 'published', ${at})`).join(',\n  ') +
      `\nON CONFLICT (id) DO UPDATE SET ${EXTERNAL_FIELDS.map((f) => `${f} = excluded.${f}`).join(', ')};`,
    );
  }
  for (const ids of chunks(d.removed, IDS_PER_UPDATE)) {
    // origin <> 'olhaoposto': never our own photos, whatever the ids say.
    out.push(`DELETE FROM photos WHERE origin <> 'olhaoposto' AND id IN (${ids.map(sqlValue).join(', ')});`);
  }
  return out;
}
