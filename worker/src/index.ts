// olh'o'posto Worker (olhaoposto.ocarroeletrico.com): the station pages, the
// read-only API and sign-in with OpenStreetMap (auth.ts). Fonts, CSS and icons in public/ are Workers static assets,
// served before this code runs. Static photo links are served by the R2
// bucket on pictures.ocarroeletrico.com, never by this Worker (Docs/arquitetura.md).
import { ROLE_ACTION, setRole, usersHtml } from './admin.ts';
import { DECIDE_ACTION, STAGING_PREFIX, decide, queueHtml, stagingImage } from './moderation.ts';
import { ALIAS_ACTION, aliasPath, aliasesHtml, getStationAlias, rekey } from './aliases.ts';
import { ACCOUNT_ACTION, accountAction, accountHtml } from './account.ts';
import { callback, login, logout } from './auth.ts';
import { apiCaller, canChooseMain } from './tokens.ts';
import { submitPhoto, uploadHtml, type PhotoEnv } from './photos.ts';
import { chooseMain } from './publish.ts';
import { syncCredits } from './credit.ts';
import { RETRY_AFTER, allowed, clientIp, type RateEnv } from './ratelimit.ts';
import { findEvse, getStation, listMainPhotos, listStations, nearStations, searchStations, type Env } from './data.ts';
import { ranking } from './points.ts';
import {
  PICTURES, SITE, evseChoicePage, homePage, messages, notFoundPage, rankingPage, rankingPath, searchPage, socketAnchor, stationPage, stationPath, type Lang,
} from './pages.ts';
import { privacyPage } from './privacy.ts';
import { termsPage } from './terms.ts';
import { proposeStation } from './proposals.ts';
import { groupPage } from './grupo.ts';
import { photoLink } from './photolinks.ts';
import { creditPage, getCredit } from './photopage.ts';
import { TAKEDOWN_DECIDE, decideTakedown, reconcile, submitTakedown, takedownHtml, takedownsHtml, type TakedownEnv } from './takedown.ts';
import { sitemapXml } from './sitemap.ts';
import {
  compactCode, ftsQuery, MAX_QUERY, NEAR_MAX_M, parseNear, STATION_ID, type EvseMatch, type SearchRow,
} from './types.ts';

// The API is for apps and agents, not for search results.
const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'x-robots-tag': 'noindex',
};

// The pages load nothing from third parties: fonts, CSS and script are ours,
// and images can only come from the static photo links.
const HTML_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'content-security-policy':
    "default-src 'none'; style-src 'self'; font-src 'self'; script-src 'self'; " +
    "img-src 'self' https://pictures.ocarroeletrico.com; manifest-src 'self'; " +
    "base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'cross-origin-opener-policy': 'same-origin',
  'strict-transport-security': 'max-age=31536000',
};

// The upload page also asks our API for stations (connect-src; also the
// HEIC decoder and face model files, fetched from /vendor/ and /models/),
// shows the prepared photo from a blob: URL, loads Turnstile (its script and
// its iframe), compiles WebAssembly (libheif for HEIC, MediaPipe for faces:
// 'wasm-unsafe-eval' allows compiling wasm, not eval of JavaScript) and,
// only when the person opens the map, shows OpenStreetMap tiles. Only that
// page gets these.
const UPLOAD_HEADERS = {
  ...HTML_HEADERS,
  'content-security-policy': HTML_HEADERS['content-security-policy']
    .replace("img-src 'self'", "img-src 'self' blob: https://tile.openstreetmap.org")
    .replace("default-src 'none';", "default-src 'none'; connect-src 'self'; frame-src https://challenges.cloudflare.com;")
    .replace("script-src 'self'", "script-src 'self' 'wasm-unsafe-eval' https://challenges.cloudflare.com"),
};

