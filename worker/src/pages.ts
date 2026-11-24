// Server-rendered HTML pages, in European Portuguese and in English. Pure
// functions of the rows (no Env), so they can be tested under Node. Every
// string from the database is third-party text (NAP names, addresses,
// operators): it only reaches the markup through esc(). That text is
// Portuguese whatever the page language, and English pages mark it as such
// (lang="pt-PT") so screen readers read it with the right voice.
import type { EvseMatch, PointRow, StationRow } from './types.ts';

export const SITE = 'https://voltframe.ocarroeletrico.com';
export const PICTURES = 'https://pictures.ocarroeletrico.com';

export type Lang = 'pt' | 'en';
export const LANGS: readonly Lang[] = ['pt', 'en'];
const HTML_LANG: Record<Lang, string> = { pt: 'pt-PT', en: 'en' };
const OG_LOCALE: Record<Lang, string> = { pt: 'pt_PT', en: 'en_GB' };
const NUMBER_LOCALE: Record<Lang, string> = { pt: 'pt-PT', en: 'en-GB' };

// The pt-PT URLs came first and never change; English lives under /en/.
export const homePath = (lang: Lang) => (lang === 'pt' ? '/' : '/en/');
export const stationPath = (lang: Lang, id: string) =>
  `${lang === 'pt' ? '/postos/' : '/en/stations/'}${encodeURIComponent(id)}`;
export const socketPath = (lang: Lang, evse: string) =>
  `${lang === 'pt' ? '/tomadas/' : '/en/sockets/'}${encodeURIComponent(evse)}`;
export const socketAnchor = (compact: string) => `#t-${encodeURIComponent(compact)}`;

