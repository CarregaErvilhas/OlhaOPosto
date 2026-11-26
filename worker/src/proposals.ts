// Proposed stations (Docs/arquitetura.md, *Posto novo*): a station that is
// not in the NAP yet, proposed from the upload page or the API.
//
// POST /api/v1/stations writes a `stations` row (source 'community', status
// 'pending_review', never public) and a review_queue row. The person who
// proposed it can send photos of it straight away; they wait in the queue
// with the station. A moderator approves the station (it becomes 'active',
// with a page and static links, and the daily NAP import never touches it)
// or rejects it ('rejected', and its waiting photos are rejected with it).
import { esc, type Lang } from './pages.ts';
import { allowed, type RateEnv } from './ratelimit.ts';
import { apiCaller, type ApiSigner } from './tokens.ts';
import type { AuthEnv } from './auth.ts';
import { distanceM } from './types.ts';

interface Stmt {
  bind(...values: unknown[]): Stmt;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes: number } }>;
}
export interface ProposalDb {
  prepare(sql: string): Stmt;
}
const db = (env: AuthEnv) => env.DB as unknown as ProposalDb;

// Mainland Portugal, Madeira and the Azores, with a margin.
const PT_BOX = { minLat: 29.5, maxLat: 42.5, minLon: -31.8, maxLon: -6.0 };
// An existing station this close is probably the same one.
export const NEARBY_M = 60;
export const DAILY_PROPOSALS: Record<string, number> = { contributor: 5 };
const DAILY_PROPOSALS_OTHERS = 50;

export interface Proposal {
  name: string;
  operator: string;
  code: string | null;
  lat: number;
  lon: number;
  note: string | null;
}

const text = (v: unknown, max: number) =>
  typeof v === 'string' ? v.normalize('NFC').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';

// The JSON body. A string is an error code.
export function parseProposal(raw: unknown): Proposal | string {
  if (!raw || typeof raw !== 'object') return 'bad_body';
  const b = raw as Record<string, unknown>;
  const name = text(b.name, 120);
  const operator = text(b.operator, 120);
  if (name.length < 2 || operator.length < 2) return 'name_and_operator';
  const code = text(b.code, 40) || null;
  if (code && !/^[A-Za-z0-9*_.-]{2,40}$/.test(code)) return 'bad_code';
  const lat = typeof b.lat === 'number' ? b.lat : NaN;
  const lon = typeof b.lon === 'number' ? b.lon : NaN;
  if (!(lat >= PT_BOX.minLat && lat <= PT_BOX.maxLat && lon >= PT_BOX.minLon && lon <= PT_BOX.maxLon)) return 'bad_position';
  const note = text(b.note, 500) || null;
  // Five decimals: about a metre, all a phone GPS gives anyway.
  return { name, operator, code, lat: Math.round(lat * 1e5) / 1e5, lon: Math.round(lon * 1e5) / 1e5, note };
}

const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

// Public stations near a point, for the duplicate check.
async function nearby(env: AuthEnv, lat: number, lon: number): Promise<{ id: string; name: string | null; distance_m: number }[]> {
  const d = 0.001; // ~110 m of latitude; the exact cut is distanceM
  const { results } = await db(env).prepare(
    `SELECT id, name, lat, lon FROM stations
      WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ? AND status IN ('active', 'missing_from_nap', 'pending_review')`,
  ).bind(lat - d, lat + d, lon - d * 1.3, lon + d * 1.3).all<{ id: string; name: string | null; lat: number; lon: number }>();
  return results
    .map((r) => ({ id: r.id, name: r.name, distance_m: Math.round(distanceM(lat, lon, r.lat, r.lon)) }))
    .filter((r) => r.distance_m <= NEARBY_M)
    .sort((a, b) => a.distance_m - b.distance_m);
}

export const newStationId = () => `OOP-${crypto.randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`;

