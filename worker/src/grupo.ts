// The group page (/grupo, /en/group): the other sites of the O Carro Elétrico
// group, each one's mascot beside a speech bubble. Every site of the group has
// this page in its own style, with the same order and the same texts: O Carro
// Elétrico's GRUPO (scripts/oce.py and site/strings.json there) is the
// reference, so a change starts there. The mascots in public/grupo/ are each
// site's own art (pano.svg is the Panoramax logo), outside this repo's licence.
// pages.ts never imports this file (its footer uses groupPath from there), so
// there is no import cycle.
import { BRAND, esc, groupPath, homePath, layout, PANORAMAX_URL, SITE, type Lang } from './pages.ts';

const GH = 'https://github.com/CarregaErvilhas/';

type Mate = {
  id: Id;
  // The viewBox size of public/grupo/<id>.svg, so the page does not jump while the images load.
  w: number;
  h: number;
  site?: string;
  repo: string;
  here?: boolean;
  private?: boolean;
};
type Id = 'carro' | 'ohmigo' | 'voltaria' | 'ceme' | 'nap' | 'oop' | 'pano' | 'ampere';

// AmpereArchive has no page to visit and its repo is private for now.
export const GROUP: readonly Mate[] = [
  { id: 'carro', w: 270, h: 300, site: 'https://ocarroeletrico.com/', repo: GH + 'OCarroEletrico' },
  { id: 'ohmigo', w: 260, h: 300, site: 'https://ohmigo.ocarroeletrico.com/', repo: GH + 'ohmigo-mcp' },
  { id: 'voltaria', w: 260, h: 300, site: 'https://voltaria.ocarroeletrico.com/', repo: GH + 'voltaria' },
  { id: 'ceme', w: 260, h: 300, site: 'https://ceme.ocarroeletrico.com/', repo: GH + 'CEME' },
  { id: 'nap', w: 212, h: 252, site: 'https://nap.ocarroeletrico.com/', repo: GH + 'nap-dashboard' },
  { id: 'oop', w: 168, h: 168, here: true, repo: GH + 'OlhaOPosto' },
  { id: 'pano', w: 1297, h: 1297, site: `${PANORAMAX_URL}/`, repo: GH + 'OlhaOPosto/tree/main/panoramax' },
  { id: 'ampere', w: 280, h: 300, repo: GH + 'AmpereArchive', private: true },
];

type SiteText = { name: string; host: string; desc: string; mascot: string; note?: string };