export function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const T = {
  pt: {
    other: 'English',
    footerData: 'Fotos CC BY-SA 4.0 · Dados dos postos: NAP Portugal (MOBI.E) e © contribuidores do OpenStreetMap (ODbL)',
    footerCode: 'Código (MIT)',
    ogImageAlt: 'Pic, a mascote do pIcŧU/Re',
    inNap: 'No NAP',
    outNap: 'Fora do NAP',
    sockets: (n: number) => (n === 1 ? '1 tomada' : `${n} tomadas`),
    noPhotos: 'Sem fotos',
    missingNotice: 'Este posto deixou de aparecer no NAP. Fica aqui com as fotos que tiver, mas pode já não existir.',
    photosHeading: 'Fotos do posto',
    emptyTitle: 'Ainda não há fotos deste posto',
    emptySoon: 'O envio de fotos abre em breve.',
    hint: 'A foto principal é escolhida pela comunidade. O link estático continua o mesmo quando ela muda.',
    linksTitle: 'Links estáticos',
    linksIntro: 'Para apps, mapas e o OSM. Devolvem 404 enquanto não houver foto principal.',
    size: 'Tamanho',
    stationLabel: 'Posto',
    copyStation: 'Copiar link: posto',
    copySocket: (code: string) => `Copiar link: tomada ${code}`,
    copied: 'Link copiado.',
    copyFailed: 'Não foi possível copiar. O link ficou selecionado: copia-o à mão.',
    socketsTitle: 'Tomadas',
    socketsIntro: 'Cada tomada com código EVSE tem o seu link.',
    noPhoto: 'sem foto',
    noEvse: 'Sem código EVSE no NAP: sem link de tomada',
    socketGone: 'já não está no NAP',
    unknownPlug: 'Ficha desconhecida',
    osmTitle: 'No OpenStreetMap',
    osmLinked: (el: string) => `Ligado ao elemento ${el}.`,
    osmView: 'Ver no OpenStreetMap',
    osmNone: 'Ainda não está ligado a um elemento do OpenStreetMap.',
    osmMap: 'Ver o sítio no mapa',
    dataTitle: 'Dados',
    dataJson: 'Em JSON, pela API',
    unknownOperator: 'Operador desconhecido',
    stationDesc: (id: string, operator: string | null, town: string | null) =>
      `Fotos e links estáticos do posto de carregamento ${id}${operator ? ` (${operator})` : ''}${town ? `, ${town}` : ''}.`,
    choiceTitle: (code: string) => `Tomada ${code}`,
    choiceDesc: (code: string) => `O código EVSE ${code} aparece em mais de um posto.`,
    choiceH1: 'Tomada em mais de um posto',
    choiceText: (code: string, n: number) => `O NAP publica o código ${code} em ${n} postos. Escolhe o certo:`,
    notFound: 'Não encontrado',
    notFoundDesc: 'Página não encontrada.',
    back: 'Voltar ao início',
    noStation: (id: string) => `Não há nenhum posto público com o código ${id}.`,
    noSocket: (code: string) => `Não há nenhuma tomada com o código EVSE ${code}.`,
    badStation: 'Código de posto inválido.',
    badSocket: 'Código EVSE inválido.',
    noPage: 'Esta página não existe.',
    homeTitle: 'pIcŧU/Re · fotos dos postos de carregamento',
    homeDesc: 'Fotos comunitárias de postos e tomadas de carregamento em Portugal, com links estáticos pelo código do posto ou da tomada.',
    homeH1: 'Fotos dos postos de carregamento',
    homeText: 'Fotos comunitárias de postos e tomadas em Portugal, com um link estático por posto e por tomada. Ainda em construção: a pesquisa e o envio de fotos vêm a seguir.',
    homeExample: 'Exemplo:',
    homeExampleLink: 'posto EZC-AMD-00051',
    homeApi: 'API:',
    and: 'e',
  },
  en: {
    other: 'Português',
    footerData: 'Photos CC BY-SA 4.0 · Station data: NAP Portugal (MOBI.E) and © OpenStreetMap contributors (ODbL)',
    footerCode: 'Source code (MIT)',
    ogImageAlt: 'Pic, the pIcŧU/Re mascot',
    inNap: 'In the NAP',
    outNap: 'Not in the NAP',
    sockets: (n: number) => (n === 1 ? '1 socket' : `${n} sockets`),
    noPhotos: 'No photos',
    missingNotice: 'This station no longer appears in the NAP. It stays here with any photos it has, but it may no longer exist.',
    photosHeading: 'Station photos',
    emptyTitle: 'No photos of this station yet',
    emptySoon: 'Photo uploads open soon.',
    hint: 'The community picks the main photo. The static link stays the same when it changes.',
    linksTitle: 'Static links',
    linksIntro: 'For apps, maps and OSM. They return 404 until there is a main photo.',
    size: 'Size',
    stationLabel: 'Station',
    copyStation: 'Copy link: station',
    copySocket: (code: string) => `Copy link: socket ${code}`,
    copied: 'Link copied.',
    copyFailed: 'Couldn’t copy. The link is selected: copy it by hand.',
    socketsTitle: 'Sockets',
    socketsIntro: 'Each socket with an EVSE code has its own link.',
    noPhoto: 'no photo',
    noEvse: 'No EVSE code in the NAP: no socket link',
    socketGone: 'no longer in the NAP',
    unknownPlug: 'Unknown connector',
    osmTitle: 'On OpenStreetMap',
    osmLinked: (el: string) => `Linked to the element ${el}.`,
    osmView: 'View on OpenStreetMap',
    osmNone: 'Not linked to an OpenStreetMap element yet.',
    osmMap: 'Show on map',
    dataTitle: 'Data',
    dataJson: 'As JSON, from the API',
    unknownOperator: 'Unknown operator',
    stationDesc: (id: string, operator: string | null, town: string | null) =>
      `Photos and static links for the charging station ${id}${operator ? ` (${operator})` : ''}${town ? `, ${town}` : ''}.`,
    choiceTitle: (code: string) => `Socket ${code}`,
    choiceDesc: (code: string) => `The EVSE code ${code} appears at more than one station.`,
    choiceH1: 'Socket at more than one station',
    choiceText: (code: string, n: number) => `The NAP lists the code ${code} at ${n} stations. Pick the right one:`,
    notFound: 'Not found',
    notFoundDesc: 'Page not found.',
    back: 'Back to home',
    noStation: (id: string) => `There is no public station with the code ${id}.`,
    noSocket: (code: string) => `There is no socket with the EVSE code ${code}.`,
    badStation: 'Invalid station code.',
    badSocket: 'Invalid EVSE code.',
    noPage: 'This page does not exist.',
    homeTitle: 'pIcŧU/Re · photos of charging stations',
    homeDesc: 'Community photos of EV charging stations and sockets in Portugal, with static links by station or socket code.',
    homeH1: 'Photos of charging stations',
    homeText: 'Community photos of charging stations and sockets in Portugal, with one static link per station and per socket. Still being built: search and photo uploads come next.',
    homeExample: 'Example:',
    homeExampleLink: 'station EZC-AMD-00051',
    homeApi: 'API:',
    and: 'and',
  },
} satisfies Record<Lang, unknown>;

