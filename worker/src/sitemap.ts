// sitemap.xml for the station pages and the home page, in both languages.
// hreflang lives in each page's <head>, so the sitemap only lists URLs.
import { esc, homePath, LANGS, SITE, stationPath } from './pages.ts';

export function sitemapXml(stations: { id: string; lastmod: string }[]): string {
  const url = (path: string, lastmod?: string) =>
    `<url><loc>${esc(SITE + path)}</loc>${lastmod ? `<lastmod>${esc(lastmod)}</lastmod>` : ''}</url>`;
  const lines = LANGS.map((l) => url(homePath(l)));
  for (const s of stations) for (const l of LANGS) lines.push(url(stationPath(l, s.id), s.lastmod));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${lines.join('\n')}\n</urlset>\n`;
}
