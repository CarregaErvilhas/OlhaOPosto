// Upload page: open the photos (JPEG or HEIC, one or several), read their
// EXIF, suggest the station (from the GPS, a map or a search), look for faces and let the person mark faces and
// number plates, and re-encode each photo without metadata.
// Everything that touches the photo runs on the device; the only requests
// are station lookups on our own API, with the GPS rounded to about 100 m
// first (the Worker logs keep the URL), and, only if the person opens it,
// the map tiles from OpenStreetMap. When uploads are open (canSend), the
// prepared files go to POST /api/v1/photos, which checks them again;
// otherwise the page stops at the prepared files.
import { isCleanJpeg, readExif, stripMetadata } from './jpeg.js';
import { isHeic, readHeicExif } from './heif.js';

const MAX_BYTES = 40 * 1024 * 1024;
// Below this, the map shows no stations (the nearby API caps at 5 km).
const MAP_MIN_ZOOM = 13;
const PT_CENTER = [39.6, -8.0];
const SIZES = [2048, 1024, 400];
const QUALITY = 0.85;
const RADIUS = 500;
const STEP = 0.01;
const MIN_ZONE = 0.02;

const $ = (id) => document.getElementById(id);
const form = $('upload');
const msgEl = $('upload-msg');
if (form && msgEl) init(form, JSON.parse(msgEl.textContent));

