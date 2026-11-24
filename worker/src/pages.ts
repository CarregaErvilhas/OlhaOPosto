// Server-rendered HTML pages. Pure functions of the rows (no Env), so they can
// be tested under Node. Every string from the database is third-party text
// (NAP names, addresses, operators): it only reaches the markup through esc().
import type { EvseMatch, PointRow, StationRow } from './types.ts';

export const SITE = 'https://voltframe.ocarroeletrico.com';
export const PICTURES = 'https://pictures.ocarroeletrico.com';

export function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const CONNECTORS: Record<string, string> = {
  T2: 'Tipo 2',
  CCS: 'CCS',
  CHADEMO: 'CHAdeMO',
  iec60309x2single16: 'CEE 16 A (industrial)',
  domesticF: 'Doméstica (Schuko)',
  domesticG: 'Doméstica tipo G',
};

const REGIONS: Record<string, string> = { CONT: 'Continente', AZO: 'Açores', MAD: 'Madeira' };

const kw = (v: number | null) =>
  v === null ? null : `${v.toLocaleString('pt-PT', { maximumFractionDigits: 1 })} kW`;

const plug = (c: string | null) => (c ? CONNECTORS[c] ?? c : 'Ficha desconhecida');

// OSM elements as the import stores them (node/123). Anything else is not linked.
const OSM_ELEMENT = /^(node|way|relation)\/\d+$/;

const ICON_CAMERA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="6" width="18" height="14" rx="2"/><circle cx="12" cy="13" r="3.5"/><path d="M8 6l1.5-2h5L16 6"/></svg>';
const ICON_COPY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 012-2h10"/></svg>';

interface Layout {
  title: string;
  description: string;
  canonical?: string;
  body: string;
  script?: boolean;
}

export function layout(p: Layout): string {
  return `<!doctype html>
<html lang="pt-PT">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(p.title)}</title>
<meta name="description" content="${esc(p.description)}">
${p.canonical ? `<link rel="canonical" href="${esc(p.canonical)}">\n` : ''}<link rel="stylesheet" href="/site.css">
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<meta name="theme-color" content="#F2B33D">
${p.script ? '<script src="/site.js" defer></script>\n' : ''}</head>
<body>
<header class="site-header">
  <div class="wrap">
    <a class="brand" href="/">
      <img src="/pic-icon.svg" alt="" width="34" height="34">
      <span class="brand-name"><span aria-hidden="true">pIcŧU/Re</span><span class="sr-only">picture</span></span>
      <span class="brand-sub">VoltFrame</span>
    </a>
  </div>
</header>
<main>
<div class="wrap">
${p.body}
</div>
</main>
<footer class="site-footer">
  <div class="wrap">
    <span>Fotos CC BY-SA 4.0 · Dados dos postos: NAP Portugal (MOBI.E) e © contribuidores do OpenStreetMap (ODbL)</span>
    <a href="https://github.com/CarregaErvilhas/VoltFrame">Código (MIT)</a>
  </div>
</footer>
</body>
</html>
`;
}

function copyRow(id: string, base: string, label: string): string {
  return `<div class="copy-row">
          <code id="${esc(id)}" data-base="${esc(base)}">${esc(base)}.jpg</code>
          <button type="button" class="copy" data-target="${esc(id)}" aria-label="Copiar link: ${esc(label)}">${ICON_COPY}</button>
        </div>`;
}

function socketItem(p: PointRow, i: number): string {
  const anchor = p.evse_compact ? ` id="t-${esc(p.evse_compact)}"` : '';
  const meta = [plug(p.connector), kw(p.max_kw), p.dc ? 'DC' : 'AC'].filter(Boolean).join(' · ');
  const gone = p.status === 'missing_from_nap' ? ' · já não está no NAP' : '';
  const code = p.evse_id
    ? `<div class="code mono">${esc(p.evse_id)}</div>`
    : `<div class="code mono">${esc(p.point_id)}</div><div class="meta">Sem código EVSE no NAP: sem link de tomada</div>`;
  const link = p.evse_compact
    ? copyRow(`l-t${i}`, `${PICTURES}/${encodeURIComponent(p.evse_compact)}`, `tomada ${p.evse_id ?? p.point_id}`)
    : '';
  return `<li class="socket"${anchor}>
      <div class="thumb" aria-hidden="true">sem foto</div>
      <div class="info">
        ${code}
        <div class="meta">${esc(meta)}${gone}</div>
        ${link}
      </div>
    </li>`;
}

