// VoltFrame Worker (voltframe.ocarroeletrico.com): the station pages and the
// read-only API. Fonts, CSS and icons in public/ are Workers static assets,
// served before this code runs. Static photo links are served by the R2
// bucket on pictures.ocarroeletrico.com, never by this Worker (Docs/arquitetura.md).
import { findEvse, getStation, listStations, type Env } from './data.ts';
import {
  evseChoicePage, homePage, messages, notFoundPage, socketAnchor, stationPage, stationPath, type Lang,
} from './pages.ts';
import { sitemapXml } from './sitemap.ts';
import { compactCode, type EvseMatch } from './types.ts';

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
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return json({ error: 'method_not_allowed' }, 405, 'no-store');
    }
    const { pathname } = new URL(request.url);
    for (const [re, handler, bad] of ROUTES) {
      const m = pathname.match(re);
      if (!m) continue;
      const value = param(m[1]);
      return value === null ? bad() : handler(env, value);
    }
    if (pathname === '/') return html('pt', homePage('pt'));
    if (pathname === '/en/') return html('en', homePage('en'));
    if (pathname === '/en') return new Response(null, { status: 301, headers: { location: '/en/' } });
    if (pathname === '/sitemap.xml') return sitemap(request, env, ctx);
    if (pathname.startsWith('/api/')) return notFound();
    const lang: Lang = pathname.startsWith('/en/') ? 'en' : 'pt';
    return pageNotFound(lang, messages(lang).noPage);
  },
} satisfies ExportedHandler<Env>;
