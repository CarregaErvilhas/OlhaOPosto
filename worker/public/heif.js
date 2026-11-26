// The metadata of HEIC/HEIF photos (iPhone, many Android phones), shared by
// the upload page (public/heic.js) and the tests. readHeicExif finds the Exif
// item inside the ISOBMFF boxes (meta → iinf, iloc) and hands its TIFF block
// to the JPEG reader, so the GPS and date come out the same way as from a
// JPEG. It never throws on a bad file.
import { readExifTiff } from './jpeg.js';

/** @typedef {{ type: string, start: number, end: number }} Box */

/** @type {(b: Uint8Array, at: number) => number} */
const u32 = (b, at) => ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
/** @type {(b: Uint8Array, at: number) => number} */
const u16 = (b, at) => (b[at] << 8) | b[at + 1];
/** @type {(b: Uint8Array, at: number) => string} */
const type = (b, at) => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);

/**
 * The boxes in b[from, to), with the start of each payload.
 * @param {Uint8Array} b @param {number} from @param {number} to
 * @returns {Box[]}
 */
function boxes(b, from, to) {
  /** @type {Box[]} */
  const out = [];
  let at = from;
  while (at + 8 <= to) {
    let size = u32(b, at);
    let header = 8;
    if (size === 1) {
      // 64-bit size: photos never need the high half.
      if (at + 16 > to || u32(b, at + 8) !== 0) break;
      size = u32(b, at + 12);
      header = 16;
    } else if (size === 0) {
      size = to - at;
    }
    if (size < header || at + size > to) break;
    out.push({ type: type(b, at + 4), start: at + header, end: at + size });
    at += size;
  }
  return out;
}

/**
 * Is this an HEIF file? The ftyp box names the brand.
 * @param {Uint8Array} b
 */
export function isHeic(b) {
  if (b.length < 12 || type(b, 4) !== 'ftyp') return false;
  const size = Math.min(u32(b, 0), b.length);
  for (let at = 8; at + 4 <= size; at += 4) {
    if (at === 12) continue; // minor version
    if (['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1'].includes(type(b, at))) return true;
  }
  return false;
}

/**
 * The item id of the Exif item, from iinf (infe version 2 or 3).
 * @param {Uint8Array} b @param {Box} iinf
 * @returns {number | null}
 */
function exifItemId(b, iinf) {
  const version = b[iinf.start];
  const first = iinf.start + 4 + (version === 0 ? 2 : 4);
  for (const infe of boxes(b, first, iinf.end)) {
    if (infe.type !== 'infe') continue;
    const v = b[infe.start];
    if (v < 2) continue;
    const id = v === 2 ? u16(b, infe.start + 4) : u32(b, infe.start + 4);
    const at = infe.start + 4 + (v === 2 ? 2 : 4) + 2;
    if (type(b, at) === 'Exif') return id;
  }
  return null;
}

/**
 * Offset and length of an item, from iloc (construction method 0: in the file).
 * @param {Uint8Array} b @param {Box} iloc @param {number} wanted
 * @returns {{ offset: number, length: number } | null}
 */
function itemExtent(b, iloc, wanted) {
  const v = b[iloc.start];
  let at = iloc.start + 4;
  const offsetSize = b[at] >> 4;
  const lengthSize = b[at] & 15;
  const baseSize = b[at + 1] >> 4;
  const indexSize = v === 1 || v === 2 ? b[at + 1] & 15 : 0;
  at += 2;
  /** @param {number} n */
  const read = (n) => {
    let x = 0;
    for (let i = 0; i < n; i++) x = x * 256 + b[at + i];
    at += n;
    return x;
  };
  const count = v < 2 ? read(2) : read(4);
  for (let i = 0; i < count && at < iloc.end; i++) {
    const id = v < 2 ? read(2) : read(4);
    const method = v === 1 || v === 2 ? read(2) & 15 : 0;
    read(2); // data reference index
    const base = read(baseSize);
    const extents = read(2);
    /** @type {{ offset: number, length: number } | null} */
    let first = null;
    for (let e = 0; e < extents; e++) {
      if (indexSize) read(indexSize);
      const offset = read(offsetSize);
      const length = read(lengthSize);
      if (e === 0) first = { offset: base + offset, length };
    }
    if (id === wanted) return method === 0 ? first : null;
  }
  return null;
}

/**
 * Date, GPS and orientation of an HEIC photo, or all null.
 * @param {Uint8Array} b
 */
export function readHeicExif(b) {
  /** @type {import('./jpeg.js').PhotoMeta} */
  const none = { lat: null, lon: null, takenAt: null, orientation: null };
  try {
    const meta = boxes(b, 0, b.length).find((x) => x.type === 'meta');
    if (!meta) return none;
    const inner = boxes(b, meta.start + 4, meta.end); // meta is a full box
    const iinf = inner.find((x) => x.type === 'iinf');
    const iloc = inner.find((x) => x.type === 'iloc');
    if (!iinf || !iloc) return none;
    const id = exifItemId(b, iinf);
    if (id === null) return none;
    const ext = itemExtent(b, iloc, id);
    if (!ext || ext.offset + ext.length > b.length || ext.length < 10) return none;
    // The item starts with the offset of the TIFF header, usually after "Exif\0\0".
    const skip = u32(b, ext.offset);
    const tiff = ext.offset + 4 + skip;
    if (tiff >= ext.offset + ext.length) return none;
    return readExifTiff(b.subarray(tiff, ext.offset + ext.length));
  } catch {
    return none;
  }
}
