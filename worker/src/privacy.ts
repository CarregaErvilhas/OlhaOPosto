// The privacy policy, in European Portuguese and English. Fixed text, no
// database strings, so it is plain markup. Keep it true to the code: when the
// Worker starts keeping something new (photos, GPS, API tokens), this page
// changes in the same PR, before it goes live.
// pages.ts never imports this file (its footer uses privacyPath from there),
// so there is no import cycle.
import { accountPath, homePath, layout, privacyPath, type Lang } from './pages.ts';

const CONTACT = 'info@ocarroeletrico.com';
const mail = `<a href="mailto:${CONTACT}">${CONTACT}</a>`;
const LINKS = {
  osmf: 'https://osmfoundation.org/wiki/Privacy_Policy',
  cfPrivacy: 'https://www.cloudflare.com/privacypolicy/',
  cfDpa: 'https://www.cloudflare.com/cloudflare-customer-dpa/',
  cnpd: 'https://www.cnpd.pt/',
  history: 'https://github.com/CarregaErvilhas/VoltFrame/commits/main/worker/src/privacy.ts',
};

export const PRIVACY: Record<Lang, { title: string; description: string; body: string }> = {
  pt: {
    title: 'Privacidade · pIcŧU/Re',
    description: 'Que dados o pIcŧU/Re (VoltFrame) trata, porquê, durante quanto tempo e como pedir que os apaguemos.',
    body: `<h1>Privacidade</h1>
<p>O pIcŧU/Re (VoltFrame) mostra fotos e dados dos postos de carregamento em Portugal. Para ver o site não precisas de conta. Não há anúncios, análise de tráfego nem nada de terceiros nas páginas.</p>
<p><strong>Responsável:</strong> O Carro Elétrico / Fernando Miguel, ${mail}.</p>

<h2>Ao visitar o site</h2>
<p>O site é servido pela Cloudflare. Cada pedido fica num registo técnico com o teu endereço IP, o que a Cloudflare deduz dele (por exemplo, país, região, cidade, código postal aproximado e operador de rede), o navegador, a hora e a página pedida, incluindo o texto de uma pesquisa. Os <i>cookies</i> não ficam no registo.</p>
<p>Usamos estes registos só para encontrar erros e abusos (interesse legítimo, artigo 6.º, n.º 1, alínea f) do RGPD). Apagam-se sozinhos ao fim de 7 dias, no máximo.</p>
<p>Para ver o site não guardamos nada no teu navegador: sem <i>cookies</i> e, no armazenamento local, só o tema, se escolheres um no seletor (claro ou escuro). Fica no teu navegador e não nos é enviado. As fontes, os estilos e os <i>scripts</i> vêm deste site; as fotos vêm de <code>pictures.ocarroeletrico.com</code>, que também é nosso.</p>

<h2>Ao iniciar sessão</h2>
<p>A conta é a do OpenStreetMap. No OpenStreetMap autorizas o pIcŧU/Re a ler as preferências da conta, e recebemos só o número e o nome da conta. Não recebemos o teu email nem a tua palavra-passe, e não podemos editar o mapa em teu nome. Essa autorização serve uma vez e é revogada logo a seguir.</p>
<p>Guardamos o número e o nome da conta no OpenStreetMap (o nome atualiza-se em cada início de sessão), o teu papel no site (por exemplo, contribuidor) e as datas de criação da conta e do último início de sessão.</p>
<p>Usamos dois <i>cookies</i>, ambos necessários para iniciar sessão, por isso não pedimos consentimento:</p>
<ul>
<li><code>__Host-vf_oauth</code>: dura 10 minutos, enquanto passas pelo OpenStreetMap;</li>
<li><code>__Host-vf_session</code>: mantém a sessão durante 30 dias, ou até a terminares. Na nossa base de dados fica só uma impressão digital (<i>hash</i>) dele, que não serve para abrir a sessão.</li>
</ul>
<p>O fundamento é prestar o serviço que pedes ao criar a conta (artigo 6.º, n.º 1, alínea b) do RGPD). Os dados ficam enquanto tiveres conta. Por agora, para apagar a conta, escreve para ${mail}.</p>
<p>Ao iniciar sessão passas pelo site do OpenStreetMap, que trata os teus dados segundo a <a href="${LINKS.osmf}">política de privacidade da OpenStreetMap Foundation</a>.</p>

<h2>Envio de fotos</h2>
<p>Ainda não está aberto. Antes de abrir, esta página passa a explicar o que acontece às fotos: desfocagem de caras e matrículas, localização, licença e remoção.</p>

<h2>Onde ficam os dados</h2>
<p>A Cloudflare, Inc. trata os dados por nossa conta: alojamento, base de dados e registos técnicos. A base de dados fica na União Europeia. A Cloudflare é uma empresa dos Estados Unidos: os pedidos passam pelo centro de dados dela mais próximo de ti, e os registos técnicos podem ficar fora da União Europeia, com as garantias do <a href="${LINKS.cfDpa}">acordo de tratamento de dados da Cloudflare</a>. Ver também a <a href="${LINKS.cfPrivacy}">política de privacidade da Cloudflare</a>.</p>
<p>Não vendemos dados, não fazemos publicidade nem perfis, e não tomamos decisões automáticas sobre ti.</p>

<h2>Os teus direitos</h2>
<p>Podes pedir acesso, retificação, apagamento, limitação ou portabilidade dos teus dados, ou opor-te aos registos técnicos, escrevendo para ${mail}. Respondemos no prazo de um mês. Também podes apresentar queixa à <a href="${LINKS.cnpd}">CNPD</a>.</p>

<h2>Dados dos postos</h2>
<p>Os dados dos postos vêm de fontes públicas (NAP Portugal/MOBI.E e OpenStreetMap) e descrevem equipamentos e operadores, não pessoas. Se encontrares aqui um dado pessoal que não devia estar, escreve-nos e retiramo-lo.</p>

<h2>Alterações</h2>
<p>Quando esta política mudar, a versão nova fica nesta página. As versões anteriores estão no <a href="${LINKS.history}">histórico do código</a>.</p>
<p><a href="${accountPath('pt')}">Conta</a> · <a href="${homePath('pt')}">Início</a></p>`,
  },
  en: {
    title: 'Privacy · pIcŧU/Re',
    description: 'What data pIcŧU/Re (VoltFrame) handles, why, for how long, and how to ask us to delete it.',
    body: `<h1>Privacy</h1>
<p>pIcŧU/Re (VoltFrame) shows photos and data about EV charging stations in Portugal. You do not need an account to use the site. There are no ads, no analytics and nothing from third parties on the pages.</p>
<p><strong>Controller:</strong> O Carro Elétrico / Fernando Miguel, ${mail}.</p>

<h2>When you visit the site</h2>
<p>The site is served by Cloudflare. Each request is kept in a technical log with your IP address, what Cloudflare derives from it (for example, country, region, city, approximate postcode and network operator), your browser, the time and the page requested, including the text of a search. Cookies are not kept in the log.</p>
<p>We use these logs only to find errors and abuse (legitimate interest, GDPR Article 6(1)(f)). They are deleted automatically after 7 days at most.</p>
<p>To browse the site we store nothing in your browser: no cookies, and in local storage only the theme, if you pick one in the picker (light or dark). It stays in your browser and is never sent to us. Fonts, styles and scripts come from this site; photos come from <code>pictures.ocarroeletrico.com</code>, which is also ours.</p>

<h2>When you sign in</h2>
<p>The account is your OpenStreetMap account. On OpenStreetMap you allow pIcŧU/Re to read your account preferences, and we receive only the account number and name. We do not receive your email or your password, and we cannot edit the map on your behalf. That permission is used once and revoked straight away.</p>
<p>We keep your OpenStreetMap account number and name (the name is refreshed at each sign-in), your role on the site (for example, contributor) and the dates the account was created and last signed in.</p>
<p>We use two cookies, both needed to sign in, so we do not ask for consent:</p>
<ul>
<li><code>__Host-vf_oauth</code>: lasts 10 minutes, while you go through OpenStreetMap;</li>
<li><code>__Host-vf_session</code>: keeps you signed in for 30 days, or until you sign out. Our database keeps only a fingerprint (hash) of it, which cannot be used to sign in.</li>
</ul>
<p>The legal basis is providing the service you ask for when you create the account (GDPR Article 6(1)(b)). The data is kept while you have an account. For now, to delete your account, write to ${mail}.</p>
<p>Signing in takes you through the OpenStreetMap site, which handles your data under the <a href="${LINKS.osmf}">OpenStreetMap Foundation privacy policy</a>.</p>

<h2>Photo uploads</h2>
<p>Not open yet. Before they open, this page will explain what happens to photos: blurring of faces and number plates, location, licence and removal.</p>

<h2>Where the data lives</h2>
<p>Cloudflare, Inc. processes the data on our behalf: hosting, database and technical logs. The database is in the European Union. Cloudflare is a United States company: requests go through its data centre nearest to you, and technical logs may be kept outside the European Union, under the safeguards of the <a href="${LINKS.cfDpa}">Cloudflare data processing agreement</a>. See also the <a href="${LINKS.cfPrivacy}">Cloudflare privacy policy</a>.</p>
<p>We do not sell data, show ads or build profiles, and we make no automated decisions about you.</p>

<h2>Your rights</h2>
<p>You can ask for access, rectification, erasure, restriction or portability of your data, or object to the technical logs, by writing to ${mail}. We reply within one month. You can also complain to the Portuguese data protection authority, the <a href="${LINKS.cnpd}" hreflang="pt-PT">CNPD</a>.</p>

<h2>Station data</h2>
<p>Station data comes from public sources (NAP Portugal/MOBI.E and OpenStreetMap) and describes equipment and operators, not people. If you find personal data here that should not be, write to us and we will remove it.</p>

<h2>Changes</h2>
<p>When this policy changes, the new version is on this page. Earlier versions are in the <a href="${LINKS.history}">code history</a>.</p>
<p><a href="${accountPath('en')}">Account</a> · <a href="${homePath('en')}">Home</a></p>`,
  },
};

export function privacyPage(lang: Lang): string {
  const p = PRIVACY[lang];
  return layout({
    lang,
    title: p.title,
    description: p.description,
    path: privacyPath(lang),
    alternates: { pt: privacyPath('pt'), en: privacyPath('en') },
    body: `<div class="page-msg prose">\n${p.body}\n</div>`,
  });
}