export type Messages = typeof T.pt;
export const messages = (lang: Lang): Messages => T[lang];

const CONNECTORS: Record<Lang, Record<string, string>> = {
  pt: {
    T2: 'Tipo 2',
    CCS: 'CCS',
    CHADEMO: 'CHAdeMO',
    iec60309x2single16: 'CEE 16 A (industrial)',
    domesticF: 'Doméstica (Schuko)',
    domesticG: 'Doméstica tipo G',
  },
  en: {
    T2: 'Type 2',
    CCS: 'CCS',
    CHADEMO: 'CHAdeMO',
    iec60309x2single16: 'CEE 16 A (industrial)',
    domesticF: 'Domestic (Schuko)',
    domesticG: 'Domestic type G',
  },
};

const REGIONS: Record<Lang, Record<string, string>> = {
  pt: { CONT: 'Continente', AZO: 'Açores', MAD: 'Madeira' },
  en: { CONT: 'Mainland Portugal', AZO: 'Azores', MAD: 'Madeira' },
};

const kw = (lang: Lang, v: number | null) =>
  v === null ? null : `${v.toLocaleString(NUMBER_LOCALE[lang], { maximumFractionDigits: 1 })} kW`;

const plug = (lang: Lang, c: string | null) => (c ? CONNECTORS[lang][c] ?? c : T[lang].unknownPlug);

// NAP text on an English page: escaped, and marked as Portuguese.
const nap = (lang: Lang, v: string) => (lang === 'pt' ? esc(v) : `<span lang="pt-PT">${esc(v)}</span>`);

// OSM elements as the import stores them (node/123). Anything else is not linked.
const OSM_ELEMENT = /^(node|way|relation)\/\d+$/;

const ICON_CAMERA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="6" width="18" height="14" rx="2"/><circle cx="12" cy="13" r="3.5"/><path d="M8 6l1.5-2h5L16 6"/></svg>';
const ICON_COPY = '<svg class="idle" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 012-2h10"/></svg>';
// Shown after a copy, so success is a shape change and not only a colour change.
const ICON_CHECK = '<svg class="done" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

interface Layout {
  lang: Lang;
  title: string;
  description: string;
  // Path of this page when it should be indexed: gives the canonical and og:url.
  path?: string;
  // The same page in each language, for hreflang and the language link.
  alternates?: Record<Lang, string>;
  noindex?: boolean;
  body: string;
  script?: boolean;
}

export function layout(p: Layout): string {
  const t = T[p.lang];
  const other: Lang = p.lang === 'pt' ? 'en' : 'pt';
  const otherHref = p.alternates?.[other] ?? homePath(other);
  const head: string[] = [];
  if (p.noindex) head.push('<meta name="robots" content="noindex">');
  if (p.path) head.push(`<link rel="canonical" href="${esc(SITE + p.path)}">`);
  if (p.alternates) {
    for (const l of LANGS) head.push(`<link rel="alternate" hreflang="${HTML_LANG[l]}" href="${esc(SITE + p.alternates[l])}">`);
    head.push(`<link rel="alternate" hreflang="x-default" href="${esc(SITE + p.alternates.pt)}">`);
  }
  head.push(
    '<meta property="og:type" content="website">',
    '<meta property="og:site_name" content="pIcŧU/Re">',
    `<meta property="og:title" content="${esc(p.title)}">`,
    `<meta property="og:description" content="${esc(p.description)}">`,
    `<meta property="og:locale" content="${OG_LOCALE[p.lang]}">`,
    `<meta property="og:locale:alternate" content="${OG_LOCALE[other]}">`,
    `<meta property="og:image" content="${SITE}/icon-512.png">`,
    `<meta property="og:image:alt" content="${esc(t.ogImageAlt)}">`,
    '<meta name="twitter:card" content="summary">',
  );
  if (p.path) head.push(`<meta property="og:url" content="${esc(SITE + p.path)}">`);
  return `<!doctype html>
<html lang="${HTML_LANG[p.lang]}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="text-scale" content="scale">
<title>${esc(p.title)}</title>
<meta name="description" content="${esc(p.description)}">
${head.join('\n')}
<link rel="stylesheet" href="/site.css">
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<meta name="theme-color" content="#F2B33D">
${p.script ? '<script src="/site.js" defer></script>\n' : ''}</head>
<body>
<header class="site-header">
  <div class="wrap">
    <a class="brand" href="${homePath(p.lang)}">
      <img src="/pic-icon.svg" alt="" width="34" height="34">
      <span class="brand-name"><span aria-hidden="true">pIcŧU/Re</span><span class="sr-only" lang="en">picture</span></span>
      <span class="brand-sub">VoltFrame</span>
    </a>
    <a class="lang-switch" href="${esc(otherHref)}" hreflang="${HTML_LANG[other]}" lang="${HTML_LANG[other]}">${t.other}</a>
  </div>
</header>
<main>
<div class="wrap">
${p.body}
</div>
</main>
<footer class="site-footer">
  <div class="wrap">
    <span>${t.footerData}</span>
    <a href="https://github.com/CarregaErvilhas/VoltFrame">${t.footerCode}</a>
  </div>
</footer>
</body>
</html>
`;
}