// The removal form loads Turnstile, like the upload page, and nothing else.
const TURNSTILE_HEADERS = {
  ...HTML_HEADERS,
  'content-security-policy': HTML_HEADERS['content-security-policy']
    .replace("default-src 'none';", "default-src 'none'; connect-src 'self'; frame-src https://challenges.cloudflare.com;")
    .replace("script-src 'self'", "script-src 'self' https://challenges.cloudflare.com"),
};

// The credit page may show a published photo that is not the main one, which
// only Panoramax serves (the sizes in pictures.* are the main photos').
const CREDIT_HEADERS = {
  ...HTML_HEADERS,
  'content-security-policy': HTML_HEADERS['content-security-policy']
    .replace("img-src 'self'", "img-src 'self' https://panoramax.ocarroeletrico.com"),
};

// 429 from the request limits (src/ratelimit.ts): JSON for the API, a short
// bilingual line for pages (the page may be the OSM callback, with no language).
function tooMany(pathname: string): Response {
  const headers = { 'cache-control': 'no-store', 'retry-after': RETRY_AFTER };
  if (pathname.startsWith('/api/')) {
    return new Response(JSON.stringify({ error: 'rate_limited' }), {
      status: 429, headers: { ...headers, 'content-type': 'application/json; charset=utf-8' },
    });
  }
  return new Response('Demasiados pedidos: tenta outra vez daqui a um minuto.\nToo many requests: try again in a minute.\n', {
    status: 429, headers: { ...headers, 'content-type': 'text/plain; charset=utf-8' },
  });
}

function json(body: unknown, status = 200, cache = 'public, max-age=300'): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, 'cache-control': cache } });
}

function html(lang: Lang, body: string, status = 200, cache = 'public, max-age=300'): Response {
  return new Response(body, {
    status,
    headers: { ...HTML_HEADERS, 'content-language': lang === 'pt' ? 'pt-PT' : 'en', 'cache-control': cache },
  });
}

const pageNotFound = (lang: Lang, what: string) => html(lang, notFoundPage(lang, what), 404, 'public, max-age=60');
const notFound = () => json({ error: 'not_found' }, 404, 'public, max-age=60');

