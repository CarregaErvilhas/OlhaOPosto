// The upload page. Everything that touches the photo runs in the browser
// (public/upload.js): the original and its EXIF never reach the server. This
// file only renders the form and the messages the script needs. Until uploads
// open (src/photos.ts), the page prepares the photo and stops there.
import { BRAND, accountPath, esc, layout, privacyPath, uploadPath, type AccountView, type Lang } from './pages.ts';

// The URL the photos will get, for the "Link:" line.
const PICTURES_HOST = 'pictures.ocarroeletrico.com';

const T = {
  pt: {
    title: 'Enviar fotos',
    desc: `Enviar fotos de postos de carregamento para o ${BRAND}.`,
    intro: 'A foto é lida, desfocada e limpa no teu dispositivo. O original nunca é enviado.',
    off: 'O envio de fotos ainda não está aberto.',
    login: 'Para enviar fotos, inicia sessão com a tua conta OpenStreetMap.',
    loginButton: 'Iniciar sessão com o OpenStreetMap',
    privacyLink: 'Como tratamos os dados.',
    signedIn: 'Sessão iniciada como',
    account: 'Conta',
    building: 'Ainda em construção: a página prepara a foto, mas o envio ainda não está ligado. Nada sai do teu dispositivo.',
    moderated: 'Cada foto passa pela moderação antes de aparecer.',
    noScript: 'Esta página precisa de JavaScript: a foto é tratada no teu dispositivo, não no servidor.',
    stepPhoto: '1 · Foto',
    photoLabel: 'Escolher a foto',
    photoHint: 'Uma foto JPEG de cada vez. No iPhone, as fotos HEIC passam a JPEG ao escolher.',
    stepStation: '2 · Posto',
    stationsLegend: 'Escolher posto',
    searchLabel: 'Procurar outro posto',
    searchHint: 'Código do posto, localidade, morada ou operador.',
    searchButton: 'Procurar',
    targetsLegend: 'Esta foto mostra',
    link: 'Link:',
    stepBlur: '3 · Privacidade',
    preview: 'Pré-visualização da foto, com as zonas desfocadas',
    draw: 'Desenhar zona',
    add: 'Acrescentar zona',
    blurHint: 'Ainda não há deteção automática: marca tu cada cara e cada matrícula legível. Toca numa zona para a ligar ou desligar. Com o teclado: as setas movem a zona, Shift e setas mudam o tamanho, Delete apaga-a.',
    stepSend: '4 · Enviar',
    checklist: 'Antes de enviar',
    check1: 'Sai da imagem todo o EXIF: GPS, data, câmara e número de série.',
    check2: 'Vão à parte, só para a moderação e nunca publicados: a data e o GPS da foto.',
    check3: 'Tamanhos gerados: 2048, 1024 e 400 px.',
    okPrivacy: 'Confirmo que não há caras nem matrículas legíveis.',
    okLicense: 'Tirei esta foto e publico-a sob CC BY-SA 4.0, com autorização para dados derivados em ODbL.',
    prepare: 'Preparar a foto',
    send: 'Enviar a foto',
    // Read by upload.js; {name} is replaced there.
    js: {
      reading: 'A abrir a foto…',
      notJpeg: 'Não foi possível abrir esta foto. Escolhe um JPEG.',
      tooBig: 'A foto tem mais de 40 MB. Escolhe outra.',
      gps: 'GPS lido da foto e arredondado a cerca de 100 m. Postos num raio de 500 m:',
      noGps: 'A foto não tem GPS. Procura o posto pelo código, localidade ou operador.',
      noneNear: 'Não há postos num raio de 500 m. Procura o posto pelo código, localidade ou operador.',
      searching: 'A procurar…',
      noResults: 'Nenhum posto encontrado.',
      tooShort: 'Escreve pelo menos duas letras ou dois números.',
      failed: 'Não foi possível falar com o servidor. Tenta outra vez.',
      general: 'Posto em geral',
      socket: 'Tomada {evse}',
      noEvse: 'As tomadas deste posto não têm código EVSE no NAP: a foto fica no posto em geral.',
      zone: 'Zona {n}',
      zoneOn: 'desfocada',
      zoneOff: 'desligada',
      zonesNone: 'Sem zonas. Desenha uma por cima de cada cara ou matrícula legível.',
      zonesCount: '{on} de {all} zonas desfocadas',
      drawing: 'Arrasta por cima da cara ou da matrícula.',
      chooseStation: 'Escolhe o posto antes de preparar a foto.',
      preparing: 'A preparar…',
      ready: 'Pronta. O envio ainda não está ligado: nada saiu do teu dispositivo.',
      notClean: 'A foto preparada ainda tinha metadados e foi posta de lado. Tenta outra vez.',
      size: '{px} px: {w} × {h}, {kb} kB',
      download: 'Descarregar a versão de 2048 px',
      resultAlt: 'A foto preparada, em 400 px',
      sending: 'A enviar…',
      sent: 'Enviada. Fica à espera da moderação antes de aparecer.',
      errors: {
        uploads_closed: 'O envio está fechado neste momento.',
        sign_in_required: 'A sessão terminou. Inicia sessão outra vez e volta a enviar.',
        daily_limit: 'Chegaste ao limite de envios de hoje. Tenta amanhã.',
        duplicate: 'Esta foto já foi enviada.',
        bad_target: 'O posto ou a tomada já não está disponível. Escolhe outro.',
        upload_failed: 'Não foi possível guardar a foto. Tenta outra vez daqui a pouco.',
        other: 'A foto não passou na verificação do servidor. Volta a escolhê-la.',
      },
    },
  },
  en: {
    title: 'Upload photos',
    desc: `Upload photos of charging stations to ${BRAND}.`,
    intro: 'The photo is read, blurred and cleaned on your device. The original is never sent.',
    off: 'Photo uploads are not open yet.',
    login: 'To upload photos, sign in with your OpenStreetMap account.',
    loginButton: 'Sign in with OpenStreetMap',
    privacyLink: 'How we handle the data.',
    signedIn: 'Signed in as',
    account: 'Account',
    building: 'Still being built: the page prepares the photo, but sending is not wired up yet. Nothing leaves your device.',
    moderated: 'Every photo is moderated before it appears.',
    noScript: 'This page needs JavaScript: the photo is handled on your device, not on the server.',
    stepPhoto: '1 · Photo',
    photoLabel: 'Choose the photo',
    photoHint: 'One JPEG photo at a time. On an iPhone, HEIC photos become JPEG when you pick them.',
    stepStation: '2 · Station',
    stationsLegend: 'Choose the station',
    searchLabel: 'Find another station',
    searchHint: 'Station code, town, address or operator.',
    searchButton: 'Search',
    targetsLegend: 'This photo shows',
    link: 'Link:',
    stepBlur: '3 · Privacy',
    preview: 'Preview of the photo, with the blurred areas',
    draw: 'Draw an area',
    add: 'Add an area',
    blurHint: 'There is no automatic detection yet: mark every readable face and number plate yourself. Tap an area to turn it on or off. With a keyboard: the arrow keys move the area, Shift and arrows resize it, Delete removes it.',
    stepSend: '4 · Send',
    checklist: 'Before sending',
    check1: 'All EXIF leaves the image: GPS, date, camera and serial number.',
    check2: 'Sent apart, only for moderation and never published: the photo’s date and GPS.',
    check3: 'Sizes made: 2048, 1024 and 400 px.',
    okPrivacy: 'I confirm there are no readable faces or number plates.',
    okLicense: 'I took this photo and publish it under CC BY-SA 4.0, with permission for derived data under ODbL.',
    prepare: 'Prepare the photo',
    send: 'Send the photo',
    js: {
      reading: 'Opening the photo…',
      notJpeg: 'Couldn’t open this photo. Choose a JPEG.',
      tooBig: 'The photo is over 40 MB. Choose another.',
      gps: 'GPS read from the photo and rounded to about 100 m. Stations within 500 m:',
      noGps: 'The photo has no GPS. Find the station by code, town or operator.',
      noneNear: 'No stations within 500 m. Find the station by code, town or operator.',
      searching: 'Searching…',
      noResults: 'No stations found.',
      tooShort: 'Type at least two letters or numbers.',
      failed: 'Couldn’t reach the server. Try again.',
      general: 'The station in general',
      socket: 'Socket {evse}',
      noEvse: 'This station’s sockets have no EVSE code in the NAP: the photo goes on the station in general.',
      zone: 'Area {n}',
      zoneOn: 'blurred',
      zoneOff: 'off',
      zonesNone: 'No areas. Draw one over every readable face or number plate.',
      zonesCount: '{on} of {all} areas blurred',
      drawing: 'Drag over the face or the number plate.',
      chooseStation: 'Choose the station before preparing the photo.',
      preparing: 'Preparing…',
      ready: 'Ready. Sending is not wired up yet: nothing has left your device.',
      notClean: 'The prepared photo still had metadata and was set aside. Try again.',
      size: '{px} px: {w} × {h}, {kb} kB',
      download: 'Download the 2048 px version',
      resultAlt: 'The prepared photo, at 400 px',
      sending: 'Sending…',
      sent: 'Sent. It waits for moderation before it appears.',
      errors: {
        uploads_closed: 'Uploads are closed right now.',
        sign_in_required: 'Your session ended. Sign in again and send it again.',
        daily_limit: 'You have reached today’s upload limit. Try tomorrow.',
        duplicate: 'This photo has already been sent.',
        bad_target: 'That station or socket is no longer available. Choose another.',
        upload_failed: 'Couldn’t store the photo. Try again in a little while.',
        other: 'The photo did not pass the server’s checks. Choose it again.',
      },
    },
  },
} satisfies Record<Lang, unknown>;

