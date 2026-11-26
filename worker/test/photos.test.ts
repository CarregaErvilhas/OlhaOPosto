import assert from 'node:assert/strict';
import { test } from 'node:test';

import { checkImage, parseMeta, sameShape, submitPhoto, uploadsOpen, type PhotoEnv } from '../src/photos.ts';

// A minimal clean JPEG of a given size: SOI, JFIF, DQT, SOF0, scan, EOI.
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

const NOW = new Date('2026-11-25T10:00:00Z');
const goodMeta = {
  station: 'EZC-AMD-00051', target: 'PTEZCEAMD000511', taken_at: '2026-11-20T10:15:00+00:00',
  exif_lat: 38.788, exif_lon: -9.2266, license: true, no_people: true,
};

test('parseMeta: accepts a full upload and one without GPS or date', () => {
  assert.deepEqual(parseMeta(JSON.stringify(goodMeta), NOW), {
    station: 'EZC-AMD-00051', target: 'PTEZCEAMD000511', taken_at: '2026-11-20T10:15:00+00:00', exif_lat: 38.788, exif_lon: -9.2266,
  });
  const bare = parseMeta(JSON.stringify({ ...goodMeta, taken_at: null, exif_lat: null, exif_lon: null }), NOW);
  assert.deepEqual(bare, { station: 'EZC-AMD-00051', target: 'PTEZCEAMD000511', taken_at: null, exif_lat: null, exif_lon: null });
});

test('parseMeta: consents, targets, dates and coordinates are checked', () => {
  const p = (over: Record<string, unknown>) => parseMeta(JSON.stringify({ ...goodMeta, ...over }), NOW);
  assert.equal(p({ license: false }), 'consent_required');
  assert.equal(p({ no_people: 'yes' }), 'consent_required');
  assert.equal(p({ station: '../x' }), 'bad_target');
  assert.equal(p({ target: 'a b' }), 'bad_target');
  assert.equal(p({ taken_at: '2026-11-20 10:15:00' }), 'bad_meta');
  assert.equal(p({ taken_at: '2027-01-01T00:00:00Z' }), 'bad_meta');   // the future
  assert.equal(p({ taken_at: '1999-12-31T23:59:59Z' }), 'bad_meta');
  assert.equal(p({ exif_lat: 91 }), 'bad_meta');
  assert.equal(p({ exif_lon: null }), 'bad_meta');                      // half a position
  assert.equal(p({ exif_lat: '38.7' }), 'bad_meta');
  assert.equal(parseMeta('{', NOW), 'bad_meta');
  assert.equal(parseMeta(null, NOW), 'bad_meta');
  assert.equal(parseMeta('x'.repeat(3000), NOW), 'bad_meta');
});

test('checkImage: clean JPEG within its size, nothing else', () => {
  assert.deepEqual(checkImage(jpeg(2048, 1536), 'full'), { width: 2048, height: 1536 });
  assert.deepEqual(checkImage(jpeg(300, 400), 'thumb'), { width: 300, height: 400 });
  assert.equal(checkImage(jpeg(2049, 1536), 'full'), null);
  assert.equal(checkImage(jpeg(1025, 700), 'main'), null);
  assert.equal(checkImage(jpeg(50, 40), 'full'), null);
  assert.equal(checkImage(jpeg(2048, 1536, EXIF), 'full'), null);
  assert.equal(checkImage(new Uint8Array([1, 2, 3]), 'thumb'), null);
});

test('sameShape: the three sizes must be one picture', () => {
  assert.ok(sameShape({ width: 2048, height: 1536 }, { width: 400, height: 300 }));
  assert.ok(sameShape({ width: 1536, height: 2048 }, { width: 300, height: 400 }));
  assert.ok(sameShape({ width: 2048, height: 1365 }, { width: 400, height: 267 }));
  assert.ok(!sameShape({ width: 2048, height: 1536 }, { width: 400, height: 400 }));
});

