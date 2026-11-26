// Pure part of the import of stations under construction (Docs/arquitetura.md,
// *Postos em construção*): the `planned` array of the feed -> rows -> diff against D1
// -> SQL, and the merges into NAP stations. No I/O, like stations.ts.
//
// Only `lifecycle: "construction"` is imported: a planned site has nothing to
// photograph yet. The NAP rows come from stations.ts; this file never writes
// them.

import { MERGE_SQL, autoMerge, osmElement } from '../../src/merge.ts';
import { sqlValue } from './stations.ts';

export interface FeedPlanned {
  id: string;
  osm?: { element?: string | null } | null;
  lifecycle?: string | null;
  codes?: string[] | null;
  name?: string | null;
  operator?: string | null;
  city?: string | null;
  region?: string | null;   // CONT, MAD, AZO
  lat: number;
  lon: number;
}

export interface ConstructionRow {
  id: string;            // OSM-w1551836005
  code: string | null;   // the first MOBI.E code, shown as the station's code
  codes: string | null;  // all of them, space separated
  operator: string | null;
  name: string | null;
  municipality: string | null;
  region: string | null;
  lat: number;
  lon: number;
  osm_ref: string;       // way/1551836005
}

// What D1 has, for the stations under construction and the NAP stations they
// may merge into.
export interface CurrentRow {
  id: string;
  source: string;
  status: string;
  code: string | null;
  codes: string | null;
  operator: string | null;
  name: string | null;
  municipality: string | null;
  region: string | null;
  lat: number;
  lon: number;
  osm_ref: string | null;
}

export const CONSTRUCTION_FIELDS = ['code', 'codes', 'operator', 'name', 'municipality', 'region', 'lat', 'lon', 'osm_ref'] as const;
export const CONSTRUCTION_COLUMNS = ['id', ...CONSTRUCTION_FIELDS] as const;

const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : null;

// MOBI.E codes as the feed expands them (ALM-00114); anything else is dropped.
const CODE = /^[A-Z]{3}-\d{4,5}$/;

export function toConstructionRows(planned: FeedPlanned[]): ConstructionRow[] {
  const out: ConstructionRow[] = [];
  const seen = new Set<string>();
  for (const p of planned) {
    const id = str(p.id);
    if (!id || p.lifecycle !== 'construction' || seen.has(id)) continue;
    // The id is the OSM element; one that does not say which is no use for
    // the merge, and a page with it could never be found again.
    const element = osmElement(id);
    if (!element || (p.osm?.element && p.osm.element !== element)) continue;
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) continue;
    seen.add(id);
    const codes = [...new Set((p.codes ?? []).map((c) => (typeof c === 'string' ? c.trim().toUpperCase() : '')).filter((c) => CODE.test(c)))];
    out.push({
      id, code: codes[0] ?? null, codes: codes.length ? codes.join(' ') : null,
      operator: str(p.operator), name: str(p.name), municipality: str(p.city), region: str(p.region),
      lat: p.lat, lon: p.lon, osm_ref: element,
    });
  }
  return out;
}

export interface Merge {
  from: string;   // OSM-w…
  to: string;     // the NAP station
}

export interface ConstructionDiff {
  upsert: ConstructionRow[];   // new, changed, or back from missing_from_osm
  missing: string[];           // active, no longer in the feed, not merging
  merges: Merge[];
}

function changed(a: ConstructionRow, b: CurrentRow): boolean {
  return CONSTRUCTION_FIELDS.some((f) => (a[f] ?? null) !== (b[f] ?? null));
}

