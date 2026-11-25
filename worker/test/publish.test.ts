import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isCleanJpeg, jpegSize } from '../public/jpeg.js';
import { publishMain, withXmp, xmpPacket, type PublishEnv } from '../src/publish.ts';

function jpeg(width: number, height: number, extra: number[] = []): Uint8Array {
  const seg = (m: number, p: number[]) => [0xff, m, (p.length + 2) >> 8, (p.length + 2) & 0xff, ...p];
  return Uint8Array.from([
    0xff, 0xd8,
    ...seg(0xe0, [74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]),
    ...extra,
    ...seg(0xdb, new Array(65).fill(1)),
    ...seg(0xc0, [8, height >> 8, height & 0xff, width >> 8, width & 0xff, 1, 1, 0x11, 0]),
    0xff, 0xda, 0, 8, 1, 1, 0, 0, 0x3f, 0, 0x12, 0x34, 0xff, 0xd9,
  ]);
}
const EXIF = [0xff, 0xe1, 0, 8, 69, 120, 105, 102, 0, 0];
const text = (b: Uint8Array) => new TextDecoder().decode(b);

test('xmpPacket: author escaped, licence and credit page', () => {
  const x = xmpPacket({ author: 'Ana <&> "x"', stationId: 'EZC-AMD-00051' });
  assert.ok(x.includes('<rdf:li>Ana &#60;&#38;&#62; &#34;x&#34;</rdf:li>'));
  assert.ok(x.includes('https://creativecommons.org/licenses/by-sa/4.0/'));
  assert.ok(x.includes('https://olhaoposto.ocarroeletrico.com/postos/EZC-AMD-00051'));
  assert.ok(!/gps|lat|lon/i.test(x.replace(/xmlns|creativecommons|olhaoposto|xpacket|attribution/gi, '')));
});

test('withXmp: one APP1 XMP after JFIF, the image untouched', () => {
  const src = jpeg(1024, 768);
  const out = withXmp(src, xmpPacket({ author: 'Ana', stationId: 'X-1' }));
  assert.deepEqual(jpegSize(out), { width: 1024, height: 768 });
  assert.deepEqual([...out.subarray(0, 4)], [0xff, 0xd8, 0xff, 0xe0]);   // JFIF still first
  assert.deepEqual([...out.subarray(20, 22)], [0xff, 0xe1]);
  assert.ok(text(out).includes('http://ns.adobe.com/xap/1.0/\0<?xpacket'));
  assert.deepEqual([...out.subarray(out.length - (src.length - 20))], [...src.subarray(20)]);
  assert.equal(isCleanJpeg(out), false);   // it does carry metadata now, on purpose
});

// --- publishMain with fake D1, R2 and Panoramax ---

function world(opts: { evse?: string | null; taken?: string[]; hd?: Uint8Array | number; staged?: boolean } = {}) {
  const selections = new Map<string, string>(opts.taken?.map((t) => [t, 'older']) ?? []);
  const published: string[] = [];
  const r2 = new Map<string, { bytes: Uint8Array; meta: unknown }>();
  const staged = opts.staged === false ? new Map() : new Map([['p1/main.jpg', jpeg(1024, 768)], ['p1/thumb.jpg', jpeg(400, 300)]]);
  const stmt = (sql: string) => {
    let a: unknown[] = [];
    const s = {
      bind(...x: unknown[]) { a = x; return s; },
      async first() {
        return { id: 'p1', station_id: 'EZC-AMD-00051', evse_compact: opts.evse === undefined ? 'PTEZCEAMD000511' : opts.evse, credit: 'Ana', panoramax_id: 'pic-1' };
      },
      async run() {
        if (sql.startsWith('INSERT OR IGNORE INTO selections')) {
          if (selections.has(a[0] as string)) return { meta: { changes: 0 } };
          selections.set(a[0] as string, a[2] as string);
          return { meta: { changes: 1 } };
        }
        if (sql.startsWith('UPDATE selections')) published.push(a[1] as string);
        if (sql.startsWith('DELETE FROM selections')) selections.delete(a[0] as string);
        return { meta: { changes: 1 } };
      },
    };
    return s;
  };
  const env = {
    DB: { prepare: stmt },
    PANORAMAX_TOKEN: 'token', PANORAMAX_URL: 'https://pano.test',
    STAGING: { async get(k: string) { const b = staged.get(k); return b ? { arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) } : null; } },
    PICTURES: {
      async put(k: string, bytes: Uint8Array, meta: unknown) { r2.set(k, { bytes, meta }); },
      async delete(keys: string[]) { for (const k of keys) r2.delete(k); },
    },
  } as unknown as PublishEnv;
  const fetches: string[] = [];
  const fetcher = async (url: string) => {
    fetches.push(url);
    const hd = opts.hd ?? jpeg(2048, 1536, EXIF);
    return typeof hd === 'number' ? new Response('no', { status: hd }) : new Response(hd);
  };
  return { env, selections, published, r2, fetcher, fetches };
}

test('publishMain: socket photo becomes main of the socket and of a station without one', async () => {
  const w = world();
  assert.deepEqual(await publishMain(w.env, 'p1', 'mod', w.fetcher), ['PTEZCEAMD000511', 'EZC-AMD-00051']);
  assert.deepEqual([...w.r2.keys()].sort(), [
    'EZC-AMD-00051.full.jpg', 'EZC-AMD-00051.jpg', 'EZC-AMD-00051.thumb.jpg',
    'PTEZCEAMD000511.full.jpg', 'PTEZCEAMD000511.jpg', 'PTEZCEAMD000511.thumb.jpg',
  ]);
  assert.deepEqual(w.published, ['PTEZCEAMD000511', 'EZC-AMD-00051']);
  assert.deepEqual(w.fetches, ['https://pano.test/api/pictures/pic-1/hd.jpg']);
  const full = w.r2.get('EZC-AMD-00051.full.jpg')!;
  assert.deepEqual(jpegSize(full.bytes), { width: 2048, height: 1536 });
  assert.ok(!text(full.bytes).includes('Exif\0'));            // Panoramax's EXIF is gone
  assert.ok(text(full.bytes).includes('<rdf:li>Ana</rdf:li>'));
  assert.deepEqual(full.meta, { httpMetadata: { contentType: 'image/jpeg', cacheControl: 'public, max-age=86400' } });
  assert.deepEqual(jpegSize(w.r2.get('EZC-AMD-00051.thumb.jpg')!.bytes), { width: 400, height: 300 });
});

test('publishMain: targets that already have a main photo are left alone', async () => {
  const w = world({ taken: ['EZC-AMD-00051'] });
  assert.deepEqual(await publishMain(w.env, 'p1', 'mod', w.fetcher), ['PTEZCEAMD000511']);
  assert.equal(w.selections.get('EZC-AMD-00051'), 'older');
  const none = world({ evse: null, taken: ['EZC-AMD-00051'] });
  assert.deepEqual(await publishMain(none.env, 'p1', 'mod', none.fetcher), []);
  assert.equal(none.r2.size, 0);
  assert.equal(none.fetches.length, 0);
});

test('publishMain: a failure leaves no copies and frees the targets', async () => {
  for (const w of [world({ hd: 500 }), world({ staged: false })]) {
    await assert.rejects(publishMain(w.env, 'p1', 'mod', w.fetcher));
    assert.equal(w.r2.size, 0);
    assert.equal(w.selections.size, 0);
  }
});