export function stationPage(s: StationRow, points: PointRow[]): string {
  const missing = s.status === 'missing_from_nap';
  const place = [s.address, s.municipality].filter(Boolean).join(', ');
  const subtitle = [s.name, place].filter(Boolean).join(' · ');
  const region = s.region ? REGIONS[s.region] ?? s.region : null;
  const n = points.length;
  const osm = s.osm_ref && OSM_ELEMENT.test(s.osm_ref)
    ? `<p>Ligado ao elemento <code>${esc(s.osm_ref)}</code>.</p>
        <a href="https://www.openstreetmap.org/${esc(s.osm_ref)}">Ver no OpenStreetMap</a>`
    : `<p>Ainda não está ligado a um elemento do OpenStreetMap.</p>
        <a href="https://www.openstreetmap.org/?mlat=${s.lat}&amp;mlon=${s.lon}#map=19/${s.lat}/${s.lon}">Ver o sítio no mapa</a>`;
  const body = `<p class="crumbs">Postos › ${esc(s.operator ?? s.opc ?? 'Operador desconhecido')}</p>
<div class="title-row">
  <div>
    <h1>${esc(s.id)}</h1>
    ${subtitle ? `<p class="subtitle">${esc(subtitle)}</p>` : ''}
  </div>
  <div class="chips">
    ${missing ? '<span class="chip warn">Fora do NAP</span>' : '<span class="chip ok">No NAP</span>'}
    <span class="chip">${n === 1 ? '1 tomada' : `${n} tomadas`}</span>
    <span class="chip">Sem fotos</span>
  </div>
</div>
${missing ? '<p class="notice">Este posto deixou de aparecer no NAP. Fica aqui com as fotos que tiver, mas pode já não existir.</p>\n' : ''}<div class="columns">
  <section class="photos" aria-labelledby="fotos">
    <h2 id="fotos" class="sr-only">Fotos do posto</h2>
    <div class="empty-photo">
      ${ICON_CAMERA}
      <strong>Ainda não há fotos deste posto</strong>
      <span>O envio de fotos abre em breve.</span>
    </div>
    <p class="hint">A foto principal é escolhida pela comunidade. O link estático continua o mesmo quando ela muda.</p>
  </section>
  <aside class="side">
    <section class="card" aria-labelledby="links">
      <h2 id="links">Links estáticos</h2>
      <p>Para apps, mapas e o OSM. Devolvem 404 enquanto não houver foto principal.</p>
      <div class="sizes" role="group" aria-label="Tamanho">
        <button type="button" data-size="thumb" aria-pressed="false">400 px</button>
        <button type="button" data-size="main" aria-pressed="true">1024 px</button>
        <button type="button" data-size="full" aria-pressed="false">2048 px</button>
      </div>
      <div class="links">
        <div>
          <div class="label">Posto</div>
          ${copyRow('l-s', `${PICTURES}/${encodeURIComponent(s.id)}`, 'posto')}
        </div>
      </div>
    </section>
    <section class="card" aria-labelledby="tomadas">
      <h2 id="tomadas">Tomadas</h2>
      <p>Cada tomada com código EVSE tem o seu link.</p>
      <ul class="sockets">
    ${points.map(socketItem).join('\n    ')}
      </ul>
    </section>
    <section class="card" aria-labelledby="osm">
      <h2 id="osm">No OpenStreetMap</h2>
      ${osm}
    </section>
    <section class="card" aria-labelledby="dados">
      <h2 id="dados">Dados</h2>
      <p>${esc([s.operator, s.opc ? `(${s.opc})` : null].filter(Boolean).join(' '))}${region ? ` · ${esc(region)}` : ''}</p>
      <a href="/api/v1/stations/${encodeURIComponent(s.id)}">Em JSON, pela API</a>
    </section>
  </aside>
</div>`;
  return layout({
    title: `${s.id}${s.name ? ` · ${s.name}` : ''} · pIcŧU/Re`,
    description: `Fotos e links estáticos do posto de carregamento ${s.id}${s.operator ? ` (${s.operator})` : ''}${s.municipality ? `, ${s.municipality}` : ''}.`,
    canonical: `${SITE}/postos/${encodeURIComponent(s.id)}`,
    body,
    script: true,
  });
}

export function evseChoicePage(code: string, matches: EvseMatch[]): string {
  const items = matches.map((m) =>
    `<li><a href="/postos/${encodeURIComponent(m.station_id)}#t-${encodeURIComponent(m.evse_compact)}">${esc(m.station_id)}</a>` +
    `${m.name ? ` · ${esc(m.name)}` : ''}${m.operator ? ` · ${esc(m.operator)}` : ''}</li>`).join('\n  ');
  return layout({
    title: `Tomada ${code} · pIcŧU/Re`,
    description: `O código EVSE ${code} aparece em mais de um posto.`,
    body: `<div class="page-msg">
<h1>Tomada em mais de um posto</h1>
<p>O NAP publica o código <code>${esc(code)}</code> em ${matches.length} postos. Escolhe o certo:</p>
<ul class="plain-list">
  ${items}
</ul>
</div>`,
  });
}

export function notFoundPage(what: string): string {
  return layout({
    title: 'Não encontrado · pIcŧU/Re',
    description: 'Página não encontrada.',
    body: `<div class="page-msg">
<h1>Não encontrado</h1>
<p>${esc(what)}</p>
<p><a href="/">Voltar ao início</a></p>
</div>`,
  });
}

export function homePage(): string {
  return layout({
    title: 'pIcŧU/Re · fotos dos postos de carregamento',
    description: 'Fotos comunitárias de postos e tomadas de carregamento em Portugal, com links estáticos pelo código do posto ou da tomada.',
    canonical: `${SITE}/`,
    body: `<div class="page-msg">
<h1>Fotos dos postos de carregamento</h1>
<p>Fotos comunitárias de postos e tomadas em Portugal, com um link estático por posto e por tomada. Ainda em construção: a pesquisa e o envio de fotos vêm a seguir.</p>
<p>Exemplo: <a href="/postos/EZC-AMD-00051">posto EZC-AMD-00051</a>.</p>
<p>API: <code>/api/v1/stations/{id}</code> e <code>/api/v1/evses/{evse}</code>.</p>
</div>`,
  });
}