// `rows` is null when the feed has no `planned` array at all (an older feed):
// then nothing is added or marked missing, and only the merges run.
// `nap` is every NAP station after this import (D1 updated with the feed).
export function diffConstruction(
  rows: ConstructionRow[] | null,
  current: CurrentRow[],
  nap: { id: string; status: string; code: string | null; osm_ref: string | null }[],
): ConstructionDiff {
  const d: ConstructionDiff = { upsert: [], missing: [], merges: [] };
  const byElement = new Map<string, typeof nap>();
  for (const n of nap) {
    if (n.status !== 'active' || !n.osm_ref) continue;
    byElement.set(n.osm_ref, [...(byElement.get(n.osm_ref) ?? []), n]);
  }
  // The NAP station this one merges into on its own, if exactly one matches.
  const target = (c: { osm_ref: string | null; codes: string | null }): string | null => {
    const hits = (byElement.get(c.osm_ref ?? '') ?? []).filter((n) => autoMerge(c, n));
    return hits.length === 1 ? hits[0].id : null;
  };

  const cur = new Map(current.filter((c) => c.source === 'osm').map((c) => [c.id, c]));
  const merging = new Set<string>();
  // Every station under construction in D1, also the ones the feed dropped:
  // the NAP and OSM change at their own pace, so the merge cannot wait to see
  // both in the same run.
  for (const c of cur.values()) {
    if (c.status === 'merged') continue;
    const to = target(c);
    if (to) {
      d.merges.push({ from: c.id, to });
      merging.add(c.id);
    }
  }
  if (rows === null) return d;

  const inFeed = new Set<string>();
  for (const r of rows) {
    inFeed.add(r.id);
    const c = cur.get(r.id);
    // A new one whose OSM element an active NAP station already carries is
    // open (the NAP wins; OSM is behind): leave it out. Also when it matches
    // several NAP stations (a shop with one element for many NAP sites),
    // which no merge could pick from. It has no photos to keep.
    if (!c) {
      if (!byElement.has(r.osm_ref)) d.upsert.push(r);
      continue;
    }
    if (c.status === 'merged' || merging.has(c.id)) continue;
    if (c.status !== 'active' || changed(r, c)) d.upsert.push(r);
  }
  for (const c of cur.values()) {
    if (c.status === 'active' && !inFeed.has(c.id) && !merging.has(c.id)) d.missing.push(c.id);
  }
  return d;
}

// Guard against a broken `planned` array marking every station under
// construction as gone: refuse over half of a real set.
export function checkConstructionMissing(d: ConstructionDiff, current: CurrentRow[]): string | null {
  const active = current.filter((c) => c.source === 'osm' && c.status === 'active').length;
  return active >= 10 && d.missing.length > active / 2
    ? `refusing: ${d.missing.length} of ${active} stations under construction would become missing_from_osm. ` +
      'Check the feed; rerun with --allow-mass-missing if it is right.'
    : null;
}

const ROWS_PER_INSERT = 100;
const IDS_PER_UPDATE = 200;

function chunks<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

// MERGE_SQL with its ?n placeholders as literals, for the import's SQL file.
export function mergeStatements(m: Merge, at: string): string[] {
  const values = [m.from, m.to, null, at].map(sqlValue);
  return MERGE_SQL.map((s) => s.replace(/\?([1-4])/g, (_, n: string) => values[Number(n) - 1]));
}

// After the NAP stations (the merges point at them).
export function constructionSql(d: ConstructionDiff, generatedAt: string): string[] {
  const at = sqlValue(generatedAt);
  const out: string[] = [];
  for (const part of chunks(d.upsert, ROWS_PER_INSERT)) {
    out.push(
      `INSERT INTO stations (${CONSTRUCTION_COLUMNS.join(', ')}, source, status, updated_at) VALUES\n  ` +
      part.map((r) => `(${CONSTRUCTION_COLUMNS.map((c) => sqlValue(r[c])).join(', ')}, 'osm', 'active', ${at})`).join(',\n  ') +
      `\nON CONFLICT (id) DO UPDATE SET ${CONSTRUCTION_FIELDS.map((f) => `${f} = excluded.${f}`).join(', ')}, ` +
      `status = 'active', updated_at = excluded.updated_at\n` +
      // Never a NAP row, never one already merged.
      `WHERE stations.source = 'osm' AND stations.status <> 'merged';`,
    );
  }
  for (const ids of chunks(d.missing, IDS_PER_UPDATE)) {
    out.push(`UPDATE stations SET status = 'missing_from_osm', updated_at = ${at} ` +
      `WHERE source = 'osm' AND status = 'active' AND id IN (${ids.map(sqlValue).join(', ')});`);
  }
  for (const m of d.merges) out.push(...mergeStatements(m, generatedAt).map((s) => `${s};`));
  return out;
}
