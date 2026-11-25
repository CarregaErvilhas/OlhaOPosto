// Removal requests (Docs/plan.md, *RGPD e moderação*).
//
// Public side: GET /takedown and /en/takedown show a form, no sign-in, with
// Turnstile; POST /takedown records the request and hides the photo at once:
//   1. D1: the photo turns `hidden` (compare-and-set on `published`). Every
//      read filters on `published`, so the station page, the API and
//      /main-photos stop showing it on their next miss (5 min at most).
//   2. pictures.*: each static link the photo served is deleted from R2, its
//      selection row goes, and the three URLs are purged from the edge
//      (the Cache Rule keeps a 200 for 30 days).
//   3. Panoramax: the upload set goes back to owner-only, and the picture's
//      image URLs are purged (the zone caches Panoramax's public responses).
// A step that fails is recorded on the request (`hide_failed`) and shown to
// moderators with a retry; the person who asked is never told to try again.
//
// The answer is the same whether or not the code or link matched a published
// photo, so the form cannot be used to probe what exists.
//
// Moderator side: /admin/remocoes and /en/admin/takedowns list the open
// requests, oldest first, with the 72 h deadline. Remove deletes the
// Panoramax upload set and the staging copies (the photo turns `removed`);
// restore makes the set public again, the photo `published`, and refills
// the static links that are still empty. One decision closes every open
// request for that photo, and clears the contacts.

import { currentUser, page, sameOrigin, type SessionUser } from './auth.ts';
import { BRAND, PANORAMAX_URL, accountPath, esc, layout, privacyPath, stationPath, type Lang } from './pages.ts';
import { turnstileOk, type PhotoEnv } from './photos.ts';
import { pictureUrls, publishMain, purgeUrls, type PublishEnv } from './publish.ts';
import { canModerate, STAGING_PREFIX } from './moderation.ts';
import { allowed, clientIp, type RateLimiter } from './ratelimit.ts';
import { compactCode, STATION_ID } from './types.ts';

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface TakedownEnv extends PublishEnv {
  TAKEDOWN_LIMIT?: RateLimiter;   // per IP, the public form's POST
}

