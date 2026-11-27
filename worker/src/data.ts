// The one data path for stations and sockets: the JSON API and the HTML pages
// both read through here, so visibility rules live in one place.
import {
  boundingBox, compactCode, distanceM, ftsQuery, isPublic, PUBLIC_SQL, STATION_ID,
  type EvseMatch, type NearQuery, type PointRow, type SearchRow, type StationFilters, type StationRow,
  type ExternalPhoto, type MainPhotoRow, type MainPhotos, type OwnPhoto, type RecentStation,
} from './types.ts';

// The most external photos shown for one station.
const EXTERNAL_LIMIT = 12;
// The most of our own photos shown for a station under construction.
const OWN_LIMIT = 24;
// The home page: how many stations, and thumbnails for each.
const RECENT_STATIONS = 3;
const RECENT_PHOTOS = 4;

export interface Env {
  DB: D1Database;
}

export async function getStation(env: Env, id: string): Promise<{ station: StationRow; points: PointRow[]; mains: MainPhotos; externals: ExternalPhoto[]; own: OwnPhoto[] } | null> {
  if (!STATION_ID.test(id)) return null;
  // One round trip for both queries: the D1 primary is in the EU jurisdiction
  // (Eastern Europe), so every extra query is another trip from the edge.
  const [station, points, mains, externals, own] = await env.DB.batch([
    env.DB.prepare(
      `SELECT id, code, opc, operator, name, address, municipality, region, lat, lon,
              status, osm_ref, updated_at, source, codes
         FROM stations WHERE id = ?`,
    ).bind(id),
    env.DB.prepare(
      `SELECT point_id, evse_id, evse_compact, connector, max_kw, dc, status
         FROM evses WHERE station_id = ? ORDER BY point_id`,
    ).bind(id),
    env.DB.prepare(
      `SELECT sel.target, p.credit, p.panoramax_id, p.id AS photo_id
         FROM selections sel JOIN photos p ON p.id = sel.photo_id
        WHERE sel.station_id = ? AND sel.published_at IS NOT NULL AND p.status = 'published'`,
    ).bind(id),
    // References to photos at their origin (the daily import writes them).
    // Few per station; the cap keeps a page and the API bounded.
    env.DB.prepare(
      `SELECT id, origin, external_src AS thumb, credit, license, source_url AS source, taken_at
         FROM photos
        WHERE station_id = ? AND origin <> 'olhaoposto' AND status = 'published' AND external_src IS NOT NULL
        ORDER BY origin, taken_at DESC, id LIMIT ${EXTERNAL_LIMIT}`,
    ).bind(id),
    // Our published photos that are not a main photo (a station under
    // construction has none, so all of its photos): the page shows them as a
    // gallery. Current mains are left out, the page already shows those.
    env.DB.prepare(
      `SELECT p.id, p.credit, p.panoramax_id, p.evse_compact, p.kind
         FROM photos p
        WHERE p.station_id = ? AND p.origin = 'olhaoposto' AND p.status = 'published' AND p.panoramax_id IS NOT NULL
          AND p.id NOT IN (SELECT sel.photo_id FROM selections sel
                            WHERE sel.station_id = ? AND sel.published_at IS NOT NULL AND sel.lost_at IS NULL)
        ORDER BY p.approved_at, p.id LIMIT ${OWN_LIMIT}`,
    ).bind(id, id),
  ]);
  const s = (station.results as StationRow[])[0];
  if (!s || !isPublic(s)) return null;
  const byTarget: MainPhotos = {};
  for (const m of mains.results as { target: string; credit: string | null; panoramax_id: string | null; photo_id: string }[]) {
    byTarget[m.target] = { credit: m.credit, panoramax_id: m.panoramax_id, photo_id: m.photo_id };
  }
  return {
    station: s, points: points.results as PointRow[], mains: byTarget,
    externals: externals.results as ExternalPhoto[], own: own.results as OwnPhoto[],
  };
}