export interface UploadView {
  user: AccountView | null;
  enabled: boolean;
  // Uploads open: the form sends. Otherwise it only prepares.
  sending?: boolean;
}

// JSON inside <script type="application/json">: a "</script>" in a string
// must not close the element.
const scriptJson = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c');

function form(lang: Lang, sending: boolean): string {
  const t = T[lang];
  return `${sending ? `<p class="hint">${t.moderated}</p>` : `<p class="notice">${t.building}</p>`}
<noscript><p class="notice">${t.noScript}</p></noscript>
<script type="application/json" id="upload-msg">${scriptJson({ lang, host: PICTURES_HOST, canSend: sending, ...t.js })}</script>
<form id="upload" class="upload" hidden>
<section class="card" aria-labelledby="h-photo">
  <h2 id="h-photo">${t.stepPhoto}</h2>
  <label for="photo">${t.photoLabel}</label>
  <input id="photo" name="photo" type="file" accept="image/jpeg" required aria-describedby="photo-hint">
  <p id="photo-hint" class="hint">${t.photoHint}</p>
  <p id="photo-status" class="status" role="status"></p>
</section>
<section class="card" id="step-station" aria-labelledby="h-station" hidden>
  <h2 id="h-station">${t.stepStation}</h2>
  <p id="station-intro" class="hint" role="status"></p>
  <fieldset id="stations" hidden>
    <legend>${t.stationsLegend}</legend>
    <div class="choices" id="station-list"></div>
  </fieldset>
  <div class="station-search">
    <label for="station-q">${t.searchLabel}</label>
    <div class="search-row">
      <input id="station-q" type="search" minlength="2" autocomplete="off" autocapitalize="off" spellcheck="false"
        enterkeyhint="search" aria-describedby="station-q-hint">
      <button type="button" id="station-search" class="button">${t.searchButton}</button>
    </div>
    <p id="station-q-hint" class="hint">${t.searchHint}</p>
  </div>
  <fieldset id="targets" hidden>
    <legend>${t.targetsLegend}</legend>
    <div class="choices" id="target-list"></div>
    <p id="target-note" class="hint"></p>
    <p class="hint">${t.link} <code id="target-link"></code></p>
  </fieldset>
</section>
<section class="card" id="step-blur" aria-labelledby="h-blur" hidden>
  <h2 id="h-blur">${t.stepBlur}</h2>
  <div class="stage" id="stage">
    <canvas id="preview" role="img" aria-label="${esc(t.preview)}"></canvas>
    <div class="zones" id="zones"></div>
  </div>
  <div class="zone-tools">
    <button type="button" id="draw" class="button secondary" aria-pressed="false">${t.draw}</button>
    <button type="button" id="add-zone" class="button secondary">${t.add}</button>
  </div>
  <p id="zone-summary" class="status" role="status"></p>
  <p class="hint">${t.blurHint}</p>
</section>
<section class="card" id="step-send" aria-labelledby="h-send" hidden>
  <h2 id="h-send">${t.stepSend}</h2>
  <h3>${t.checklist}</h3>
  <ul class="plain-list">
    <li>${t.check1}</li>
    <li>${t.check2}</li>
    <li>${t.check3}</li>
  </ul>
  <p class="check"><input type="checkbox" id="ok-privacy" name="ok_privacy" required> <label for="ok-privacy">${t.okPrivacy}</label></p>
  <p class="check"><input type="checkbox" id="ok-license" name="ok_license" required> <label for="ok-license">${t.okLicense}</label></p>
  <button type="submit" class="button">${sending ? t.send : t.prepare}</button>
  <p id="send-status" class="status" role="status"></p>
  <div id="result" class="result-photo" hidden></div>
</section>
</form>`;
}

