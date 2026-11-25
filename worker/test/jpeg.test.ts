import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isCleanJpeg, jpegSize, readExif, stripMetadata } from '../public/jpeg.js';

// A tiny TIFF writer, enough for the tags the upload reads.
type Entry = { tag: number; type: number; values: number[] | string };

function tiff(le: boolean, ifd0: Entry[], exif: Entry[] = [], gps: Entry[] = []): Uint8Array {
  const buf = new Uint8Array(4096);
  const v = new DataView(buf.buffer);
  buf.set(le ? [0x49, 0x49] : [0x4d, 0x4d]);
  v.setUint16(2, 42, le);
  v.setUint32(4, 8, le);
  let free = 8;
  // Writes one IFD at `free`, its out-of-line values after it, and returns its offset.
  const write = (entries: Entry[]): number => {
    const at = free;
    v.setUint16(at, entries.length, le);
    let data = at + 2 + entries.length * 12 + 4;
    entries.forEach((e, k) => {
      const p = at + 2 + k * 12;
      const bytes: number[] = [];
      const w = new DataView(new ArrayBuffer(8));
      if (typeof e.values === 'string') for (const ch of e.values + '\0') bytes.push(ch.charCodeAt(0));
      else for (const n of e.values) {
        if (e.type === 3) { w.setUint16(0, n, le); bytes.push(...new Uint8Array(w.buffer, 0, 2)); }
        else { w.setUint32(0, n, le); bytes.push(...new Uint8Array(w.buffer, 0, 4)); }
      }
      const count = typeof e.values === 'string' ? bytes.length : e.type === 5 ? e.values.length / 2 : e.values.length;
      v.setUint16(p, e.tag, le);
      v.setUint16(p + 2, e.type, le);
      v.setUint32(p + 4, count, le);
      if (bytes.length <= 4) buf.set(bytes, p + 8);
      else {
        v.setUint32(p + 8, data, le);
        buf.set(bytes, data);
        data += bytes.length + (bytes.length % 2);
      }
    });
    free = data;
    return at;
  };
  // IFD0 goes first at offset 8; the sub-IFD pointers are patched in after.
  const exifPtr: Entry = { tag: 0x8769, type: 4, values: [0] };
  const gpsPtr: Entry = { tag: 0x8825, type: 4, values: [0] };
  const all = [...ifd0, ...(exif.length ? [exifPtr] : []), ...(gps.length ? [gpsPtr] : [])];
  write(all);
  const patch = (tag: number, off: number) => {
    const n = v.getUint16(8, le);
    for (let k = 0; k < n; k++) if (v.getUint16(10 + k * 12, le) === tag) v.setUint32(10 + k * 12 + 8, off, le);
  };
  if (exif.length) patch(0x8769, write(exif));
  if (gps.length) patch(0x8825, write(gps));
  return buf.subarray(0, free);
}

const seg = (marker: number, payload: Uint8Array | number[]) => {
  const p = Uint8Array.from(payload);
  return Uint8Array.from([0xff, marker, (p.length + 2) >> 8, (p.length + 2) & 0xff, ...p]);
};
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

const SOI = Uint8Array.from([0xff, 0xd8]);
const JFIF = seg(0xe0, ascii('JFIF\0\x01\x01\0\0\x01\0\x01\0\0'));
const DQT = seg(0xdb, new Array(65).fill(1));
// SOS header, a few bytes of "scan data" (with a stuffed 0xFF00) and EOI.
const SCAN = Uint8Array.from([0xff, 0xda, 0x00, 0x08, 1, 1, 0, 0, 0x3f, 0, 0x12, 0xff, 0x00, 0x34, 0xff, 0xd9]);
const exifSeg = (t: Uint8Array) => seg(0xe1, concat(Uint8Array.from(ascii('Exif\0\0')), t));