// POST /api/v1/stations. ?force=1 skips the nearby check, after the person
// has seen the stations it found and says theirs is another one.
// `signedIn`: as in submitPhoto (src/photos.ts), for the MCP server.
export async function proposeStation(
  request: Request, env: AuthEnv & RateEnv, now = new Date(), signedIn?: ApiSigner,
): Promise<Response> {
  const caller = signedIn ?? await apiCaller(request, env, 'photos:write', now);
  if ('error' in caller) return reply(caller.status, { error: caller.error });
  const { user } = caller;
  if (!(await allowed(env.UPLOAD_LIMIT, user.id))) return reply(429, { error: 'too_fast' });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return reply(400, { error: 'bad_body' });
  }
  const p = parseProposal(body);
  if (typeof p === 'string') return reply(400, { error: p });

  const dayStart = `${now.toISOString().slice(0, 10)}T00:00:00.000Z`;
  const count = await db(env).prepare(
    `SELECT COUNT(*) AS n FROM review_queue WHERE submitted_by = ? AND kind = 'new_station' AND created_at >= ?`,
  ).bind(user.id, dayStart).first<{ n: number }>();
  if ((count?.n ?? 0) >= (DAILY_PROPOSALS[user.role] ?? DAILY_PROPOSALS_OTHERS)) return reply(429, { error: 'daily_limit' });

  if (new URL(request.url).searchParams.get('force') !== '1') {
    const close = await nearby(env, p.lat, p.lon);
    if (close.length) return reply(409, { error: 'station_nearby', stations: close });
  }

  const id = newStationId();
  const at = now.toISOString();
  await db(env).prepare(
    `INSERT INTO stations (id, code, operator, name, lat, lon, source, status, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'community', 'pending_review', ?)`,
  ).bind(id, p.code, p.operator, p.name, p.lat, p.lon, at).run();
  await db(env).prepare(
    `INSERT INTO review_queue (id, kind, station_id, payload, submitted_by, created_at) VALUES (?, 'new_station', ?, ?, ?, ?)`,
  ).bind(crypto.randomUUID(), id, JSON.stringify(p), user.id, at).run();
  return reply(201, { id, status: 'pending_review' });
}

// May this person send photos of this station? Public stations: anyone.
// A proposal: only whoever proposed it, until a moderator decides.
export async function proposedBy(env: AuthEnv, stationId: string, userId: string): Promise<boolean> {
  const row = await db(env).prepare(
    `SELECT 1 AS ok FROM review_queue WHERE station_id = ? AND submitted_by = ? AND kind = 'new_station' AND status = 'pending'`,
  ).bind(stationId, userId).first<{ ok: number }>();
  return row !== null;
}

// --- the moderation queue (src/moderation.ts renders the page) ---

export interface ProposalRow {
  queue_id: string;
  station_id: string;
  payload: string;
  proposer: string | null;
  created_at: string;
  photos: number;
}

export async function pendingProposals(env: AuthEnv, limit = 50): Promise<ProposalRow[]> {
  const { results } = await db(env).prepare(
    `SELECT q.id AS queue_id, q.station_id, q.payload, COALESCE(u.pseudonym, u.osm_name) AS proposer, q.created_at,
            (SELECT COUNT(*) FROM photos p WHERE p.station_id = q.station_id AND p.status = 'pending') AS photos
       FROM review_queue q LEFT JOIN users u ON u.id = q.submitted_by
      WHERE q.kind = 'new_station' AND q.status = 'pending'
      ORDER BY q.created_at
      LIMIT ${limit}`,
  ).all<ProposalRow>();
  return results;
}

