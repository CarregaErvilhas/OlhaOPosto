// Removal requests, on top of Panoramax's own reports (Docs/arquitetura.md,
// *Pedidos de remoção*).
//
// Panoramax already has reports: anyone can POST /api/reports, and for the
// issues in AUTO_HIDE a database trigger makes the picture owner-only at once
// (the report starts as `open_autofix`). What Panoramax does not know about
// is our copies: the static links in pictures.*, the edge cache in front of
// both hosts, and the photo's row in D1. This file keeps those in step:
//
//   - /takedown: a form with Turnstile (Panoramax's POST has none). It turns
//     a code or link into the Panoramax picture, files the report, and hides
//     our copies straight away. No contact is asked: the service account is
//     not a Panoramax admin, so it could never read or delete it.
//   - reconcile(): run by the cron and by the panel. It hides our copies of
//     every picture with an open auto-hide report, whoever filed it (this form
//     or the viewer's report button), and retries any hide that half-failed.
//   - /admin/remocoes: the open reports on our pictures. The service account
//     owns every picture, which is enough to read and close their reports.
//     Remove deletes the upload set (the report goes with it, ON DELETE
//     CASCADE); keep closes the report, makes the picture public again and
//     refills the static links that are still empty.
//
// The report is filed without our token on purpose: Panoramax checks
// "reporter" before "owner", and a reporter cannot close a report as ignored.

import { currentUser, page, sameOrigin, type SessionUser } from './auth.ts';
import { BRAND, PANORAMAX_URL, accountPath, esc, layout, privacyPath, stationPath, type Lang } from './pages.ts';
import { turnstileOk, type PhotoEnv } from './photos.ts';
import { pictureUrls, publishMain, purgeUrls, type PublishEnv } from './publish.ts';
import { canModerate, STAGING_PREFIX } from './moderation.ts';
import { allowed, clientIp, type RateLimiter } from './ratelimit.ts';
import { compactCode, STATION_ID } from './types.ts';

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface TakedownEnv extends PublishEnv {
  TAKEDOWN_LIMIT?: RateLimiter;    // per IP, the public form's POST
  // Sent with the report so the zone's WAF rule lets it through; without the
  // rule anyone could hide every photo with a script (Docs/cloudflare.md).
  PANORAMAX_REPORT_KEY?: string;
}

export const TAKEDOWN_ACTION = 'takedown';   // Turnstile action, checked on siteverify
export const REPORT_HEADER = 'x-olhaoposto-report';
export const takedownFormPath = (lang: Lang) => (lang === 'pt' ? '/takedown' : '/en/takedown');
export const takedownsPath = (lang: Lang) => (lang === 'pt' ? '/admin/remocoes' : '/en/admin/takedowns');
export const TAKEDOWN_DECIDE = '/admin/remocao';
export const DEADLINE_H = 72;

// The Panoramax issues its trigger hides at once (migration report_visibility).
export const AUTO_HIDE = ['blur_missing', 'inappropriate', 'privacy', 'copyright'];
const REASONS = ['face', 'plate', 'property', 'copyright', 'other'] as const;
type Reason = typeof REASONS[number];
// Every reason maps to an auto-hide issue, so the form's promise holds; the
// reason itself goes at the start of the comment for the moderator.
const ISSUE: Record<Reason, string> = {
  face: 'blur_missing', plate: 'blur_missing', property: 'privacy', copyright: 'copyright', other: 'inappropriate',
};
const MAX_ASKED = 300;
const MAX_DETAILS = 2000;

export interface Report {
  id: string;
  issue: string;
  status: string;
  picture_id?: string | null;
  sequence_id?: string | null;
  ts_opened: string;
  reporter_comments?: string | null;
}

// The slices of D1 and R2 used here, so the tests typecheck under Node.
interface Stmt {
  bind(...values: unknown[]): Stmt;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes: number } }>;
}
const db = (env: PhotoEnv) => env.DB as unknown as { prepare(sql: string): Stmt };
interface Buckets {
  delete(keys: string[]): Promise<void>;
}

