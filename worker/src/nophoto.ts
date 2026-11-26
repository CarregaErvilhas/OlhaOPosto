// Stations without a photo: a page to pick one to photograph, filtered by town
// or operator. The same list is GET /api/v1/stations?has_photo=false. A
// station counts as without a photo while its static link answers 404.
import { filterStations, withoutPhotoFacets, type Env, type Facet } from './data.ts';
import { BRAND, esc, layout, nap, stationPath, uploadPath, withoutPhotoPath, type Lang } from './pages.ts';
import { MAX_MUNICIPALITY, type SearchRow, type StationFilters } from './types.ts';

export const NOPHOTO_PAGE = 50;

// The query names follow the language of the page.
const PARAM = {
  pt: { town: 'concelho', operator: 'operador', after: 'depois' },
  en: { town: 'municipality', operator: 'operator', after: 'after' },
} as const;

const T = {
  pt: {
    title: 'Postos sem foto',
    desc: `Postos de carregamento em Portugal que ainda não têm foto no ${BRAND}.`,
    intro: (n: number) => `${n === 1 ? 'Há 1 posto' : `Há ${n} postos`} sem foto. Escolhe um perto de ti, fotografa-o e envia a foto: se for aprovada, passa a ser a foto principal do posto.`,
    introAll: 'Todos os postos têm foto. Obrigado!',
    town: 'Concelho',
    operator: 'Operador',
    any: 'Todos',
    filter: 'Filtrar',
    clear: 'Limpar filtros',
    send: 'Enviar foto',
    empty: 'Nenhum posto sem foto com estes filtros.',
    next: 'Mais postos',
    api: 'Em JSON, pela API:',
    unknownOperator: 'Operador desconhecido',
    outNap: 'Fora do NAP',
  },
  en: {
    title: 'Stations without a photo',
    desc: `Charging stations in Portugal that have no photo on ${BRAND} yet.`,
    intro: (n: number) => `${n === 1 ? '1 station has' : `${n} stations have`} no photo. Pick one near you, photograph it and send the photo: once approved, it becomes the station's main photo.`,
    introAll: 'Every station has a photo. Thank you!',
    town: 'Municipality',
    operator: 'Operator',
    any: 'All',
    filter: 'Filter',
    clear: 'Clear filters',
    send: 'Send a photo',
    empty: 'No station without a photo matches these filters.',
    next: 'More stations',
    api: 'As JSON, through the API:',
    unknownOperator: 'Unknown operator',
    outNap: 'Not in the NAP',
  },
} as const;

export interface NoPhotoView {
  rows: SearchRow[];
  next: string | null;
  total: number;
  municipalities: Facet[];
  operators: Facet[];
  filters: StationFilters;
}

const query = (lang: Lang, f: StationFilters, after?: string) => {
  const q = new URLSearchParams();
  if (f.municipality) q.set(PARAM[lang].town, f.municipality);
  if (f.opc) q.set(PARAM[lang].operator, f.opc);
  if (after) q.set(PARAM[lang].after, after);
  const s = q.toString();
  return withoutPhotoPath(lang) + (s ? `?${s}` : '');
};

const options = (lang: Lang, facets: Facet[], chosen: string | undefined, withLabel: (f: Facet) => string) =>
  `<option value="">${T[lang].any}</option>` + facets.map((f) =>
    `<option value="${esc(f.value)}"${chosen?.toLowerCase() === f.value.toLowerCase() ? ' selected' : ''}>${esc(withLabel(f))}</option>`).join('');

function item(lang: Lang, r: SearchRow): string {
  const t = T[lang];
  const place = [r.address, r.municipality].filter(Boolean).join(', ');
  const line = [r.name, place].filter(Boolean).join(' · ');
  return `<li class="result">
    <a class="mono" href="${stationPath(lang, r.id)}">${esc(r.id)}</a>
    ${line ? `<div>${nap(lang, line)}</div>` : ''}
    <div class="meta">${r.operator ? nap(lang, r.operator) : t.unknownOperator}${r.status === 'missing_from_nap' ? ` · ${t.outNap}` : ''} · <a href="${uploadPath(lang)}?posto=${encodeURIComponent(r.id)}">${t.send}</a></div>
  </li>`;
}

export function noPhotoPage(lang: Lang, v: NoPhotoView): string {
  const t = T[lang];
  const p = PARAM[lang];
  const n = (f: Facet) => `${f.label} (${f.n})`;
  const filtered = v.filters.opc !== undefined || v.filters.municipality !== undefined;
  const form = `<form class="search" action="${withoutPhotoPath(lang)}" method="get">
  <p><label for="f-town">${t.town}</label><br>
  <select id="f-town" name="${p.town}">${options(lang, v.municipalities, v.filters.municipality, n)}</select></p>
  <p><label for="f-op">${t.operator}</label><br>
  <select id="f-op" name="${p.operator}">${options(lang, v.operators, v.filters.opc, n)}</select></p>
  <p><button type="submit" class="button">${t.filter}</button>${filtered ? ` <a href="${withoutPhotoPath(lang)}">${t.clear}</a>` : ''}</p>
</form>`;
  const list = v.rows.length
    ? `<ul class="results" role="list">\n  ${v.rows.map((r) => item(lang, r)).join('\n  ')}\n</ul>`
    : `<p>${t.empty}</p>`;
  const more = v.next ? `<p><a class="button secondary" href="${esc(query(lang, v.filters, v.next))}">${t.next}</a></p>` : '';
  const api = `/api/v1/stations?has_photo=false${v.filters.opc ? `&amp;opc=${encodeURIComponent(v.filters.opc)}` : ''}${v.filters.municipality ? `&amp;municipality=${encodeURIComponent(v.filters.municipality)}` : ''}`;
  return layout({
    lang,
    title: `${t.title} · ${BRAND}`,
    description: t.desc,
    // A filtered or later page is a view of the same list.
    path: withoutPhotoPath(lang),
    alternates: { pt: withoutPhotoPath('pt'), en: withoutPhotoPath('en') },
    switchTo: { pt: query('pt', v.filters), en: query('en', v.filters) },
    body: `<div class="page-msg">
<h1>${t.title}</h1>
<p>${v.total ? t.intro(v.total) : t.introAll}</p>
${form}
${list}
${more}
<p class="hint">${t.api} <code>${api}</code></p>
</div>`,
  });
}

// Reads the filters in the page's own language, then the list and the facets.
export async function noPhotoData(env: Env, lang: Lang, url: URL): Promise<NoPhotoView> {
  const p = PARAM[lang];
  const town = (url.searchParams.get(p.town) ?? '').trim().slice(0, MAX_MUNICIPALITY);
  const opc = (url.searchParams.get(p.operator) ?? '').trim();
  const filters: StationFilters = { hasPhoto: false };
  if (town) filters.municipality = town;
  if (/^[A-Za-z0-9_-]{1,40}$/.test(opc)) filters.opc = opc;
  const after = (url.searchParams.get(p.after) ?? '').slice(0, 64);
  const [facets, page] = await Promise.all([withoutPhotoFacets(env), filterStations(env, filters, NOPHOTO_PAGE, after)]);
  // The filters shown on the page do not carry hasPhoto: it is always false.
  const { hasPhoto: _, ...shown } = filters;
  return { ...page, ...facets, filters: shown };
}
