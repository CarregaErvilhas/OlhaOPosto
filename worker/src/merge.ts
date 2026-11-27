// Merging a station under construction (source 'osm', id OSM-w123) into the
// NAP station it became (Docs/arquitetura.md, *Postos em construção*). The same
// statements run in the daily import (scripts/lib/construction.ts, as SQL
// text) and in the Worker when a moderator merges by hand (src/aliases.ts),
// so both do exactly the same thing.
//
// ?1 the station under construction, ?2 the NAP station, ?3 who (NULL for
// the import), ?4 when. A station under construction never has a main photo
// or a static link (they wait for the NAP id), so there is nothing to move in
// `selections` or in the public bucket: the cron publishes a main for the NAP
// station from the moved photos if it has none (src/construction.ts).
export const MERGE_SQL: readonly string[] = [
  // The old page and API answer 301 from now on.
  `INSERT INTO station_aliases (old_id, new_id, created_by, created_at) VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT (old_id) DO NOTHING`,
  // Our photos on Panoramax still carry OlhaOPosto|site=<old id>: the cron
  // swaps the tag and clears site_tag_old.
  `UPDATE photos SET
     site_tag_old = CASE WHEN origin = 'olhaoposto' AND panoramax_id IS NOT NULL
                         THEN COALESCE(site_tag_old, station_id) ELSE site_tag_old END,
     station_id = ?2
   WHERE station_id = ?1`,
  `UPDATE stations SET status = 'merged', updated_at = ?4 WHERE id = ?1 AND source = 'osm'`,
];

// The values one statement of MERGE_SQL takes: up to its highest ?n (SQLite
// counts parameters that way, and refuses extra ones).
export function mergeBinds(sql: string, values: readonly unknown[]): unknown[] {
  const top = Math.max(0, ...[...sql.matchAll(/\?(\d)/g)].map((m) => Number(m[1])));
  return values.slice(0, top);
}

// The OSM element of a station under construction from its id, in the form
// the NAP stations carry it (osm.element): OSM-w123 -> way/123.
export function osmElement(id: string): string | null {
  const m = /^OSM-([nw])(\d+)$/.exec(id);
  return m ? `${m[1] === 'n' ? 'node' : 'way'}/${m[2]}` : null;
}

// May the station under construction merge on its own into this NAP station?
// Same OSM element and the codes agree: the NAP code is one of the codes the
// OSM tags carried, or there were none to compare.
export function autoMerge(
  construction: { osm_ref: string | null; codes: string | null },
  nap: { osm_ref: string | null; code: string | null },
): boolean {
  if (!construction.osm_ref || construction.osm_ref !== nap.osm_ref) return false;
  const codes = (construction.codes ?? '').split(' ').filter(Boolean);
  return codes.length === 0 || (nap.code !== null && codes.includes(nap.code));
}
