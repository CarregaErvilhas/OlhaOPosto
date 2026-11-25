// Row shapes shared by the API and the HTML pages. No Workers types here, so
// the page renderer can be tested under Node (test/pages.test.ts).

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
  status: string;
  osm_ref: string | null;
  updated_at: string;
}

export interface PointRow {
  point_id: string;
  evse_id: string | null;
  evse_compact: string | null;
  connector: string | null;
  max_kw: number | null;
  dc: number;
  status: string;
}

export interface EvseMatch {
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

// Station ids seen in the NAP: letters, digits, dashes and underscores
// (EZC-AMD-00051, HGP-MCN-HOTEL-CASAL_SILVA-C01). Anything else cannot be a station.
export const STATION_ID = /^[A-Za-z0-9_-]{1,64}$/;

// A socket's NAP EVSE code, with or without the `*` (PT*EDP*E*LSB*90050*01 or
// PTEDPELSB9005001). A few operators use dashes (PT*VIA*EMOBI-CSC-00189-3).
const EVSE_CODE = /^[A-Z0-9-]{3,64}$/;

export function compactCode(raw: string): string | null {
  const code = raw.replace(/\*/g, '').toUpperCase();
  return EVSE_CODE.test(code) ? code : null;
}

// Proposals and rejected stations are not public.
export const isPublic = (s: { status: string }) => s.status === 'active' || s.status === 'missing_from_nap';

export interface SearchRow {
  id: string;
  name: string | null;
  opc: string | null;
  operator: string | null;
  address: string | null;
  municipality: string | null;
  region: string | null;
  lat: number;
  lon: number;
  status: string;
}

// What a person typed, as an FTS5 query: every word must match, each as a
// prefix ("amad" finds Amadora). The input is split on anything that is not a
// letter or digit, so quotes, `*`, `:` and FTS operators (NEAR, OR) never reach
// MATCH as syntax; each word goes in double quotes. One-letter words are
// dropped (they would match half the table), and the query is capped.
export const MAX_QUERY = 100;
const MAX_TERMS = 6;

export function ftsQuery(raw: string): string | null {
  const terms = raw.normalize('NFC').slice(0, MAX_QUERY).split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 2).slice(0, MAX_TERMS);
  return terms.length ? terms.map((t) => `"${t}"*`).join(' AND ') : null;
}

// Nearby search (GET /api/v1/stations?lat=&lon=&radius=). Strict parsing:
// Number('') is 0, and a blank lat must not search the Gulf of Guinea.
export const NEAR_DEFAULT_M = 500;
export const NEAR_MAX_M = 5000;
const DEGREES = /^-?\d{1,3}(\.\d{1,10})?$/;
const METRES = /^\d{1,5}$/;

export interface NearQuery {
  lat: number;
  lon: number;
  radius: number;
}

// null: no coordinates asked for; 'bad': asked, but not usable.
export function parseNear(params: URLSearchParams): NearQuery | 'bad' | null {
  const rawLat = params.get('lat');
  const rawLon = params.get('lon');
  const rawRadius = params.get('radius');
  if (rawLat === null && rawLon === null && rawRadius === null) return null;
  if (rawLat === null || rawLon === null || !DEGREES.test(rawLat) || !DEGREES.test(rawLon)) return 'bad';
  const lat = Number(rawLat);
  const lon = Number(rawLon);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return 'bad';
  if (rawRadius !== null && !METRES.test(rawRadius)) return 'bad';
  const radius = rawRadius === null ? NEAR_DEFAULT_M : Number(rawRadius);
  if (radius < 1 || radius > NEAR_MAX_M) return 'bad';
  return { lat, lon, radius };
}

const EARTH_M = 6_371_008.8; // mean radius
const rad = (d: number) => (d * Math.PI) / 180;

// Haversine: metres between two points, plenty for a few kilometres.
export function distanceM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

// A box that contains the circle, with 1% to spare; the exact cut is distanceM.
export function boundingBox(q: NearQuery): { minLat: number; maxLat: number; minLon: number; maxLon: number } {
  const dLat = ((q.radius * 1.01) / EARTH_M) * (180 / Math.PI);
  const cos = Math.cos(rad(q.lat));
  const dLon = cos < 1e-6 ? 180 : Math.min(180, dLat / cos);
  return { minLat: q.lat - dLat, maxLat: q.lat + dLat, minLon: q.lon - dLon, maxLon: q.lon + dLon };
}


// Published main photos of a station and its sockets, by target (station id
// or compact EVSE code).
export type MainPhotos = Record<string, { credit: string | null }>;
