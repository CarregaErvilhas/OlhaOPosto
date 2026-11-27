// The upload page. Everything that touches the photo runs in the browser
// (public/upload.js): the original and its EXIF never reach the server. This
// file only renders the form and the messages the script needs. Until uploads
// open (src/photos.ts), the page prepares the photo and stops there.
import { BRAND, accountPath, esc, layout, privacyPath, termsPath, uploadPath, withoutPhotoPath, type AccountView, type Lang } from './pages.ts';

// The URL the photos will get, for the "Link:" line.
const PICTURES_HOST = 'pictures.ocarroeletrico.com';

const T = {
  pt: {
    title: 'Enviar fotos',
    desc: `Enviar fotos de postos de carregamento para o ${BRAND}.`,
    intro: 'A foto é lida, desfocada e limpa no teu dispositivo. O original nunca é enviado.',
    needPhoto: 'Não sabes que posto fotografar?',
    needPhotoLink: 'Vê os postos que ainda não têm foto',
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
    photoHint: 'JPEG ou HEIC. Podes escolher várias: tratas uma de cada vez, e o posto da anterior fica sugerido para a seguinte.',
    stepStation: '2 · Posto',
    stationsLegend: 'Escolher posto',
    searchLabel: 'Procurar outro posto',
    searchHint: 'Código do posto, localidade, morada ou operador.',
    searchButton: 'Procurar',
    mapOpen: 'Escolher no mapa',
    mapNote: 'O mapa carrega os mosaicos do OpenStreetMap, que recebe o teu endereço IP, como qualquer site que os mostre. Só abre se tocares no botão.',
    locate: 'Ir para a minha localização',
    mapLabel: 'Mapa dos postos. Toca num posto para o escolher.',
    targetsLegend: 'O que mostra esta foto?',
    targetsHint: 'O posto em geral (o carregador, o lugar, a sinalização), ou uma tomada: a ficha dela, com o código EVSE do autocolante. Escolhe uma.',
    link: 'Link:',
    stepBlur: '3 · Privacidade',
    preview: 'Pré-visualização da foto, com as zonas desfocadas',
    draw: 'Desenhar zona',
    add: 'Acrescentar zona',
    detect: 'Procurar caras',
    blurHint: 'As caras são procuradas automaticamente no teu dispositivo; confirma cada zona. As matrículas tens de as marcar tu. Toca numa zona para a ligar ou desligar. Com o teclado: as setas movem a zona, Shift e setas mudam o tamanho, Delete apaga-a.',
    stepSend: '4 · Enviar',
    checklist: 'Antes de enviar',
    check1: 'Sai da imagem todo o EXIF: GPS, data, câmara e número de série.',
    check2: 'Vão à parte, só para a moderação e nunca publicados: a data e o GPS da foto.',
    check3: 'Tamanhos gerados: 2048, 1024 e 400 px.',
    okPrivacy: 'Confirmo que não há caras nem matrículas legíveis.',
    okLicense: `Tirei esta foto, aceito as <a href="${termsPath('pt')}" target="_blank" rel="noopener">condições de utilização</a> e publico-a sob CC BY-SA 4.0, com autorização para dados derivados em ODbL.`,
    prepare: 'Preparar a foto',
    send: 'Enviar a foto',
    next: 'Foto seguinte',
    // Read by upload.js; {name} is replaced there.
    js: {
      reading: 'A abrir a foto…',
      notJpeg: 'Não foi possível abrir esta foto. Escolhe um JPEG ou um HEIC.',
      heic: 'A converter a foto HEIC no teu dispositivo…',
      queue: 'Foto {n} de {all}.',
      queueDone: 'Já trataste todas as fotos que escolheste.',
      skip: 'Saltar esta foto',
      previous: 'Posto da foto anterior:',
      detecting: 'A procurar caras na foto…',
      detected: '{n} caras encontradas e desfocadas. Confirma se não falta nenhuma, e marca as matrículas.',
      detectedOne: '1 cara encontrada e desfocada. Confirma se não falta nenhuma, e marca as matrículas.',
      detectedNone: 'Não foi encontrada nenhuma cara. Confirma tu, e marca as matrículas.',
      detectFailed: 'A procura automática de caras não funcionou neste dispositivo. Marca tu cada cara e cada matrícula.',
      mapLoading: 'A abrir o mapa…',
      mapFailed: 'Não foi possível abrir o mapa.',
      mapZoom: 'Aproxima o mapa para veres os postos.',
      mapStations: '{n} postos nesta zona. Toca num para o escolher.',
      locating: 'A procurar a tua localização…',
      locateFailed: 'Não foi possível saber a tua localização.',
      tooBig: 'A foto tem mais de 40 MB. Escolhe outra.',
      gps: 'GPS lido da foto e arredondado a cerca de 100 m. Postos num raio de 500 m:',
      preset: 'Posto do link que abriste:',
      noGps: 'A foto não tem GPS. Procura o posto pelo código, localidade ou operador.',
      noneNear: 'Não há postos num raio de 500 m. Procura o posto pelo código, localidade ou operador.',
      searching: 'A procurar…',
      noResults: 'Nenhum posto encontrado.',
      tooShort: 'Escreve pelo menos duas letras ou dois números.',
      failed: 'Não foi possível falar com o servidor. Tenta outra vez.',
      general: 'Posto em geral',
      building: 'Em construção, segundo o OpenStreetMap',
      socket: 'Tomada {n}',
      chooseTarget: 'Escolhe se a foto mostra o posto em geral ou uma tomada.',
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
      sentPublished: 'Enviada e publicada.',
      errors: {
        uploads_closed: 'O envio está fechado neste momento.',
        turnstile: 'A verificação de segurança falhou ou ainda não terminou. Espera uns segundos e volta a enviar.',
        sign_in_required: 'A sessão terminou. Inicia sessão outra vez e volta a enviar.',
        daily_limit: 'Chegaste ao limite de envios de hoje. Tenta amanhã.',
        too_fast: 'Estás a enviar muito depressa. Espera um minuto e volta a enviar.',
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
    needPhoto: 'Not sure which station to photograph?',
    needPhotoLink: 'See the stations that still have no photo',
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
    photoHint: 'JPEG or HEIC. You can pick several: you handle one at a time, and the previous photo’s station is suggested for the next.',
    stepStation: '2 · Station',
    stationsLegend: 'Choose the station',
    searchLabel: 'Find another station',
    searchHint: 'Station code, town, address or operator.',
    searchButton: 'Search',
    mapOpen: 'Choose on the map',
    mapNote: 'The map loads its tiles from OpenStreetMap, which receives your IP address, like any site that shows them. It only opens if you tap the button.',
    locate: 'Go to my location',
    mapLabel: 'Map of the stations. Tap a station to choose it.',
    targetsLegend: 'What does this photo show?',
    targetsHint: 'The station in general (the charger, the bay, the signs), or one socket: its plug, with the EVSE code on its sticker. Pick one.',
    link: 'Link:',
    stepBlur: '3 · Privacy',
    preview: 'Preview of the photo, with the blurred areas',
    draw: 'Draw an area',
    add: 'Add an area',
    detect: 'Look for faces',
    blurHint: 'Faces are looked for automatically on your device; check every area. Number plates you have to mark yourself. Tap an area to turn it on or off. With a keyboard: the arrow keys move the area, Shift and arrows resize it, Delete removes it.',
    stepSend: '4 · Send',
    checklist: 'Before sending',
    check1: 'All EXIF leaves the image: GPS, date, camera and serial number.',
    check2: 'Sent apart, only for moderation and never published: the photo’s date and GPS.',
    check3: 'Sizes made: 2048, 1024 and 400 px.',
    okPrivacy: 'I confirm there are no readable faces or number plates.',
    okLicense: `I took this photo, accept the <a href="${termsPath('en')}" target="_blank" rel="noopener">terms of use</a> and publish it under CC BY-SA 4.0, with permission for derived data under ODbL.`,
    prepare: 'Prepare the photo',
    send: 'Send the photo',
    next: 'Next photo',
    js: {
      reading: 'Opening the photo…',
      notJpeg: 'Couldn’t open this photo. Choose a JPEG or a HEIC.',
      heic: 'Converting the HEIC photo on your device…',
      queue: 'Photo {n} of {all}.',
      queueDone: 'You have handled every photo you picked.',
      skip: 'Skip this photo',
      previous: 'Station of the previous photo:',
      detecting: 'Looking for faces in the photo…',
      detected: '{n} faces found and blurred. Check that none is missing, and mark the number plates.',
      detectedOne: '1 face found and blurred. Check that none is missing, and mark the number plates.',
      detectedNone: 'No faces found. Check for yourself, and mark the number plates.',
      detectFailed: 'Automatic face detection did not work on this device. Mark every face and number plate yourself.',
      mapLoading: 'Opening the map…',
      mapFailed: 'Couldn’t open the map.',
      mapZoom: 'Zoom in to see the stations.',
      mapStations: '{n} stations in this area. Tap one to choose it.',
      locating: 'Finding your location…',
      locateFailed: 'Couldn’t get your location.',
      tooBig: 'The photo is over 40 MB. Choose another.',
      gps: 'GPS read from the photo and rounded to about 100 m. Stations within 500 m:',
      preset: 'Station from the link you opened:',
      noGps: 'The photo has no GPS. Find the station by code, town or operator.',
      noneNear: 'No stations within 500 m. Find the station by code, town or operator.',
      searching: 'Searching…',
      noResults: 'No stations found.',
      tooShort: 'Type at least two letters or numbers.',
      failed: 'Couldn’t reach the server. Try again.',
      general: 'The station in general',
      building: 'Under construction, according to OpenStreetMap',
      socket: 'Socket {n}',
      chooseTarget: 'Choose whether the photo shows the station in general or one socket.',
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
      sentPublished: 'Sent and published.',
      errors: {
        uploads_closed: 'Uploads are closed right now.',
        turnstile: 'The security check failed or has not finished yet. Wait a few seconds and send again.',
        sign_in_required: 'Your session ended. Sign in again and send it again.',
        daily_limit: 'You have reached today’s upload limit. Try tomorrow.',
        too_fast: 'You are sending too fast. Wait a minute and send again.',
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
  // Turnstile site key, only while sending is open.
  sitekey?: string;
  // ?posto=<id>: the station to pick first (a station page, the NAP dashboard).
  station?: string | null;
  // ?tomada=<EVSE>: the socket of that station to pick (a socket on a station page).
  socket?: string | null;
}

// A station id or alias as the links carry it: NAP site ids (EZC-AMD-00051),
// MOBI.E codes, OPC-… ids. Anything else is ignored, not an error.
export function presetStation(raw: string | null): string | null {
  const v = (raw ?? '').trim();
  return /^[A-Za-z0-9][A-Za-z0-9*_.-]{0,63}$/.test(v) ? v : null;
}

// A socket's EVSE code, in either form (PT*EZC*E*AMD*00051*1 or
// PTEZCEAMD000511), as the compact code the targets use. Anything else: null.
export function presetSocket(raw: string | null): string | null {
  const v = (raw ?? '').trim().replace(/\*/g, '').toUpperCase();
  return /^[A-Z]{2}[A-Z0-9]{3,60}$/.test(v) ? v : null;
}

// Must match what the Worker expects back from siteverify (src/photos.ts).
export const TURNSTILE_ACTION = 'upload';

// JSON inside <script type="application/json">: a "</script>" in a string
// must not close the element.
const scriptJson = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c');

function form(lang: Lang, sending: boolean, sitekey?: string, station?: string | null, socket?: string | null): string {
  const t = T[lang];
  return `${sending ? `<p class="hint">${t.moderated}</p>` : `<p class="notice">${t.building}</p>`}
<noscript><p class="notice">${t.noScript}</p></noscript>
<script type="application/json" id="upload-msg">${scriptJson({ lang, host: PICTURES_HOST, canSend: sending, station: station ?? null, presetSocket: socket ?? null, ...t.js })}</script>
<form id="upload" class="upload" hidden>
<section class="card" aria-labelledby="h-photo">
  <h2 id="h-photo">${t.stepPhoto}</h2>
  <label for="photo">${t.photoLabel}</label>
  <input id="photo" name="photo" type="file" accept="image/jpeg,image/heic,image/heif,.heic,.heif,.jpg,.jpeg" multiple required aria-describedby="photo-hint">
  <p id="photo-hint" class="hint">${t.photoHint}</p>
  <p id="photo-queue" class="hint" hidden></p>
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
  <div class="station-map">
    <button type="button" id="map-open" class="button secondary">${t.mapOpen}</button>
    <p class="hint">${t.mapNote}</p>
    <div id="map-box" hidden>
      <div id="map" class="map" role="region" aria-label="${esc(t.mapLabel)}"></div>
      <div class="zone-tools"><button type="button" id="locate" class="button secondary">${t.locate}</button></div>
      <p id="map-status" class="status" role="status"></p>
    </div>
  </div>
  <fieldset id="targets" hidden>
    <legend>${t.targetsLegend}</legend>
    <p class="hint">${t.targetsHint}</p>
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
    <button type="button" id="detect" class="button secondary">${t.detect}</button>
  </div>
  <p id="detect-status" class="status" role="status"></p>
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
  ${sending && sitekey ? `<div class="cf-turnstile" data-sitekey="${esc(sitekey)}" data-action="${TURNSTILE_ACTION}" data-language="${lang === 'pt' ? 'pt-pt' : 'en'}" data-size="flexible" data-appearance="interaction-only"></div>
  <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>` : ''}
  <button type="submit" class="button">${sending ? t.send : t.prepare}</button>
  <p id="send-status" class="status" role="status"></p>
  <div id="result" class="result-photo" hidden></div>
  <p class="zone-tools"><button type="button" id="next-photo" class="button" hidden>${t.next}</button>
  <button type="button" id="skip-photo" class="button secondary" hidden>${t.js.skip}</button></p>
</section>
</form>`;
}

export function uploadPage(lang: Lang, p: UploadView): string {
  const t = T[lang];
  const q = p.station ? `?posto=${encodeURIComponent(p.station)}` : '';
  const here = uploadPath(lang) + q;
  const parts: string[] = [`<h1>${t.title}</h1>`, `<p>${t.intro}</p>`, `<p class="hint">${t.needPhoto} <a href="${withoutPhotoPath(lang)}">${t.needPhotoLink}</a>.</p>`];
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
      form(lang, Boolean(p.sending), p.sitekey, p.station, p.socket),
    );
    module = '/upload.js';
  }
  return layout({
    lang,
    title: `${t.title} · ${BRAND}`,
    description: t.desc,
    noindex: true,
    switchTo: { pt: uploadPath('pt') + q, en: uploadPath('en') + q },
    module,
    body: `<div class="upload-page">\n${parts.join('\n')}\n</div>`,
  });
}
