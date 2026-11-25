import type { Env } from './data.ts';

export interface RankingRow {
  name: string;
  points: number;
}

export async function ranking(env: Env, period: 'month' | 'all'): Promise<RankingRow[]> {
  const month = new Date().toISOString().slice(0, 7);
  const where = period === 'month' ? 'AND p.month = ?' : '';
  const binds = period === 'month' ? [month] : [];
  const { results } = await env.DB.prepare(
    `SELECT COALESCE(u.pseudonym, u.osm_name) AS name, SUM(p.points) AS points
       FROM points p JOIN users u ON u.id = p.user_id
      WHERE u.ranking_opt_out = 0 ${where}
      GROUP BY u.id
      ORDER BY points DESC, name ASC
      LIMIT 50`,
  ).bind(...binds).all<RankingRow>();
  return results.map((r) => ({ name: r.name, points: Number(r.points) }));
}
