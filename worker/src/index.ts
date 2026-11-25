// olh'o'posto Worker (olhaoposto.ocarroeletrico.com): the station pages, the
// read-only API and sign-in with OpenStreetMap (auth.ts). Fonts, CSS and icons in public/ are Workers static assets,
// served before this code runs. Static photo links are served by the R2
// bucket on pictures.ocarroeletrico.com, never by this Worker (Docs/arquitetura.md).
import { ROLE_ACTION, setRole, usersHtml } from './admin.ts';
import { DECIDE_ACTION, STAGING_PREFIX, decide, queueHtml, stagingImage } from './moderation.ts';
import { accountHtml, callback, login, logout } from './auth.ts';
import { submitPhoto, uploadHtml, type PhotoEnv } from './photos.ts';
import { findEvse, getStation, listStations, nearStations, searchStations, type Env } from './data.ts';
import {
  evseChoicePage, homePage, messages, notFoundPage, searchPage, socketAnchor, stationPage, stationPath, type Lang,
} from './pages.ts';
import { privacyPage } from './privacy.ts';
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

// The upload page also asks our API for stations (connect-src) and shows the
// prepared photo from a blob: URL. Only that page gets these.
const UPLOAD_HEADERS = {
  ...HTML_HEADERS,
  'content-security-policy': HTML_HEADERS['content-security-policy']
    .replace("img-src 'self'", "img-src 'self' blob:")
    .replace("default-src 'none';", "default-src 'none'; connect-src 'self';"),
};

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
  const found = await getStation(env, id);
  if (!found) return notFound();
  const { station: s, points } = found;
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
    points: points.map((p) => ({
      id: p.point_id,
      evse: p.evse_id,
      compact: p.evse_compact,
      connector: p.connector,
      kw: p.max_kw,
      dc: p.dc === 1,
      status: p.status,
    })),
    updatedAt: s.updated_at,
  });
}

const evseBody = (e: EvseMatch) => ({
  evse: e.evse_id,
  compact: e.evse_compact,
  station: { id: e.station_id, name: e.name, operator: { id: e.opc, name: e.operator } },
  point: { id: e.point_id, connector: e.connector, kw: e.max_kw, dc: e.dc === 1, status: e.status },
  updatedAt: e.updated_at,
});

async function evseJson(env: Env, raw: string): Promise<Response> {
  const results = await findEvse(env, raw);
  if (results.length === 0) return notFound();
  // The NAP does not promise one code per socket. When it repeats, say so and
  // list the candidates instead of picking one at random.
  if (results.length > 1) return json({ error: 'ambiguous', candidates: results.map(evseBody) }, 300);
  return json(evseBody(results[0]));
}

function stationHtml(lang: Lang) {
  return async (env: Env, id: string): Promise<Response> => {
    const found = await getStation(env, id);
    if (!found) return pageNotFound(lang, messages(lang).noStation(id));
    return html(lang, stationPage(lang, found.station, found.points));
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
  [/^\/en\/stations\/([^/]+)$/, stationHtml('en'), () => pageNotFound('en', messages('en').badStation)],
  [/^\/en\/sockets\/([^/]+)$/, evseHtml('en'), () => pageNotFound('en', messages('en').badSocket)],
];

export default {
  async fetch(request: Request, env: Env & PhotoEnv, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;
    // The POSTs: everything else on this site only reads.
    if (request.method === 'POST' && pathname === '/auth/logout') return logout(request, env);
    if (request.method === 'POST' && pathname === ROLE_ACTION) return setRole(request, env);
    if (request.method === 'POST' && pathname === DECIDE_ACTION) return decide(request, env);
    if (request.method === 'POST' && pathname === '/api/v1/photos') return submitPhoto(request, env, ctx);
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return json({ error: 'method_not_allowed' }, 405, 'no-store');
    }
    for (const [re, handler, bad] of ROUTES) {
      const m = pathname.match(re);
      if (!m) continue;
      const value = param(m[1]);
      return value === null ? bad() : handler(env, value);
    }
    if (pathname === '/api/v1/stations') return searchJson(env, url);
    if (pathname === '/pesquisa') return searchHtml('pt', env, url);
    if (pathname === '/en/search') return searchHtml('en', env, url);
    if (pathname === '/') return html('pt', homePage('pt'));
    if (pathname === '/en/') return html('en', homePage('en'));
    if (pathname === '/en') return new Response(null, { status: 301, headers: { location: '/en/' } });
    if (pathname === '/privacidade') return html('pt', privacyPage('pt'));
    if (pathname === '/en/privacy') return html('en', privacyPage('en'));
    if (pathname === '/conta') return accountHtml('pt', request, env, HTML_HEADERS);
    if (pathname === '/en/account') return accountHtml('en', request, env, HTML_HEADERS);
    if (pathname === '/admin/fila') return queueHtml('pt', request, env, HTML_HEADERS);
    if (pathname === '/en/admin/queue') return queueHtml('en', request, env, HTML_HEADERS);
    if (pathname.startsWith(STAGING_PREFIX)) return stagingImage(request, env, pathname.slice(STAGING_PREFIX.length));
    if (pathname === '/admin/utilizadores') return usersHtml('pt', request, env, HTML_HEADERS);
    if (pathname === '/en/admin/users') return usersHtml('en', request, env, HTML_HEADERS);
    if (pathname === '/enviar') return uploadHtml('pt', request, env, UPLOAD_HEADERS);
    if (pathname === '/en/upload') return uploadHtml('en', request, env, UPLOAD_HEADERS);
    if (pathname === '/auth/osm/login') return login(request, env, HTML_HEADERS);
    if (pathname === '/auth/osm/callback') return callback(request, env, ctx, HTML_HEADERS);
    if (pathname === '/sitemap.xml') return sitemap(request, env, ctx);
    if (pathname.startsWith('/api/')) return notFound();
    const lang: Lang = pathname.startsWith('/en/') ? 'en' : 'pt';
    return pageNotFound(lang, messages(lang).noPage);
  },
} satisfies ExportedHandler<Env & PhotoEnv>;
