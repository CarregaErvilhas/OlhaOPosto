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