// --- submitPhoto, with fake D1, R2 and Panoramax ---

interface Fakes {
  env: PhotoEnv;
  rows: Map<string, Record<string, unknown>>;
  r2: Map<string, Uint8Array>;
  calls: { url: string; method: string }[];
  waits: Promise<unknown>[];
  licenseSet: number;
  // What siteverify answers, and what it was asked.
  turnstile: Record<string, unknown>;
  verified: { response: unknown; remoteip: unknown; secret: unknown }[];
}

function fakes(opts: { count?: number; panoramax?: number; role?: string; socket?: boolean; turnstile?: Record<string, unknown> } = {}): Fakes {
  const rows = new Map<string, Record<string, unknown>>();
  const r2 = new Map<string, Uint8Array>();
  const f: Fakes = {
    env: {} as PhotoEnv, rows, r2, calls: [], waits: [], licenseSet: 0, verified: [],
    turnstile: opts.turnstile ?? { success: true, hostname: 'olhaoposto.ocarroeletrico.com', action: 'upload' },
  };
  const stmt = (sql: string) => {
    let args: unknown[] = [];
    const s = {
      bind(...a: unknown[]) { args = a; return s; },
      async first<T>(): Promise<T | null> {
        if (sql.includes('FROM api_tokens')) {
          return { token_id: 't1', scopes: 'photos:write', last_used_at: NOW.toISOString(), id: 'u1', name: 'Ana', role: opts.role ?? 'contributor' } as T;
        }
        if (sql.includes('FROM sessions')) return { id: 'u1', name: 'Ana', role: opts.role ?? 'contributor' } as T;
        if (sql.includes('FROM stations')) return (args[0] === 'EZC-AMD-00051' ? { lat: 38.78791, lon: -9.226767 } : null) as T;
        if (sql.includes('FROM evses')) return (opts.socket === false ? null : { evse_id: 'PT*EZC*E*AMD*00051*1' }) as T;
        if (sql.includes('COUNT(*)')) return { n: opts.count ?? 0 } as T;
        return null;
      },
      async run() {
        if (sql.startsWith('INSERT INTO photos')) {
          rows.set(args[0] as string, { station_id: args[1], evse_compact: args[2], distance_m: args[7], credit: args[8], status: 'uploading' });
        } else if (sql.includes(`SET status = ?`)) {
          Object.assign(rows.get(args[5] as string)!, { status: args[0], panoramax_set: args[1], panoramax_id: args[2] });
        } else if (sql.includes(`SET status = 'failed'`)) {
          rows.get(args[0] as string)!.status = 'failed';
        } else if (sql.includes('license_accepted_at')) {
          f.licenseSet++;
        }
        return {};
      },
    };
    return s;
  };
  f.env = {
    DB: { prepare: stmt, batch: async (ss: { run(): Promise<unknown> }[]) => { for (const s of ss) await s.run(); } },
    OSM_CLIENT_ID: 'id', OSM_CLIENT_SECRET: 'secret', PANORAMAX_TOKEN: 'token', PANORAMAX_URL: 'https://pano.test',
    TURNSTILE_SITEKEY: 'site-key', TURNSTILE_SECRET: 'ts-secret',
    STAGING: {
      async put(k: string, v: Uint8Array) { r2.set(k, v); },
      async delete(keys: string | string[]) { for (const k of [keys].flat()) r2.delete(k); },
    },
  } as unknown as PhotoEnv;
  return f;
}

function fakeFetch(f: Fakes, status = 200) {
  return async (url: string, init?: RequestInit) => {
    const json = (body: unknown, s = 200) => new Response(JSON.stringify(body), { status: s });
    if (url === 'https://challenges.cloudflare.com/turnstile/v0/siteverify') {
      const b = init?.body as FormData;
      f.verified.push({ response: b.get('response'), remoteip: b.get('remoteip'), secret: b.get('secret') });
      return json(f.turnstile);
    }
    f.calls.push({ url, method: init?.method ?? 'GET' });
    if (url.endsWith('/api/upload_sets') && init?.method === 'POST') return json({ id: 'set-1' });
    if (url.endsWith('/files')) return status === 200 ? json({ picture_id: 'pic-1' }) : json({ message: 'no' }, status);
    if (url.endsWith('/complete')) return json({ completed: true });
    return json({});
  };
}

