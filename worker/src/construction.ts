// What a merge leaves for the Worker (Docs/arquitetura.md, *Postos
// em construção*). The import runs in GitHub Actions and only writes to D1
// (src/merge.ts), so two steps wait for the cron, which can reach R2 and
// Panoramax:
//
// 1. A NAP station that took the photos of a station under construction and
//    has no main photo gets the first of them as main, as an approval would
//    have done (src/publish.ts). A station whose main photo was lost has a
//    `selections` row and is left to a moderator, as always (src/mains.ts).
// 2. The OlhaOPosto|site tag on Panoramax still says the old id: swapped for
//    the NAP id, then photos.site_tag_old is cleared (like the credit tags in
//    src/credit.ts).
//
// Small batches: the cron shares the 50 external requests of the Free plan
// with the takedowns and the credits.
import { PANORAMAX_URL } from './photos.ts';
import { publishMain, type PublishEnv } from './publish.ts';

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
interface Stmt {
  bind(...values: unknown[]): Stmt;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes: number } }>;
}
const db = (env: PublishEnv) => env.DB as unknown as { prepare(sql: string): Stmt };

export const SITE_TAG = 'OlhaOPosto|site';
export const MAIN_BATCH = 2;
export const SITE_TAG_BATCH = 5;

// Step 1. Returns the stations that got a main photo.
export async function publishMergedMains(env: PublishEnv, fetcher: Fetch = fetch, now = new Date()): Promise<string[]> {
  const { results } = await db(env).prepare(
    `SELECT p.id, p.station_id, COALESCE(p.approved_by, p.uploader_id) AS by
       FROM station_aliases a
       JOIN stations o ON o.id = a.old_id AND o.source = 'osm' AND o.status = 'merged'
       JOIN stations n ON n.id = a.new_id AND n.source = 'nap'
       JOIN photos p ON p.station_id = a.new_id
      WHERE p.origin = 'olhaoposto' AND p.status = 'published' AND p.evse_compact IS NULL
        AND p.panoramax_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM selections sel WHERE sel.target = a.new_id)
      ORDER BY p.approved_at, p.id`,
  ).all<{ id: string; station_id: string; by: string | null }>();
  const first = new Map<string, { id: string; by: string | null }>();
  for (const r of results) if (!first.has(r.station_id)) first.set(r.station_id, r);
  const done: string[] = [];
  for (const [station, p] of [...first].slice(0, MAIN_BATCH)) {
    if (!p.by) continue;
    const targets = await publishMain(env, p.id, p.by, fetcher, now).catch((): string[] => []);
    if (targets.includes(station)) done.push(station);
  }
  return done;
}

// Step 2. Deleting the new value before adding it makes a retry after a lost
// reply harmless (Panoramax refuses a duplicate tag).
export async function syncSiteTags(env: PublishEnv, fetcher: Fetch = fetch): Promise<number> {
  const d = db(env);
  // Gone from Panoramax, or back where it was: nothing to swap.
  await d.prepare(
    `UPDATE photos SET site_tag_old = NULL
      WHERE site_tag_old IS NOT NULL AND (status IN ('failed', 'removed') OR site_tag_old = station_id)`,
  ).run();
  if (!env.PANORAMAX_TOKEN) return 0;
  const { results } = await d.prepare(
    `SELECT id, panoramax_id, station_id, site_tag_old FROM photos
      WHERE site_tag_old IS NOT NULL AND panoramax_id IS NOT NULL AND status IN ('pending', 'published', 'hidden')
      ORDER BY created_at LIMIT ?`,
  ).bind(SITE_TAG_BATCH).all<{ id: string; panoramax_id: string; station_id: string; site_tag_old: string }>();
  const base = env.PANORAMAX_URL ?? PANORAMAX_URL;
  for (const p of results) {
    const r = await fetcher(`${base}/api/pictures/${encodeURIComponent(p.panoramax_id)}`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${env.PANORAMAX_TOKEN}`, 'user-agent': 'OlhaOPosto', 'content-type': 'application/json' },
      body: JSON.stringify({
        semantics: [
          { action: 'delete', key: SITE_TAG, value: p.site_tag_old },
          { action: 'delete', key: SITE_TAG, value: p.station_id },
          { action: 'add', key: SITE_TAG, value: p.station_id },
        ],
      }),
    }).catch(() => null);
    // 404: the picture is gone, nothing left to tag. Only clear the value
    // just swapped: a second merge meanwhile leaves the new one.
    if (r && (r.ok || r.status === 404)) {
      await d.prepare('UPDATE photos SET site_tag_old = NULL WHERE id = ? AND site_tag_old = ? AND station_id = ?')
        .bind(p.id, p.site_tag_old, p.station_id).run();
    }
  }
  return results.length;
}

// Both, one after the other, from the cron (src/index.ts).
export async function afterMerges(env: PublishEnv, fetcher: Fetch = fetch): Promise<void> {
  await publishMergedMains(env, fetcher).catch((): string[] => []);
  await syncSiteTags(env, fetcher).catch(() => 0);
}