function copyRow(id: string, base: string, label: string): string {
  return `<div class="copy-row">
          <code id="${esc(id)}" data-base="${esc(base)}">${esc(base)}.jpg</code>
          <button type="button" class="copy" data-target="${esc(id)}" aria-label="${esc(label)}">${ICON_COPY}${ICON_CHECK}</button>
        </div>`;
}

function socketItem(lang: Lang, p: PointRow, i: number): string {
  const t = T[lang];
  const anchor = p.evse_compact ? ` id="t-${esc(p.evse_compact)}"` : '';
  const meta = [plug(lang, p.connector), kw(lang, p.max_kw), p.dc ? 'DC' : 'AC'];
  if (p.status === 'missing_from_nap') meta.push(t.socketGone);
  const code = p.evse_id
    ? `<div class="code mono">${esc(p.evse_id)}</div>`
    : `<div class="code mono">${esc(p.point_id)}</div><div class="meta">${t.noEvse}</div>`;
  const link = p.evse_compact
    ? copyRow(`l-t${i}`, `${PICTURES}/${encodeURIComponent(p.evse_compact)}`, t.copySocket(p.evse_id ?? p.point_id))
    : '';
  return `<li class="socket"${anchor}>
      <div class="thumb" aria-hidden="true">${t.noPhoto}</div>
      <div class="info">
        ${code}
        <div class="meta">${esc(meta.filter(Boolean).join(' · '))}</div>
        ${link}
      </div>
    </li>`;
}

