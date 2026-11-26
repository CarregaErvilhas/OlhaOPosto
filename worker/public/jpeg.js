// @ts-check
// JPEG metadata: read the few EXIF fields the upload needs, and make sure none
// of it leaves the device. Plain JavaScript so the upload page loads it as is
// (the CSP allows only our own scripts, and there is no build step) and the
// tests, and later the Worker's upload check, import the same file.

/**
 * @typedef {{ lat: number | null, lon: number | null, takenAt: string | null, orientation: number | null }} PhotoMeta
 */

const SOS = 0xda;

/**
 * Walks the segments before the image data, which is where EXIF lives. Calls
 * fn with each marker, where its segment starts (at the 0xFF) and its total
 * length. Header only, so a file cut short after its header still reads.
 * @param {Uint8Array} b
 * @param {(marker: number, start: number, length: number) => void} fn
 * @returns {number} where the scan data (SOS) starts, or -1 when b is not a well-formed JPEG
 */
function walk(b, fn) {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return -1;
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return -1;
    const m = b[i + 1];
    // Fill bytes before a marker.
    if (m === 0xff) { i++; continue; }
    if (m === SOS) return i;
    // A standalone marker (no length) or a second SOI or EOI has no place here.
    if (m === 0x00 || m === 0x01 || m === 0xd8 || m === 0xd9 || (m >= 0xd0 && m <= 0xd7)) return -1;
    const len = (b[i + 2] << 8) | b[i + 3];
    if (len < 2 || i + 2 + len > b.length) return -1;
    fn(m, i, 2 + len);
    i += 2 + len;
  }
  return -1;
}

/** @param {Uint8Array} b @param {number} at @param {string} text */
function startsWith(b, at, text) {
  if (at + text.length > b.length) return false;
  for (let k = 0; k < text.length; k++) if (b[at + k] !== text.charCodeAt(k)) return false;
  return true;
}

// What an encoder needs to show the image the same way: JFIF (APP0), the
// colour profile (APP2 ICC_PROFILE) and Adobe's colour transform (APP14).
// Every other APPn (EXIF and XMP are APP1, IPTC is APP13, MPF is APP2) and
// comments go.
/** @param {Uint8Array} b @param {number} marker @param {number} start */
function keep(b, marker, start) {
  if (marker === 0xfe) return false;
  if (marker < 0xe0 || marker > 0xef) return true;
  if (marker === 0xe0 || marker === 0xee) return true;
  return marker === 0xe2 && startsWith(b, start + 4, 'ICC_PROFILE\0');
}

/**
 * Splits a whole JPEG into its pieces, up to the first EOI: every marker
 * segment (including those between progressive scans) and, after each SOS,
 * the entropy-coded data as a piece with marker -1.
 * @param {Uint8Array} b
 * @returns {{ pieces: Array<{ m: number, start: number, end: number }>, end: number } | null}
 *   null when b is not a well-formed JPEG ending in EOI
 */
function pieces(b) {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  /** @type {Array<{ m: number, start: number, end: number }>} */
  const out = [];
  let i = 2;
  while (i + 1 < b.length) {
    if (b[i] !== 0xff) return null;
    const m = b[i + 1];
    if (m === 0xff) { i++; continue; }
    if (m === 0xd9) {
      out.push({ m, start: i, end: i + 2 });
      return { pieces: out, end: i + 2 };
    }
    if (m === 0x00 || m === 0x01 || m === 0xd8 || (m >= 0xd0 && m <= 0xd7)) return null;
    if (i + 4 > b.length) return null;
    const len = (b[i + 2] << 8) | b[i + 3];
    if (len < 2 || i + 2 + len > b.length) return null;
    out.push({ m, start: i, end: i + 2 + len });
    i += 2 + len;
    if (m === SOS) {
      // Scan data runs to the next marker that is not a stuffed 0xFF00 or a
      // restart. indexOf is native: the Worker checks megabytes of scan data
      // inside a 10 ms CPU budget.
      let j = i;
      for (;;) {
        j = b.indexOf(0xff, j);
        if (j < 0 || j + 1 >= b.length) return null;
        const n = b[j + 1];
        if (n !== 0x00 && (n < 0xd0 || n > 0xd7)) break;
        j += 2;
      }
      out.push({ m: -1, start: i, end: j });
      i = j;
    }
  }
  return null;
}

/**
 * A copy of the JPEG without metadata segments and without anything after
 * its end (a Motion Photo's video, an embedded second image), or null when it
 * is not a well-formed JPEG.
 * @param {Uint8Array} b
 * @returns {Uint8Array | null}
 */
export function stripMetadata(b) {
  const p = pieces(b);
  if (!p) return null;
  const kept = p.pieces.filter((x) => x.m === -1 || keep(b, x.m, x.start));
  const out = new Uint8Array(2 + kept.reduce((n, x) => n + x.end - x.start, 0));
  out[0] = 0xff;
  out[1] = 0xd8;
  let o = 2;
  for (const x of kept) {
    out.set(b.subarray(x.start, x.end), o);
    o += x.end - x.start;
  }
  return out;
}

/**
 * True when b is a well-formed JPEG with no metadata segment anywhere and
 * nothing after its EOI.
 * @param {Uint8Array} b
 */
export function isCleanJpeg(b) {
  const p = pieces(b);
  return p !== null && p.end === b.length && p.pieces.every((x) => x.m === -1 || keep(b, x.m, x.start));
}

