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
  // 'osm': a station under construction (Docs/arquitetura.md, *Postos em construção*), with
  // its MOBI.E codes, space separated.
  source: string;
  codes: string | null;
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
  // The station's position, for the Panoramax viewer link.
  lat: number;
  lon: number;
  // Main photos of the socket and of its station (0/1 from SQLite).
  socket_photo: number;
  socket_credit: string | null;
  socket_pano: string | null;
  station_photo: number;
  station_credit: string | null;
  station_pano: string | null;
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

// The statuses with a public page. A merged station is not one: its id
// answers with a redirect to the NAP station (station_aliases).
export const PUBLIC_STATUSES = ['active', 'missing_from_nap', 'missing_from_osm'] as const;
export const PUBLIC_SQL = `(${PUBLIC_STATUSES.map((s) => `'${s}'`).join(', ')})`;
export const isPublic = (s: { status: string }) => (PUBLIC_STATUSES as readonly string[]).includes(s.status);
// A station under construction: no sockets, no main photo, no static link
// until it merges into its NAP station.
export const underConstruction = (s: { source?: string | null }) => s.source === 'osm';

// Beyond this, a photo is considered far from its station (Docs/plan.md).
export const FAR_M = 300;

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
  source: string;
}

// What a person typed, as an FTS5 query: every word must match, each as a
// prefix ("amad" finds Amadora). The input is split on anything that is not a
// letter or digit, so quotes, `*`, `:` and FTS operators (NEAR, OR) never reach
// MATCH as syntax; each word goes in double quotes. One-letter words are
// dropped (they would match half the table), and the query is capped.
export const MAX_QUERY = 100;
export const API_MAX_RESULTS = 50;
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

// Filters of the station search (GET /api/v1/stations?opc=&has_photo=&municipality=)
// and of the list of stations without a photo. hasPhoto is about the station's
// own static link (its main photo), not about its sockets.
export interface StationFilters {
  opc?: string;
  municipality?: string;
  hasPhoto?: boolean;
}
const OPC = /^[A-Za-z0-9_-]{1,40}$/;
export const MAX_MUNICIPALITY = 80;

// 'bad': a filter was given but not usable. An empty value counts as absent.
export function parseFilters(params: URLSearchParams): StationFilters | 'bad' {
  const f: StationFilters = {};
  const opc = params.get('opc')?.trim();
  if (opc) {
    if (!OPC.test(opc)) return 'bad';
    f.opc = opc;
  }
  const municipality = params.get('municipality')?.trim();
  if (municipality) {
    if (municipality.length > MAX_MUNICIPALITY) return 'bad';
    f.municipality = municipality;
  }
  const has = params.get('has_photo')?.trim().toLowerCase();
  if (has) {
    if (has === 'true' || has === '1') f.hasPhoto = true;
    else if (has === 'false' || has === '0') f.hasPhoto = false;
    else return 'bad';
  }
  return f;
}

export const hasFilters = (f: StationFilters) => f.opc !== undefined || f.municipality !== undefined || f.hasPhoto !== undefined;

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
export type MainPhotos = Record<string, { credit: string | null; panoramax_id?: string | null; photo_id?: string }>;

// A photo that lives at its origin (Panoramax, Commons), shown in the gallery
// as a reference with its author, licence and link. Never a main photo.
export type ExternalPhoto = {
  id: string;
  origin: 'osm_panoramax' | 'commons';
  thumb: string;
  credit: string | null;
  license: string;
  source: string;
  taken_at: string | null;
};

// One of our published photos of a station under construction: it has no
// main photo (no static link until the merge), so they show as a gallery,
// with Panoramax's own thumbnail and the credit page.
export type OwnPhoto = {
  id: string;
  credit: string | null;
  panoramax_id: string;
};

// One published main photo, for apps that copy them (nap.ocarroeletrico.com).
export type MainPhotoRow = {
  target: string;
  station_id: string;
  code: string | null;
  credit: string | null;
  panoramax_id: string | null;
  published_at: string;
};

// A name folded for comparison: without accents, case, spaces or
// punctuation, so «João_Silva» and «joao silva» are the same name. Used to
// stop a pseudonym from reading like someone else's name (src/credit.ts).
export function nameKey(name: string): string {
  return name.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}