export function stationPage(lang: Lang, s: StationRow, points: PointRow[]): string {
  const t = T[lang];
  const missing = s.status === 'missing_from_nap';
  const place = [s.address, s.municipality].filter(Boolean).join(', ');
  const subtitle = [s.name, place].filter(Boolean).join(' · ');
  const region = s.region ? REGIONS[lang][s.region] ?? s.region : null;
  const operator = s.operator ?? s.opc;
  const osm = s.osm_ref && OSM_ELEMENT.test(s.osm_ref)
    ? `<p>${t.osmLinked(`<code>${esc(s.osm_ref)}</code>`)}</p>
        <a href="https://www.openstreetmap.org/${esc(s.osm_ref)}">${t.osmView}</a>`
    : `<p>${t.osmNone}</p>
        <a href="https://www.openstreetmap.org/?mlat=${s.lat}&amp;mlon=${s.lon}#map=19/${s.lat}/${s.lon}">${t.osmMap}</a>`;
  const operatorData = [s.operator ? nap(lang, s.operator) : null, s.opc ? `(${esc(s.opc)})` : null].filter(Boolean).join(' ');
  const body = `<p class="operator">${operator ? nap(lang, operator) : t.unknownOperator}</p>
<div class="title-row">
  <div>
    <h1>${esc(s.id)}</h1>
    ${subtitle ? `<p class="subtitle">${nap(lang, subtitle)}</p>` : ''}
  </div>
  <div class="chips">
    ${missing ? `<span class="chip warn">${t.outNap}</span>` : `<span class="chip ok">${t.inNap}</span>`}
    <span class="chip">${t.sockets(points.length)}</span>
    <span class="chip">${t.noPhotos}</span>
  </div>
</div>
${missing ? `<p class="notice">${t.missingNotice}</p>\n` : ''}<div class="columns">
  <section class="photos">
    <h2 class="sr-only">${t.photosHeading}</h2>
    <div class="empty-photo">
      ${ICON_CAMERA}
      <strong>${t.emptyTitle}</strong>
      <span>${t.emptySoon}</span>
    </div>
    <p class="hint">${t.hint}</p>
  </section>
  <div class="side">
    <section class="card">
      <h2>${t.linksTitle}</h2>
      <p>${t.linksIntro}</p>
      <div class="sizes" role="group" aria-label="${t.size}">
        <button type="button" data-size="thumb" aria-pressed="false">400 px</button>
        <button type="button" data-size="main" aria-pressed="true">1024 px</button>
        <button type="button" data-size="full" aria-pressed="false">2048 px</button>
      </div>
      <div class="links">
        <div>
          <div class="label">${t.stationLabel}</div>
          ${copyRow('l-s', `${PICTURES}/${encodeURIComponent(s.id)}`, t.copyStation)}
        </div>
      </div>
      <p id="copy-status" class="sr-only" role="status" data-copied="${esc(t.copied)}" data-failed="${esc(t.copyFailed)}"></p>
    </section>
    <section class="card">
      <h2>${t.socketsTitle}</h2>
      <p>${t.socketsIntro}</p>
      <ul class="sockets" role="list">
    ${points.map((p, i) => socketItem(lang, p, i)).join('\n    ')}
      </ul>
    </section>
    <section class="card">
      <h2>${t.osmTitle}</h2>
      ${osm}
    </section>
    <section class="card">
      <h2>${t.dataTitle}</h2>
      <p>${operatorData}${region ? `${operatorData ? ' · ' : ''}${esc(region)}` : ''}</p>
      <a href="/api/v1/stations/${encodeURIComponent(s.id)}">${t.dataJson}</a>
    </section>
  </div>
</div>`;
  return layout({
    lang,
    title: `${s.id}${s.name ? ` · ${s.name}` : ''} · pIcŧU/Re`,
    description: t.stationDesc(s.id, s.operator, s.municipality),
    path: stationPath(lang, s.id),
    alternates: { pt: stationPath('pt', s.id), en: stationPath('en', s.id) },
    body,
    script: true,
  });
}

export function evseChoicePage(lang: Lang, code: string, matches: EvseMatch[]): string {
  const t = T[lang];
  const items = matches.map((m) =>
    `<li><a href="${stationPath(lang, m.station_id)}${socketAnchor(m.evse_compact)}">${esc(m.station_id)}</a>` +
    `${m.name ? ` · ${nap(lang, m.name)}` : ''}${m.operator ? ` · ${nap(lang, m.operator)}` : ''}</li>`).join('\n  ');
  return layout({
    lang,
    title: `${t.choiceTitle(code)} · pIcŧU/Re`,
    description: t.choiceDesc(code),
    // A list of links to the real pages: no use in a search index.
    noindex: true,
    alternates: { pt: socketPath('pt', code), en: socketPath('en', code) },
    body: `<div class="page-msg">
<h1>${t.choiceH1}</h1>
<p>${t.choiceText(`<code>${esc(code)}</code>`, matches.length)}</p>
<ul class="plain-list">
  ${items}
</ul>
</div>`,
  });
}

export function notFoundPage(lang: Lang, what: string): string {
  const t = T[lang];
  return layout({
    lang,
    title: `${t.notFound} · pIcŧU/Re`,
    description: t.notFoundDesc,
    body: `<div class="page-msg">
<h1>${t.notFound}</h1>
<p>${esc(what)}</p>
<p><a href="${homePath(lang)}">${t.back}</a></p>
</div>`,
  });
}

export function homePage(lang: Lang): string {
  const t = T[lang];
  return layout({
    lang,
    title: t.homeTitle,
    description: t.homeDesc,
    path: homePath(lang),
    alternates: { pt: homePath('pt'), en: homePath('en') },
    body: `<div class="page-msg">
<h1>${t.homeH1}</h1>
<p>${t.homeText}</p>
<p>${t.homeExample} <a href="${stationPath(lang, 'EZC-AMD-00051')}">${t.homeExampleLink}</a>.</p>
<p>${t.homeApi} <code>/api/v1/stations/{id}</code> ${t.and} <code>/api/v1/evses/{evse}</code>.</p>
</div>`,
  });
}
