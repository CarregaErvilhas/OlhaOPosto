// Gamification (Docs/arquitetura.md, *Gamificação*): points for approved
// photos, medals from the all-time total, and the ranking.
//
// The rules:
//   approved     +1  every approved photo;
//   first_photo  +3  the first approved photo of its target (a socket, or the
//                    station in general);
//   refresh      +2  a photo that replaces a main photo more than 12 months old.
// The same person on the same target within 30 days counts once: a second
// photo there earns nothing. Points always go to the photo's author, never to
// the moderator who approved it. Points of a photo that is later hidden or
// removed stop counting (the ranking only adds up published photos), so a
// takedown or a cheat found later takes them away without deleting rows.

interface Stmt {
  bind(...values: unknown[]): Stmt;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}
export interface PointsDb {
  prepare(sql: string): Stmt;
}

export const POINTS = { approved: 1, first_photo: 3, refresh: 2 } as const;
export type Reason = keyof typeof POINTS;
export const SAME_TARGET_DAYS = 30;
export const REFRESH_AGE_DAYS = 365;
const DAY = 86_400_000;

// From the all-time total, highest first.
export const MEDALS = [
  { id: 'gold', min: 200 },
  { id: 'silver', min: 50 },
  { id: 'bronze', min: 10 },
] as const;
export type Medal = (typeof MEDALS)[number]['id'];
export const medalFor = (total: number): Medal | null => MEDALS.find((m) => total >= m.min)?.id ?? null;

interface PhotoTarget {
  id: string;
  uploader_id: string | null;
  station_id: string;
  evse_compact: string | null;
  // A rating plate counts apart from the photos of the same station.
  kind?: string | null;
}

const insert = (db: PointsDb, userId: string, photoId: string, reason: Reason, now: Date) =>
  db.prepare(
    `INSERT INTO points (user_id, photo_id, points, reason, month, created_at)
     SELECT ?1, ?2, ?3, ?4, ?5, ?6
      WHERE NOT EXISTS (SELECT 1 FROM points WHERE photo_id = ?2 AND reason = ?4)`,
  ).bind(userId, photoId, POINTS[reason], reason, now.toISOString().slice(0, 7), now.toISOString());

async function loadPhoto(db: PointsDb, photoId: string): Promise<PhotoTarget | null> {
  return db.prepare(
    `SELECT id, uploader_id, station_id, evse_compact, kind FROM photos WHERE id = ? AND status = 'published' AND origin = 'olhaoposto'`,
  ).bind(photoId).first<PhotoTarget>();
}

// Has this person already earned points on this target in the last 30 days,
// with another photo?
async function recentOnTarget(db: PointsDb, p: PhotoTarget, now: Date): Promise<boolean> {
  const since = new Date(now.getTime() - SAME_TARGET_DAYS * DAY).toISOString();
  const row = await db.prepare(
    `SELECT 1 AS hit FROM points pt JOIN photos ph ON ph.id = pt.photo_id
      WHERE pt.user_id = ? AND ph.station_id = ? AND ph.evse_compact IS ? AND ph.kind = ? AND ph.id <> ? AND pt.created_at >= ?
      LIMIT 1`,
  ).bind(p.uploader_id, p.station_id, p.evse_compact, p.kind ?? 'photo', p.id, since).first<{ hit: number }>();
  return row !== null;
}

// Points for a photo that was just approved (by a moderator, or directly for
// a trusted account). Returns the reasons awarded. Safe to call twice: each
// reason is awarded once per photo.
export async function awardApproval(db: PointsDb, photoId: string, now = new Date()): Promise<Reason[]> {
  const p = await loadPhoto(db, photoId);
  if (!p?.uploader_id) return [];
  if (await recentOnTarget(db, p, now)) return [];
  const earlier = await db.prepare(
    `SELECT COUNT(*) AS n FROM photos
      WHERE station_id = ? AND evse_compact IS ? AND kind = ? AND id <> ? AND status = 'published' AND origin = 'olhaoposto'`,
  ).bind(p.station_id, p.evse_compact, p.kind ?? 'photo', p.id).first<{ n: number }>();
  const reasons: Reason[] = ['approved'];
  if ((earlier?.n ?? 0) === 0) reasons.push('first_photo');
  for (const r of reasons) await insert(db, p.uploader_id, p.id, r, now).run();
  return reasons;
}

