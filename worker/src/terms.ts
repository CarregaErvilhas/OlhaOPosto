// The terms of use: what someone agrees to when they send a photo, propose a
// station or use an API token. Fixed text, like the privacy policy, and kept
// true to the code: when the rules for uploads, moderation or tokens change,
// this page changes in the same PR. The licence summary lives in
// Docs/licenca.md; the legal text is the licence itself.
// pages.ts never imports this file, so there is no import cycle.
import { BRAND, accountPath, homePath, layout, privacyPath, termsPath, uploadPath, type Lang } from './pages.ts';
import { DEADLINE_H, takedownFormPath } from './takedown.ts';

export { termsPath };

const CONTACT = 'info@ocarroeletrico.com';
const mail = `<a href="mailto:${CONTACT}">${CONTACT}</a>`;
const LINKS = {
  ccbysa: { pt: 'https://creativecommons.org/licenses/by-sa/4.0/deed.pt', en: 'https://creativecommons.org/licenses/by-sa/4.0/deed.en' },
  ccby: { pt: 'https://creativecommons.org/licenses/by/4.0/deed.pt', en: 'https://creativecommons.org/licenses/by/4.0/deed.en' },
  odbl: 'https://opendatacommons.org/licenses/odbl/1-0/',
  history: 'https://github.com/CarregaErvilhas/OlhaOPosto/commits/main/worker/src/terms.ts',
};

