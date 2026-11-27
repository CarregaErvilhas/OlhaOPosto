// The JSON shapes of stations, sockets and search results, shared by the REST
// API (src/index.ts) and the MCP server (src/mcp.ts), so both say the same
// thing about a station and its photos (Docs/api.md).
import { BRAND, PANORAMAX_URL, PICTURES, SITE, photoPath, socketAnchor, stationPath } from './pages.ts';
import { photoLink } from './photolinks.ts';
import { underConstruction, type EvseMatch, type ExternalPhoto, type MainPhotoRow, type MainPhotos, type OwnPhoto, type PointRow, type SearchRow, type StationRow } from './types.ts';

// GET /api/v1/stations/{id}
export function stationBody(found: { station: StationRow; points: PointRow[]; mains: MainPhotos; externals?: ExternalPhoto[]; own?: OwnPhoto[] }) {
  const { station: s, points, mains, externals = [], own = [] } = found;
  const photo = (target: string | null) => {
    const m = target ? mains[target] : undefined;
    return m && target
      ? photoLink({ target, stationId: s.id, credit: m.credit, panoramaxId: m.panoramax_id, lat: s.lat, lon: s.lon })
      : null;
  };
  return {
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
    ...lifecycle(s),
    osm: s.osm_ref,
    photo: photo(s.id),
    ...(underConstruction(s) ? { codes: (s.codes ?? '').split(' ').filter(Boolean) } : {}),
    // Our other published photos, the ones that are not a main photo (a
    // station under construction has none, so all of its photos): no static
    // link, Panoramax's thumbnail and the credit page.
    photos: own.map((p) => ({
      id: p.id, kind: p.kind ?? 'photo', socket: p.evse_compact ?? null, credit: p.credit, license: 'CC-BY-SA-4.0',
      attribution: `© ${p.credit ?? BRAND}, CC BY-SA 4.0, via ${BRAND}`,
      page: SITE + photoPath('pt', p.id),
      thumb: `${PANORAMAX_URL}/api/pictures/${encodeURIComponent(p.panoramax_id)}/thumb.jpg`,
    })),
    // Photos at their origin (Panoramax, Commons), as references: never a main
    // photo, no static link. Show the author, the licence and the source link.
    externalPhotos: externals.map((p) => ({
      id: p.id,
      external: true,
      origin: p.origin,
      thumb: p.thumb,
      credit: p.credit,
      license: p.license,
      source: p.source,
      takenAt: p.taken_at,
    })),
    points: points.map((p) => ({
      id: p.point_id,
      evse: p.evse_id,
      compact: p.evse_compact,
      connector: p.connector,
      kw: p.max_kw,
      dc: p.dc === 1,
      status: p.status,
      photo: photo(p.evse_compact),
    })),
    updatedAt: s.updated_at,
  };
}

// GET /api/v1/evses/{evse}
export function evseBody(e: EvseMatch) {
  const at = { stationId: e.station_id, lat: e.lat, lon: e.lon };
  return {
    evse: e.evse_id,
    compact: e.evse_compact,
    station: {
      id: e.station_id, name: e.name, operator: { id: e.opc, name: e.operator },
      photo: e.station_photo ? photoLink({ ...at, target: e.station_id, credit: e.station_credit, panoramaxId: e.station_pano }) : null,
    },
    point: { id: e.point_id, connector: e.connector, kw: e.max_kw, dc: e.dc === 1, status: e.status },
    photo: e.socket_photo ? photoLink({ ...at, target: e.evse_compact, credit: e.socket_credit, panoramaxId: e.socket_pano }) : null,
    updatedAt: e.updated_at,
  };
}

// One result of GET /api/v1/stations?q= or ?lat=&lon=
export const searchBody = (r: SearchRow) => ({
  id: r.id,
  name: r.name,
  operator: { id: r.opc, name: r.operator },
  address: r.address,
  municipality: r.municipality,
  region: r.region,
  lat: r.lat,
  lon: r.lon,
  status: r.status,
  ...lifecycle(r),
});

// `lifecycle: "construction"` on stations under construction (from OSM, not
// in the NAP yet: they do not charge). Absent on NAP stations.
const lifecycle = (s: { source?: string | null }) => (underConstruction(s) ? { lifecycle: 'construction' as const } : {});

// One entry of GET /api/v1/main-photos
export function mainPhotoBody(r: MainPhotoRow) {
  const base = `${PICTURES}/${encodeURIComponent(r.target)}`;
  const anchor = r.target === r.station_id ? '' : socketAnchor(r.target);
  return {
    target: r.target,
    station: { id: r.station_id, code: r.code },
    credit: r.credit,
    thumb: `${base}.thumb.jpg`,
    main: `${base}.jpg`,
    full: `${base}.full.jpg`,
    page: `${SITE}${stationPath('pt', r.station_id)}${anchor}`,
    panoramax: r.panoramax_id,
    publishedAt: r.published_at,
  };
}