// The public stations whose photos were published last, for the home page.
export async function recentPhotoStations(env: Env): Promise<RecentStation[]> {
  const { results } = await env.DB.prepare(
    `WITH pics AS (
       SELECT p.id, p.station_id, p.credit, p.panoramax_id, p.approved_at AS at
         FROM photos p JOIN stations s ON s.id = p.station_id
        WHERE p.origin = 'olhaoposto' AND p.status = 'published' AND p.kind <> 'plate'
          AND p.panoramax_id IS NOT NULL AND s.status IN ${PUBLIC_SQL}
     ), latest AS (
       SELECT station_id, max(at) AS last FROM pics GROUP BY station_id
        ORDER BY last DESC, station_id LIMIT ${RECENT_STATIONS}
     ), ranked AS (
       SELECT pics.*, latest.last,
              row_number() OVER (PARTITION BY pics.station_id ORDER BY pics.at DESC, pics.id) AS n
         FROM pics JOIN latest ON latest.station_id = pics.station_id
     )
     SELECT r.station_id, r.id, r.credit, r.panoramax_id, s.name, s.municipality, s.source, s.status
       FROM ranked r JOIN stations s ON s.id = r.station_id
      WHERE r.n <= ${RECENT_PHOTOS}
      ORDER BY r.last DESC, r.station_id, r.n`,
  ).all<Omit<RecentStation, 'id' | 'photos'> & RecentStation['photos'][number] & { station_id: string }>();
  const stations = new Map<string, RecentStation>();
  for (const { station_id: id, name, municipality, source, status, ...photo } of results) {
    const s = stations.get(id) ?? { id, name, municipality, source, status, photos: [] };
    s.photos.push(photo);
    stations.set(id, s);
  }
  return [...stations.values()];
}

