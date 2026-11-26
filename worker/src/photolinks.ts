// The photo object the API returns for a station or socket's main photo
// (GET /api/v1/stations/{id}, /evses/{evse}). One builder, so every route
// says the same thing about credit, sizes and links.
//
// The sizes are the longest side of each file, not exact widths: the photo
// keeps its shape (Docs/arquitetura.md, *Links estáticos*).

import { BRAND, PANORAMAX_URL, PICTURES, SITE, socketAnchor, stationPath } from './pages.ts';

export const LICENSE = 'CC-BY-SA-4.0';
export const LICENSE_URL = 'https://creativecommons.org/licenses/by-sa/4.0/';
export const SIZE_PX = { thumb: 400, main: 1024, full: 2048 } as const;

export const reportPath = (target?: string) =>
  `/report${target ? `?alvo=${encodeURIComponent(target)}` : ''}`;

export interface PhotoLink {
  target: string;
  credit: string;
  license: typeof LICENSE;
  licenseUrl: string;
  attribution: string;
  sizes: Record<keyof typeof SIZE_PX, { url: string; maxPx: number }>;
  page: string;
  panoramax: string | null;
  report: string;
}

export function photoLink(p: {
  target: string;
  stationId: string;
  credit: string | null;
  panoramaxId: string | null | undefined;
  lat: number;
  lon: number;
}): PhotoLink {
  const base = `${PICTURES}/${encodeURIComponent(p.target)}`;
  const credit = p.credit ?? BRAND;
  const anchor = p.target === p.stationId ? '' : socketAnchor(p.target);
  return {
    target: p.target,
    credit,
    license: LICENSE,
    licenseUrl: LICENSE_URL,
    // The same wording as the XMP in each file (src/publish.ts).
    attribution: `© ${credit}, CC BY-SA 4.0, via ${BRAND}`,
    sizes: {
      thumb: { url: `${base}.thumb.jpg`, maxPx: SIZE_PX.thumb },
      main: { url: `${base}.jpg`, maxPx: SIZE_PX.main },
      full: { url: `${base}.full.jpg`, maxPx: SIZE_PX.full },
    },
    page: `${SITE}${stationPath('pt', p.stationId)}${anchor}`,
    panoramax: p.panoramaxId
      ? `${PANORAMAX_URL}/viewer?focus=map&map=19/${p.lat}/${p.lon}&pic=${encodeURIComponent(p.panoramaxId)}`
      : null,
    report: SITE + reportPath(p.target),
  };
}
