// Import of stations and charge points from the NAP dashboard network model
// into D1, and of the stations under construction that OSM knows of (the
// feed's `planned` array, scripts/lib/construction.ts), with their merges
// into the NAP stations they become. Runs in GitHub Actions (.github/workflows/import-stations.yml),
// not in the Worker: parsing the ~12 MB feed does not fit the 10 ms CPU limit
// of a Free-plan Cron Trigger.
//
//   node scripts/import-stations.ts --local            # local D1 (wrangler dev)
//   node scripts/import-stations.ts --remote           # real D1
//   options: --dry-run  --force (ignore unchanged generatedAt)
//            --allow-mass-missing  --feed <url or path>
//
// Only rows that changed are written: D1 Free counts rows written per day.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import {
  checkExternalRemovals, checkMissing, diff, diffExternalPhotos, EXTERNAL_COLUMNS, externalSql, toExternalPhotos,
  toRows, toSql, validateFeed,
  type CurrentEvse, type CurrentStation, type ExternalPhotoRow, EVSE_COLUMNS, STATION_COLUMNS,
} from './lib/stations.ts';
import {
  checkConstructionMissing, constructionSql, diffConstruction, toConstructionRows, type CurrentRow,
} from './lib/construction.ts';
import { d1, type Target } from './lib/wrangler.ts';

const FEED_URL = 'https://nap.ocarroeletrico.com/ohmigo/chargers.json';

const { values } = parseArgs({
  options: {
    local: { type: 'boolean', default: false },
    remote: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
    force: { type: 'boolean', default: false },
    'allow-mass-missing': { type: 'boolean', default: false },
    feed: { type: 'string', default: FEED_URL },
  },
});
if (values.local === values.remote) {
  console.error('pass exactly one of --local or --remote');
  process.exit(2);
}
const target: Target = values.remote ? 'remote' : 'local';

async function loadFeed(src: string): Promise<unknown> {
  if (!/^https?:\/\//.test(src)) return JSON.parse(readFileSync(src, 'utf8'));
  const res = await fetch(src, { headers: { 'user-agent': 'OlhaOPosto-import' } });
  if (!res.ok) throw new Error(`feed: HTTP ${res.status} from ${src}`);
  return res.json();
}

const feed = validateFeed(await loadFeed(values.feed));
const rows = toRows(feed);
console.log(`feed ${feed.generatedAt}: ${rows.stations.length} stations, ${rows.evses.length} points` +
  (rows.skipped.length ? `, ${rows.skipped.length} sites skipped` : ''));

d1(target, (db) => {
  const last = db.query<{ value: string }>(`SELECT value FROM import_state WHERE key = 'generated_at'`)[0]?.value;
  if (last === feed.generatedAt && !values.force) {
    console.log('feed unchanged since the last import; nothing to do (--force to rerun)');
    return;
  }
  const current = {
    stations: db.query<CurrentStation>(`SELECT ${STATION_COLUMNS.join(', ')}, source, status FROM stations`),
    evses: db.query<CurrentEvse>(`SELECT ${EVSE_COLUMNS.join(', ')}, status FROM evses`),
  };
  const d = diff(rows, current);
  console.log(`stations: +${d.insertStations.length} ~${d.updateStations.length} missing ${d.missingStations.length}` +
    ` | points: +${d.insertEvses.length} ~${d.updateEvses.length} missing ${d.missingEvses.length}` +
    (d.conflicts.length ? ` | conflicts (not NAP rows): ${d.conflicts.join(', ')}` : ''));

  const refusal = checkMissing(d, current.stations);
  if (refusal && !values['allow-mass-missing']) throw new Error(refusal);

  // Stations under construction. The NAP stations they may merge into are D1
  // as this run leaves it: the feed's rows active, the ones it dropped gone.
  const osmCurrent = db.query<CurrentRow>(
    `SELECT id, source, status, code, codes, operator, name, lat, lon, osm_ref FROM stations WHERE source = 'osm'`,
  );
  const gone = new Set(d.missingStations);
  const nap = new Map(current.stations.filter((s) => s.source === 'nap')
    .map((s) => [s.id, { id: s.id, status: gone.has(s.id) ? 'missing_from_nap' : s.status, code: s.code, osm_ref: s.osm_ref }]));
  for (const s of rows.stations) {
    if (!d.conflicts.includes(s.id)) nap.set(s.id, { id: s.id, status: 'active', code: s.code, osm_ref: s.osm_ref });
  }
  const planned = feed.planned === undefined ? null : toConstructionRows(feed.planned);
  const cd = diffConstruction(planned, osmCurrent, [...nap.values()]);
  console.log(planned === null
    ? `under construction: no planned array in the feed; merges ${cd.merges.length}`
    : `under construction: ${planned.length} in the feed, +/~${cd.upsert.length} missing ${cd.missing.length}` +
      ` merges ${cd.merges.length}` + (cd.merges.length ? ` (${cd.merges.map((m) => `${m.from}->${m.to}`).join(', ')})` : ''));
  const cRefusal = checkConstructionMissing(cd, osmCurrent);
  if (cRefusal && !values['allow-mass-missing']) throw new Error(cRefusal);

  // External photos (references to Panoramax and Commons, never copies). Ours
  // are left out: their Panoramax UUID is in photos.panoramax_id.
  const own = new Set(db.query<{ panoramax_id: string }>(
    `SELECT panoramax_id FROM photos WHERE origin = 'olhaoposto' AND panoramax_id IS NOT NULL`,
  ).map((r) => r.panoramax_id.toLowerCase()));
  const externalCurrent = db.query<ExternalPhotoRow>(
    `SELECT ${EXTERNAL_COLUMNS.join(', ')} FROM photos WHERE origin <> 'olhaoposto'`,
  );
  const ext = diffExternalPhotos(toExternalPhotos(feed, own), externalCurrent);
  console.log(`external photos: +/~${ext.upsert.length} removed ${ext.removed.length} (of ${externalCurrent.length})`);
  const extRefusal = checkExternalRemovals(ext, externalCurrent.length);
  if (extRefusal && !values['allow-mass-missing']) throw new Error(extRefusal);

  // The stations come first: photos.station_id references them, and the
  // merges point at the NAP stations. The generated_at marker goes last, so a
  // failed run is rerun.
  const marker = toSql(d, feed.generatedAt);
  const statements = [...marker.slice(0, -1), ...constructionSql(cd, feed.generatedAt),
    ...externalSql(ext, feed.generatedAt), marker[marker.length - 1]];
  if (values['dry-run']) {
    console.log(`dry run: ${statements.length} statements, nothing written`);
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), 'olhaoposto-import-'));
  try {
    const file = join(dir, 'import.sql');
    writeFileSync(file, statements.join('\n') + '\n');
    const written = db.executeFile(file);
    console.log(`done: ${statements.length} statements` + (written === null ? '' : `, ${written} rows written`));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