const T: Record<Lang, {
  title: string; description: string; eyebrow: string; h1: string; lead: string; bubble: string; bubbleAlt: string;
  open: string; here: string; code: string; private: string; sites: Record<Id, SiteText>;
}> = {
  pt: {
    title: `Os sites do grupo · ${BRAND}`,
    description: "O Carro Elétrico, o ohmigo, o Voltaria, o Comparador CEME, o Postos PT, o olh'o'posto, o Panoramax e o AmpereArchive: o que faz cada um e onde está o código.",
    eyebrow: 'O grupo',
    h1: 'Eu tiro as fotos. O resto fica com os vizinhos.',
    lead: 'Como é o posto, isso mostro eu. Quanto custa carregar, se está livre agora ou o que diz a lei já são perguntas de outros sites, feitos pela mesma comunidade. O código de todos está no GitHub.',
    bubble: 'Tirei uma foto de grupo.',
    bubbleAlt: `O Pic, a mascote do ${BRAND}`,
    open: 'Abrir o site',
    here: 'Estás aqui',
    code: 'Código no GitHub',
    private: 'GitHub (privado, por agora)',
    sites: {
    carro: { name: "O Carro Elétrico", host: "ocarroeletrico.com", desc: "A mobilidade elétrica em Portugal explicada a quem conduz: carregar em casa e na rua, condomínio, instalação, apoios e impostos. Cada facto com a lei e a fonte.", mascot: "O carrinho repórter d'O Carro Elétrico, cor de laranja, com chapéu de imprensa e microfone" },
    ohmigo: { name: "ohmigo", host: "ohmigo.ocarroeletrico.com", desc: "Pergunta ao ChatGPT ou ao Claude quanto custa carregar e onde fica mais barato. O ohmigo conhece os preços de todos os postos públicos do país, dentro e fora da rede MOBI.E.", mascot: "O ohmi, a ficha verde com cara do ohmigo" },
    voltaria: { name: "Voltaria", host: "voltaria.ocarroeletrico.com", desc: "O conhecimento por trás dos outros: a lei, as normas e as regras da mobilidade elétrica em Portugal, escritas para assistentes de IA. Cada facto com a sua fonte.", mascot: "O livro azul do Voltaria, com um raio na capa" },
    ceme: { name: "Comparador CEME", host: "ceme.ocarroeletrico.com", desc: "Compara os tarifários de quem te vende a energia na rede MOBI.E. Faz as contas com as tarifas de acesso às redes, o preço do mercado ibérico e os impostos, à hora a que carregas.", mascot: "A mascote do Comparador CEME, uma calculadora cor-de-rosa com um raio no ecrã" },
    nap: { name: "Postos PT", host: "nap.ocarroeletrico.com", desc: "Todos os postos públicos que o Ponto de Acesso Nacional publica. Procura perto de ti, vê o estado ao vivo, as estatísticas da rede e os erros nos dados.", mascot: "O pino de mapa azul do Postos PT, com cara e um raio" },
    oop: { name: "olh'o'posto", host: "olhaoposto.ocarroeletrico.com", desc: "Fotos dos postos e das tomadas, tiradas pela comunidade. Cada posto tem um link que nunca muda, pelo ID oficial, para qualquer app ou mapa mostrar como é o posto antes de lá chegares.", mascot: "O Pic, a ficha Type 2 cor de âmbar do olh'o'posto, com uma objetiva e um flash" },
    pano: { name: "Panoramax", host: "panoramax.ocarroeletrico.com", desc: "Onde ficam guardadas as fotos do olh'o'posto, com o mapa e o visualizador. É um servidor Panoramax, o software livre de fotos de rua que o OpenStreetMap usa, montado só para postos de carregamento.", mascot: "O logótipo do Panoramax" },
    ampere: { name: "AmpereArchive", host: "ohm-age.ocarroeletrico.com", desc: "Guarda a história dos postos. Lê o NAP a cada minuto e arquiva o que mudou, porque o NAP só mostra o presente. É daqui que o ohmigo tira o estado ao vivo e o Postos PT o histórico.", mascot: "A caixa de arquivo roxa do AmpereArchive, de óculos e com um cronómetro", note: "Não tem página para visitar: é um arquivo de dados que os outros leem." },
    },
  },
  en: {
    title: `The group's sites · ${BRAND}`,
    description: "O Carro Elétrico, ohmigo, Voltaria, the CEME comparator, Postos PT, olh'o'posto, Panoramax and AmpereArchive: what each one does and where the code is.",
    eyebrow: 'The group',
    h1: 'I take the pictures. The rest is up to the neighbours.',
    lead: "What a charger looks like, that's my job. What a charge costs, whether it's free right now or what the law says are questions for other sites, made by the same community. All their code is on GitHub.",
    bubble: 'I took a group photo.',
    bubbleAlt: `Pic, the ${BRAND} mascot`,
    open: 'Open the site',
    here: 'You are here',
    code: 'Code on GitHub',
    private: 'GitHub (private, for now)',
    sites: {
    carro: { name: "O Carro Elétrico", host: "ocarroeletrico.com", desc: "Electric mobility in Portugal explained for drivers: charging at home and on the road, condos, installation, grants and tax. Every fact with the law and its source.", mascot: "O Carro Elétrico's little reporter car, orange, with a press hat and a microphone" },
    ohmigo: { name: "ohmigo", host: "ohmigo.ocarroeletrico.com", desc: "Ask ChatGPT or Claude what a charge costs and where it's cheapest. ohmigo knows the prices of every public charger in the country, on the MOBI.E network and off it.", mascot: "Ohmi, ohmigo's green plug with a face" },
    voltaria: { name: "Voltaria", host: "voltaria.ocarroeletrico.com", desc: "The knowledge behind the others: the law, the standards and the rules of electric mobility in Portugal, written for AI assistants. Every fact with its source.", mascot: "Voltaria's blue book, with a lightning bolt on the cover" },
    ceme: { name: "CEME comparator", host: "ceme.ocarroeletrico.com", desc: "Compares the tariffs of whoever sells you the energy on the MOBI.E network. It does the maths with the grid access tariffs, the Iberian market price and the taxes, at the hour you charge.", mascot: "The CEME comparator's mascot, a pink calculator with a lightning bolt on its screen" },
    nap: { name: "Postos PT", host: "nap.ocarroeletrico.com", desc: "Every public charger the National Access Point publishes. Search near you, see the live status, the network's statistics and the errors in the data.", mascot: "Postos PT's blue map pin, with a face and a lightning bolt" },
    oop: { name: "olh'o'posto", host: "olhaoposto.ocarroeletrico.com", desc: "Photos of chargers and their sockets, taken by the community. Every charger has a link that never changes, by its official ID, so any app or map can show what it looks like before you get there.", mascot: "Pic, olh'o'posto's amber Type 2 plug, with a lens and a flash" },
    pano: { name: "Panoramax", host: "panoramax.ocarroeletrico.com", desc: "Where olh'o'posto's photos are stored, with the map and the viewer. It's a Panoramax server, the free street-photo software OpenStreetMap uses, set up for charging stations only.", mascot: "The Panoramax logo" },
    ampere: { name: "AmpereArchive", host: "ohm-age.ocarroeletrico.com", desc: "Keeps the chargers' history. It reads the NAP every minute and archives what changed, because the NAP only shows the present. ohmigo gets its live status from here, and Postos PT its history.", mascot: "AmpereArchive's purple archive box, with glasses and a stopwatch", note: "There's no page to visit: it's a data archive the others read." },
    },
  },
};

