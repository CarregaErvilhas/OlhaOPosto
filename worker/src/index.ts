// VoltFrame Worker (voltframe.ocarroeletrico.com). For now: the read-only
// station and socket API. Static photo links are served by the R2 bucket on
// pictures.ocarroeletrico.com, never by this Worker (Docs/plan.md).

export interface Env {
  DB: D1Database;
}

interface StationRow {
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
  status: string;
  osm_ref: string | null;
  updated_at: string;
}

interface EvseRow {
  point_id: string;
  evse_id: string | null;
  connector: string | null;
  max_kw: number | null;
  dc: number;
  status: string;
}

// Station ids seen in the NAP: letters, digits, dashes and underscores
// (EZC-AMD-00051, HGP-MCN-HOTEL-CASAL_SILVA-C01). Anything else cannot be a station.
const STATION_ID = /^[A-Za-z0-9_-]{1,64}$/;

// A socket's NAP EVSE code, with or without the `*` (PT*EDP*E*LSB*90050*01 or
// PTEDPELSB9005001). A few operators use dashes (PT*VIA*EMOBI-CSC-00189-3).
const EVSE_CODE = /^[A-Z0-9-]{3,64}$/;

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
};

function json(body: unknown, status = 200, cache = 'public, max-age=300'): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, 'cache-control': cache },
  });
}

const notFound = () => json({ error: 'not_found' }, 404, 'public, max-age=60');

async function station(env: Env, id: string): Promise<Response> {
  if (!STATION_ID.test(id)) return notFound();
  // One round trip for both queries: the D1 primary is in the EU jurisdiction
  // (Eastern Europe), so every extra query is another trip from the edge.
  const [station, points] = await env.DB.batch([
    env.DB.prepare(
      `SELECT id, code, opc, operator, name, address, municipality, region, lat, lon,
              status, osm_ref, updated_at
         FROM stations WHERE id = ?`,
    ).bind(id),
    env.DB.prepare(
      `SELECT point_id, evse_id, connector, max_kw, dc, status
         FROM evses WHERE station_id = ? ORDER BY point_id`,
    ).bind(id),
  ]);
  const s = (station.results as StationRow[])[0];
  // Proposals and rejected stations are not public.
  if (!s || (s.status !== 'active' && s.status !== 'missing_from_nap')) return notFound();
  const results = points.results as EvseRow[];
  return json({
    id: s.id,
    code: s.code,
    name: s.name,
    operator: { id: s.opc, name: s.operator },
    address: s.address,
    municipality: s.municipality,
    region: s.region,
    lat: s.lat,
    lon: s.lon,
    status: s.status,
    osm: s.osm_ref,
    points: results.map((p) => ({
      id: p.point_id,
      evse: p.evse_id,
      connector: p.connector,
      kw: p.max_kw,
      dc: p.dc === 1,
      status: p.status,
    })),
    updatedAt: s.updated_at,
  });
}

interface EvseMatch {
  station_id: string;
  name: string | null;
  opc: string | null;
  operator: string | null;
  point_id: string;
  evse_id: string;
  evse_compact: string;
  connector: string | null;
  max_kw: number | null;
  dc: number;
  status: string;
  updated_at: string;
}

async function evse(env: Env, raw: string): Promise<Response> {
  const code = raw.replace(/\*/g, '').toUpperCase();
  if (!EVSE_CODE.test(code)) return notFound();
  const { results } = await env.DB.prepare(
    `SELECT e.station_id, s.name, s.opc, s.operator, e.point_id, e.evse_id, e.evse_compact,
            e.connector, e.max_kw, e.dc, e.status, e.updated_at
       FROM evses e JOIN stations s ON s.id = e.station_id
      WHERE e.evse_compact = ? AND s.status IN ('active', 'missing_from_nap')
      ORDER BY e.station_id, e.point_id`,
  ).bind(code).all<EvseMatch>();
  if (results.length === 0) return notFound();
  const body = (e: EvseMatch) => ({
    evse: e.evse_id,
    compact: e.evse_compact,
    station: { id: e.station_id, name: e.name, operator: { id: e.opc, name: e.operator } },
    point: { id: e.point_id, connector: e.connector, kw: e.max_kw, dc: e.dc === 1, status: e.status },
    updatedAt: e.updated_at,
  });
  // The NAP does not promise one code per socket. When it repeats, say so and
  // list the candidates instead of picking one at random.
  if (results.length > 1) return json({ error: 'ambiguous', candidates: results.map(body) }, 300);
  return json(body(results[0]));
}

function param(raw: string): string | null {
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return json({ error: 'method_not_allowed' }, 405, 'no-store');
    }
    const { pathname } = new URL(request.url);
    const st = pathname.match(/^\/api\/v1\/stations\/([^/]+)$/);
    if (st) {
      const id = param(st[1]);
      return id === null ? notFound() : station(env, id);
    }
    const ev = pathname.match(/^\/api\/v1\/evses\/([^/]+)$/);
    if (ev) {
      const code = param(ev[1]);
      return code === null ? notFound() : evse(env, code);
    }
    if (pathname === '/') {
      return new Response('VoltFrame: em construção. API: /api/v1/stations/{id}, /api/v1/evses/{evse}\n', {
        headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=300' },
      });
    }
    return notFound();
  },
} satisfies ExportedHandler<Env>;