const T = {
  pt: {
    h: 'Postos propostos',
    intro: 'Postos que não estão no NAP. Confirma que existem (pelas fotos, pelo OpenStreetMap, pelo site do operador) antes de aprovar. Aprovar torna o posto público; recusar recusa também as fotos dele que estão à espera.',
    by: 'Proposto por',
    code: 'Código',
    note: 'Nota',
    photos: (n: number) => (n === 1 ? '1 foto à espera' : `${n} fotos à espera`),
    approve: 'Aprovar posto',
    reject: 'Recusar posto',
  },
  en: {
    h: 'Proposed stations',
    intro: 'Stations that are not in the NAP. Check that they exist (from the photos, OpenStreetMap, the operator’s site) before approving. Approving makes the station public; rejecting also rejects its photos that are waiting.',
    by: 'Proposed by',
    code: 'Code',
    note: 'Note',
    photos: (n: number) => (n === 1 ? '1 photo waiting' : `${n} photos waiting`),
    approve: 'Approve station',
    reject: 'Reject station',
  },
};

export function proposalsSection(lang: Lang, rows: ProposalRow[], action: string): string {
  if (rows.length === 0) return '';
  const t = T[lang];
  const card = (r: ProposalRow) => {
    let p: Partial<Proposal> = {};
    try { p = JSON.parse(r.payload); } catch { /* shown as empty */ }
    const pos = typeof p.lat === 'number' && typeof p.lon === 'number'
      ? `<a href="https://www.openstreetmap.org/?mlat=${p.lat}&amp;mlon=${p.lon}#map=19/${p.lat}/${p.lon}" target="_blank" rel="noopener">${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}</a>`
      : '—';
    const button = (decision: 'approve_station' | 'reject_station', label: string, cls: string) =>
      `<form method="post" action="${action}"><input type="hidden" name="station" value="${esc(r.station_id)}">` +
      `<input type="hidden" name="action" value="${decision}"><input type="hidden" name="lang" value="${lang}">` +
      `<button type="submit" class="${cls}">${label}</button></form>`;
    return `<article class="queue-item proposal">
<div>
<p><strong lang="pt-PT">${esc(p.name ?? r.station_id)}</strong> · <span lang="pt-PT">${esc(p.operator ?? '')}</span> <span class="muted">${esc(r.station_id)}</span></p>
${p.code ? `<p><strong>${t.code}:</strong> <code>${esc(p.code)}</code></p>` : ''}
<p>${pos} · ${t.photos(r.photos)}</p>
${p.note ? `<p><strong>${t.note}:</strong> <span lang="">${esc(p.note)}</span></p>` : ''}
<p class="muted">${t.by} <span lang="">${esc(r.proposer ?? '—')}</span> · ${esc(r.created_at.slice(0, 16).replace('T', ' '))}</p>
<div class="queue-actions">${button('approve_station', t.approve, 'button')}${button('reject_station', t.reject, 'button secondary')}</div>
</div>
</article>`;
  };
  return `<h2>${t.h}</h2>\n<p>${t.intro}</p>\n${rows.map(card).join('\n')}`;
}

// Approve or reject. Returns the ids of the photos that must be rejected
// with the station (the caller deletes them on Panoramax and staging), or
// null when someone else already decided.
export async function decideProposal(
  env: AuthEnv, stationId: string, approve: boolean, moderatorId: string, now = new Date(),
): Promise<string[] | null> {
  const at = now.toISOString();
  const r = await db(env).prepare(
    `UPDATE review_queue SET status = ?, decided_by = ?, decided_at = ?
      WHERE station_id = ? AND kind = 'new_station' AND status = 'pending'`,
  ).bind(approve ? 'approved' : 'rejected', moderatorId, at, stationId).run();
  if (r.meta.changes !== 1) return null;
  await db(env).prepare(`UPDATE stations SET status = ?, updated_at = ? WHERE id = ? AND status = 'pending_review'`)
    .bind(approve ? 'active' : 'rejected', at, stationId).run();
  if (approve) return [];
  const { results } = await db(env).prepare(`SELECT id FROM photos WHERE station_id = ? AND status = 'pending'`)
    .bind(stationId).all<{ id: string }>();
  return results.map((x) => x.id);
}