export const TAKEDOWN_ACTION = 'takedown';   // Turnstile action, checked on siteverify
export const takedownFormPath = (lang: Lang) => (lang === 'pt' ? '/takedown' : '/en/takedown');
export const takedownsPath = (lang: Lang) => (lang === 'pt' ? '/admin/remocoes' : '/en/admin/takedowns');
export const TAKEDOWN_DECIDE = '/admin/remocao';
export const DEADLINE_H = 72;
// Decided requests are kept as the record of the decision, then deleted
// (the privacy policy says so). No cron: the delete runs when a request
// arrives or the panel opens, which is often enough for a 2-year limit.
export const KEEP_DAYS = 730;
const REASONS = ['face', 'plate', 'property', 'other'] as const;
type Reason = typeof REASONS[number];
const MAX_ASKED = 300;
const MAX_DETAILS = 2000;
const MAX_CONTACT = 200;
const LIST_LIMIT = 50;

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
    intro: `Se uma foto do ${BRAND} mostra a tua cara, a matrícula do teu carro, a tua casa ou outra coisa tua que não queres ali, pede aqui que a retiremos. Não precisas de conta. A foto fica oculta logo que o pedido chega e um moderador decide em ${DEADLINE_H} horas se a apaga de vez.`,
    asked: 'Que foto?',
    askedHint: 'O código do posto ou da tomada (por exemplo EZC-AMD-00051), ou o link da foto, da página do posto ou do Panoramax.',
    reason: 'Porquê?',
    reasons: { face: 'Mostra a minha cara ou a de outra pessoa', plate: 'Mostra uma matrícula', property: 'Mostra a minha casa ou propriedade', other: 'Outro motivo' } as Record<Reason, string>,
    details: 'Detalhes (opcional)',
    detailsHint: 'O que está na foto e onde, para o moderador encontrar.',
    contact: 'Email para te respondermos (opcional)',
    contactHint: 'Só para te dizermos o que decidimos. Apagamo-lo quando o pedido for decidido.',
    send: 'Pedir remoção',
    privacy: 'O que guardamos com este pedido está na',
    privacyLink: 'política de privacidade',
    closed: 'O formulário ainda não está disponível. Escreve para info@ocarroeletrico.com com o link da foto e o motivo.',
    ok: `Pedido recebido. Se o código ou o link corresponde a uma foto publicada, ela já está oculta; pode levar alguns minutos a desaparecer de todos os sítios. Um moderador decide em ${DEADLINE_H} horas.`,
    errors: {
      turnstile: 'A verificação de segurança falhou ou ainda não terminou. Espera uns segundos e volta a enviar.',
      bad: 'Falta dizer que foto é e porquê.',
      limit: 'Demasiados pedidos seguidos. Tenta outra vez daqui a um minuto.',
    } as Record<string, string>,
    // Admin panel
    adminTitle: 'Pedidos de remoção',
    adminIntro: `Pedidos abertos, do mais antigo para o mais recente. A foto já está oculta; decide em ${DEADLINE_H} horas. Remover apaga-a do Panoramax e do armazenamento privado. Repor volta a publicá-la e preenche os links estáticos que ainda estiverem vazios.`,
    empty: 'Não há pedidos abertos.',
    askedFor: 'Pedido para',
    photo: 'Foto',
    noPhoto: 'Não corresponde a nenhuma foto publicada. Lê o pedido e fecha-o.',
    station: 'Posto',
    reasonLabel: 'Motivo',
    detailsLabel: 'Detalhes',
    contactLabel: 'Contacto',
    received: 'Recebido em',
    due: (h: number) => (h >= 0 ? `Faltam ${h} h` : `Atrasado ${-h} h`),
    failed: 'Falhou ao ocultar:',
    steps: { pictures: 'links estáticos', panoramax: 'Panoramax', purge: 'limpeza da cache' } as Record<string, string>,
    retry: 'Tentar ocultar outra vez',
    remove: 'Remover',
    restore: 'Repor',
    close: 'Fechar',
    recent: 'Decididos recentemente',
    outcomes: { removed: 'removida', restored: 'reposta', closed: 'fechado' } as Record<string, string>,
    done: { remove: 'Foto removida.', restore: 'Foto reposta.', close: 'Pedido fechado.', retry: 'Ocultação repetida.' } as Record<string, string>,
    adminErrors: {
      stale: 'Este pedido já foi decidido.',
      panoramax: 'O Panoramax não respondeu. Nada mudou; tenta outra vez.',
      closed: 'A ligação ao Panoramax não está configurada.',
      bad: 'Pedido inválido.',
      partial: 'Ainda falham passos; vê a lista do pedido.',
      publish: 'Foto reposta, mas a cópia para o link estático falhou.',
    } as Record<string, string>,
    forbidden: 'Esta página é só para moderadores e administradores.',
    back: 'Voltar à conta',
  },
  en: {
    title: 'Ask for a photo to be removed',
    intro: `If a photo on ${BRAND} shows your face, your car's number plate, your home or anything else of yours you do not want there, ask us here to take it down. You do not need an account. The photo is hidden as soon as the request arrives, and a moderator decides within ${DEADLINE_H} hours whether to delete it for good.`,
    asked: 'Which photo?',
    askedHint: 'The station or socket code (for example EZC-AMD-00051), or the link to the photo, the station page or Panoramax.',
    reason: 'Why?',
    reasons: { face: 'It shows my face or someone else\'s', plate: 'It shows a number plate', property: 'It shows my home or property', other: 'Another reason' } as Record<Reason, string>,
    details: 'Details (optional)',
    detailsHint: 'What is in the photo and where, so the moderator can find it.',
    contact: 'Email for our reply (optional)',
    contactHint: 'Only to tell you what we decided. We delete it once the request is decided.',
    send: 'Ask for removal',
    privacy: 'What we keep with this request is in the',
    privacyLink: 'privacy policy',
    closed: 'The form is not available yet. Write to info@ocarroeletrico.com with the photo link and the reason.',
    ok: `Request received. If the code or link matches a published photo, it is hidden already; it can take a few minutes to disappear everywhere. A moderator decides within ${DEADLINE_H} hours.`,
    errors: {
      turnstile: 'The security check failed or has not finished yet. Wait a few seconds and send again.',
      bad: 'Say which photo it is and why.',
      limit: 'Too many requests in a row. Try again in a minute.',
    } as Record<string, string>,
    adminTitle: 'Removal requests',
    adminIntro: `Open requests, oldest first. The photo is hidden already; decide within ${DEADLINE_H} hours. Remove deletes it from Panoramax and from the private storage. Restore publishes it again and refills the static links that are still empty.`,
    empty: 'No open requests.',
    askedFor: 'Asked for',
    photo: 'Photo',
    noPhoto: 'It matches no published photo. Read the request and close it.',
    station: 'Station',
    reasonLabel: 'Reason',
    detailsLabel: 'Details',
    contactLabel: 'Contact',
    received: 'Received on',
    due: (h: number) => (h >= 0 ? `${h} h left` : `${-h} h overdue`),
    failed: 'Failed to hide:',
    steps: { pictures: 'static links', panoramax: 'Panoramax', purge: 'cache purge' } as Record<string, string>,
    retry: 'Try hiding again',
    remove: 'Remove',
    restore: 'Restore',
    close: 'Close',
    recent: 'Recently decided',
    outcomes: { removed: 'removed', restored: 'restored', closed: 'closed' } as Record<string, string>,
    done: { remove: 'Photo removed.', restore: 'Photo restored.', close: 'Request closed.', retry: 'Hiding repeated.' } as Record<string, string>,
    adminErrors: {
      stale: 'This request was already decided.',
      panoramax: 'Panoramax did not answer. Nothing changed; try again.',
      closed: 'The Panoramax connection is not configured.',
      bad: 'Invalid request.',
      partial: 'Some steps still fail; see the request.',
      publish: 'Photo restored, but copying it to the static link failed.',
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

// The published (or already hidden) photo behind what was typed.
async function resolvePhoto(env: PhotoEnv, asked: { target?: string; picture?: string }): Promise<string | null> {
  if (asked.picture) {
    const row = await db(env).prepare(
      `SELECT id FROM photos WHERE (panoramax_id = ?1 OR id = ?1) AND status IN ('published', 'hidden') LIMIT 1`,
    ).bind(asked.picture).first<{ id: string }>();
    return row?.id ?? null;
  }
  if (!asked.target) return null;
  // Most codes are upper case; Tesla's are lower case hex (see searchHtml).
  for (const target of new Set([asked.target, asked.target.toUpperCase()])) {
    const row = await db(env).prepare(
      `SELECT p.id FROM selections sel JOIN photos p ON p.id = sel.photo_id
        WHERE sel.target = ? AND p.status = 'published' LIMIT 1`,
    ).bind(target).first<{ id: string }>();
    if (row) return row.id;
  }
  // A second request by code: hiding deleted the selection, but the first
  // request remembers which targets it cleared.
  const earlier = await db(env).prepare(
    `SELECT k.photo_id AS id FROM takedowns k, json_each(k.cleared) c
      WHERE k.status = 'open' AND k.photo_id IS NOT NULL AND c.value IN (?1, upper(?1)) LIMIT 1`,
  ).bind(asked.target).first<{ id: string }>();
  return earlier?.id ?? null;
}

// Steps 2 and 3 of hiding. Safe to repeat: R2 deletes, the Panoramax PATCH
// and the purges are idempotent. Returns the targets cleared and what failed.
export async function hideEverywhere(
  env: TakedownEnv, photoId: string, fetcher: Fetch,
): Promise<{ cleared: string[]; failed: string[] }> {
  const failed: string[] = [];
  const cleared: string[] = [];
  const photo = await db(env).prepare(
    `SELECT panoramax_set, panoramax_id FROM photos WHERE id = ?`,
  ).bind(photoId).first<{ panoramax_set: string | null; panoramax_id: string | null }>();

  // pictures.*: every static link this photo serves.
  const purge: string[] = [];
  try {
    const { results } = await db(env).prepare(
      `SELECT target FROM selections WHERE photo_id = ?`,
    ).bind(photoId).all<{ target: string }>();
    for (const { target } of results) {
      const keys = pictureUrls(target).map((u) => u.slice(u.lastIndexOf('/') + 1)).map(decodeURIComponent);
      if (env.PICTURES) await (env.PICTURES as Buckets).delete(keys);
      await db(env).prepare(`DELETE FROM selections WHERE target = ? AND photo_id = ?`).bind(target, photoId).run();
      cleared.push(target);
      purge.push(...pictureUrls(target));
    }
  } catch {
    failed.push('pictures');
  }

  // Panoramax: back to owner-only. Only the set's visibility counts (the
  // stricter of set and picture wins, src/moderation.ts).
  if (photo?.panoramax_set && env.PANORAMAX_TOKEN) {
    const base = env.PANORAMAX_URL ?? PANORAMAX_URL;
    const r = await fetcher(`${base}/api/upload_sets/${encodeURIComponent(photo.panoramax_set)}`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${env.PANORAMAX_TOKEN}`, 'user-agent': 'OlhaOPosto', 'content-type': 'application/json' },
      body: JSON.stringify({ visibility: 'owner-only' }),
    }).catch(() => null);
    if (!r?.ok) failed.push('panoramax');
  } else if (photo?.panoramax_set) {
    failed.push('panoramax');
  }
  if (photo?.panoramax_id) {
    const pic = `${PANORAMAX_URL}/api/pictures/${encodeURIComponent(photo.panoramax_id)}`;
    purge.push(`${pic}/hd.jpg`, `${pic}/sd.jpg`, `${pic}/thumb.jpg`);
  }
  if (purge.length && !(await purgeUrls(env, purge, fetcher))) failed.push('purge');
  return { cleared, failed };
}

const redirect = (location: string, status = 302) =>
  new Response(null, { status, headers: { location, 'cache-control': 'no-store' } });
const noStore = (body: string, status: number) =>
  new Response(body, { status, headers: { 'cache-control': 'no-store' } });

// Closed until the purge works too: without it a deleted static link keeps
// being served from the edge for up to 30 days, and the form would promise
// something it cannot do.
export const takedownOpen = (env: PublishEnv) =>
  Boolean(env.TURNSTILE_SITEKEY && env.TURNSTILE_SECRET && env.CF_ZONE_ID && env.CF_CACHE_PURGE_TOKEN);

export function takedownPage(lang: Lang, p: { open: boolean; sitekey?: string; asked?: string; ok?: boolean; error?: string }): string {
  const t = T[lang];
  const parts: string[] = [`<h1>${t.title}</h1>`, `<p>${t.intro}</p>`];
  if (p.ok) parts.push(`<p class="notice" role="status">${t.ok}</p>`);
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
  <p><label for="contacto"><strong>${t.contact}</strong></label><br>
  <input id="contacto" name="contacto" type="email" maxlength="${MAX_CONTACT}" autocomplete="email" aria-describedby="contacto-hint"></p>
  <p id="contacto-hint" class="hint">${t.contactHint}</p>
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
    ok: url.searchParams.get('ok') === '1',
    error: url.searchParams.get('erro') ?? undefined,
  }), 200, headers);
}

// POST /takedown (both languages; the form says which page to go back to).
export async function submitTakedown(request: Request, env: TakedownEnv, fetcher: Fetch = fetch, now = new Date()): Promise<Response> {
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
  const askedRaw = str('alvo', MAX_ASKED);
  const reason = str('motivo', 16) as Reason;
  if (!askedRaw || !REASONS.includes(reason)) return back('erro=bad');
  // The plain-form widget posts its token as cf-turnstile-response.
  if (!(await turnstileOk(env, fetcher, form.get('cf-turnstile-response'), clientIp(request), TAKEDOWN_ACTION))) {
    return back('erro=turnstile');
  }
  const details = str('detalhes', MAX_DETAILS) || null;
  const contactRaw = str('contacto', MAX_CONTACT);
  const contact = /^[^\s@]+@[^\s@]+$/.test(contactRaw) ? contactRaw : null;

  await forgetOld(env, now);
  const photoId = await resolvePhoto(env, parseAsked(askedRaw));
  const id = crypto.randomUUID();
  await db(env).prepare(
    `INSERT INTO takedowns (id, asked, photo_id, reason, details, contact, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'open', ?)`,
  ).bind(id, askedRaw, photoId, reason, details, contact, now.toISOString()).run();

  if (photoId) {
    // Step 1. If it was hidden already (a second request), the rest still
    // runs: it is idempotent and may fix a step that failed before.
    await db(env).prepare(`UPDATE photos SET status = 'hidden' WHERE id = ? AND status = 'published'`).bind(photoId).run();
    const { cleared, failed } = await hideEverywhere(env, photoId, fetcher);
    await db(env).prepare(`UPDATE takedowns SET cleared = ?, hide_failed = ? WHERE id = ?`)
      .bind(JSON.stringify(cleared), failed.length ? JSON.stringify(failed) : null, id).run();
  }
  return back('ok=1');
}

export async function forgetOld(env: PhotoEnv, now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - KEEP_DAYS * 86_400_000).toISOString();
  await db(env).prepare(`DELETE FROM takedowns WHERE status <> 'open' AND decided_at < ?`).bind(cutoff).run().catch(() => {});
}

// --- Admin panel ---

export interface TakedownRow {
  id: string;
  asked: string;
  photo_id: string | null;
  reason: Reason;
  details: string | null;
  contact: string | null;
  status: string;
  hide_failed: string | null;
  created_at: string;
  decided_at: string | null;
  station_id: string | null;
  station_name: string | null;
  evse_compact: string | null;
  photo_status: string | null;
}

const hoursLeft = (createdAt: string, now: Date) =>
  Math.floor((Date.parse(createdAt) + DEADLINE_H * 3_600_000 - now.getTime()) / 3_600_000);

const parseList = (raw: string | null): string[] => {
  try { return raw ? (JSON.parse(raw) as string[]) : []; } catch { return []; }
};

function item(lang: Lang, r: TakedownRow, now: Date): string {
  const t = T[lang];
  const left = hoursLeft(r.created_at, now);
  const button = (action: string, label: string, cls: string) =>
    `<form method="post" action="${TAKEDOWN_DECIDE}">` +
    `<input type="hidden" name="pedido" value="${esc(r.id)}">` +
    `<input type="hidden" name="action" value="${action}">` +
    `<input type="hidden" name="lang" value="${lang}">` +
    `<button type="submit" class="${cls}">${label}</button></form>`;
  const failed = parseList(r.hide_failed);
  const img = r.photo_id ? `${STAGING_PREFIX}${encodeURIComponent(r.photo_id)}/` : '';
  const actions = r.photo_id
    ? button('remove', t.remove, 'button') + button('restore', t.restore, 'button secondary') +
      (failed.length ? button('retry', t.retry, 'button secondary') : '')
    : button('close', t.close, 'button secondary');
  return `<article class="queue-item">
${r.photo_id ? `<a href="${img}main.jpg" target="_blank" rel="noopener"><img src="${img}thumb.jpg" alt="" loading="lazy"></a>` : '<div></div>'}
<div>
<p><strong>${t.askedFor}:</strong> <code>${esc(r.asked)}</code></p>
${r.station_id
    ? `<p><strong>${t.station}:</strong> <a href="${stationPath(lang, r.station_id)}" target="_blank" rel="noopener">${esc(r.station_name ?? r.station_id)}</a> <span class="muted">${esc(r.station_id)}${r.evse_compact ? ` · ${esc(r.evse_compact)}` : ''}</span></p>`
    : `<p class="notice">${t.noPhoto}</p>`}
<p><strong>${t.reasonLabel}:</strong> ${esc(t.reasons[r.reason] ?? r.reason)}</p>
${r.details ? `<p><strong>${t.detailsLabel}:</strong> <span lang="">${esc(r.details)}</span></p>` : ''}
${r.contact ? `<p><strong>${t.contactLabel}:</strong> <a href="mailto:${esc(r.contact)}">${esc(r.contact)}</a></p>` : ''}
<p><strong>${t.received}:</strong> ${esc(r.created_at.slice(0, 16).replace('T', ' '))} UTC · ${left < 0 ? `<strong>${t.due(left)}</strong>` : t.due(left)}</p>
${failed.length ? `<p class="notice">${t.failed} ${failed.map((f) => esc(t.steps[f] ?? f)).join(', ')}</p>` : ''}
<div class="queue-actions">${actions}</div>
</div>
</article>`;
}

export function takedownsPage(lang: Lang, open: TakedownRow[], recent: TakedownRow[], p: { ok?: string; error?: string }, now = new Date()): string {
  const t = T[lang];
  const parts = [`<h1>${t.adminTitle}</h1>`, `<p>${t.adminIntro}</p>`];
  const ok = p.ok ? t.done[p.ok] : undefined;
  if (ok) parts.push(`<p class="notice" role="status">${ok}</p>`);
  const err = p.error ? t.adminErrors[p.error] : undefined;
  if (err) parts.push(`<p class="notice" role="alert">${esc(err)}</p>`);
  parts.push(open.length ? open.map((r) => item(lang, r, now)).join('\n') : `<p>${t.empty}</p>`);
  if (recent.length) {
    parts.push(`<h2>${t.recent}</h2>`, '<ul class="plain-list">', ...recent.map((r) =>
      `<li><code>${esc(r.asked)}</code> · ${esc(t.reasons[r.reason] ?? r.reason)} · ${esc(t.outcomes[r.status] ?? r.status)} · ${esc((r.decided_at ?? '').slice(0, 16).replace('T', ' '))}</li>`), '</ul>');
  }
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

const ROW_SQL = `SELECT k.id, k.asked, k.photo_id, k.reason, k.details, k.contact, k.status, k.hide_failed,
         k.created_at, k.decided_at, p.station_id, s.name AS station_name, p.evse_compact, p.status AS photo_status
    FROM takedowns k
    LEFT JOIN photos p ON p.id = k.photo_id
    LEFT JOIN stations s ON s.id = p.station_id`;

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

export async function takedownsHtml(lang: Lang, request: Request, env: PhotoEnv, headers: Record<string, string>): Promise<Response> {
  const user = await currentUser(request, env).catch(() => null);
  if (!user) return redirect(`/auth/osm/login?next=${encodeURIComponent(takedownsPath(lang))}`);
  if (!canModerate(user.role)) return page(lang, forbiddenPage(lang), 403, headers);
  await forgetOld(env, new Date());
  const open = await db(env).prepare(`${ROW_SQL} WHERE k.status = 'open' ORDER BY k.created_at LIMIT ${LIST_LIMIT}`).all<TakedownRow>();
  const recent = await db(env).prepare(`${ROW_SQL} WHERE k.status <> 'open' ORDER BY k.decided_at DESC LIMIT 20`).all<TakedownRow>();
  const url = new URL(request.url);
  return page(lang, takedownsPage(lang, open.results ?? [], recent.results ?? [], {
    ok: url.searchParams.get('ok') ?? undefined,
    error: url.searchParams.get('erro') ?? undefined,
  }), 200, headers);
}

// POST /admin/remocao: remove, restore, close (no photo) or retry hiding.
export async function decideTakedown(request: Request, env: TakedownEnv, fetcher: Fetch = fetch, now = new Date()): Promise<Response> {
  if (!sameOrigin(request)) return noStore('forbidden', 403);
  let form: FormData;
  try { form = await request.formData(); } catch { return noStore('bad request', 400); }
  const lang: Lang = form.get('lang') === 'en' ? 'en' : 'pt';
  const back = (q: string) => redirect(`${takedownsPath(lang)}?${q}`, 303);
  const user: SessionUser | null = await currentUser(request, env).catch(() => null);
  if (!user) return redirect(`/auth/osm/login?next=${encodeURIComponent(takedownsPath(lang))}`, 303);
  if (!canModerate(user.role)) return noStore('forbidden', 403);
  const id = form.get('pedido');
  const action = form.get('action');
  if (typeof id !== 'string' || !['remove', 'restore', 'close', 'retry'].includes(action as string)) return back('erro=bad');

  const k = await db(env).prepare(
    `SELECT k.photo_id, p.panoramax_set FROM takedowns k LEFT JOIN photos p ON p.id = k.photo_id
      WHERE k.id = ? AND k.status = 'open'`,
  ).bind(id).first<{ photo_id: string | null; panoramax_set: string | null }>();
  if (!k) return back('erro=stale');
  const nowIso = now.toISOString();

  // Every open request for this photo (or just this one) ends with the same outcome.
  const finish = async (outcome: 'removed' | 'restored' | 'closed') => {
    const sql = k.photo_id
      ? `UPDATE takedowns SET status = ?, decided_by = ?, decided_at = ?, contact = NULL WHERE photo_id = ? AND status = 'open'`
      : `UPDATE takedowns SET status = ?, decided_by = ?, decided_at = ?, contact = NULL WHERE id = ? AND status = 'open'`;
    return db(env).prepare(sql).bind(outcome, user.id, nowIso, k.photo_id ?? id).run();
  };

  if (action === 'close' || !k.photo_id) {
    if (action !== 'close') return back('erro=bad');
    await finish('closed');
    return back('ok=close');
  }
  const photoId = k.photo_id;

  if (action === 'retry') {
    const { failed } = await hideEverywhere(env, photoId, fetcher);
    await db(env).prepare(`UPDATE takedowns SET hide_failed = ? WHERE photo_id = ? AND status = 'open'`)
      .bind(failed.length ? JSON.stringify(failed) : null, photoId).run();
    return back(failed.length ? 'erro=partial' : 'ok=retry');
  }

  if (!env.PANORAMAX_TOKEN) return back('erro=closed');
  const base = env.PANORAMAX_URL ?? PANORAMAX_URL;
  const headers = { authorization: `Bearer ${env.PANORAMAX_TOKEN}`, 'user-agent': 'OlhaOPosto' };
  const set = k.panoramax_set ? `${base}/api/upload_sets/${encodeURIComponent(k.panoramax_set)}` : null;

  if (action === 'remove') {
    if (set) {
      // 404: already gone, which is what we want.
      const r = await fetcher(set, { method: 'DELETE', headers }).catch(() => null);
      if (!r || (!r.ok && r.status !== 404)) return back('erro=panoramax');
    }
    await db(env).prepare(`UPDATE photos SET status = 'removed' WHERE id = ? AND status = 'hidden'`).bind(photoId).run();
    await finish('removed');
    if (env.STAGING) await env.STAGING.delete([`${photoId}/main.jpg`, `${photoId}/thumb.jpg`]).catch(() => {});
    return back('ok=remove');
  }

  // restore
  if (set) {
    const r = await fetcher(set, {
      method: 'PATCH',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ visibility: 'anyone' }),
    }).catch(() => null);
    if (!r?.ok) return back('erro=panoramax');
  }
  await db(env).prepare(`UPDATE photos SET status = 'published' WHERE id = ? AND status = 'hidden'`).bind(photoId).run();
  await finish('restored');
  try {
    // Only targets still without a main photo are filled (INSERT OR IGNORE).
    await publishMain(env, photoId, user.id, fetcher, now);
  } catch {
    return back('ok=restore&erro=publish');
  }
  return back('ok=restore');
}