// 38° 42' 20.28" N, 9° 8' 21.48" W: Lisbon.
const GPS: Entry[] = [
  { tag: 1, type: 2, values: 'N' },
  { tag: 2, type: 5, values: [38, 1, 42, 1, 2028, 100] },
  { tag: 3, type: 2, values: 'W' },
  { tag: 4, type: 5, values: [9, 1, 8, 1, 2148, 100] },
];
const EXIF: Entry[] = [
  { tag: 0x9003, type: 2, values: '2026:05:17 14:03:09' },
  { tag: 0x9011, type: 2, values: '+01:00' },
];

for (const le of [true, false]) {
  test(`readExif: GPS, date and orientation (${le ? 'little' : 'big'} endian)`, () => {
    const jpeg = concat(SOI, JFIF, exifSeg(tiff(le, [{ tag: 0x0112, type: 3, values: [6] }], EXIF, GPS)), DQT, SCAN);
    const m = readExif(jpeg);
    assert.ok(Math.abs(m.lat! - 38.705633) < 1e-6, String(m.lat));
    assert.ok(Math.abs(m.lon! - -9.139300) < 1e-6, String(m.lon));
    assert.equal(m.takenAt, '2026-05-17T14:03:09+01:00');
    assert.equal(m.orientation, 6);
  });
}

test('readExif: nothing to read gives nulls, never a throw', () => {
  const none = { lat: null, lon: null, takenAt: null, orientation: null };
  assert.deepEqual(readExif(concat(SOI, JFIF, DQT, SCAN)), none);
  assert.deepEqual(readExif(new Uint8Array(0)), none);
  assert.deepEqual(readExif(Uint8Array.from([0x89, 0x50, 0x4e, 0x47])), none);
  // An EXIF block cut short, and one with offsets pointing past its end.
  const full = tiff(true, [{ tag: 0x0112, type: 3, values: [3] }], EXIF, GPS);
  for (let cut = 0; cut < full.length; cut += 7) {
    readExif(concat(SOI, exifSeg(full.subarray(0, cut)), DQT, SCAN));
  }
  const bad = full.slice();
  new DataView(bad.buffer).setUint32(4, 0xfffffff0, true);
  assert.deepEqual(readExif(concat(SOI, exifSeg(bad), DQT, SCAN)), none);
});

test('readExif: refuses 0,0, a zero denominator and a bad date', () => {
  const zero: Entry[] = [
    { tag: 1, type: 2, values: 'N' }, { tag: 2, type: 5, values: [0, 1, 0, 1, 0, 1] },
    { tag: 3, type: 2, values: 'E' }, { tag: 4, type: 5, values: [0, 1, 0, 1, 0, 1] },
  ];
  const noDen: Entry[] = [
    { tag: 1, type: 2, values: 'N' }, { tag: 2, type: 5, values: [38, 0, 0, 1, 0, 1] },
    { tag: 3, type: 2, values: 'W' }, { tag: 4, type: 5, values: [9, 1, 0, 1, 0, 1] },
  ];
  const badDate: Entry[] = [{ tag: 0x9003, type: 2, values: '0000:00:00 00:00:00' }];
  for (const [exif, gps] of [[[], zero], [[], noDen], [badDate, []]] as Entry[][][]) {
    const m = readExif(concat(SOI, exifSeg(tiff(true, [], exif, gps)), DQT, SCAN));
    assert.equal(m.lat, null);
    assert.equal(m.takenAt, null);
  }
});

