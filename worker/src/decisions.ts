// The decisions history for moderators (/admin/decisoes, /en/admin/decisions):
// who approved or refused what, and when, with the reason. Photos come from
// approved_by/approved_at (and refused_by + refusal_reason for a refusal).
// Removals by takedown have no
// moderator in our rows (the report lives in Panoramax), so they are not here.
import { currentUser, page, type AuthEnv } from './auth.ts';
import { BRAND, accountPath, esc, layout, stationPath, type Lang } from './pages.ts';
import { canModerate, decisionsPath, queuePath } from './moderation.ts';
import { REASON_TEXT, isReason } from './reasons.ts';

export const DECISIONS_PAGE_SIZE = 50;

interface Stmt {
  bind(...values: unknown[]): Stmt;
  all<T>(): Promise<{ results: T[] }>;
}

export interface DecisionRow {
  kind: 'photo';
  id: string;
  station_id: string;
  station_name: string | null;
  decision: 'approved' | 'refused';
  reason: string | null;
  note: string | null;
  decided_at: string;
  moderator: string | null;
}

const T = {
  pt: {
    title: 'Histórico de decisões',
    intro: 'As decisões mais recentes sobre fotos: quem decidiu, quando e porquê. As remoções por pedido de remoção não entram: ficam nas denúncias do Panoramax.',
    empty: 'Ainda não há decisões.',
    when: 'Quando', who: 'Quem', what: 'O quê', result: 'Decisão', reason: 'Motivo',
    photo: 'Foto',
    approved: 'Aprovada', refused: 'Recusada',
    prev: 'Mais recentes', next: 'Mais antigas',
    queue: 'Fila de moderação', back: 'Voltar à conta',
    forbidden: 'Esta página é só para moderadores e administradores.',
  },
  en: {
    title: 'Decisions history',
    intro: 'The latest decisions on photos: who decided, when and why. Removals by removal request are not here: they live in the Panoramax reports.',
    empty: 'No decisions yet.',
    when: 'When', who: 'Who', what: 'What', result: 'Decision', reason: 'Reason',
    photo: 'Photo',
    approved: 'Approved', refused: 'Refused',
    prev: 'Newer', next: 'Older',
    queue: 'Moderation queue', back: 'Back to account',
    forbidden: 'This page is only for moderators and admins.',
  },
};

export function decisionsPage(lang: Lang, rows: DecisionRow[], pageNo: number, more: boolean): string {
  const t = T[lang];
  const row = (r: DecisionRow) => {
    const reason = r.reason && isReason(r.reason) ? REASON_TEXT[lang][r.reason] : '';
    return `<tr><td>${esc(r.decided_at.slice(0, 16).replace('T', ' '))}</td>
<td lang="">${esc(r.moderator ?? '—')}</td>
<td>${t.photo}: <a href="${stationPath(lang, r.station_id)}">${esc(r.station_name ?? r.station_id)}</a></td>
<td>${r.decision === 'approved' ? t.approved : t.refused}</td>
<td>${esc(reason)}${r.note ? `${reason ? ' — ' : ''}<span lang="">${esc(r.note)}</span>` : ''}</td></tr>`;
  };
  const here = decisionsPath(lang);
  const nav = [
    pageNo > 1 ? `<a href="${here}${pageNo > 2 ? `?pagina=${pageNo - 1}` : ''}">${t.prev}</a>` : '',
    more ? `<a href="${here}?pagina=${pageNo + 1}">${t.next}</a>` : '',
  ].filter(Boolean).join(' · ');
  const body = [
    `<h1>${t.title}</h1>`,
    `<p>${t.intro}</p>`,
    rows.length === 0
      ? `<p>${t.empty}</p>`
      : `<div class="table-wrap"><table>
<thead><tr><th>${t.when}</th><th>${t.who}</th><th>${t.what}</th><th>${t.result}</th><th>${t.reason}</th></tr></thead>
<tbody>${rows.map(row).join('\n')}</tbody></table></div>`,
    nav ? `<p>${nav}</p>` : '',
    `<p><a href="${queuePath(lang)}">${t.queue}</a> · <a href="${accountPath(lang)}">${t.back}</a></p>`,
  ].join('\n');
  return layout({
    lang, title: `${t.title} · ${BRAND}`, description: t.title, noindex: true,
    switchTo: { pt: decisionsPath('pt'), en: decisionsPath('en') },
    body,
  });
}

export async function decisionsHtml(lang: Lang, request: Request, env: AuthEnv, headers: Record<string, string>): Promise<Response> {
  const user = await currentUser(request, env).catch(() => null);
  if (!user) {
    return new Response(null, { status: 302, headers: { location: `/auth/osm/login?next=${encodeURIComponent(decisionsPath(lang))}`, 'cache-control': 'no-store' } });
  }
  if (!canModerate(user.role)) {
    const t = T[lang];
    return page(lang, layout({
      lang, title: `${t.title} · ${BRAND}`, description: t.title, noindex: true,
      body: `<div class="page-msg">\n<h1>${t.title}</h1>\n<p>${t.forbidden}</p>\n<p><a href="${accountPath(lang)}">${t.back}</a></p>\n</div>`,
    }), 403, headers);
  }
  const n = Number(new URL(request.url).searchParams.get('pagina'));
  const pageNo = Number.isInteger(n) && n >= 1 && n <= 10000 ? n : 1;
  const db = env.DB as unknown as { prepare(sql: string): Stmt };
  const { results } = await db.prepare(
    `SELECT * FROM (
       SELECT 'photo' AS kind, p.id, p.station_id, s.name AS station_name,
              CASE WHEN p.refused_by IS NOT NULL THEN 'refused' ELSE 'approved' END AS decision,
              p.refusal_reason AS reason, p.refusal_note AS note, p.approved_at AS decided_at,
              COALESCE(u.pseudonym, u.osm_name) AS moderator
         FROM photos p JOIN stations s ON s.id = p.station_id LEFT JOIN users u ON u.id = p.approved_by
        WHERE p.approved_by IS NOT NULL AND p.approved_at IS NOT NULL AND p.origin = 'olhaoposto'
     ) ORDER BY decided_at DESC, id
     LIMIT ? OFFSET ?`,
  ).bind(DECISIONS_PAGE_SIZE + 1, (pageNo - 1) * DECISIONS_PAGE_SIZE).all<DecisionRow>();
  return page(lang, decisionsPage(lang, results.slice(0, DECISIONS_PAGE_SIZE), pageNo, results.length > DECISIONS_PAGE_SIZE), 200, headers);
}