export const TERMS: Record<Lang, { title: string; description: string; body: string }> = {
  pt: {
    title: `Condições de utilização · ${BRAND}`,
    description: `O que aceitas ao enviar fotos ou propor postos no ${BRAND}: licença, privacidade, moderação e uso da API.`,
    body: `<h1>Condições de utilização</h1>
<p>Para ver o site e usar a API de leitura não precisas de conta nem de aceitar nada. Estas condições aplicam-se a quem inicia sessão e envia fotos, propõe postos, usa um <i>token</i> de API ou liga um agente pelo MCP. Ao enviar a primeira foto, aceitas estas condições e guardamos a data em que o fizeste.</p>

<h2>As tuas fotos</h2>
<ul>
<li><strong>És o autor.</strong> Só envias fotos que tiraste tu. Não envias fotos de outras pessoas, nem capturas de ecrã, nem imagens tiradas da Internet.</li>
<li><strong>Licença.</strong> Publicas cada foto sob a <a href="${LINKS.ccbysa.pt}">Creative Commons Atribuição-CompartilhaIgual 4.0 (CC BY-SA 4.0)</a>. Qualquer pessoa pode usá-la, também para fins comerciais, desde que te dê crédito e partilhe os derivados sob a mesma licença. A licença não se pode revogar para as cópias que já foram feitas.</li>
<li><strong>Dados tirados das fotos.</strong> Autorizas também que os dados não fotográficos que se tiram das fotos (o tipo de tomada, o operador, a posição de um posto) sejam publicados sob <a href="${LINKS.ccby.pt}">CC BY 4.0</a> ou <a href="${LINKS.odbl}">ODbL</a>, para poderem ir para o OpenStreetMap.</li>
<li><strong>Crédito.</strong> O crédito é o teu nome no OpenStreetMap ou, se o escolheres na tua <a href="${accountPath('pt')}">conta</a>, um pseudónimo («nome a mostrar»). Vai com a foto no Panoramax, nos metadados dos links estáticos, nas páginas dos postos e no ranking. O pseudónimo não pode ser o nome de outra pessoa nem um link, e muda no máximo uma vez por dia. Quando o mudas, atualizamos as tuas fotos no ${BRAND}, no Panoramax e nos links estáticos; as cópias que outras pessoas já fizeram ficam com o nome antigo.</li>
</ul>

<h2>Privacidade de quem aparece</h2>
<ul>
<li>Antes de enviar, desfocas todas as caras e matrículas legíveis. A página de envio ajuda (pode sugerir zonas), mas a confirmação é tua.</li>
<li>Não envias fotos de pessoas a carregar, do interior de casas ou garagens privadas, nem de documentos.</li>
<li>Fotografas o posto, as tomadas e o que ajuda a encontrá-lo (sinalética, o lugar de estacionamento), e mais nada.</li>
</ul>

<h2>O que se pode enviar</h2>
<ul>
<li>Fotos do posto ou da tomada que escolhes, tiradas no local. A página usa o GPS da foto para confirmar o posto; o GPS nunca é publicado (<a href="${privacyPath('pt')}">privacidade</a>).</li>
<li>Postos novos só quando existem mesmo e não estão no site. Um moderador confirma cada proposta.</li>
<li>Não são aceites: publicidade, texto ou marcas de água por cima da foto, fotos repetidas, fotos tremidas ou escuras demais para se perceber o posto.</li>
</ul>

<h2>Moderação</h2>
<ul>
<li>Cada foto de uma conta nova fica escondida até um moderador a aprovar. As contas promovidas à mão a <i>trusted</i> publicam direto quando a foto foi tirada a menos de 300 m de um posto ativo.</li>
<li>Os moderadores podem recusar, ocultar ou apagar qualquer foto, e mudar ou retirar o papel de qualquer conta, sem aviso prévio, quando estas condições não forem cumpridas.</li>
<li>Qualquer pessoa pode pedir a remoção de uma foto no <a href="${takedownFormPath('pt')}">formulário de remoção</a>. A foto fica oculta logo e um moderador decide em ${DEADLINE_H} horas.</li>
<li>Para retirar uma foto tua, escreve para ${mail}.</li>
</ul>

<h2>Pontos e ranking</h2>
<p>As fotos aprovadas dão pontos e entram no <a href="/ranking">ranking</a>. Os pontos servem só para medalhas no site: não dão prémios nem direitos. Podes sair do ranking na tua <a href="${accountPath('pt')}">conta</a>. Pontos ganhos com batota (fotos repetidas, de outro posto ou de outra pessoa) são retirados.</p>

<h2><i>Tokens</i> de API e agentes</h2>
<ul>
<li>Na tua <a href="${accountPath('pt')}">conta</a> podes criar <i>tokens</i> para enviar fotos ou escolher fotos principais por programa. Um <i>token</i> age em teu nome, com o teu papel e os teus limites, e o que se envia com ele segue estas condições.</li>
<li>O <i>token</i> só aparece uma vez. Guarda-o como uma palavra-passe e revoga-o na conta se o perderes.</li>
<li>Fotos enviadas pela API já vêm desfocadas e sem metadados: o programa que usas faz o que a página de envio faria. O servidor recusa fotos com EXIF.</li>
<li>Usa a API com moderação. Os limites de pedidos podem mudar, e um <i>token</i> usado para abusos é revogado.</li>
<li>Um agente de IA que ligues pelo servidor MCP (<code>/mcp</code>) é tratado como um <i>token</i>: age em teu nome, com o teu papel e os teus limites, só pode o que escolheste ao autorizá-lo, e o que envia segue estas condições, como se fosses tu a enviar. Desliga-o na conta quando deixares de o usar.</li>
</ul>

<h2>Sem garantias</h2>
<p>O ${BRAND} é um projeto comunitário e gratuito. Os dados dos postos vêm do NAP Portugal (MOBI.E) e do OpenStreetMap e podem estar errados ou desatualizados. O serviço pode parar, mudar ou perder dados sem aviso. Na medida em que a lei o permite, não respondemos por danos causados pelo uso do site, da API ou das fotos.</p>

<h2>Alterações e contacto</h2>
<p>Quando estas condições mudarem, a versão nova fica nesta página e aplica-se aos envios seguintes. As versões anteriores estão no <a href="${LINKS.history}">histórico do código</a>. Dúvidas: ${mail}. A lei aplicável é a portuguesa.</p>
<p><a href="${uploadPath('pt')}">Enviar fotos</a> · <a href="${privacyPath('pt')}">Privacidade</a> · <a href="${homePath('pt')}">Início</a></p>`,
  },
  en: {
    title: `Terms of use · ${BRAND}`,
    description: `What you agree to when you upload photos or propose stations on ${BRAND}: licence, privacy, moderation and API use.`,
    body: `<h1>Terms of use</h1>
<p>You need no account and agree to nothing to browse the site or use the read-only API. These terms apply to people who sign in and upload photos, propose stations, use an API token or connect an agent through MCP. When you send your first photo, you accept these terms and we keep the date you did.</p>

<h2>Your photos</h2>
<ul>
<li><strong>You are the author.</strong> You only send photos you took yourself. No photos by other people, no screenshots, no images from the Internet.</li>
<li><strong>Licence.</strong> You publish each photo under <a href="${LINKS.ccbysa.en}">Creative Commons Attribution-ShareAlike 4.0 (CC BY-SA 4.0)</a>. Anyone can use it, commercially too, as long as they credit you and share derivatives under the same licence. The licence cannot be revoked for copies already made.</li>
<li><strong>Data taken from the photos.</strong> You also allow the non-photographic data taken from the photos (the socket type, the operator, a station’s position) to be published under <a href="${LINKS.ccby.en}">CC BY 4.0</a> or <a href="${LINKS.odbl}">ODbL</a>, so it can go into OpenStreetMap.</li>
<li><strong>Credit.</strong> The credit is your OpenStreetMap name or, if you choose one on your <a href="${accountPath('en')}">account</a> page, a pseudonym (“display name”). It travels with the photo on Panoramax, in the metadata of the static links, on the station pages and in the ranking. The pseudonym cannot be someone else’s name or a link, and changes at most once a day. When you change it, we update your photos on ${BRAND}, on Panoramax and in the static links; copies other people have already made keep the old name.</li>
</ul>

<h2>Privacy of the people in the picture</h2>
<ul>
<li>Before sending, you blur every readable face and number plate. The upload page helps (it can suggest areas), but confirming is up to you.</li>
<li>You do not send photos of people charging, of the inside of homes or private garages, or of documents.</li>
<li>You photograph the station, the sockets and what helps find it (signs, the parking bay), and nothing else.</li>
</ul>

<h2>What you can send</h2>
<ul>
<li>Photos of the station or socket you pick, taken on site. The page uses the photo’s GPS to check the station; the GPS is never published (<a href="${privacyPath('en')}">privacy</a>).</li>
<li>New stations only when they really exist and are not on the site. A moderator checks every proposal.</li>
<li>Not accepted: advertising, text or watermarks over the photo, repeated photos, photos too blurry or dark to make out the station.</li>
</ul>

<h2>Moderation</h2>
<ul>
<li>Every photo from a new account stays hidden until a moderator approves it. Accounts promoted by hand to <i>trusted</i> publish directly when the photo was taken within 300 m of an active station.</li>
<li>Moderators can reject, hide or delete any photo, and change or withdraw any account’s role, without notice, when these terms are not met.</li>
<li>Anyone can ask for a photo to be taken down with the <a href="${takedownFormPath('en')}">removal form</a>. The photo is hidden straight away and a moderator decides within ${DEADLINE_H} hours.</li>
<li>To take down one of your photos, write to ${mail}.</li>
</ul>

<h2>Points and ranking</h2>
<p>Approved photos earn points and enter the <a href="/en/ranking">ranking</a>. Points are only for medals on the site: they carry no prizes or rights. You can leave the ranking from your <a href="${accountPath('en')}">account</a>. Points earned by cheating (repeated photos, photos of another station or by someone else) are taken away.</p>

<h2>API tokens and agents</h2>
<ul>
<li>On your <a href="${accountPath('en')}">account</a> page you can create tokens to upload photos or choose main photos from a program. A token acts on your behalf, with your role and your limits, and what is sent with it follows these terms.</li>
<li>The token is shown only once. Keep it like a password and revoke it from your account if you lose it.</li>
<li>Photos sent through the API arrive already blurred and without metadata: the program you use does what the upload page would. The server refuses photos with EXIF.</li>
<li>Use the API in moderation. Request limits may change, and a token used for abuse is revoked.</li>
<li>An AI agent you connect through the MCP server (<code>/mcp</code>) is treated like a token: it acts on your behalf, with your role and your limits, can only do what you chose when you authorised it, and what it sends follows these terms as if you sent it. Disconnect it on your account page when you stop using it.</li>
</ul>

<h2>No warranty</h2>
<p>${BRAND} is a free community project. Station data comes from NAP Portugal (MOBI.E) and OpenStreetMap and may be wrong or out of date. The service may stop, change or lose data without notice. As far as the law allows, we are not liable for damage caused by using the site, the API or the photos.</p>

<h2>Changes and contact</h2>
<p>When these terms change, the new version is on this page and applies to later uploads. Earlier versions are in the <a href="${LINKS.history}">code history</a>. Questions: ${mail}. Portuguese law applies.</p>
<p><a href="${uploadPath('en')}">Upload photos</a> · <a href="${privacyPath('en')}">Privacy</a> · <a href="${homePath('en')}">Home</a></p>`,
  },
};

export function termsPage(lang: Lang): string {
  const p = TERMS[lang];
  return layout({
    lang,
    title: p.title,
    description: p.description,
    path: termsPath(lang),
    alternates: { pt: termsPath('pt'), en: termsPath('en') },
    body: `<div class="page-msg prose">\n${p.body}\n</div>`,
  });
}