// Points for a photo that became a target's main photo in place of an older
// one. oldPublishedAt is when the replaced photo went up as main.
export async function awardRefresh(
  db: PointsDb, photoId: string, oldPublishedAt: string | null, now = new Date(),
): Promise<boolean> {
  if (!oldPublishedAt) return false;
  const age = now.getTime() - Date.parse(oldPublishedAt);
  if (!(age > REFRESH_AGE_DAYS * DAY)) return false;
  const p = await loadPhoto(db, photoId);
  if (!p?.uploader_id) return false;
  await insert(db, p.uploader_id, p.id, 'refresh', now).run();
  return true;
}

export interface RankingRow {
  name: string;
  points: number;
  photos: number;
  medal: Medal | null;
}

// Top 50, by points of published photos. The medal is always from the
// all-time total, also in the monthly ranking.
export async function ranking(db: PointsDb, period: 'month' | 'all', now = new Date()): Promise<RankingRow[]> {
  const month = now.toISOString().slice(0, 7);
  const { results } = await db.prepare(
    `SELECT COALESCE(u.pseudonym, u.osm_name) AS name,
            SUM(CASE WHEN ?1 = 'all' OR p.month = ?2 THEN p.points ELSE 0 END) AS score,
            COUNT(DISTINCT CASE WHEN p.reason = 'approved' AND (?1 = 'all' OR p.month = ?2) THEN p.photo_id END) AS photos,
            SUM(p.points) AS total
       FROM points p
       JOIN users u ON u.id = p.user_id
       JOIN photos ph ON ph.id = p.photo_id AND ph.status = 'published'
      WHERE u.ranking_opt_out = 0
      GROUP BY u.id
     HAVING score > 0
      ORDER BY score DESC, name ASC
      LIMIT 50`,
  ).bind(period, month).all<{ name: string; score: number; photos: number; total: number }>();
  return results.map((r) => ({
    name: r.name, points: Number(r.score), photos: Number(r.photos), medal: medalFor(Number(r.total)),
  }));
}

export interface MyPoints {
  total: number;
  month: number;
  photos: number;
  medal: Medal | null;
  optOut: boolean;
}

// The account page: a person's own points, also when they left the ranking.
export async function myPoints(db: PointsDb, userId: string, now = new Date()): Promise<MyPoints> {
  const month = now.toISOString().slice(0, 7);
  const row = await db.prepare(
    `SELECT COALESCE(SUM(p.points), 0) AS total,
            COALESCE(SUM(CASE WHEN p.month = ?2 THEN p.points ELSE 0 END), 0) AS month,
            COUNT(DISTINCT CASE WHEN p.reason = 'approved' THEN p.photo_id END) AS photos,
            (SELECT ranking_opt_out FROM users WHERE id = ?1) AS opt_out
       FROM points p JOIN photos ph ON ph.id = p.photo_id AND ph.status = 'published'
      WHERE p.user_id = ?1`,
  ).bind(userId, month).first<{ total: number; month: number; photos: number; opt_out: number | null }>();
  const total = Number(row?.total ?? 0);
  return { total, month: Number(row?.month ?? 0), photos: Number(row?.photos ?? 0), medal: medalFor(total), optOut: row?.opt_out === 1 };
}

export async function setRankingOptOut(db: PointsDb, userId: string, out: boolean): Promise<void> {
  await db.prepare('UPDATE users SET ranking_opt_out = ? WHERE id = ?').bind(out ? 1 : 0, userId).run();
}