function init(form, M) {
  const locale = M.lang === 'pt' ? 'pt-PT' : 'en-GB';
  const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
  const say = (el, text) => { el.textContent = text; };

  const photo = $('photo');
  const photoStatus = $('photo-status');
  const sections = ['step-station', 'step-blur', 'step-send'].map($);
  const stationIntro = $('station-intro');
  const stationsBox = $('stations');
  const stationList = $('station-list');
  const searchInput = $('station-q');
  const searchButton = $('station-search');
  const targetsBox = $('targets');
  const targetList = $('target-list');
  const targetNote = $('target-note');
  const targetLink = $('target-link');
  const preview = $('preview');
  const zonesEl = $('zones');
  const drawButton = $('draw');
  const addButton = $('add-zone');
  const zoneSummary = $('zone-summary');
  const sendStatus = $('send-status');
  const result = $('result');
  const queueEl = $('photo-queue');
  const nextButton = $('next-photo');
  const skipButton = $('skip-photo');
  const detectButton = $('detect');
  const detectStatus = $('detect-status');
  const mapOpen = $('map-open');
  const mapBox = $('map-box');
  const mapStatus = $('map-status');
  const locateButton = $('locate');

  /** The photo scaled to the largest size, with EXIF orientation applied. */
  let base = null;
  let meta = null;
  /** Areas to blur, as fractions of the image: { x, y, w, h, on }. */
  let zones = [];
  let station = null;
  let target = null;
  let lookup = 0;
  /** Where the chosen station is, for the next photo. */
  let stationPos = null;
  let urls = [];
  let sent = false;
  /** The files picked, and which one is open. */
  let queue = [];
  let current = -1;
  /** The station of the last photo sent, suggested for the next one. */
  let lastStation = null;

  form.hidden = false;

  // ---- 1. Photo ----

  async function decode(file) {
    // Ask for the EXIF orientation explicitly; an older Safari that does not
    // know the option still applies it by default.
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      return createImageBitmap(file);
    }
  }

  photo.addEventListener('change', () => {
    queue = [...(photo.files ?? [])];
    current = -1;
    openNext();
  });

  function showQueue() {
    queueEl.hidden = queue.length < 2;
    say(queueEl, current < queue.length ? fill(M.queue, { n: current + 1, all: queue.length }) : M.queueDone);
    const more = current + 1 < queue.length;
    nextButton.hidden = !(sent && more);
    skipButton.hidden = !(more && !sent);
  }

  nextButton.addEventListener('click', openNext);
  skipButton.addEventListener('click', openNext);

  async function openNext() {
    current++;
    reset();
    showQueue();
    if (current >= queue.length) {
      if (queue.length > 1) photo.focus();
      return;
    }
    await openPhoto(queue[current]);
  }

  // A canvas or bitmap of the photo, upright, and its metadata. HEIC goes to
  // the browser first (Safari decodes it) and to libheif when that fails.
  async function open(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (isHeic(bytes)) {
      const m = readHeicExif(bytes);
      try {
        return { image: await decode(file), meta: m };
      } catch {
        say(photoStatus, M.heic);
        const { decodeHeic } = await import('./heic.js');
        return { image: await decodeHeic(bytes), meta: m };
      }
    }
    return { image: await decode(file), meta: readExif(bytes) };
  }

  async function openPhoto(file) {
    if (file.size > MAX_BYTES) return say(photoStatus, M.tooBig);
    say(photoStatus, M.reading);
    let opened;
    try {
      opened = await open(file);
    } catch {
      return say(photoStatus, M.notJpeg);
    }
    const { image } = opened;
    meta = opened.meta;
    const scale = Math.min(1, SIZES[0] / Math.max(image.width, image.height));
    base = document.createElement('canvas');
    base.width = Math.round(image.width * scale);
    base.height = Math.round(image.height * scale);
    const ctx = base.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, 0, 0, base.width, base.height);
    image.close?.();
    preview.width = base.width;
    preview.height = base.height;
    say(photoStatus, '');
    for (const s of sections) s.hidden = false;
    render();
    renderZones();
    const keep = lastStation && (meta?.lat == null || distance(meta.lat, meta.lon, lastStation.lat, lastStation.lon) < RADIUS);
    if (keep) preset(lastStation.id, M.previous);
    else if (M.station && current === 0) preset(M.station, M.preset);
    else findNear();
    // Saving data: no 15 MB download unless the person asks for it.
    if (!navigator.connection?.saveData) detect();
  }

  function reset() {
    sent = false;
    base = null;
    meta = null;
    zones = [];
    station = null;
    target = null;
    detectRun++;
    say(detectStatus, '');
    nextButton.hidden = true;
    skipButton.hidden = true;
    lookup++;
    for (const s of sections) s.hidden = true;
    stationsBox.hidden = true;
    stationList.replaceChildren();
    targetsBox.hidden = true;
    targetList.replaceChildren();
    zonesEl.replaceChildren();
    say(stationIntro, '');
    say(sendStatus, '');
    clearResult();
  }

  // ---- 2. Station ----

  const R = 6371008.8;
  const rad = (d) => (d * Math.PI) / 180;
  function distance(lat1, lon1, lat2, lon2) {
    const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 +
      Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  }
  const metres = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  const km = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const showDistance = (m) => (m < 1000 ? `${metres.format(m)} m` : `${km.format(m / 1000)} km`);

  async function api(path) {
    const r = await fetch(path, { headers: { accept: 'application/json' } });
    if (!r.ok && r.status !== 404) throw new Error(String(r.status));
    return r.ok ? r.json() : null;
  }

  async function findNear() {
    if (meta?.lat == null) {
      say(stationIntro, M.noGps);
      searchInput.focus();
      return;
    }
    // About 100 m: enough to list the stations, and all the URL gives away.
    const lat = meta.lat.toFixed(3);
    const lon = meta.lon.toFixed(3);
    await listStations(`/api/v1/stations?lat=${lat}&lon=${lon}&radius=${RADIUS}&limit=10`, M.gps, M.noneNear);
  }

  // ?posto=<id>: the station the link came from goes first; the search and
  // the photo's GPS stay there to pick another. Unknown id: as if absent.
  async function preset(id, intro) {
    const ok = await listStations(`/api/v1/stations/${encodeURIComponent(id)}`, intro, '', true);
    if (!ok) findNear();
  }

  async function search() {
    const q = searchInput.value.trim();
    if (q.length < 2) return say(stationIntro, M.tooShort);
    await listStations(`/api/v1/stations?q=${encodeURIComponent(q)}&limit=10`, '', M.noResults);
  }

  async function listStations(path, intro, empty, one = false) {
    const mine = ++lookup;
    say(stationIntro, M.searching);
    let body;
    try {
      body = await api(path);
    } catch {
      if (mine === lookup) say(stationIntro, M.failed);
      return mine !== lookup;
    }
    // A newer lookup took over: nothing left to do here.
    if (mine !== lookup) return true;
    const found = one ? (body?.id ? [body] : []) : (body?.results ?? []);
    if (one && found.length === 0) return false;
    const rows = found.map((s) => ({
      ...s,
      // From the exact GPS, which stays on the device.
      d: meta?.lat != null ? distance(meta.lat, meta.lon, s.lat, s.lon) : null,
    }));
    // NAP stations first, then the ones under construction (from OSM).
    const late = (s) => (s.lifecycle === 'construction' ? 1 : 0);
    if (rows.every((s) => s.d !== null)) rows.sort((a, b) => late(a) - late(b) || a.d - b.d);
    else rows.sort((a, b) => late(a) - late(b));
    if (rows.length === 0) {
      say(stationIntro, empty);
      return;
    }
    say(stationIntro, intro);
    stationList.replaceChildren(...rows.map((s) => choice('station', s.id, [
      el('strong', {}, s.id),
      el('span', { className: 'meta', lang: 'pt-PT' }, [s.name, s.municipality].filter(Boolean).join(' · ')),
      ...(s.lifecycle === 'construction' ? [el('span', { className: 'meta' }, M.building)] : []),
    ], s.d === null ? null : showDistance(s.d))));
    stationsBox.hidden = false;
    const first = stationList.querySelector('input');
    first.checked = true;
    pickStation(first.value);
    return true;
  }

  searchButton.addEventListener('click', search);
  searchInput.addEventListener('keydown', (e) => {
    // Enter searches instead of submitting the form; not while an IME is composing.
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      search();
    }
  });
  stationList.addEventListener('change', (e) => pickStation(e.target.value));

  async function pickStation(id) {
    station = id;
    target = null;
    const mine = ++lookup;
    targetsBox.hidden = true;
    let s;
    try {
      s = await api(`/api/v1/stations/${encodeURIComponent(id)}`);
    } catch {
      if (mine === lookup) say(stationIntro, M.failed);
      return;
    }
    if (mine !== lookup || !s) return;
    // A merged station under construction redirects to its NAP station: the
    // photo goes to the id the API answered with, not the one in the link.
    station = s.id;
    stationPos = { id: s.id, lat: s.lat, lon: s.lon };
    const sockets = (s.points ?? []).filter((p) => p.compact);
    targetList.replaceChildren(
      choice('target', s.id, [el('span', {}, M.general)]),
      ...sockets.map((p) => choice('target', p.compact, [
        el('span', {}, fill(M.socket, { evse: p.evse })),
        p.kw ? el('span', { className: 'meta' }, `${km.format(p.kw)} kW`) : null,
      ].filter(Boolean))),
    );
    say(targetNote, sockets.length === 0 && (s.points ?? []).length > 0 ? M.noEvse : '');
    targetList.querySelector('input').checked = true;
    setTarget(s.id);
    targetsBox.hidden = false;
  }

  targetList.addEventListener('change', (e) => setTarget(e.target.value));

  function setTarget(value) {
    target = value;
    say(targetLink, `${M.host}/${target}.jpg`);
  }

  function el(tag, props, children) {
    const n = Object.assign(document.createElement(tag), props);
    if (typeof children === 'string') n.textContent = children;
    else if (children) n.append(...children);
    return n;
  }

  // One radio with its label. Text goes in through textContent: names and
  // addresses come from the NAP.
  function choice(name, value, content, aside = null) {
    const input = el('input', { type: 'radio', name, value, required: true });
    const text = el('span', { className: 'choice-text' }, content);
    const label = el('label', { className: 'choice' }, [input, text]);
    if (aside) label.append(el('span', { className: 'dist' }, aside));
    return label;
  }

  // ---- 3. Privacy: areas to blur ----

  const scratch = document.createElement('canvas');

  // A coarse mosaic, about 8 blocks across the longer side of the area: a
  // number plate ends up with roughly one block per character.
  function pixelate(ctx, z) {
    const W = ctx.canvas.width;
    const H = ctx.canvas.height;
    const x = Math.round(z.x * W);
    const y = Math.round(z.y * H);
    const w = Math.max(1, Math.round(z.w * W));
    const h = Math.max(1, Math.round(z.h * H));
    const block = Math.max(6, Math.round(Math.max(w, h) / 8));
    scratch.width = Math.max(1, Math.ceil(w / block));
    scratch.height = Math.max(1, Math.ceil(h / block));
    const s = scratch.getContext('2d');
    s.imageSmoothingQuality = 'high';
    s.drawImage(base, x, y, w, h, 0, 0, scratch.width, scratch.height);
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(scratch, 0, 0, scratch.width, scratch.height, x, y, w, h);
    ctx.restore();
  }

  // The preview is the image that gets sent: what you see is what leaves.
  function render() {
    if (!base) return;
    const ctx = preview.getContext('2d');
    ctx.drawImage(base, 0, 0);
    for (const z of zones) if (z.on) pixelate(ctx, z);
  }

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  function placeZone(button, z) {
    button.style.left = `${z.x * 100}%`;
    button.style.top = `${z.y * 100}%`;
    button.style.width = `${z.w * 100}%`;
    button.style.height = `${z.h * 100}%`;
  }

  function renderZones(focus = -1) {
    zonesEl.replaceChildren(...zones.map((z, i) => {
      const b = el('button', { type: 'button', className: 'zone' }, [
        el('span', { className: 'tag' }, `${fill(M.zone, { n: i + 1 })} · ${z.on ? M.zoneOn : M.zoneOff}`),
      ]);
      b.setAttribute('aria-pressed', String(z.on));
      b.dataset.i = String(i);
      placeZone(b, z);
      return b;
    }));
    const on = zones.filter((z) => z.on).length;
    say(zoneSummary, zones.length === 0 ? M.zonesNone : fill(M.zonesCount, { on, all: zones.length }));
    if (focus >= 0) zonesEl.children[Math.min(focus, zones.length - 1)]?.focus();
  }

  zonesEl.addEventListener('click', (e) => {
    const b = e.target.closest('.zone');
    if (!b || drawing) return;
    const i = Number(b.dataset.i);
    zones[i].on = !zones[i].on;
    render();
    renderZones(i);
  });

  zonesEl.addEventListener('keydown', (e) => {
    const b = e.target.closest('.zone');
    if (!b) return;
    const i = Number(b.dataset.i);
    const z = zones[i];
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      zones.splice(i, 1);
      render();
      renderZones(zones.length ? i : -1);
      if (!zones.length) addButton.focus();
      return;
    }
    const dx = { ArrowLeft: -STEP, ArrowRight: STEP }[e.key] ?? 0;
    const dy = { ArrowUp: -STEP, ArrowDown: STEP }[e.key] ?? 0;
    if (!dx && !dy) return;
    e.preventDefault();
    if (e.shiftKey) {
      z.w = clamp(z.w + dx, MIN_ZONE, 1 - z.x);
      z.h = clamp(z.h + dy, MIN_ZONE, 1 - z.y);
    } else {
      z.x = clamp(z.x + dx, 0, 1 - z.w);
      z.y = clamp(z.y + dy, 0, 1 - z.h);
    }
    placeZone(b, z);
    render();
  });

  addButton.addEventListener('click', () => {
    // Number-plate shaped, in the middle; move and resize it from there.
    zones.push({ x: 0.4, y: 0.44, w: 0.2, h: 0.12, on: true });
    render();
    renderZones(zones.length - 1);
  });

  let drawing = false;
  let start = null;
  let ghost = null;

  function setDrawing(on) {
    drawing = on;
    drawButton.setAttribute('aria-pressed', String(on));
    zonesEl.classList.toggle('drawing', on);
    if (on) say(zoneSummary, M.drawing);
    else if (ghost) { ghost.remove(); ghost = null; start = null; }
  }
  drawButton.addEventListener('click', () => setDrawing(!drawing));

  const at = (e) => {
    const r = zonesEl.getBoundingClientRect();
    return { x: clamp((e.clientX - r.left) / r.width, 0, 1), y: clamp((e.clientY - r.top) / r.height, 0, 1) };
  };
  const box = (a, b) => ({
    x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y), on: true,
  });

  zonesEl.addEventListener('pointerdown', (e) => {
    if (!drawing || !e.isPrimary) return;
    e.preventDefault();
    zonesEl.setPointerCapture(e.pointerId);
    start = at(e);
    ghost = el('div', { className: 'zone ghost' });
    placeZone(ghost, box(start, start));
    zonesEl.append(ghost);
  });
  zonesEl.addEventListener('pointermove', (e) => {
    if (start && ghost) placeZone(ghost, box(start, at(e)));
  });
  zonesEl.addEventListener('pointerup', (e) => {
    if (!start) return;
    const z = box(start, at(e));
    setDrawing(false);
    if (z.w >= MIN_ZONE && z.h >= MIN_ZONE) zones.push(z);
    render();
    renderZones(z.w >= MIN_ZONE && z.h >= MIN_ZONE ? zones.length - 1 : -1);
  });
  zonesEl.addEventListener('pointercancel', () => setDrawing(false));

  // ---- 4. Prepare ----

  function scaled(src, px) {
    const scale = Math.min(1, px / Math.max(src.width, src.height));
    if (scale === 1) return src;
    const c = document.createElement('canvas');
    c.width = Math.round(src.width * scale);
    c.height = Math.round(src.height * scale);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, c.width, c.height);
    return c;
  }

  const toBlob = (c) => new Promise((ok, fail) => {
    c.toBlob((b) => (b ? ok(b) : fail(new Error('encode'))), 'image/jpeg', QUALITY);
  });

  function clearResult() {
    for (const u of urls) URL.revokeObjectURL(u);
    urls = [];
    result.replaceChildren();
    result.hidden = true;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!base) return;
    // One photo, one upload: a second click would send a re-encoded copy.
    if (sent) return say(sendStatus, M.sent);
    if (!target) {
      say(sendStatus, M.chooseStation);
      searchInput.focus();
      return;
    }
    const button = e.submitter;
    if (button) button.disabled = true;
    clearResult();
    say(sendStatus, M.preparing);
    try {
      render();
      const out = [];
      for (const px of SIZES) {
        const c = scaled(preview, px);
        // Canvas output carries no EXIF; strip anyway, then check, so a
        // browser that adds a segment never gets one past this point.
        const clean = stripMetadata(new Uint8Array(await (await toBlob(c)).arrayBuffer()));
        if (!clean || !isCleanJpeg(clean)) throw new Error('metadata');
        out.push({ px, w: c.width, h: c.height, blob: new Blob([clean], { type: 'image/jpeg' }) });
      }
      if (M.canSend) {
        await send(out);
      } else {
        showResult(out, true);
        say(sendStatus, M.ready);
      }
    } catch (err) {
      say(sendStatus, err.message === 'metadata' ? M.notClean : M.failed);
    } finally {
      if (button) button.disabled = false;
    }
  });

  async function send(out) {
    say(sendStatus, M.sending);
    const body = new FormData();
    out.forEach((o, i) => body.append(['full', 'main', 'thumb'][i], o.blob, `${o.px}.jpg`));
    // In the body, never the URL: the Worker logs keep URLs.
    body.append('meta', JSON.stringify({
      station,
      target,
      taken_at: meta?.takenAt ?? null,
      exif_lat: meta?.lat ?? null,
      exif_lon: meta?.lon ?? null,
      license: $('ok-license').checked,
      no_people: $('ok-privacy').checked,
    }));
    // Turnstile puts its token in a hidden input inside the form. Tokens are
    // single use, so the widget is reset after every attempt.
    const token = form.querySelector('[name="cf-turnstile-response"]')?.value ?? '';
    if (!token) return say(sendStatus, M.errors.turnstile);
    body.append('turnstile', token);
    let r;
    try {
      r = await fetch('/api/v1/photos', { method: 'POST', body });
    } catch {
      return say(sendStatus, M.errors.upload_failed);
    } finally {
      window.turnstile?.reset();
    }
    if (r.ok) {
      sent = true;
      if (stationPos && stationPos.id === station) lastStation = stationPos;
      showResult(out, false);
      const body = await r.json().catch(() => ({}));
      say(sendStatus, body.status === 'published' ? M.sentPublished : M.sent);
      showQueue();
      if (!nextButton.hidden) nextButton.focus();
      return;
    }
    const code = await r.json().then((j) => j.error).catch(() => null);
    say(sendStatus, M.errors[code] ?? M.errors.other);
  }

  function showResult(out, download) {
    const url = (b) => { const u = URL.createObjectURL(b); urls.push(u); return u; };
    const small = out[out.length - 1];
    const img = el('img', { src: url(small.blob), alt: M.resultAlt, width: small.w, height: small.h });
    const list = el('ul', { className: 'plain-list' }, out.map((o) =>
      el('li', {}, fill(M.size, { px: o.px, w: o.w, h: o.h, kb: metres.format(o.blob.size / 1024) }))));
    result.replaceChildren(img, list);
    if (download) {
      result.append(el('p', {}, [el('a', { href: url(out[0].blob), download: `${target}.jpg` }, M.download)]));
    }
    result.hidden = false;
  }

  // ---- Face detection (public/detect.js) ----

  let detectRun = 0;

  async function detect() {
    if (!base) return;
    const mine = ++detectRun;
    detectButton.disabled = true;
    say(detectStatus, M.detecting);
    try {
      const { detectFaces } = await import('./detect.js');
      const faces = await detectFaces(base);
      if (mine !== detectRun) return;
      // Replace the earlier suggestions, keep what the person drew.
      zones = zones.filter((z) => !z.auto).concat(faces.map((f) => ({ ...f, on: true, auto: true })));
      render();
      renderZones();
      say(detectStatus, faces.length === 0 ? M.detectedNone : faces.length === 1 ? M.detectedOne : fill(M.detected, { n: faces.length }));
    } catch {
      if (mine === detectRun) say(detectStatus, M.detectFailed);
    } finally {
      if (mine === detectRun) detectButton.disabled = false;
    }
  }
  detectButton.addEventListener('click', detect);

  // ---- Map (Leaflet, OpenStreetMap tiles), only when opened ----

  let map = null;
  let markers = null;
  let mapLookup = 0;

  function loadLeaflet() {
    if (window.L) return Promise.resolve(window.L);
    const css = el('link', { rel: 'stylesheet', href: '/vendor/leaflet/leaflet.css' });
    document.head.append(css);
    return new Promise((ok, fail) => {
      const s = el('script', { src: '/vendor/leaflet/leaflet.js' });
      s.onload = () => ok(window.L);
      s.onerror = () => fail(new Error('leaflet'));
      document.head.append(s);
    });
  }

  mapOpen.addEventListener('click', async () => {
    if (map) {
      mapBox.hidden = !mapBox.hidden;
      if (!mapBox.hidden) map.invalidateSize();
      return;
    }
    say(mapStatus, M.mapLoading);
    mapBox.hidden = false;
    let L;
    try {
      L = await loadLeaflet();
    } catch {
      return say(mapStatus, M.mapFailed);
    }
    const start = meta?.lat != null ? [meta.lat, meta.lon] : stationPos ? [stationPos.lat, stationPos.lon] : PT_CENTER;
    map = L.map('map', { zoomControl: true }).setView(start, start === PT_CENTER ? 7 : 16);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
    }).addTo(map);
    markers = L.layerGroup().addTo(map);
    map.on('moveend', () => mapStations(L));
    mapStations(L);
  });

  async function mapStations(L) {
    const mine = ++mapLookup;
    if (map.getZoom() < MAP_MIN_ZOOM) {
      markers.clearLayers();
      return say(mapStatus, M.mapZoom);
    }
    const c = map.getCenter();
    const b = map.getBounds();
    const radius = Math.min(5000, Math.ceil(map.distance(c, b.getNorthEast())));
    // Rounded like the photo's GPS: the URL is all the logs see.
    const path = `/api/v1/stations?lat=${c.lat.toFixed(3)}&lon=${c.lng.toFixed(3)}&radius=${radius}&limit=50`;
    let body;
    try {
      body = await api(path);
    } catch {
      if (mine === mapLookup) say(mapStatus, M.failed);
      return;
    }
    if (mine !== mapLookup) return;
    markers.clearLayers();
    const rows = body?.results ?? [];
    for (const s of rows) {
      const m = L.circleMarker([s.lat, s.lon], { radius: 9, weight: 2, color: '#1F3650', fillColor: '#F2B33D', fillOpacity: 0.9 });
      m.bindTooltip([s.id, s.name].filter(Boolean).join(' · '));
      m.on('click', () => preset(s.id, M.preset));
      markers.addLayer(m);
    }
    say(mapStatus, fill(M.mapStations, { n: rows.length }));
  }

  locateButton.addEventListener('click', () => {
    if (!navigator.geolocation || !map) return say(mapStatus, M.locateFailed);
    say(mapStatus, M.locating);
    navigator.geolocation.getCurrentPosition(
      (p) => map.setView([p.coords.latitude, p.coords.longitude], 17),
      () => say(mapStatus, M.locateFailed),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
    );
  });
}