function upload(opts: { meta?: Record<string, unknown>; origin?: string; full?: Uint8Array; turnstile?: string | null; token?: string } = {}) {
  const body = new FormData();
  body.append('full', new Blob([opts.full ?? jpeg(2048, 1536)], { type: 'image/jpeg' }), 'full.jpg');
  body.append('main', new Blob([jpeg(1024, 768)], { type: 'image/jpeg' }), 'main.jpg');
  body.append('thumb', new Blob([jpeg(400, 300)], { type: 'image/jpeg' }), 'thumb.jpg');
  body.append('meta', JSON.stringify(opts.meta ?? goodMeta));
  if (opts.turnstile !== null) body.append('turnstile', opts.turnstile ?? 'ts-token');
  return new Request('https://olhaoposto.ocarroeletrico.com/api/v1/photos', {
    method: 'POST', body,
    headers: opts.token
      ? { authorization: `Bearer ${opts.token}`, 'cf-connecting-ip': '192.0.2.1' }
      : { origin: opts.origin ?? 'https://olhaoposto.ocarroeletrico.com', cookie: '__Host-oop_session=abc', 'cf-connecting-ip': '192.0.2.1' },
  });
}

const run = async (f: Fakes, req: Request, status = 200) => {
  const res = await submitPhoto(req, f.env, { waitUntil: (p) => f.waits.push(p) }, fakeFetch(f, status), NOW);
  await Promise.all(f.waits);
  return { status: res.status, body: await res.json() as Record<string, unknown> };
};

test('submitPhoto: closed until sign-in, the token and the bucket all exist', async () => {
  const f = fakes();
  assert.equal(uploadsOpen(f.env), true);
  for (const key of ['PANORAMAX_TOKEN', 'STAGING', 'OSM_CLIENT_SECRET', 'TURNSTILE_SITEKEY', 'TURNSTILE_SECRET'] as const) {
    const g = fakes();
    delete (g.env as unknown as Record<string, unknown>)[key];
    assert.deepEqual(await run(g, upload()), { status: 503, body: { error: 'uploads_closed' } });
  }
});

test('submitPhoto: a good upload lands in Panoramax, staging and D1', async () => {
  const f = fakes();
  const { status, body } = await run(f, upload());
  assert.equal(status, 201);
  const row = f.rows.get(body.id as string)!;
  assert.equal(row.status, 'pending');
  assert.equal(row.panoramax_set, 'set-1');
  assert.equal(row.panoramax_id, 'pic-1');
  assert.equal(row.evse_compact, 'PTEZCEAMD000511');
  assert.equal(row.credit, 'Ana');
  assert.ok((row.distance_m as number) < 30);
  assert.deepEqual([...f.r2.keys()].sort(), [`${body.id}/main.jpg`, `${body.id}/thumb.jpg`]);
  assert.deepEqual(f.calls.map((c) => `${c.method} ${c.url.replace('https://pano.test', '')}`), [
    'POST /api/upload_sets', 'POST /api/upload_sets/set-1/files', 'POST /api/upload_sets/set-1/complete',
  ]);
  assert.equal(f.licenseSet, 1);
});

test('submitPhoto: a photo of the station in general has no socket', async () => {
  const f = fakes();
  const { status, body } = await run(f, upload({ meta: { ...goodMeta, target: 'EZC-AMD-00051' } }));
  assert.equal(status, 201);
  assert.equal(f.rows.get(body.id as string)!.evse_compact, null);
});

