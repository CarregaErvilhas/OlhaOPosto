// The one data path for stations and sockets: the JSON API and the HTML pages
// both read through here, so visibility rules live in one place.
import { compactCode, isPublic, STATION_ID, type EvseMatch, type PointRow, type StationRow } from './types.ts';

export interface Env {
  DB: D1Database;
}

export async function getStation(env: Env, id: string): Promise<{ station: StationRow; points: PointRow[] } | null> {
  if (!STATION_ID.test(id)) return null;
  // One round trip for both queries: the D1 primary is in the EU jurisdiction
  // (Eastern Europe), so every extra query is another trip from the edge.
  const [station, points] = await env.DB.batch([
    env.DB.prepare(
      `SELECT id, code, opc, operator, name, address, municipality, region, lat, lon,
              status, osm_ref, updated_at
         FROM stations WHERE id = ?`,
    ).bind(id),
    env.DB.prepare(
      `SELECT point_id, evse_id, evse_compact, connector, max_kw, dc, status
         FROM evses WHERE station_id = ? ORDER BY point_id`,
    ).bind(id),
  ]);
  const s = (station.results as StationRow[])[0];
  if (!s || !isPublic(s)) return null;
  return { station: s, points: points.results as PointRow[] };
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
