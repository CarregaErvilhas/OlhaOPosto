// The group page (/grupo, /en/group): the other sites of the O Carro Elétrico
// group, each one's mascot beside a speech bubble. Every site of the group has
// this page in its own style. The order, the site texts and the shared labels
// come from brand/group.json (the CarregaErvilhas/Brand submodule), so a change
// to them starts there; this page's own title, lead and bubble are below. The
// mascots are copied from the submodule into public/grupo/ (scripts/brand.ts);
// each is its own site's art (pano.svg is the Panoramax logo), outside this
// repo's licence. pages.ts never imports this file (its footer uses groupPath
// from there), so there is no import cycle.
import group from '../../brand/group.json' with { type: 'json' };
import { BRAND, esc, groupPath, homePath, layout, SITE, type Lang } from './pages.ts';

export const GROUP = group.sites.map((s) => ({
  ...s,
  here: s.id === 'oop',
  site: s.id === 'oop' ? null : s.url,
}));
type Mate = (typeof GROUP)[number];

const T: Record<Lang, {
  title: string; description: string; eyebrow: string; h1: string; lead: string; bubble: string; bubbleAlt: string;
}> = {
  pt: {
    title: `Os sites do grupo · ${BRAND}`,
    description: "O Carro Elétrico, o ohmigo, o Voltaria, o Comparador CEME, o Postos PT, o olh'o'posto, o Panoramax e o AmpereArchive: o que faz cada um e onde está o código.",
    eyebrow: 'O grupo',
    h1: 'Eu tiro as fotos. O resto fica com os vizinhos.',
    lead: 'Como é o posto, isso mostro eu. Quanto custa carregar, se está livre agora ou o que diz a lei já são perguntas de outros sites, feitos pela mesma comunidade. O código de todos está no GitHub.',
    bubble: 'Tirei uma foto de grupo.',
    bubbleAlt: `O Pic, a mascote do ${BRAND}`,
  },
  en: {
    title: `The group's sites · ${BRAND}`,
    description: "O Carro Elétrico, ohmigo, Voltaria, the CEME comparator, Postos PT, olh'o'posto, Panoramax and AmpereArchive: what each one does and where the code is.",
    eyebrow: 'The group',
    h1: 'I take the pictures. The rest is up to the neighbours.',
    lead: "What a charger looks like, that's my job. What a charge costs, whether it's free right now or what the law says are questions for other sites, made by the same community. All their code is on GitHub.",
    bubble: 'I took a group photo.',
    bubbleAlt: `Pic, the ${BRAND} mascot`,
  },
};

// Inline icons, as on the other sites of the group: code (</>) and a padlock.
const ICON_CODE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 7 3 12l5 5M16 7l5 5-5 5M14 4l-4 16"/></svg>';
const ICON_LOCK = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/></svg>';

function mate(lang: Lang, g: Mate): string {
  const note = 'note' in g ? g.note?.[lang] : undefined;
  const go = g.here
    ? `<span class="here">${group.labels.here[lang]}</span>`
    : g.site
      ? `<a class="button" href="${esc(g.site)}" target="_blank" rel="noopener">${group.labels.open[lang]}&nbsp;<span aria-hidden="true">→</span></a>`
      : '';
  const code = `<a class="button secondary" href="${esc(g.repo)}" target="_blank" rel="noopener">${g.private ? ICON_LOCK : ICON_CODE}${group.labels[g.private ? 'private' : 'code'][lang]}</a>`;
  return `<li class="mate m-${g.id}">
  <div class="mate-pic"><img src="/${g.mascot.file}" alt="${esc(g.mascot.alt[lang])}" width="${g.mascot.width}" height="${g.mascot.height}" loading="lazy"></div>
  <div class="mate-bubble">
    <p class="mate-host">${esc(g.host)}</p>
    <h2>${esc(g.name[lang])}</h2>
    <p>${esc(g.desc[lang])}</p>${note ? `\n    <p class="mate-note">${esc(note)}</p>` : ''}
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
      '@type': 'WebSite', name: g.name[lang], url: g.site ?? `${SITE}/`,
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
