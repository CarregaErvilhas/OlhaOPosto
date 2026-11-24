// Pure part of the station import: feed -> rows -> diff against D1 -> SQL.
// No I/O here, so it can be unit tested (test/stations.test.ts).

export interface FeedPoint {
  id: string;
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
const EVSE_FIELDS = ['connector', 'max_kw', 'dc'] as const;

export const STATION_COLUMNS = ['id', ...STATION_FIELDS] as const;
export const EVSE_COLUMNS = ['station_id', 'point_id', ...EVSE_FIELDS] as const;

const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : null;

export function validateFeed(feed: unknown): Feed {
  const f = feed as Feed;
  if (!f || f.schema !== 1 || !Array.isArray(f.sites) || typeof f.generatedAt !== 'string') {
    throw new Error('feed: unexpected shape (schema 1 with generatedAt and sites[] expected)');
  }
  return f;
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
      evses.push({
        station_id: id,
        point_id: pid,
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