const TYPE_SIZE = /** @type {Record<number, number>} */ ({ 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 });

/**
 * The same fields from a bare TIFF block (Exif in an HEIC file, public/heic.js).
 * @param {Uint8Array} t
 * @returns {PhotoMeta}
 */
export function readExifTiff(t) {
  /** @type {PhotoMeta} */
  const out = { lat: null, lon: null, takenAt: null, orientation: null };
  try {
    readTiff(t, out);
  } catch {
    // Keep whatever was read before the damage.
  }
  return out;
}

/**
 * The EXIF fields the upload uses. Fields that are missing or malformed come
 * back as null; this never throws on a bad file.
 * @param {Uint8Array} b
 * @returns {PhotoMeta}
 */
export function readExif(b) {
  /** @type {PhotoMeta} */
  const out = { lat: null, lon: null, takenAt: null, orientation: null };
  let done = false;
  walk(b, (m, start, length) => {
    if (done || m !== 0xe1 || !startsWith(b, start + 4, 'Exif\0\0')) return;
    done = true;
    try {
      readTiff(b.subarray(start + 10, start + length), out);
    } catch {
      // A truncated or hostile TIFF block: keep whatever was read before it.
    }
  });
  return out;
}

/** @param {Uint8Array} t @param {PhotoMeta} out */
function readTiff(t, out) {
  const v = new DataView(t.buffer, t.byteOffset, t.byteLength);
  const order = v.getUint16(0);
  if (order !== 0x4949 && order !== 0x4d4d) return;
  const le = order === 0x4949;
  if (v.getUint16(2, le) !== 42) return;
  const u16 = (/** @type {number} */ at) => v.getUint16(at, le);
  const u32 = (/** @type {number} */ at) => v.getUint32(at, le);

  /**
   * The entries of one IFD by tag: where the value is, its type and count.
   * @param {number} off
   */
  const ifd = (off) => {
    /** @type {Map<number, { type: number, count: number, at: number }>} */
    const tags = new Map();
    if (off < 8 || off + 2 > t.length) return tags;
    const n = u16(off);
    if (n > 512 || off + 2 + n * 12 > t.length) return tags;
    for (let k = 0; k < n; k++) {
      const e = off + 2 + k * 12;
      const type = u16(e + 2);
      const count = u32(e + 4);
      const size = TYPE_SIZE[type];
      if (!size || count > 4096) continue;
      const at = size * count <= 4 ? e + 8 : u32(e + 8);
      if (at + size * count > t.length) continue;
      tags.set(u16(e), { type, count, at });
    }
    return tags;
  };
  /** @param {{ type: number, count: number, at: number } | undefined} e */
  const ascii = (e) => {
    if (!e || e.type !== 2) return null;
    let s = '';
    for (let k = 0; k < e.count && t[e.at + k] !== 0; k++) s += String.fromCharCode(t[e.at + k]);
    return s;
  };
  /** @param {{ type: number, count: number, at: number } | undefined} e */
  const pointer = (e) => (e && e.type === 4 && e.count === 1 ? u32(e.at) : 0);

  const ifd0 = ifd(u32(4));
  const o = ifd0.get(0x0112);
  if (o && o.type === 3 && o.count === 1) {
    const value = u16(o.at);
    if (value >= 1 && value <= 8) out.orientation = value;
  }

  const exif = ifd(pointer(ifd0.get(0x8769)));
  const when = ascii(exif.get(0x9003));
  const m = when?.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (m && m[1] !== '0000') {
    const offset = ascii(exif.get(0x9011));
    out.takenAt = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}` + (offset && /^[+-]\d{2}:\d{2}$/.test(offset) ? offset : '');
  }

  const gps = ifd(pointer(ifd0.get(0x8825)));
  /** @param {number} refTag @param {number} tag @param {string} neg @param {number} max */
  const coord = (refTag, tag, neg, max) => {
    const e = gps.get(tag);
    const ref = ascii(gps.get(refTag));
    if (!e || e.type !== 5 || e.count !== 3 || !ref) return null;
    let deg = 0;
    for (let k = 0; k < 3; k++) {
      const num = u32(e.at + k * 8);
      const den = u32(e.at + k * 8 + 4);
      if (den === 0) return null;
      deg += num / den / 60 ** k;
    }
    if (!(deg <= max)) return null;
    return ref.toUpperCase() === neg ? -deg : deg;
  };
  const lat = coord(1, 2, 'S', 90);
  const lon = coord(3, 4, 'W', 180);
  // Some cameras write 0,0 when they have no fix.
  if (lat !== null && lon !== null && (lat !== 0 || lon !== 0)) {
    out.lat = lat;
    out.lon = lon;
  }
}

/**
 * Width and height from the frame header (SOFn), or null when there is none.
 * @param {Uint8Array} b
 * @returns {{ width: number, height: number } | null}
 */
export function jpegSize(b) {
  /** @type {{ width: number, height: number } | null} */
  let size = null;
  walk(b, (m, start) => {
    // SOF0 to SOF15, except DHT (C4), JPG (C8) and DAC (CC).
    if (size || m < 0xc0 || m > 0xcf || m === 0xc4 || m === 0xc8 || m === 0xcc) return;
    if (start + 9 > b.length) return;
    size = { height: (b[start + 5] << 8) | b[start + 6], width: (b[start + 7] << 8) | b[start + 8] };
  });
  return size;
}