const T = {
  pt: {
    title: 'Pedir a remoção de uma foto',
    intro: `Se uma foto do ${BRAND} mostra a tua cara, a matrícula do teu carro, a tua casa ou outra coisa tua que não queres ali, pede aqui que a retiremos. Não precisas de conta nem de deixar contacto. A foto fica oculta logo que o pedido chega e um moderador decide em ${DEADLINE_H} horas se a apaga de vez.`,
    asked: 'Que foto?',
    askedHint: 'O código do posto ou da tomada (por exemplo EZC-AMD-00051), ou o link da foto, da página do posto ou do Panoramax.',
    reason: 'Porquê?',
    reasons: {
      face: 'Mostra a minha cara ou a de outra pessoa',
      plate: 'Mostra uma matrícula',
      property: 'Mostra a minha casa ou propriedade',
      copyright: 'É uma foto minha, publicada sem autorização',
      other: 'Outro motivo',
    } as Record<Reason, string>,
    details: 'Detalhes (opcional)',
    detailsHint: 'O que está na foto e onde, para o moderador encontrar. Não escrevas aqui o teu nome nem contactos.',
    send: 'Pedir remoção',
    privacy: 'O que guardamos com este pedido está na',
    privacyLink: 'política de privacidade',
    closed: 'O formulário ainda não está disponível. Escreve para info@ocarroeletrico.com com o link da foto e o motivo.',
    ok: `Pedido recebido. A foto já está oculta; pode levar alguns minutos a desaparecer de todos os sítios. Um moderador decide em ${DEADLINE_H} horas se a apaga de vez.`,
    already: 'Essa foto já está oculta, à espera da decisão de um moderador.',
    errors: {
      turnstile: 'A verificação de segurança falhou ou ainda não terminou. Espera uns segundos e volta a enviar.',
      bad: 'Falta dizer que foto é e porquê.',
      limit: 'Demasiados pedidos seguidos. Tenta outra vez daqui a um minuto.',
      notfound: 'Não encontrámos nenhuma foto publicada com esse código ou link. Confirma-o, ou escreve para info@ocarroeletrico.com.',
      panoramax: 'Não conseguimos registar o pedido agora. Tenta outra vez daqui a pouco, ou escreve para info@ocarroeletrico.com.',
    } as Record<string, string>,
    // Admin panel
    adminTitle: 'Pedidos de remoção',
    adminIntro: `Denúncias abertas sobre as nossas fotos, do formulário de remoção ou do botão do visualizador do Panoramax, da mais antiga para a mais recente. As de privacidade, desfocagem, conteúdo impróprio e direitos de autor já ocultaram a foto; decide em ${DEADLINE_H} horas. Remover apaga-a do Panoramax e do armazenamento privado. Manter fecha a denúncia, volta a publicar a foto e preenche os links estáticos que ainda estiverem vazios.`,
    empty: 'Não há denúncias abertas.',
    station: 'Posto',
    issueLabel: 'Motivo',
    comments: 'Comentário',
    received: 'Recebida em',
    due: (h: number) => (h >= 0 ? `Faltam ${h} h` : `Atrasada ${-h} h`),
    hidden: 'Oculta',
    visible: 'Ainda visível',
    pending: 'Os links estáticos ainda não foram limpos; o sistema tenta outra vez a cada 10 minutos.',
    notOurs: 'Não corresponde a nenhuma foto do olh\'o\'posto. Vê-a no Panoramax.',
    sequence: 'Denúncia de uma sequência inteira: trata-a diretamente no Panoramax.',
    issues: {
      blur_missing: 'Falta desfocar pessoas ou veículos', blur_excess: 'Desfocagem a mais', inappropriate: 'Conteúdo impróprio',
      privacy: 'Privacidade', picture_low_quality: 'Má qualidade', mislocated: 'Localização errada',
      copyright: 'Direitos de autor', other: 'Outro',
    } as Record<string, string>,
    remove: 'Remover',
    keep: 'Manter',
    view: 'Ver no Panoramax',
    done: { remove: 'Foto removida.', keep: 'Denúncia fechada; a foto fica publicada.' } as Record<string, string>,
    adminErrors: {
      stale: 'Esta denúncia já foi decidida.',
      panoramax: 'O Panoramax não respondeu. Nada mudou; tenta outra vez.',
      list: 'Não foi possível ler as denúncias no Panoramax.',
      closed: 'A ligação ao Panoramax não está configurada.',
      bad: 'Pedido inválido.',
      publish: 'Foto mantida, mas a cópia para o link estático falhou.',
    } as Record<string, string>,
    forbidden: 'Esta página é só para moderadores e administradores.',
    back: 'Voltar à conta',
  },
  en: {
    title: 'Ask for a photo to be removed',
    intro: `If a photo on ${BRAND} shows your face, your car's number plate, your home or anything else of yours you do not want there, ask us here to take it down. You need no account and leave no contact. The photo is hidden as soon as the request arrives, and a moderator decides within ${DEADLINE_H} hours whether to delete it for good.`,
    asked: 'Which photo?',
    askedHint: 'The station or socket code (for example EZC-AMD-00051), or the link to the photo, the station page or Panoramax.',
    reason: 'Why?',
    reasons: {
      face: 'It shows my face or someone else\'s',
      plate: 'It shows a number plate',
      property: 'It shows my home or property',
      copyright: 'It is my photo, published without my permission',
      other: 'Another reason',
    } as Record<Reason, string>,
    details: 'Details (optional)',
    detailsHint: 'What is in the photo and where, so the moderator can find it. Do not write your name or contacts here.',
    send: 'Ask for removal',
    privacy: 'What we keep with this request is in the',
    privacyLink: 'privacy policy',
    closed: 'The form is not available yet. Write to info@ocarroeletrico.com with the photo link and the reason.',
    ok: `Request received. The photo is hidden already; it can take a few minutes to disappear everywhere. A moderator decides within ${DEADLINE_H} hours whether to delete it for good.`,
    already: 'That photo is hidden already, waiting for a moderator\'s decision.',
    errors: {
      turnstile: 'The security check failed or has not finished yet. Wait a few seconds and send again.',
      bad: 'Say which photo it is and why.',
      limit: 'Too many requests in a row. Try again in a minute.',
      notfound: 'We found no published photo with that code or link. Check it, or write to info@ocarroeletrico.com.',
      panoramax: 'We could not record the request just now. Try again shortly, or write to info@ocarroeletrico.com.',
    } as Record<string, string>,
    adminTitle: 'Removal requests',
    adminIntro: `Open reports on our photos, from the removal form or the Panoramax viewer's button, oldest first. Privacy, blurring, inappropriate content and copyright reports have hidden the photo already; decide within ${DEADLINE_H} hours. Remove deletes it from Panoramax and from the private storage. Keep closes the report, publishes the photo again and refills the static links that are still empty.`,
    empty: 'No open reports.',
    station: 'Station',
    issueLabel: 'Reason',
    comments: 'Comment',
    received: 'Received on',
    due: (h: number) => (h >= 0 ? `${h} h left` : `${-h} h overdue`),
    hidden: 'Hidden',
    visible: 'Still visible',
    pending: 'The static links are not cleared yet; the system tries again every 10 minutes.',
    notOurs: 'It matches no olh\'o\'posto photo. See it on Panoramax.',
    sequence: 'A report on a whole sequence: handle it on Panoramax directly.',
    issues: {
      blur_missing: 'People or vehicles not blurred', blur_excess: 'Too much blurring', inappropriate: 'Inappropriate content',
      privacy: 'Privacy', picture_low_quality: 'Low quality', mislocated: 'Wrong location',
      copyright: 'Copyright', other: 'Other',
    } as Record<string, string>,
    remove: 'Remove',
    keep: 'Keep',
    view: 'See on Panoramax',
    done: { remove: 'Photo removed.', keep: 'Report closed; the photo stays published.' } as Record<string, string>,
    adminErrors: {
      stale: 'This report was already decided.',
      panoramax: 'Panoramax did not answer. Nothing changed; try again.',
      list: 'Could not read the reports from Panoramax.',
      closed: 'The Panoramax connection is not configured.',
      bad: 'Invalid request.',
      publish: 'Photo kept, but copying it to the static link failed.',
    } as Record<string, string>,
    forbidden: 'This page is only for moderators and admins.',
    back: 'Back to account',
  },
};

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