// Inline icons, as on the other sites of the group: code (</>) and a padlock.
const ICON_CODE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 7 3 12l5 5M16 7l5 5-5 5M14 4l-4 16"/></svg>';
const ICON_LOCK = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/></svg>';

function mate(lang: Lang, g: Mate): string {
  const t = T[lang];
  const s = t.sites[g.id];
  const go = g.here
    ? `<span class="here">${t.here}</span>`
    : g.site
      ? `<a class="button" href="${esc(g.site)}" target="_blank" rel="noopener">${t.open}&nbsp;<span aria-hidden="true">→</span></a>`
      : '';
  const code = `<a class="button secondary" href="${esc(g.repo)}" target="_blank" rel="noopener">${g.private ? ICON_LOCK : ICON_CODE}${g.private ? t.private : t.code}</a>`;
  return `<li class="mate m-${g.id}">
  <div class="mate-pic"><img src="/grupo/${g.id}.svg" alt="${esc(s.mascot)}" width="${g.w}" height="${g.h}" loading="lazy"></div>
  <div class="mate-bubble">
    <p class="mate-host">${esc(s.host)}</p>
    <h2>${esc(s.name)}</h2>
    <p>${esc(s.desc)}</p>${s.note ? `\n    <p class="mate-note">${esc(s.note)}</p>` : ''}
    <p class="mate-links">${go}${code}</p>
  </div>
</li>`;
}

export function groupPage(lang: Lang): string {
  const t = T[lang];
  const jsonld = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: t.title,
    url: SITE + groupPath(lang),
    inLanguage: lang === 'pt' ? 'pt-PT' : 'en',
    hasPart: GROUP.filter((g) => g.site || g.here).map((g) => ({
      '@type': 'WebSite', name: t.sites[g.id].name, url: g.site ?? `${SITE}/`,
    })),
  };
  return layout({
    lang,
    title: t.title,
    description: t.description,
    path: groupPath(lang),
    alternates: { pt: groupPath('pt'), en: groupPath('en') },
    // < escaped so no string can close the script element.
    jsonld: JSON.stringify(jsonld).replace(/</g, '\\u003c'),
    body: `<section class="group-hero">
<div class="group-hero-text">
<p class="eyebrow">${t.eyebrow}</p>
<h1>${t.h1}</h1>
<p class="lead">${t.lead}</p>
</div>
<div class="group-stage">
<img src="/grupo/oop.svg" alt="${esc(t.bubbleAlt)}" width="168" height="168">
<p class="group-bubble">${t.bubble}</p>
</div>
</section>
<ol class="mates">
${GROUP.map((g) => mate(lang, g)).join('\n')}
</ol>
<p class="group-back"><a href="${homePath(lang)}">${lang === 'pt' ? 'Voltar ao início' : 'Back to the home page'}</a></p>`,
  });
}