// Every published main photo of a public station or socket, for sites that
// copy the thumbnails (the NAP dashboard does, once a day). The R2 keys are
// <target>.jpg, .thumb.jpg and .full.jpg on pictures.*.
export async function listMainPhotos(env: Env): Promise<MainPhotoRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT sel.target, sel.station_id, s.code, p.credit, p.panoramax_id, sel.published_at
       FROM selections sel
       JOIN photos p ON p.id = sel.photo_id
       JOIN stations s ON s.id = sel.station_id
      WHERE sel.published_at IS NOT NULL AND p.status = 'published'
        AND s.status IN ${PUBLIC_SQL}
      ORDER BY sel.target`,
  ).all<MainPhotoRow>();
  return results;
}

// Every public socket with this code. Usually one; the NAP does not promise it.
export async function findEvse(env: Env, raw: string): Promise<EvseMatch[]> {
  const code = compactCode(raw);
  if (!code) return [];
  const { results } = await env.DB.prepare(
    // The main photos of the socket and of its station ride along. The photo
    // status sits in the ON clause: in WHERE it would drop every socket
    // without a photo. A socket target is matched with its station too,
    // because the NAP can repeat a code across stations.
    `SELECT e.station_id, s.name, s.opc, s.operator, s.lat, s.lon, e.point_id, e.evse_id, e.evse_compact,
            e.connector, e.max_kw, e.dc, e.status, e.updated_at,
            ps.id IS NOT NULL AS socket_photo, ps.credit AS socket_credit, ps.panoramax_id AS socket_pano,
            pt.id IS NOT NULL AS station_photo, pt.credit AS station_credit, pt.panoramax_id AS station_pano
       FROM evses e JOIN stations s ON s.id = e.station_id
       LEFT JOIN selections ss ON ss.target = e.evse_compact AND ss.station_id = e.station_id AND ss.published_at IS NOT NULL
       LEFT JOIN photos ps ON ps.id = ss.photo_id AND ps.status = 'published'
       LEFT JOIN selections st ON st.target = e.station_id AND st.published_at IS NOT NULL
       LEFT JOIN photos pt ON pt.id = st.photo_id AND pt.status = 'published'
      WHERE e.evse_compact = ? AND s.status IN ${PUBLIC_SQL}
      ORDER BY e.station_id, e.point_id`,
  ).bind(code).all<EvseMatch>();
  return results;
}

// Every public NAP station with the last time its page could have changed: its own
// row or any of its sockets. One correlated lookup per station on the evses
// primary key; the Worker caches the result for a day (index.ts).
export async function listStations(env: Env): Promise<{ id: string; lastmod: string }[]> {
  const { results } = await env.DB.prepare(
    `SELECT s.id,
            max(s.updated_at, coalesce((SELECT max(e.updated_at) FROM evses e WHERE e.station_id = s.id), '')) AS lastmod
       FROM stations s
      WHERE s.status IN ${PUBLIC_SQL} AND s.source = 'nap'
      ORDER BY s.id`,
  ).all<{ id: string; lastmod: string }>();
  return results;
}

// The station has a published main photo: its static link answers 200.
const HAS_MAIN = `EXISTS (SELECT 1 FROM selections sel JOIN photos ph ON ph.id = sel.photo_id
   WHERE sel.target = s.id AND sel.published_at IS NOT NULL AND sel.lost_at IS NULL AND ph.status = 'published')`;

// The extra WHERE terms of a station query on `stations s`, with their binds
// in order. Always starts with AND, so it follows a status test.
export function filterSql(f: StationFilters): { sql: string; binds: string[] } {
  const parts: string[] = [];
  const binds: string[] = [];
  if (f.opc) { parts.push('s.opc = ? COLLATE NOCASE'); binds.push(f.opc); }
  if (f.municipality) { parts.push('s.municipality = ? COLLATE NOCASE'); binds.push(f.municipality); }
  if (f.hasPhoto === true) parts.push(HAS_MAIN);
  // Without a photo means a static link that would answer 404: a station
  // under construction has no link to fill yet.
  if (f.hasPhoto === false) parts.push(`NOT ${HAS_MAIN}`, `s.source = 'nap'`);
  return { sql: parts.map((p) => ` AND ${p}`).join(''), binds };
}

const PUBLIC = `s.status IN ${PUBLIC_SQL}`;
const SEARCH_COLUMNS = 's.id, s.name, s.opc, s.operator, s.address, s.municipality, s.region, s.lat, s.lon, s.status, s.source';

// Public stations whose code, name, address, town or operator match every
// word typed, best match first (FTS5 bm25). Reads the index entries that match
// plus one stations row per result, not the whole table.
export async function searchStations(env: Env, raw: string, limit: number, filters: StationFilters = {}): Promise<SearchRow[]> {
  const match = ftsQuery(raw);
  if (!match) return [];
  const f = filterSql(filters);
  try {
    const { results } = await env.DB.prepare(
      `SELECT ${SEARCH_COLUMNS}
         FROM stations_fts f JOIN stations s ON s.rowid = f.rowid
        WHERE stations_fts MATCH ? AND ${PUBLIC}${f.sql}
        ORDER BY f.rank
        LIMIT ?`,
    ).bind(match, ...f.binds, limit).all<SearchRow>();
    return results;
  } catch {
    // ftsQuery leaves no syntax for MATCH to choke on, but a search must never
    // turn into a 500: no results is the honest answer.
    return [];
  }
}

export type NearRow = SearchRow & { distance_m: number };

// Public stations within q.radius metres, nearest first. The box comes from
// the stations_lat_lon index; the circle and the order are done here.
export async function nearStations(env: Env, q: NearQuery, limit: number, filters: StationFilters = {}): Promise<NearRow[]> {
  const b = boundingBox(q);
  const f = filterSql(filters);
  const { results } = await env.DB.prepare(
    `SELECT ${SEARCH_COLUMNS}
       FROM stations s
      WHERE s.lat BETWEEN ? AND ? AND s.lon BETWEEN ? AND ? AND ${PUBLIC}${f.sql}`,
  ).bind(b.minLat, b.maxLat, b.minLon, b.maxLon, ...f.binds).all<SearchRow>();
  return results
    .map((r) => ({ ...r, distance_m: Math.round(distanceM(q.lat, q.lon, r.lat, r.lon)) }))
    .filter((r) => r.distance_m <= q.radius)
    .sort((a, b) => a.distance_m - b.distance_m || a.id.localeCompare(b.id))
    .slice(0, limit);
}

// Public stations that match the filters alone, by id, a page after the id
// `after` (keyset paging). Asks for one more than `limit`: the caller sees
// from it whether there is a next page.
export async function filterStations(env: Env, filters: StationFilters, limit: number, after = ''): Promise<{ rows: SearchRow[]; next: string | null }> {
  const f = filterSql(filters);
  const { results } = await env.DB.prepare(
    `SELECT ${SEARCH_COLUMNS} FROM stations s WHERE ${PUBLIC} AND s.id > ?${f.sql} ORDER BY s.id LIMIT ?`,
  ).bind(after, ...f.binds, limit + 1).all<SearchRow>();
  const rows = results.slice(0, limit);
  return { rows, next: results.length > limit ? rows[rows.length - 1].id : null };
}

export interface Facet { value: string; label: string; n: number }

// Stations without a main photo, counted by town and by operator, for the
// filters of the "sem foto" page. One scan of the stations table; the page is
// cached for a few minutes.
export async function withoutPhotoFacets(env: Env): Promise<{ total: number; municipalities: Facet[]; operators: Facet[] }> {
  const { results } = await env.DB.prepare(
    `SELECT s.municipality, s.opc, s.operator, COUNT(*) AS n
       FROM stations s WHERE ${PUBLIC} AND s.source = 'nap' AND NOT ${HAS_MAIN}
      GROUP BY s.municipality, s.opc, s.operator`,
  ).all<{ municipality: string | null; opc: string | null; operator: string | null; n: number }>();
  const town = new Map<string, number>();
  const op = new Map<string, Facet>();
  let total = 0;
  for (const r of results) {
    total += r.n;
    if (r.municipality) town.set(r.municipality, (town.get(r.municipality) ?? 0) + r.n);
    if (r.opc) {
      const prev = op.get(r.opc);
      op.set(r.opc, { value: r.opc, label: r.operator ?? r.opc, n: (prev?.n ?? 0) + r.n });
    }
  }
  const byLabel = (a: Facet, b: Facet) => a.label.localeCompare(b.label, 'pt');
  return {
    total,
    municipalities: [...town].map(([value, n]) => ({ value, label: value, n })).sort(byLabel),
    operators: [...op.values()].sort(byLabel),
  };
}

export interface MissingSocket {
  station_id: string;
  name: string | null;
  municipality: string | null;
  operator: string | null;
  evse_id: string;
  evse_compact: string;
  connector: string | null;
  max_kw: number | null;
}

// Sockets with a NAP EVSE code (they have a static link) and no main photo
// yet, on active stations, for the MCP campaigns (src/mcp.ts). Keyset paging
// on (station id, point id) as in filterStations.
export async function socketsWithoutPhoto(
  env: Env, filters: StationFilters, limit: number, after = '',
): Promise<{ rows: MissingSocket[]; next: string | null }> {
  const f = filterSql({ ...filters, hasPhoto: undefined });
  const { results } = await env.DB.prepare(
    `SELECT e.station_id, s.name, s.municipality, s.operator, e.evse_id, e.evse_compact, e.connector, e.max_kw,
            e.station_id || '|' || e.point_id AS cursor
       FROM evses e JOIN stations s ON s.id = e.station_id
      WHERE s.status = 'active' AND e.evse_compact IS NOT NULL AND e.status = 'active'
        AND e.station_id || '|' || e.point_id > ?${f.sql}
        AND NOT EXISTS (SELECT 1 FROM selections sel JOIN photos ph ON ph.id = sel.photo_id
          WHERE sel.target = e.evse_compact AND sel.station_id = e.station_id
            AND sel.published_at IS NOT NULL AND ph.status = 'published')
      ORDER BY e.station_id, e.point_id
      LIMIT ?`,
  ).bind(after, ...f.binds, limit + 1).all<MissingSocket & { cursor: string }>();
  const page = results.slice(0, limit);
  return {
    rows: page.map(({ cursor: _c, ...r }) => r),
    next: results.length > limit ? page[page.length - 1].cursor : null,
  };
}