// What the person typed, as either a static link target or a Panoramax
// picture id (or one of our photo ids). Links from our pages, pictures.* and
// Panoramax are understood; anything else is tried as a code.
export function parseAsked(raw: string): { target?: string; picture?: string } {
  const s = raw.trim();
  let url: URL | null = null;
  try { if (/^https?:\/\//i.test(s)) url = new URL(s); } catch { url = null; }
  if (url) {
    const path = decodeURIComponent(url.pathname);
    if (url.hostname.startsWith('panoramax.')) {
      const pic = url.searchParams.get('pic') ?? path.match(UUID)?.[0];
      return pic && UUID.test(pic) ? { picture: pic.toLowerCase() } : {};
    }
    if (url.hostname.startsWith('pictures.')) {
      const m = path.match(/^\/([^/]+?)(?:\.thumb|\.full)?\.jpg$/);
      return m && STATION_ID.test(m[1]) ? { target: m[1] } : {};
    }
    const socket = url.hash.match(/^#t-(.+)$/);
    if (socket && STATION_ID.test(decodeURIComponent(socket[1]))) return { target: decodeURIComponent(socket[1]) };
    const st = path.match(/^\/(?:postos|en\/stations|tomadas|en\/sockets)\/([^/]+)$/);
    if (st) {
      const code = path.includes('tomadas') || path.includes('sockets') ? compactCode(st[1]) : st[1];
      return code && STATION_ID.test(code) ? { target: code } : {};
    }
    return {};
  }
  const uuid = s.match(new RegExp(`^${UUID.source}$`, 'i'));
  if (uuid) return { picture: s.toLowerCase() };
  if (STATION_ID.test(s)) return { target: s };
  const compact = compactCode(s);
  return compact ? { target: compact } : {};
}

interface Found { id: string; panoramax_id: string | null; status: string }

// The published photo behind what was typed, or one already hidden by an
// earlier request (hiding removes its selection, so look at the photo itself).
async function resolvePhoto(env: PhotoEnv, asked: { target?: string; picture?: string }): Promise<Found | null> {
  if (asked.picture) {
    return db(env).prepare(
      `SELECT id, panoramax_id, status FROM photos WHERE (panoramax_id = ?1 OR id = ?1) AND status IN ('published', 'hidden') LIMIT 1`,
    ).bind(asked.picture).first<Found>();
  }
  if (!asked.target) return null;
  // Most codes are upper case; Tesla's are lower case hex (see searchHtml).
  const targets = [...new Set([asked.target, asked.target.toUpperCase()])];
  for (const target of targets) {
    const row = await db(env).prepare(
      `SELECT p.id, p.panoramax_id, p.status FROM selections sel JOIN photos p ON p.id = sel.photo_id
        WHERE sel.target = ? AND p.status = 'published' LIMIT 1`,
    ).bind(target).first<Found>();
    if (row) return row;
  }
  for (const target of targets) {
    const row = await db(env).prepare(
      `SELECT id, panoramax_id, status FROM photos
        WHERE status = 'hidden' AND (evse_compact = ?1 OR (evse_compact IS NULL AND station_id = ?1)) LIMIT 1`,
    ).bind(target).first<Found>();
    if (row) return row;
  }
  return null;
}

const panoBase = (env: PublishEnv) => env.PANORAMAX_URL ?? PANORAMAX_URL;
const authed = (env: PublishEnv) => ({ authorization: `Bearer ${env.PANORAMAX_TOKEN}`, 'user-agent': 'OlhaOPosto' });
const json = { 'content-type': 'application/json' };

// Open reports on the service account's pictures (and any it filed). Null
// when Panoramax cannot be read: the caller must not take that as "none".
export async function openReports(env: PublishEnv, fetcher: Fetch): Promise<Report[] | null> {
  if (!env.PANORAMAX_TOKEN) return null;
  const filter = encodeURIComponent(`status IN ('open', 'open_autofix', 'waiting')`);
  const r = await fetcher(`${panoBase(env)}/api/users/me/reports?limit=100&filter=${filter}`, { headers: authed(env) }).catch(() => null);
  if (!r?.ok) return null;
  const body = await r.json().catch(() => null) as { reports?: Report[] } | null;
  return Array.isArray(body?.reports) ? body.reports : null;
}

// Hides our copies of a photo. Safe to repeat. The selection rows are the
// "still to clear" marker: they go only once the R2 deletes and the purge
// worked, and reconcile() retries while any are left.
export async function hideCopies(env: TakedownEnv, photoId: string, fetcher: Fetch): Promise<string[]> {
  const failed: string[] = [];
  const photo = await db(env).prepare(`SELECT panoramax_id FROM photos WHERE id = ?`)
    .bind(photoId).first<{ panoramax_id: string | null }>();
  // D1 first: every read filters on `published`, so pages and the API stop
  // showing it on their next cache miss.
  await db(env).prepare(`UPDATE photos SET status = 'hidden' WHERE id = ? AND status = 'published'`).bind(photoId).run();

  // Panoramax: the picture, as the report trigger does (and keep undoes).
  if (photo?.panoramax_id) {
    const r = env.PANORAMAX_TOKEN
      ? await fetcher(`${panoBase(env)}/api/pictures/${encodeURIComponent(photo.panoramax_id)}`, {
        method: 'PATCH', headers: { ...authed(env), ...json }, body: JSON.stringify({ visibility: 'owner-only' }),
      }).catch(() => null)
      : null;
    if (!r?.ok) failed.push('panoramax');
  }

  const { results } = await db(env).prepare(`SELECT target FROM selections WHERE photo_id = ?`)
    .bind(photoId).all<{ target: string }>();
  const purge: string[] = [];
  try {
    for (const { target } of results) {
      const urls = pictureUrls(target);
      if (env.PICTURES) await (env.PICTURES as Buckets).delete(urls.map((u) => decodeURIComponent(u.slice(u.lastIndexOf('/') + 1))));
      purge.push(...urls);
    }
  } catch {
    failed.push('pictures');
  }
  if (photo?.panoramax_id) {
    // The zone caches Panoramax's public image responses too.
    const pic = `${PANORAMAX_URL}/api/pictures/${encodeURIComponent(photo.panoramax_id)}`;
    purge.push(`${pic}/hd.jpg`, `${pic}/sd.jpg`, `${pic}/thumb.jpg`);
  }
  if (!(await purgeUrls(env, purge, fetcher))) failed.push('purge');
  else if (!failed.includes('pictures') && results.length) {
    await db(env).prepare(`DELETE FROM selections WHERE photo_id = ?`).bind(photoId).run();
  }
  return failed;
}

const hides = (r: Report) =>
  Boolean(r.picture_id) && (r.status === 'open' || r.status === 'open_autofix') && AUTO_HIDE.includes(r.issue);

// Keeps our copies in step with Panoramax: hides every photo with an open
// auto-hide report, and retries hides that left static links behind.
export async function reconcile(env: TakedownEnv, fetcher: Fetch, reports?: Report[] | null): Promise<void> {
  const list = reports === undefined ? await openReports(env, fetcher) : reports;
  const ids = new Set<string>();
  for (const r of list ?? []) {
    if (!hides(r)) continue;
    const row = await db(env).prepare(
      `SELECT id FROM photos WHERE panoramax_id = ? AND status = 'published'`,
    ).bind(r.picture_id!.toLowerCase()).first<{ id: string }>();
    if (row) ids.add(row.id);
  }
  const { results } = await db(env).prepare(
    `SELECT DISTINCT p.id FROM photos p JOIN selections s ON s.photo_id = p.id WHERE p.status IN ('hidden', 'removed')`,
  ).all<{ id: string }>();
  for (const r of results) ids.add(r.id);
  for (const id of ids) await hideCopies(env, id, fetcher).catch(() => {});
}

const redirect = (location: string, status = 302) =>
  new Response(null, { status, headers: { location, 'cache-control': 'no-store' } });
const noStore = (body: string, status: number) =>
  new Response(body, { status, headers: { 'cache-control': 'no-store' } });

// Closed until hiding can work end to end: without the purge a deleted static
// link keeps being served from the edge for up to 30 days, and without the
// Panoramax token our copies cannot be found or hidden.
export const takedownOpen = (env: PublishEnv) =>
  Boolean(env.TURNSTILE_SITEKEY && env.TURNSTILE_SECRET && env.CF_ZONE_ID && env.CF_CACHE_PURGE_TOKEN && env.PANORAMAX_TOKEN);

export function takedownPage(lang: Lang, p: { open: boolean; sitekey?: string; asked?: string; ok?: string; error?: string }): string {
  const t = T[lang];
  const parts: string[] = [`<h1>${t.title}</h1>`, `<p>${t.intro}</p>`];
  if (p.ok) parts.push(`<p class="notice" role="status">${p.ok === '2' ? t.already : t.ok}</p>`);
  const err = p.error ? t.errors[p.error] : undefined;
  if (err) parts.push(`<p class="notice" role="alert">${esc(err)}</p>`);
  if (!p.open || !p.sitekey) {
    parts.push(`<p class="notice">${t.closed}</p>`);
  } else {
    const radios = REASONS.map((r, i) =>
      `<p class="check"><input type="radio" id="r-${r}" name="motivo" value="${r}"${i === 0 ? ' required' : ''}> <label for="r-${r}">${t.reasons[r]}</label></p>`).join('\n  ');
    parts.push(`<form method="post" action="${takedownFormPath('pt')}" class="card takedown">
  <input type="hidden" name="lang" value="${lang}">
  <p><label for="alvo"><strong>${t.asked}</strong></label><br>
  <input id="alvo" name="alvo" required maxlength="${MAX_ASKED}" value="${esc(p.asked ?? '')}" autocomplete="off" autocapitalize="off" spellcheck="false" aria-describedby="alvo-hint"></p>
  <p id="alvo-hint" class="hint">${t.askedHint}</p>
  <fieldset>
  <legend><strong>${t.reason}</strong></legend>
  ${radios}
  </fieldset>
  <p><label for="detalhes"><strong>${t.details}</strong></label><br>
  <textarea id="detalhes" name="detalhes" rows="4" maxlength="${MAX_DETAILS}" aria-describedby="detalhes-hint"></textarea></p>
  <p id="detalhes-hint" class="hint">${t.detailsHint}</p>
  <div class="cf-turnstile" data-sitekey="${esc(p.sitekey)}" data-action="${TAKEDOWN_ACTION}" data-language="${lang === 'pt' ? 'pt-pt' : 'en'}" data-size="flexible"></div>
  <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
  <p><button type="submit" class="button">${t.send}</button></p>
</form>`);
  }
  parts.push(`<p class="hint">${t.privacy} <a href="${privacyPath(lang)}">${t.privacyLink}</a>.</p>`);
  return layout({
    lang,
    title: `${t.title} · ${BRAND}`,
    description: t.title,
    path: takedownFormPath(lang),
    alternates: { pt: takedownFormPath('pt'), en: takedownFormPath('en') },
    body: parts.join('\n'),
  });
}

export function takedownHtml(lang: Lang, request: Request, env: PublishEnv, headers: Record<string, string>): Response {
  const url = new URL(request.url);
  const open = takedownOpen(env);
  return page(lang, takedownPage(lang, {
    open,
    sitekey: open ? env.TURNSTILE_SITEKEY : undefined,
    asked: (url.searchParams.get('alvo') ?? '').slice(0, MAX_ASKED),
    ok: url.searchParams.get('ok') ?? undefined,
    error: url.searchParams.get('erro') ?? undefined,
  }), 200, headers);
}

// POST /takedown (both languages; the form says which page to go back to).
export async function submitTakedown(request: Request, env: TakedownEnv, fetcher: Fetch = fetch): Promise<Response> {
  if (!sameOrigin(request)) return noStore('forbidden', 403);
  let form: FormData;
  try { form = await request.formData(); } catch { return noStore('bad request', 400); }
  const lang: Lang = form.get('lang') === 'en' ? 'en' : 'pt';
  const back = (q: string) => redirect(`${takedownFormPath(lang)}?${q}`, 303);
  if (!takedownOpen(env)) return back('erro=bad');
  if (!(await allowed(env.TAKEDOWN_LIMIT, clientIp(request)))) return back('erro=limit');
  const str = (k: string, max: number) => {
    const v = form.get(k);
    return typeof v === 'string' ? v.trim().slice(0, max) : '';
  };
  const asked = str('alvo', MAX_ASKED);
  const reason = str('motivo', 16) as Reason;
  if (!asked || !REASONS.includes(reason)) return back('erro=bad');
  // The plain-form widget posts its token as cf-turnstile-response.
  if (!(await turnstileOk(env, fetcher, form.get('cf-turnstile-response'), clientIp(request), TAKEDOWN_ACTION))) {
    return back('erro=turnstile');
  }
  const found = await resolvePhoto(env, parseAsked(asked));
  if (!found?.panoramax_id) return back('erro=notfound');
  if (found.status === 'hidden') return back('ok=2');

  // Anonymous on purpose (see the top of this file).
  const details = str('detalhes', MAX_DETAILS);
  const r = await fetcher(`${panoBase(env)}/api/reports`, {
    method: 'POST',
    headers: {
      ...json, 'user-agent': 'OlhaOPosto',
      ...(env.PANORAMAX_REPORT_KEY ? { [REPORT_HEADER]: env.PANORAMAX_REPORT_KEY } : {}),
    },
    body: JSON.stringify({
      issue: ISSUE[reason],
      picture_id: found.panoramax_id,
      reporter_comments: `[${reason}] ${asked}${details ? `\n${details}` : ''}`,
    }),
  }).catch(() => null);
  if (!r?.ok) return back('erro=panoramax');
  // What fails here, reconcile() retries on the next cron run.
  await hideCopies(env, found.id, fetcher).catch(() => {});
  return back('ok=1');
}

// --- Admin panel ---

export interface PanelItem {
  report: Report;
  photo: { id: string; station_id: string; station_name: string | null; evse_compact: string | null; status: string; uncleared: number } | null;
}

const hoursLeft = (openedAt: string, now: Date) =>
  Math.floor((Date.parse(openedAt) + DEADLINE_H * 3_600_000 - now.getTime()) / 3_600_000);

function item(lang: Lang, { report: r, photo }: PanelItem, now: Date): string {
  const t = T[lang];
  const left = hoursLeft(r.ts_opened, now);
  const button = (action: string, label: string, cls: string) =>
    `<form method="post" action="${TAKEDOWN_DECIDE}">` +
    `<input type="hidden" name="denuncia" value="${esc(r.id)}">` +
    `<input type="hidden" name="action" value="${action}">` +
    `<input type="hidden" name="lang" value="${lang}">` +
    `<button type="submit" class="${cls}">${label}</button></form>`;
  const viewer = r.picture_id
    ? `<a href="${PANORAMAX_URL}/viewer?pic=${encodeURIComponent(r.picture_id)}" target="_blank" rel="noopener">${t.view}</a>`
    : '';
  const img = photo ? `${STAGING_PREFIX}${encodeURIComponent(photo.id)}/` : '';
  let state: string;
  if (!r.picture_id) state = `<p class="notice">${t.sequence}</p>`;
  else if (!photo) state = `<p class="notice">${t.notOurs} ${viewer}</p>`;
  else {
    state = `<p><strong>${t.station}:</strong> <a href="${stationPath(lang, photo.station_id)}" target="_blank" rel="noopener">${esc(photo.station_name ?? photo.station_id)}</a> <span class="muted">${esc(photo.station_id)}${photo.evse_compact ? ` · ${esc(photo.evse_compact)}` : ''}</span> · ${photo.status === 'published' ? t.visible : t.hidden} · ${viewer}</p>` +
      (photo.uncleared && photo.status !== 'published' ? `<p class="notice">${t.pending}</p>` : '');
  }
  const actions = photo ? button('remove', t.remove, 'button') + button('keep', t.keep, 'button secondary') : '';
  return `<article class="queue-item">
${photo ? `<a href="${img}main.jpg" target="_blank" rel="noopener"><img src="${img}thumb.jpg" alt="" loading="lazy"></a>` : '<div></div>'}
<div>
<p><strong>${t.issueLabel}:</strong> ${esc(t.issues[r.issue] ?? r.issue)}</p>
${r.reporter_comments ? `<p><strong>${t.comments}:</strong> <span lang="">${esc(r.reporter_comments)}</span></p>` : ''}
${state}
<p><strong>${t.received}:</strong> ${esc(r.ts_opened.slice(0, 16).replace('T', ' '))} UTC · ${left < 0 ? `<strong>${t.due(left)}</strong>` : t.due(left)}</p>
${actions ? `<div class="queue-actions">${actions}</div>` : ''}
</div>
</article>`;
}

export function takedownsPage(lang: Lang, items: PanelItem[] | null, p: { ok?: string; error?: string }, now = new Date()): string {
  const t = T[lang];
  const parts = [`<h1>${t.adminTitle}</h1>`, `<p>${t.adminIntro}</p>`];
  const ok = p.ok ? t.done[p.ok] : undefined;
  if (ok) parts.push(`<p class="notice" role="status">${ok}</p>`);
  const err = p.error ? t.adminErrors[p.error] : undefined;
  if (err) parts.push(`<p class="notice" role="alert">${esc(err)}</p>`);
  if (items === null) parts.push(`<p class="notice" role="alert">${t.adminErrors.list}</p>`);
  else parts.push(items.length ? items.map((i) => item(lang, i, now)).join('\n') : `<p>${t.empty}</p>`);
  parts.push(`<p><a href="${accountPath(lang)}">${t.back}</a></p>`);
  return layout({
    lang,
    title: `${t.adminTitle} · ${BRAND}`,
    description: t.adminTitle,
    noindex: true,
    switchTo: { pt: takedownsPath('pt'), en: takedownsPath('en') },
    body: parts.join('\n'),
  });
}

function forbiddenPage(lang: Lang): string {
  const t = T[lang];
  return layout({
    lang,
    title: `${t.adminTitle} · ${BRAND}`,
    description: t.adminTitle,
    noindex: true,
    body: `<div class="page-msg">\n<h1>${t.adminTitle}</h1>\n<p>${t.forbidden}</p>\n<p><a href="${accountPath(lang)}">${t.back}</a></p>\n</div>`,
  });
}

async function photoFor(env: PhotoEnv, pictureId: string): Promise<PanelItem['photo']> {
  return db(env).prepare(
    `SELECT p.id, p.station_id, s.name AS station_name, p.evse_compact, p.status,
            (SELECT COUNT(*) FROM selections sel WHERE sel.photo_id = p.id) AS uncleared
       FROM photos p LEFT JOIN stations s ON s.id = p.station_id
      WHERE p.panoramax_id = ? AND p.status IN ('published', 'hidden')`,
  ).bind(pictureId.toLowerCase()).first<NonNullable<PanelItem['photo']>>();
}

export async function takedownsHtml(lang: Lang, request: Request, env: TakedownEnv, headers: Record<string, string>, fetcher: Fetch = fetch, now = new Date()): Promise<Response> {
  const user = await currentUser(request, env).catch(() => null);
  if (!user) return redirect(`/auth/osm/login?next=${encodeURIComponent(takedownsPath(lang))}`);
  if (!canModerate(user.role)) return page(lang, forbiddenPage(lang), 403, headers);
  const reports = await openReports(env, fetcher);
  // Bring our copies up to date first, so the page shows what is true now.
  await reconcile(env, fetcher, reports).catch(() => {});
  let items: PanelItem[] | null = null;
  if (reports) {
    items = [];
    const sorted = [...reports].sort((a, b) => a.ts_opened.localeCompare(b.ts_opened));
    for (const report of sorted) {
      items.push({ report, photo: report.picture_id ? await photoFor(env, report.picture_id) : null });
    }
  }
  const url = new URL(request.url);
  return page(lang, takedownsPage(lang, items, {
    ok: url.searchParams.get('ok') ?? undefined,
    error: url.searchParams.get('erro') ?? undefined,
  }, now), 200, headers);
}

// POST /admin/remocao: remove or keep.
export async function decideTakedown(request: Request, env: TakedownEnv, fetcher: Fetch = fetch, now = new Date()): Promise<Response> {
  if (!sameOrigin(request)) return noStore('forbidden', 403);
  let form: FormData;
  try { form = await request.formData(); } catch { return noStore('bad request', 400); }
  const lang: Lang = form.get('lang') === 'en' ? 'en' : 'pt';
  const back = (q: string) => redirect(`${takedownsPath(lang)}?${q}`, 303);
  const user: SessionUser | null = await currentUser(request, env).catch(() => null);
  if (!user) return redirect(`/auth/osm/login?next=${encodeURIComponent(takedownsPath(lang))}`, 303);
  if (!canModerate(user.role)) return noStore('forbidden', 403);
  const id = form.get('denuncia');
  const action = form.get('action');
  if (typeof id !== 'string' || !UUID.test(id) || (action !== 'remove' && action !== 'keep')) return back('erro=bad');
  if (!env.PANORAMAX_TOKEN) return back('erro=closed');

  const base = panoBase(env);
  const got = await fetcher(`${base}/api/reports/${encodeURIComponent(id)}`, { headers: authed(env) }).catch(() => null);
  if (got?.status === 404) return back('erro=stale');   // gone with its picture
  if (!got?.ok) return back('erro=panoramax');
  const report = await got.json().catch(() => null) as Report | null;
  if (!report) return back('erro=panoramax');
  if (!['open', 'open_autofix', 'waiting'].includes(report.status)) return back('erro=stale');
  if (!report.picture_id) return back('erro=bad');
  const photo = await db(env).prepare(
    `SELECT id, panoramax_set, status FROM photos WHERE panoramax_id = ? AND status IN ('published', 'hidden')`,
  ).bind(report.picture_id.toLowerCase()).first<{ id: string; panoramax_set: string | null; status: string }>();
  if (!photo) return back('erro=stale');

  if (action === 'remove') {
    // Our copies first, while the photo can still be found; then the source.
    await hideCopies(env, photo.id, fetcher).catch(() => {});
    if (photo.panoramax_set) {
      // 404: already gone, which is what we want.
      const r = await fetcher(`${base}/api/upload_sets/${encodeURIComponent(photo.panoramax_set)}`, { method: 'DELETE', headers: authed(env) }).catch(() => null);
      if (!r || (!r.ok && r.status !== 404)) return back('erro=panoramax');
    }
    await db(env).prepare(`UPDATE photos SET status = 'removed' WHERE id = ? AND status IN ('published', 'hidden')`).bind(photo.id).run();
    if (env.STAGING) await env.STAGING.delete([`${photo.id}/main.jpg`, `${photo.id}/thumb.jpg`]).catch(() => {});
    return back('ok=remove');
  }

  // keep: close every open report on this picture first, or the next
  // reconcile() would hide it again; then make it public.
  const open = (await openReports(env, fetcher)) ?? [report];
  for (const r of open.filter((x) => x.picture_id?.toLowerCase() === report.picture_id!.toLowerCase())) {
    const res = await fetcher(`${base}/api/reports/${encodeURIComponent(r.id)}`, {
      method: 'PATCH', headers: { ...authed(env), ...json },
      body: JSON.stringify({ status: 'closed_ignored', resolver_comments: `olh'o'posto: kept by a moderator` }),
    }).catch(() => null);
    if (!res?.ok) return back('erro=panoramax');
  }
  const vis = await fetcher(`${base}/api/pictures/${encodeURIComponent(report.picture_id)}`, {
    method: 'PATCH', headers: { ...authed(env), ...json }, body: JSON.stringify({ visibility: 'anyone' }),
  }).catch(() => null);
  if (!vis?.ok) return back('erro=panoramax');
  const res = await db(env).prepare(`UPDATE photos SET status = 'published' WHERE id = ? AND status = 'hidden'`).bind(photo.id).run();
  if (res.meta.changes === 1) {
    // A hide that half-failed leaves selection rows whose files may be gone;
    // drop them so publishMain writes the links again.
    await db(env).prepare(`DELETE FROM selections WHERE photo_id = ?`).bind(photo.id).run();
    try {
      // Only targets still without a main photo are filled (INSERT OR IGNORE).
      await publishMain(env, photo.id, user.id, fetcher, now);
    } catch {
      return back('ok=keep&erro=publish');
    }
  }
  return back('ok=keep');
}