test('submitPhoto: refuses other sites, bad photos, unknown targets and the daily limit', async () => {
  assert.equal((await run(fakes(), upload({ origin: 'https://evil.example' }))).status, 403);
  assert.deepEqual((await run(fakes(), upload({ full: jpeg(2048, 1536, EXIF) }))).body, { error: 'bad_photo' });
  assert.deepEqual((await run(fakes(), upload({ full: jpeg(1536, 2048) }))).body, { error: 'bad_photo' });
  assert.deepEqual((await run(fakes(), upload({ meta: { ...goodMeta, station: 'NOPE-1' } }))).body, { error: 'bad_target' });
  assert.deepEqual((await run(fakes({ socket: false }), upload())).body, { error: 'bad_target' });
  assert.deepEqual((await run(fakes({ count: 50 }), upload())).body, { error: 'daily_limit' });
  assert.equal((await run(fakes({ count: 50, role: 'trusted' }), upload())).status, 201);
  // None of these reached Panoramax or wrote a row.
  const f = fakes({ count: 50 });
  await run(f, upload());
  assert.equal(f.calls.length, 0);
  assert.equal(f.rows.size, 0);
});

test('submitPhoto: too many uploads in a minute from one account', async () => {
  const f = fakes();
  const keys: string[] = [];
  (f.env as unknown as Record<string, unknown>).UPLOAD_LIMIT = { async limit({ key }: { key: string }) { keys.push(key); return { success: false }; } };
  assert.deepEqual(await run(f, upload()), { status: 429, body: { error: 'too_fast' } });
  assert.deepEqual(keys, ['u1']);
  assert.equal(f.verified.length, 0);
  assert.equal(f.rows.size, 0);
});

test('submitPhoto: Turnstile is checked before anything is written', async () => {
  const f = fakes();
  await run(f, upload());
  assert.deepEqual(f.verified, [{ response: 'ts-token', remoteip: '192.0.2.1', secret: 'ts-secret' }]);
  const cases: [Record<string, unknown> | undefined, string | null | undefined][] = [
    [undefined, null],                                                                       // no token
    [undefined, ''],
    [{ success: false, 'error-codes': ['invalid-input-response'] }, undefined],
    [{ success: true, hostname: 'evil.example', action: 'upload' }, undefined],              // token for another site
    [{ success: true, hostname: 'olhaoposto.ocarroeletrico.com', action: 'login' }, undefined],
  ];
  for (const [answer, token] of cases) {
    const g = fakes(answer ? { turnstile: answer } : {});
    assert.deepEqual(await run(g, upload({ turnstile: token })), { status: 403, body: { error: 'turnstile' } });
    assert.equal(g.calls.length, 0);
    assert.equal(g.rows.size, 0);
  }
});

test('submitPhoto: a Panoramax failure leaves only a failed row', async () => {
  for (const [code, error] of [[409, 'duplicate'], [500, 'upload_failed']] as const) {
    const f = fakes();
    const { status, body } = await run(f, upload(), code);
    assert.equal(status, code === 409 ? 409 : 502);
    assert.deepEqual(body, { error });
    assert.equal(f.r2.size, 0);
    assert.deepEqual([...f.rows.values()].map((r) => r.status), ['failed']);
    // The half-made upload set is deleted.
    assert.equal(f.calls.at(-1)?.method, 'DELETE');
    assert.equal(f.licenseSet, 0);
  }
});

test('submitPhoto: an API token uploads without Turnstile or an origin, with the same checks', async () => {
  const f = fakes();
  const { status, body } = await run(f, upload({ token: 'oop_abc', turnstile: null }));
  assert.equal(status, 201);
  assert.equal(f.verified.length, 0);
  assert.equal(f.rows.get(body.id as string)!.status, 'pending');
  assert.deepEqual((await run(fakes(), upload({ token: 'oop_abc', turnstile: null, full: jpeg(2048, 1536, EXIF) }))).body, { error: 'bad_photo' });
  assert.deepEqual((await run(fakes(), upload({ token: 'not-ours', turnstile: null }))).body, { error: 'sign_in_required' });
});
