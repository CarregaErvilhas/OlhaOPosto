// Stations without a photo: a page to pick one to photograph, searched by text
// and filtered by town or operator. The same list is GET /api/v1/stations?has_photo=false. A
// station counts as without a photo while its static link answers 404.
import { filterStations, searchStations, withoutPhotoFacets, type Env, type Facet } from './data.ts';
import { BRAND, esc, layout, nap, stationPath, uploadPath, withoutPhotoPath, type Lang } from './pages.ts';
import { ftsQuery, MAX_MUNICIPALITY, MAX_QUERY, type SearchRow, type StationFilters } from './types.ts';

export const NOPHOTO_PAGE = 50;

// The query names follow the language of the page.
const PARAM = {
  pt: { q: 'q', town: 'concelho', operator: 'operador', after: 'depois' },
  en: { q: 'q', town: 'municipality', operator: 'operator', after: 'after' },
} as const;

const T = {
  pt: {
    title: 'Postos sem foto',
    desc: `Postos de carregamento em Portugal que ainda não têm foto no ${BRAND}.`,
    intro: (n: number) => `${n === 1 ? 'Há 1 posto' : `Há ${n} postos`} sem foto. Escolhe um perto de ti, fotografa-o e envia a foto: se for aprovada, passa a ser a foto principal do posto.`,
    introAll: 'Todos os postos têm foto. Obrigado!',
    search: 'Pesquisar',
    searchHint: 'Código, nome, morada ou localidade.',
    town: 'Concelho',
    operator: 'Operador',
    any: 'Escreve para procurar; vazio mostra todos',
    count: (n: number) => (n === 1 ? '1 sem foto' : `${n} sem foto`),
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
    search: 'Search',
    searchHint: 'Code, name, address or place.',
    town: 'Municipality',
    operator: 'Operator',
    any: 'Type to look one up; empty shows all',
    count: (n: number) => `${n} without a photo`,
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
  // What the reader typed, shown back in the form.
  q: string;
  operatorText: string;
}

const query = (lang: Lang, f: StationFilters, after?: string, text = '') => {
  const q = new URLSearchParams();
  if (text) q.set(PARAM[lang].q, text);
  if (f.municipality) q.set(PARAM[lang].town, f.municipality);
  if (f.opc) q.set(PARAM[lang].operator, f.opc);
  if (after) q.set(PARAM[lang].after, after);
  const s = q.toString();
  return withoutPhotoPath(lang) + (s ? `?${s}` : '');
};

// A text box with the facets as suggestions (a datalist), so the reader types
// a few letters instead of scrolling hundreds of options. The box sends the
// label (the operator's name); noPhotoData turns it back into a filter.
const options = (lang: Lang, facets: Facet[]) =>
  facets.map((f) => `<option value="${esc(f.label)}">${esc(T[lang].count(f.n))}</option>`).join('');

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
  const filtered = v.filters.opc !== undefined || v.filters.municipality !== undefined || v.q !== '' || v.operatorText !== '';
  const box = (id: string, name: string, value: string, list: string, extra = '') =>
    `<input id="${id}" name="${name}" type="search" value="${esc(value)}" autocomplete="off" spellcheck="false"${list ? ` list="${id}-list" placeholder="${t.any}"` : ''}${extra}>`;
  const form = `<form class="search filters" action="${withoutPhotoPath(lang)}" method="get">
  <p><label for="f-q">${t.search}</label>
  ${box('f-q', p.q, v.q, '', ` maxlength="${MAX_QUERY}" aria-describedby="f-q-hint"`)}
  <span id="f-q-hint" class="hint">${t.searchHint}</span></p>
  <p><label for="f-town">${t.town}</label>
  ${box('f-town', p.town, v.filters.municipality ?? '', 'list', ` maxlength="${MAX_MUNICIPALITY}"`)}
  <datalist id="f-town-list">${options(lang, v.municipalities)}</datalist></p>
  <p><label for="f-op">${t.operator}</label>
  ${box('f-op', p.operator, v.operatorText, 'list', ' maxlength="80"')}
  <datalist id="f-op-list">${options(lang, v.operators)}</datalist></p>
  <p><button type="submit" class="button">${t.filter}</button>${filtered ? ` <a href="${withoutPhotoPath(lang)}">${t.clear}</a>` : ''}</p>
</form>`;
  const list = v.rows.length
    ? `<ul class="results" role="list">\n  ${v.rows.map((r) => item(lang, r)).join('\n  ')}\n</ul>`
    : `<p>${t.empty}</p>`;
  const more = v.next ? `<p><a class="button secondary" href="${esc(query(lang, v.filters, v.next, v.q))}">${t.next}</a></p>` : '';
  const api = `/api/v1/stations?has_photo=false${v.q ? `&amp;q=${encodeURIComponent(v.q)}` : ''}${v.filters.opc ? `&amp;opc=${encodeURIComponent(v.filters.opc)}` : ''}${v.filters.municipality ? `&amp;municipality=${encodeURIComponent(v.filters.municipality)}` : ''}`;
  return layout({
    lang,
    title: `${t.title} · ${BRAND}`,
    description: t.desc,
    // A filtered or later page is a view of the same list.
    path: withoutPhotoPath(lang),
    alternates: { pt: withoutPhotoPath('pt'), en: withoutPhotoPath('en') },
    switchTo: { pt: query('pt', v.filters, undefined, v.q), en: query('en', v.filters, undefined, v.q) },
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

// The operator box sends a name picked from the suggestions, but an operator
// code (older links, the API's opc) still works.
function operatorOf(facets: Facet[], typed: string): Facet | undefined {
  const t = typed.toLowerCase();
  return facets.find((f) => f.value.toLowerCase() === t) ?? facets.find((f) => f.label.toLowerCase() === t);
}

// Reads the search and the filters in the page's own language, then the list
// and the facets. With text typed, the list is the best matches (no paging).
export async function noPhotoData(env: Env, lang: Lang, url: URL): Promise<NoPhotoView> {
  const p = PARAM[lang];
  const q = (url.searchParams.get(p.q) ?? '').trim().slice(0, MAX_QUERY);
  const town = (url.searchParams.get(p.town) ?? '').trim().slice(0, MAX_MUNICIPALITY);
  const typedOp = (url.searchParams.get(p.operator) ?? '').trim().slice(0, 80);
  const after = (url.searchParams.get(p.after) ?? '').slice(0, 64);
  const facets = await withoutPhotoFacets(env);
  const filters: StationFilters = { hasPhoto: false };
  if (town) filters.municipality = town;
  const op = typedOp ? operatorOf(facets.operators, typedOp) : undefined;
  if (op) filters.opc = op.value;
  else if (/^[A-Za-z0-9_-]{1,40}$/.test(typedOp)) filters.opc = typedOp;
  // A name that is no operator with stations left to photograph: nothing matches.
  const nothing = typedOp !== '' && filters.opc === undefined;
  const page = nothing
    ? { rows: [], next: null }
    : ftsQuery(q)
      ? { rows: await searchStations(env, q, NOPHOTO_PAGE, filters), next: null }
      : await filterStations(env, filters, NOPHOTO_PAGE, after);
  // The filters shown on the page do not carry hasPhoto: it is always false.
  const { hasPhoto: _, ...shown } = filters;
  return { ...page, ...facets, filters: shown, q, operatorText: op?.label ?? typedOp };
}