test('stripMetadata drops EXIF, XMP, IPTC, MPF and comments, keeps the image', () => {
  const xmp = seg(0xe1, ascii('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta/>'));
  const iptc = seg(0xed, ascii('Photoshop 3.0\0'));
  const mpf = seg(0xe2, ascii('MPF\0\0\0\0\0'));
  const icc = seg(0xe2, ascii('ICC_PROFILE\0\x01\x01profile'));
  const adobe = seg(0xee, ascii('Adobe\0\x64\0\0\0\0\x01'));
  const comment = seg(0xfe, ascii('made on a phone'));
  const dirty = concat(SOI, JFIF, exifSeg(tiff(true, [], EXIF, GPS)), xmp, iptc, mpf, icc, adobe, comment, DQT, SCAN);
  assert.equal(isCleanJpeg(dirty), false);
  const clean = stripMetadata(dirty)!;
  assert.deepEqual(clean, concat(SOI, JFIF, icc, adobe, DQT, SCAN));
  assert.equal(isCleanJpeg(clean), true);
  assert.deepEqual(readExif(clean), { lat: null, lon: null, takenAt: null, orientation: null });
  // Already clean: same bytes back.
  assert.deepEqual(stripMetadata(clean), clean);
});

test('isCleanJpeg looks past the first scan: trailing data and segments between scans', () => {
  const clean = concat(SOI, JFIF, DQT, SCAN);
  assert.equal(isCleanJpeg(clean), true);
  // A Motion Photo appends a video after EOI; a second image can follow too.
  const trailing = concat(clean, Uint8Array.from([0, 0, 0, 0x18, ...ascii('ftypmp42')]));
  assert.equal(isCleanJpeg(trailing), false);
  assert.deepEqual(stripMetadata(trailing), clean);
  // Progressive: a second scan, with a comment and an EXIF block hidden between the scans.
  const scan1 = SCAN.subarray(0, SCAN.length - 2);
  const hidden = concat(SOI, JFIF, DQT, scan1, seg(0xfe, ascii('hi')), exifSeg(tiff(true, [], EXIF, GPS)), SCAN);
  assert.equal(isCleanJpeg(hidden), false);
  assert.deepEqual(stripMetadata(hidden), concat(SOI, JFIF, DQT, scan1, SCAN));
  assert.equal(isCleanJpeg(stripMetadata(hidden)!), true);
  // Restart markers and stuffed bytes inside scan data are part of the data.
  const restarts = concat(SOI, JFIF, DQT, Uint8Array.from([0xff, 0xda, 0x00, 0x08, 1, 1, 0, 0, 0x3f, 0, 0x01, 0xff, 0xd0, 0x02, 0xff, 0x00, 0xff, 0xd1, 0x03, 0xff, 0xd9]));
  assert.equal(isCleanJpeg(restarts), true);
  assert.deepEqual(stripMetadata(restarts), restarts);
});

test('stripMetadata and isCleanJpeg refuse what is not a well-formed JPEG', () => {
  for (const b of [
    new Uint8Array(0),
    Uint8Array.from([0xff, 0xd8]),
    concat(SOI, JFIF, DQT),                                    // no scan data
    concat(SOI, Uint8Array.from([0xff, 0xe1, 0x40, 0x00, 1])), // length past the end
    concat(SOI, Uint8Array.from([0x00]), JFIF, SCAN),          // junk between segments
    concat(Uint8Array.from([0x89, 0x50]), JFIF, SCAN),         // not a JPEG at all
    concat(SOI, JFIF, DQT, SCAN.subarray(0, SCAN.length - 2)), // cut before EOI
  ]) {
    assert.equal(stripMetadata(b), null);
    assert.equal(isCleanJpeg(b), false);
  }
});

test('jpegSize reads the frame header', () => {
  // SOF0: precision 8, height 600, width 1024, 3 components.
  const sof = seg(0xc0, [8, 0x02, 0x58, 0x04, 0x00, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  assert.deepEqual(jpegSize(concat(SOI, JFIF, DQT, sof, SCAN)), { width: 1024, height: 600 });
  // A DHT (C4) is not a frame header.
  assert.equal(jpegSize(concat(SOI, JFIF, seg(0xc4, [0, 1, 2, 3, 4, 5, 6, 7]), SCAN)), null);
  assert.equal(jpegSize(new Uint8Array(0)), null);
});