export function uploadPage(lang: Lang, p: UploadView): string {
  const t = T[lang];
  const here = uploadPath(lang);
  const parts: string[] = [`<h1>${t.title}</h1>`, `<p>${t.intro}</p>`];
  let module: string | undefined;
  if (!p.enabled) {
    parts.push(`<p>${t.off}</p>`);
  } else if (!p.user) {
    // A link, not a form: see accountPage.
    parts.push(
      `<p>${t.login} <a href="${privacyPath(lang)}">${t.privacyLink}</a></p>`,
      `<p><a class="button" href="/auth/osm/login?next=${encodeURIComponent(here)}">${t.loginButton}</a></p>`,
    );
  } else {
    // The OSM name is the person's own text, in whatever language they chose.
    parts.push(
      `<p class="hint">${t.signedIn} <strong lang="">${esc(p.user.name)}</strong> · <a href="${accountPath(lang)}">${t.account}</a></p>`,
      form(lang, Boolean(p.sending)),
    );
    module = '/upload.js';
  }
  return layout({
    lang,
    title: `${t.title} · ${BRAND}`,
    description: t.desc,
    noindex: true,
    switchTo: { pt: uploadPath('pt'), en: uploadPath('en') },
    module,
    body: `<div class="upload-page">\n${parts.join('\n')}\n</div>`,
  });
}