function param(raw: string): string | null {
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

async function stationJson(env: Env, id: string): Promise<Response> {
  const alias = await getStationAlias(env, id);
  if (alias) return new Response(null, { status: 301, headers: { location: `/api/v1/stations/${encodeURIComponent(alias)}`, 'cache-control': 'no-store' } });
  const found = await getStation(env, id);
  if (!found) return notFound();
  const { station: s, points, mains } = found;
  const photo = (target: string | null) => {
    const m = target ? mains[target] : undefined;
    return m && target
      ? photoLink({ target, stationId: s.id, credit: m.credit, panoramaxId: m.panoramax_id, lat: s.lat, lon: s.lon })
      : null;
  };
  return json({
    id: s.id,
    code: s.code,
    name: s.name,
    operator: { id: s.opc, name: s.operator },
    address: s.address,
    municipality: s.municipality,
    region: s.region,
    lat: s.lat,
    lon: s.lon,
    status: s.status,
    osm: s.osm_ref,
    photo: photo(s.id),
    points: points.map((p) => ({
      id: p.point_id,
      evse: p.evse_id,
      compact: p.evse_compact,
      connector: p.connector,
      kw: p.max_kw,
      dc: p.dc === 1,
      status: p.status,
      photo: photo(p.evse_compact),
    })),
    updatedAt: s.updated_at,
  });
}

const evseBody = (e: EvseMatch) => {
  const at = { stationId: e.station_id, lat: e.lat, lon: e.lon };
  return {
    evse: e.evse_id,
    compact: e.evse_compact,
    station: {
      id: e.station_id, name: e.name, operator: { id: e.opc, name: e.operator },
      photo: e.station_photo ? photoLink({ ...at, target: e.station_id, credit: e.station_credit, panoramaxId: e.station_pano }) : null,
    },
    point: { id: e.point_id, connector: e.connector, kw: e.max_kw, dc: e.dc === 1, status: e.status },
    photo: e.socket_photo ? photoLink({ ...at, target: e.evse_compact, credit: e.socket_credit, panoramaxId: e.socket_pano }) : null,
    updatedAt: e.updated_at,
  };
};

async function evseJson(env: Env, raw: string): Promise<Response> {
  const results = await findEvse(env, raw);
  if (results.length === 0) return notFound();
  // The NAP does not promise one code per socket. When it repeats, say so and
  // list the candidates instead of picking one at random.
  if (results.length > 1) return json({ error: 'ambiguous', candidates: results.map(evseBody) }, 300);
  return json(evseBody(results[0]));
}

// Every published main photo, for sites that copy the thumbnails with their
// credit (the NAP dashboard reads this once a day). A few hundred rows at most
// for a long while; the five minutes of browser cache match the other JSON.
async function mainPhotosJson(env: Env): Promise<Response> {
  const rows = await listMainPhotos(env);
  return json({
    license: 'CC-BY-SA-4.0',
    photos: rows.map((r) => {
      const base = `${PICTURES}/${encodeURIComponent(r.target)}`;
      const anchor = r.target === r.station_id ? '' : socketAnchor(r.target);
      return {
        target: r.target,
        station: { id: r.station_id, code: r.code },
        credit: r.credit,
        thumb: `${base}.thumb.jpg`,
        main: `${base}.jpg`,
        full: `${base}.full.jpg`,
        page: `${SITE}${stationPath('pt', r.station_id)}${anchor}`,
        panoramax: r.panoramax_id,
        publishedAt: r.published_at,
      };
    }),
  });
}

function stationHtml(lang: Lang) {
  return async (env: Env, id: string): Promise<Response> => {
    const alias = await getStationAlias(env, id);
    if (alias) return new Response(null, { status: 301, headers: { location: stationPath(lang, alias), 'cache-control': 'no-store' } });
    const found = await getStation(env, id);
    if (!found) return pageNotFound(lang, messages(lang).noStation(id));
    return html(lang, stationPage(lang, found.station, found.points, found.mains));
  };
}

function creditHtml(lang: Lang) {
  return async (env: Env, id: string): Promise<Response> => {
    const row = await getCredit(env, id);
    if (!row) return pageNotFound(lang, messages(lang).noPublishedPhoto(id));
    return new Response(creditPage(lang, row), {
      status: 200,
      headers: { ...CREDIT_HEADERS, 'content-language': lang === 'pt' ? 'pt-PT' : 'en', 'cache-control': 'public, max-age=300' },
    });
  };
}

function evseHtml(lang: Lang) {
  return async (env: Env, raw: string): Promise<Response> => {
    const results = await findEvse(env, raw);
    if (results.length === 0) return pageNotFound(lang, messages(lang).noSocket(raw));
    if (results.length > 1) return html(lang, evseChoicePage(lang, compactCode(raw) ?? raw, results), 300);
    const m = results[0];
    // 302, not 301: a code can move to another station in a later import.
    return new Response(null, {
      status: 302,
      headers: {
        location: stationPath(lang, m.station_id) + socketAnchor(m.evse_compact),
        'cache-control': 'public, max-age=300',
      },
    });
  };
}

async function rankingJson(env: Env, url: URL): Promise<Response> {
  const period = url.searchParams.get('period') === 'all' ? 'all' : 'month';
  const now = new Date();
  const rows = await ranking(env.DB, period, now);
  return json({
    period,
    month: period === 'month' ? now.toISOString().slice(0, 7) : undefined,
    contributors: rows.map((r, i) => ({ rank: i + 1, name: r.name, points: r.points, photos: r.photos, medal: r.medal })),
  });
}

// About 9k stations, read once a day per data centre: Workers responses are
// not kept by the CDN on their own, so the Cache API holds this one.
async function sitemap(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const key = new Request(new URL('/sitemap.xml', request.url));
  const hit = await caches.default.match(key);
  if (hit) return hit;
  const res = new Response(sitemapXml(await listStations(env)), {
    headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=86400' },
  });
  ctx.waitUntil(caches.default.put(key, res.clone()));
  return res;
}

const PAGE_RESULTS = 20;
const API_MAX_RESULTS = 50;
const queryOf = (url: URL) => (url.searchParams.get('q') ?? '').trim().slice(0, MAX_QUERY);

const searchBody = (r: SearchRow) => ({
  id: r.id,
  name: r.name,
  operator: { id: r.opc, name: r.operator },
  address: r.address,
  municipality: r.municipality,
  region: r.region,
  lat: r.lat,
  lon: r.lon,
  status: r.status,
});

function limitOf(url: URL): number {
  const asked = Number(url.searchParams.get('limit') ?? PAGE_RESULTS);
  return Number.isInteger(asked) ? Math.min(Math.max(asked, 1), API_MAX_RESULTS) : PAGE_RESULTS;
}

// Two ways in: words (?q=) or a place (?lat=&lon=&radius=), never both.
async function searchJson(env: Env, url: URL): Promise<Response> {
  const near = parseNear(url.searchParams);
  if (near !== null) {
    if (url.searchParams.has('q')) {
      return json({ error: 'q_or_coordinates', detail: 'use either q or lat/lon, not both' }, 400, 'no-store');
    }
    if (near === 'bad') {
      return json({
        error: 'bad_coordinates',
        detail: `lat and lon in decimal degrees; radius in whole metres, 1 to ${NEAR_MAX_M}`,
      }, 400, 'no-store');
    }
    const results = await nearStations(env, near, limitOf(url));
    return json({ ...near, results: results.map((r) => ({ ...searchBody(r), distance_m: r.distance_m })) });
  }
  const q = queryOf(url);
  if (!ftsQuery(q)) {
    return json({
      error: 'q_required',
      detail: 'q needs a word of at least two letters or digits, or search by place with lat and lon',
    }, 400, 'no-store');
  }
  return json({ q, results: (await searchStations(env, q, limitOf(url))).map(searchBody) });
}

// A typed station or socket code goes straight to its page; anything else is
// a word search. Both lookups are on primary keys or indexes.
async function searchHtml(lang: Lang, env: Env, url: URL): Promise<Response> {
  const q = queryOf(url);
  // Most codes are upper case (EZC-AMD-00051), Tesla's are lower case hex: try both.
  for (const id of new Set([q, q.toUpperCase()])) {
    if (STATION_ID.test(id) && (await getStation(env, id))) {
      return new Response(null, { status: 302, headers: { location: stationPath(lang, id), 'cache-control': 'no-store' } });
    }
  }
  if (compactCode(q)) {
    const evses = await findEvse(env, q);
    if (evses.length === 1) {
      const m = evses[0];
      return new Response(null, {
        status: 302,
        headers: { location: stationPath(lang, m.station_id) + socketAnchor(m.evse_compact), 'cache-control': 'no-store' },
      });
    }
  }
  const results = ftsQuery(q) ? await searchStations(env, q, PAGE_RESULTS) : null;
  return html(lang, searchPage(lang, q, results, PAGE_RESULTS), 200, 'no-store');
}

type Handler = (env: Env, value: string) => Promise<Response>;
const ROUTES: [RegExp, Handler, () => Response][] = [
  [/^\/api\/v1\/stations\/([^/]+)$/, stationJson, notFound],
  [/^\/api\/v1\/evses\/([^/]+)$/, evseJson, notFound],
  [/^\/postos\/([^/]+)$/, stationHtml('pt'), () => pageNotFound('pt', messages('pt').badStation)],
  [/^\/tomadas\/([^/]+)$/, evseHtml('pt'), () => pageNotFound('pt', messages('pt').badSocket)],
  [/^\/p\/([^/]+)$/, creditHtml('pt'), () => pageNotFound('pt', messages('pt').noPublishedPhoto('?'))],
  [/^\/en\/p\/([^/]+)$/, creditHtml('en'), () => pageNotFound('en', messages('en').noPublishedPhoto('?'))],
  [/^\/en\/stations\/([^/]+)$/, stationHtml('en'), () => pageNotFound('en', messages('en').badStation)],
  [/^\/en\/sockets\/([^/]+)$/, evseHtml('en'), () => pageNotFound('en', messages('en').badSocket)],
];

async function setSelection(request: Request, env: Env & PhotoEnv, ctx: ExecutionContext, target: string): Promise<Response> {
  const caller = await apiCaller(request, env, 'selections:write');
  if ('error' in caller) return json({ error: caller.error }, caller.status, 'no-store');
  const { user } = caller;
  if (!canChooseMain(user.role)) return json({ error: 'forbidden' }, 403, 'no-store');
  let body: { photo?: string } = {};
  try { body = await request.json(); } catch { return json({ error: 'bad_body' }, 400, 'no-store'); }
  if (!body.photo) return json({ error: 'bad_photo' }, 400, 'no-store');
  try {
    const targets = await chooseMain(env, target, body.photo, user.id, fetch, new Date());
    return json({ targets });
  } catch {
    return json({ error: 'publish_failed' }, 502, 'no-store');
  }
}

export default {
  async fetch(request: Request, env: Env & TakedownEnv & RateEnv, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;
    // The POSTs: everything else on this site only reads.
    if (request.method === 'POST' && pathname === '/auth/logout') return logout(request, env);
    if (request.method === 'POST' && pathname === ACCOUNT_ACTION) return accountAction(request, env, HTML_HEADERS, ctx);
    if (request.method === 'POST' && pathname === ROLE_ACTION) return setRole(request, env);
    if (request.method === 'POST' && pathname === DECIDE_ACTION) return decide(request, env);
    if (request.method === 'POST' && (pathname === ALIAS_ACTION || pathname === '/admin/alias' || pathname === '/admin/rekeys' || pathname === '/admin/aliases')) return rekey(request, env);
    if (request.method === 'POST' && pathname === '/api/v1/photos') return submitPhoto(request, env, ctx);
    if (request.method === 'POST' && pathname === '/api/v1/stations') return proposeStation(request, env);
    if (request.method === 'POST' && pathname === '/report') return submitTakedown(request, env);
    if (request.method === 'POST' && pathname === TAKEDOWN_DECIDE) return decideTakedown(request, env);
    if (request.method === 'PUT') {
      const m = pathname.match(/^\/api\/v1\/selections\/([^/]+)$/);
      if (m) {
        const value = param(m[1]);
        if (value === null) return notFound();
        return setSelection(request, env, ctx, value);
      }
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return json({ error: 'method_not_allowed' }, 405, 'no-store');
    }
    for (const [re, handler, bad] of ROUTES) {
      const m = pathname.match(re);
      if (!m) continue;
      const value = param(m[1]);
      return value === null ? bad() : handler(env, value);
    }
    if (pathname === '/api/v1/main-photos') return mainPhotosJson(env);
    if (pathname === '/api/v1/ranking') return rankingJson(env, url);
    if (pathname === '/api/v1/stations' || pathname === '/pesquisa' || pathname === '/en/search') {
      if (!(await allowed(env.SEARCH_LIMIT, clientIp(request)))) return tooMany(pathname);
      if (pathname === '/api/v1/stations') return searchJson(env, url);
      return searchHtml(pathname === '/pesquisa' ? 'pt' : 'en', env, url);
    }
    if (pathname === '/') return html('pt', homePage('pt'));
    if (pathname === '/en/') return html('en', homePage('en'));
    if (pathname === '/en') return new Response(null, { status: 301, headers: { location: '/en/' } });
    if (pathname === '/privacidade') return html('pt', privacyPage('pt'));
    if (pathname === '/en/privacy') return html('en', privacyPage('en'));
    if (pathname === '/condicoes') return html('pt', termsPage('pt'));
    if (pathname === '/en/terms') return html('en', termsPage('en'));
    if (pathname === '/grupo') return html('pt', groupPage('pt'));
    if (pathname === '/en/group') return html('en', groupPage('en'));
    if (pathname === '/conta') return accountHtml('pt', request, env, HTML_HEADERS);
    if (pathname === '/en/account') return accountHtml('en', request, env, HTML_HEADERS);
    if (pathname === '/admin/fila') return queueHtml('pt', request, env, HTML_HEADERS);
    if (pathname === '/en/admin/queue') return queueHtml('en', request, env, HTML_HEADERS);
    if (pathname.startsWith(STAGING_PREFIX)) return stagingImage(request, env, pathname.slice(STAGING_PREFIX.length));
    if (pathname === '/admin/utilizadores') return usersHtml('pt', request, env, HTML_HEADERS);
    if (pathname === '/en/admin/users') return usersHtml('en', request, env, HTML_HEADERS);
    if (pathname === '/admin/postos-fora-do-nap' || pathname === '/admin/aliases' || pathname === '/admin/rekeys' || pathname === '/admin/rekey') return aliasesHtml('pt', request, env, HTML_HEADERS);
    if (pathname === '/en/admin/stations-missing' || pathname === '/en/admin/aliases' || pathname === '/en/admin/rekeys' || pathname === '/en/admin/rekey') return aliasesHtml('en', request, env, HTML_HEADERS);
    // The removal form loads Turnstile, like the upload page.
    if (pathname === '/report') return takedownHtml('pt', request, env, TURNSTILE_HEADERS);
    if (pathname === '/en/report') return takedownHtml('en', request, env, TURNSTILE_HEADERS);
    if (pathname === '/admin/remocoes') return takedownsHtml('pt', request, env, HTML_HEADERS);
    if (pathname === '/en/admin/takedowns') return takedownsHtml('en', request, env, HTML_HEADERS);
    if (pathname === '/enviar') return uploadHtml('pt', request, env, UPLOAD_HEADERS);
    if (pathname === '/en/upload') return uploadHtml('en', request, env, UPLOAD_HEADERS);
    if (pathname === '/auth/osm/login' || pathname === '/auth/osm/callback') {
      if (!(await allowed(env.LOGIN_LIMIT, clientIp(request)))) return tooMany(pathname);
      if (pathname === '/auth/osm/login') return login(request, env, HTML_HEADERS);
      return callback(request, env, ctx, HTML_HEADERS);
    }
    if (pathname === '/ranking' || pathname === '/en/ranking') {
      const lang = pathname.startsWith('/en/') ? 'en' : 'pt';
      const periodRaw = url.searchParams.get('period') ?? 'all';
      const period = periodRaw === 'month' ? 'month' : 'all';
      const rows = await ranking(env.DB, period);
      return html(lang, rankingPage(lang, period, rows));
    }
    if (pathname === '/sitemap.xml') return sitemap(request, env, ctx);
    if (pathname.startsWith('/api/')) return notFound();
    const lang: Lang = pathname.startsWith('/en/') ? 'en' : 'pt';
    return pageNotFound(lang, messages(lang).noPage);
  },
  // Every 6 hours (wrangler.json): retries the hides that half-failed, and
  // follows any auto-hide report that did not come from our form
  // (src/takedown.ts); then a batch of what is left of credit changes
  // (src/credit.ts). One after the other: they share the subrequest limit.
  async scheduled(_event: ScheduledController, env: Env & TakedownEnv, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(reconcile(env, fetch).catch(() => {}).then(() => syncCredits(env, fetch)));
  },
} satisfies ExportedHandler<Env & TakedownEnv>;
