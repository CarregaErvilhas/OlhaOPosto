// The one data path for stations and sockets: the JSON API and the HTML pages
// both read through here, so visibility rules live in one place.
import {
  boundingBox, compactCode, distanceM, ftsQuery, isPublic, STATION_ID,
  type EvseMatch, type NearQuery, type PointRow, type SearchRow, type StationRow,
  type MainPhotoRow, type MainPhotos,
} from './types.ts';

export interface Env {
  DB: D1Database;
}

export async function getStation(env: Env, id: string): Promise<{ station: StationRow; points: PointRow[]; mains: MainPhotos } | null> {
  if (!STATION_ID.test(id)) return null;
  // One round trip for both queries: the D1 primary is in the EU jurisdiction
  // (Eastern Europe), so every extra query is another trip from the edge.
  const [station, points, mains] = await env.DB.batch([
    env.DB.prepare(
      `SELECT id, code, opc, operator, name, address, municipality, region, lat, lon,
              status, osm_ref, updated_at
         FROM stations WHERE id = ?`,
    ).bind(id),
    env.DB.prepare(
      `SELECT point_id, evse_id, evse_compact, connector, max_kw, dc, status
         FROM evses WHERE station_id = ? ORDER BY point_id`,
    ).bind(id),
    env.DB.prepare(
      `SELECT sel.target, p.credit, p.panoramax_id
         FROM selections sel JOIN photos p ON p.id = sel.photo_id
        WHERE sel.station_id = ? AND sel.published_at IS NOT NULL AND p.status = 'published'`,
    ).bind(id),
  ]);
  const s = (station.results as StationRow[])[0];
  if (!s || !isPublic(s)) return null;
  const byTarget: MainPhotos = {};
  for (const m of mains.results as { target: string; credit: string | null; panoramax_id: string | null }[]) {
    byTarget[m.target] = { credit: m.credit, panoramax_id: m.panoramax_id };
  }
  return { station: s, points: points.results as PointRow[], mains: byTarget };
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
        AND s.status IN ('active', 'missing_from_nap')
      ORDER BY sel.target`,
  ).all<MainPhotoRow>();
  return results;
}

// Every public socket with this code. Usually one; the NAP does not promise it.
export async function findEvse(env: Env, raw: string): Promise<EvseMatch[]> {
  const code = compactCode(raw);
  if (!code) return [];
  const { results } = await env.DB.prepare(
    `SELECT e.station_id, s.name, s.opc, s.operator, e.point_id, e.evse_id, e.evse_compact,
            e.connector, e.max_kw, e.dc, e.status, e.updated_at
       FROM evses e JOIN stations s ON s.id = e.station_id
      WHERE e.evse_compact = ? AND s.status IN ('active', 'missing_from_nap')
      ORDER BY e.station_id, e.point_id`,
  ).bind(code).all<EvseMatch>();
  return results;
}

// Every public station with the last time its page could have changed: its own
// row or any of its sockets. One correlated lookup per station on the evses
// primary key; the Worker caches the result for a day (index.ts).
export async function listStations(env: Env): Promise<{ id: string; lastmod: string }[]> {
  const { results } = await env.DB.prepare(
    `SELECT s.id,
            max(s.updated_at, coalesce((SELECT max(e.updated_at) FROM evses e WHERE e.station_id = s.id), '')) AS lastmod
       FROM stations s
      WHERE s.status IN ('active', 'missing_from_nap')
      ORDER BY s.id`,
  ).all<{ id: string; lastmod: string }>();
  return results;
}

// Public stations whose code, name, address, town or operator match every
// word typed, best match first (FTS5 bm25). Reads the index entries that match
// plus one stations row per result, not the whole table.
export async function searchStations(env: Env, raw: string, limit: number): Promise<SearchRow[]> {
  const match = ftsQuery(raw);
  if (!match) return [];
  try {
    const { results } = await env.DB.prepare(
      `SELECT s.id, s.name, s.opc, s.operator, s.address, s.municipality, s.region, s.lat, s.lon, s.status
         FROM stations_fts f JOIN stations s ON s.rowid = f.rowid
        WHERE stations_fts MATCH ?1 AND s.status IN ('active', 'missing_from_nap')
        ORDER BY f.rank
        LIMIT ?2`,
    ).bind(match, limit).all<SearchRow>();
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
export async function nearStations(env: Env, q: NearQuery, limit: number): Promise<NearRow[]> {
  const b = boundingBox(q);
  const { results } = await env.DB.prepare(
    `SELECT id, name, opc, operator, address, municipality, region, lat, lon, status
       FROM stations
      WHERE lat BETWEEN ?1 AND ?2 AND lon BETWEEN ?3 AND ?4
        AND status IN ('active', 'missing_from_nap')`,
  ).bind(b.minLat, b.maxLat, b.minLon, b.maxLon).all<SearchRow>();
  return results
    .map((r) => ({ ...r, distance_m: Math.round(distanceM(q.lat, q.lon, r.lat, r.lon)) }))
    .filter((r) => r.distance_m <= q.radius)
    .sort((a, b) => a.distance_m - b.distance_m || a.id.localeCompare(b.id))
    .slice(0, limit);
}


// Top contributors by points. Period 'month' = current UTC month, 'all' = all time.
// Users with ranking_opt_out=1 are excluded; their points still count for totals.
export interface RankingRow {
  name: string;
  points: number;
}

export async function ranking(env: Env, period: 'month' | 'all'): Promise<RankingRow[]> {
  const month = new Date().toISOString().slice(0, 7);
  const where = period === 'month' ? 'AND p.month = ?' : '';
  const binds = period === 'month' ? [month] : [];
  const { results } = await env.DB.prepare(
    `SELECT COALESCE(u.pseudonym, u.osm_name) AS name, SUM(p.points) AS points
       FROM points p JOIN users u ON u.id = p.user_id
      WHERE u.ranking_opt_out = 0 ${where}
      GROUP BY u.id
      ORDER BY points DESC, name ASC
      LIMIT 50`,
  ).bind(...binds).all<RankingRow>();
  return results.map((r) => ({ name: r.name, points: Number(r.points) }));
}

// Stations that left the NAP but still have photos: candidates for a re-key.
export interface MissingStationRow {
  id: string;
  name: string | null;
  operator: string | null;
  photo_count: number;
  alias: string | null;
}

export async function listMissingStationsWithPhotos(env: Env): Promise<MissingStationRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT s.id, s.name, s.operator,
            (SELECT COUNT(*) FROM photos p WHERE p.station_id = s.id) AS photo_count,
            a.new_id AS alias
       FROM stations s
       LEFT JOIN station_aliases a ON a.old_id = s.id
      WHERE s.status = 'missing_from_nap'
        AND EXISTS (SELECT 1 FROM photos p WHERE p.station_id = s.id)
      ORDER BY s.id`,
  ).all<MissingStationRow>();
  return results;
}

export async function getStationAlias(env: Env, oldId: string): Promise<string | null> {
  const row = await env.DB.prepare(
    `SELECT new_id FROM station_aliases WHERE old_id = ?`,
  ).bind(oldId).first<{ new_id: string }>();
  return row?.new_id ?? null;
}
