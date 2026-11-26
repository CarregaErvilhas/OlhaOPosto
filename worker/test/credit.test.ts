import assert from 'node:assert/strict';
import { test } from 'node:test';

import { accountAction, accountHtml } from '../src/account.ts';
import { tokenHash } from '../src/auth.ts';
import { changeCredit as change, normalizeName, parseCredit, syncCredits, TAG_BATCH } from '../src/credit.ts';
import type { CreditDb } from '../src/credit.ts';
import { withXmp, xmpPacket, type PublishEnv } from '../src/publish.ts';
import { d1 } from './d1.ts';

const NOW = new Date('2026-11-25T10:00:00Z');
const LATER = new Date('2026-11-26T10:00:01Z');
const SITE = 'https://olhaoposto.ocarroeletrico.com';
const text = (b: Uint8Array) => new TextDecoder().decode(b);

function jpeg(width: number, height: number): Uint8Array {
  const seg = (m: number, p: number[]) => [0xff, m, (p.length + 2) >> 8, (p.length + 2) & 0xff, ...p];
  return Uint8Array.from([
    0xff, 0xd8,
    ...seg(0xe0, [74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]),
    ...seg(0xdb, new Array(65).fill(1)),
    ...seg(0xc0, [8, height >> 8, height & 0xff, width >> 8, width & 0xff, 1, 1, 0x11, 0]),
    0xff, 0xda, 0, 8, 1, 1, 0, 0, 0x3f, 0, 0x12, 0x34, 0xff, 0xd9,
  ]);
}

// Ana (OSM name «Ana») with photos in every state; Bea and «João Silva»
// (from before osm_key existed) are other accounts.
function setup() {
  const db = d1();
  db.sql.exec(`INSERT INTO stations (id, lat, lon, updated_at) VALUES ('S1', 38.7, -9.2, 'x'), ('S2', 38.8, -9.3, 'x')`);
  db.sql.exec(`INSERT INTO users (id, osm_uid, osm_name, osm_key, created_at, last_login_at) VALUES
    ('ana', 1, 'Ana', 'ana', 'x', 'x'),
    ('bea', 2, 'Bea', 'bea', 'x', 'x')`);
  db.sql.exec(`INSERT INTO users (id, osm_uid, osm_name, created_at, last_login_at) VALUES ('joao', 3, 'João Silva', 'x', 'x')`);
  db.sql.exec(`UPDATE users SET pseudonym = 'Mestre Bea', pseudonym_key = 'mestrebea' WHERE id = 'bea'`);
  const photo = db.sql.prepare(
    `INSERT INTO photos (id, station_id, uploader_id, panoramax_id, credit, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  photo.run('p1', 'S1', 'ana', 'pic-1', 'Ana', 'published', '2026-01-01');
  photo.run('p2', 'S2', 'ana', 'pic-2', 'Ana', 'pending', '2026-01-02');
  photo.run('p3', 'S2', 'ana', null, 'Ana', 'removed', '2026-01-03');
  photo.run('p4', 'S2', 'bea', 'pic-4', 'Mestre Bea', 'published', '2026-01-04');
  photo.run('p5', 'S2', 'ana', 'pic-5', 'Ana', 'hidden', '2026-01-05');
  const sel = db.sql.prepare(`INSERT INTO selections (target, station_id, photo_id, chosen_at, published_at) VALUES (?, ?, ?, ?, ?)`);
  sel.run('S1', 'S1', 'p1', '2026-01-01', '2026-01-01');
  sel.run('S2', 'S2', 'p4', '2026-01-04', '2026-01-04');
  sel.run('PTS2E1', 'S2', 'p5', '2026-01-05', '2026-01-05');
  return db;
}

// A fake `pictures` with etags and conditional puts, and a fetch that plays
// Panoramax and the Cloudflare purge API.
function world(db: ReturnType<typeof d1>, opts: { panoramax?: number; purge?: number; secrets?: boolean } = {}) {
  let n = 0;
  const r2 = new Map<string, { bytes: Uint8Array; etag: string }>();
  const put = (key: string, bytes: Uint8Array) => r2.set(key, { bytes, etag: `e${++n}` });
  for (const [target, author] of [['S1', 'Ana'], ['S2', 'Mestre Bea'], ['PTS2E1', 'Ana']]) {
    const packet = xmpPacket({ author, photoId: target });
    put(`${target}.jpg`, withXmp(jpeg(1024, 768), packet));
    put(`${target}.thumb.jpg`, withXmp(jpeg(400, 300), packet));
    put(`${target}.full.jpg`, withXmp(jpeg(2048, 1536), packet));
  }
  const pictures = {
    async get(key: string) {
      const o = r2.get(key);
      return o ? { etag: o.etag, async arrayBuffer() { return o.bytes.slice().buffer; } } : null;
    },
    async put(key: string, bytes: Uint8Array, o: { onlyIf?: { etagMatches: string } }) {
      if (o.onlyIf && r2.get(key)?.etag !== o.onlyIf.etagMatches) return null;
      put(key, bytes);
      return {};
    },
  };
  const patches: { url: string; body: unknown }[] = [];
  const purges: string[][] = [];
  const fetcher = async (url: string, init?: RequestInit) => {
    if (url.includes('/purge_cache')) {
      purges.push(JSON.parse(String(init?.body)).files);
      return new Response('{}', { status: opts.purge ?? 200 });
    }
    patches.push({ url, body: JSON.parse(String(init?.body)) });
    return new Response('{}', { status: opts.panoramax ?? 200 });
  };
  const secrets = opts.secrets === false ? {} : { CF_ZONE_ID: 'z', CF_CACHE_PURGE_TOKEN: 't' };
  const env = { DB: db, PICTURES: pictures, PANORAMAX_TOKEN: 'pt', PANORAMAX_URL: 'https://pano.test', ...secrets } as unknown as PublishEnv;
  return { env, r2, patches, purges, fetcher };
}

// The d1() stand-in has what changeCredit uses.
const changeCredit = (db: ReturnType<typeof d1>, id: string, raw: unknown, now: Date) =>
  change(db as unknown as CreditDb, id, raw, now);

const row = <T>(db: ReturnType<typeof d1>, sql: string, ...a: unknown[]) => db.sql.prepare(sql).get(...(a as never[])) as T;

test('normalizeName: NFC, one space, no control or invisible characters', () => {
  assert.equal(normalizeName('  Jose\u0301   da\tSilva \n'), 'José da Silva');
  assert.equal(normalizeName('A\u200Bna\u200E\u00A0Maria'), 'Ana Maria');
  assert.equal(normalizeName('Ana\u0000\u0007'), 'Ana');
});

test('parseCredit: length, characters, links and reserved names', () => {
  assert.deepEqual(parseCredit(' Zé  Carregador '), { name: 'Zé Carregador', key: 'zecarregador' });
  assert.deepEqual(parseCredit("O'Neill (Porto)"), { name: "O'Neill (Porto)", key: 'oneillporto' });
  assert.equal(parseCredit('A'), 'credit_length');
  assert.equal(parseCredit('A\u200B'), 'credit_length');
  assert.equal(parseCredit('x'.repeat(41)), 'credit_length');
  assert.deepEqual(parseCredit('x'.repeat(40)), { name: 'x'.repeat(40), key: 'x'.repeat(40) });
  assert.equal(parseCredit(42), 'credit_length');
  for (const bad of ['Ana 🚗', 'ana@mail', 'a/b', 'Ana: sim', 'Ana <b>', '\u3164\u3164Ana', 'Za\u0301\u0302\u0303\u0304lgo', '-.-', 'a#b']) {
    assert.equal(parseCredit(bad), 'credit_chars', bad);
  }
  for (const bad of ['ana.pt', 'Visita www.x', 'ftp://a', 'olhaoposto.ocarroeletrico']) {
    assert.equal(parseCredit(bad), 'credit_url', bad);
  }
  assert.deepEqual(parseCredit('J. R. Silva'), { name: 'J. R. Silva', key: 'jrsilva' });
  for (const r of ["Olh'o'posto", 'OlhaOPosto', 'Moderação', 'ADMIN']) assert.equal(parseCredit(r), 'credit_reserved', r);
});

test('changeCredit: nobody else’s OSM name or pseudonym, ignoring case, accents and punctuation', async () => {
  const db = setup();
  for (const other of ['joao silva', 'JOAO_SILVA', 'João-Silva', 'mestre bea', 'BEA']) {
    assert.equal(await changeCredit(db, 'ana', other, NOW), 'credit_taken', other);
  }
  // The old account got its osm_key on the way.
  assert.equal(row<{ k: string }>(db, `SELECT osm_key AS k FROM users WHERE id = 'joao'`).k, 'joaosilva');
  assert.equal(await changeCredit(db, 'ana', 'Ana', NOW), 'credit_same');
  // Their own OSM name in another case is theirs.
  assert.deepEqual(await changeCredit(db, 'ana', 'ANA', NOW), { credit: 'ANA' });
  assert.equal(row<{ p: string }>(db, `SELECT pseudonym AS p FROM users WHERE id = 'ana'`).p, 'ANA');
  // The unique index catches what the check could miss (two at once).
  assert.throws(() => db.sql.exec(`UPDATE users SET pseudonym_key = 'mestrebea' WHERE id = 'joao'`));
});

test('changeCredit: once a day, and back to the OSM name', async () => {
  const db = setup();
  assert.deepEqual(await changeCredit(db, 'ana', 'Ana Carrega', NOW), { credit: 'Ana Carrega' });
  assert.equal(await changeCredit(db, 'ana', 'Outra Coisa', new Date(NOW.getTime() + 3600_000)), 'credit_daily');
  assert.equal(await changeCredit(db, 'ana', null, new Date(NOW.getTime() + 3600_000)), 'credit_daily');
  assert.deepEqual(await changeCredit(db, 'ana', null, LATER), { credit: 'Ana' });
  const u = row<{ pseudonym: string | null; pseudonym_key: string | null; pseudonym_changed_at: string }>(
    db, `SELECT pseudonym, pseudonym_key, pseudonym_changed_at FROM users WHERE id = 'ana'`,
  );
  assert.deepEqual({ ...u }, { pseudonym: null, pseudonym_key: null, pseudonym_changed_at: LATER.toISOString() });
  // Nothing to go back from.
  assert.equal(await changeCredit(db, 'ana', null, new Date(LATER.getTime() + 2 * 86_400_000)), 'credit_same');
});

test('changeCredit: the credit on every photo, and the marks for copies and tags', async () => {
  const db = setup();
  await changeCredit(db, 'ana', 'Ana Carrega', NOW);
  const photos = db.sql.prepare(`SELECT id, credit, author_tag_old FROM photos ORDER BY id`).all().map((r) => ({ ...r }));
  assert.deepEqual(photos, [
    { id: 'p1', credit: 'Ana Carrega', author_tag_old: 'Ana' },
    { id: 'p2', credit: 'Ana Carrega', author_tag_old: 'Ana' },
    { id: 'p3', credit: 'Ana Carrega', author_tag_old: null },        // removed: gone from Panoramax
    { id: 'p4', credit: 'Mestre Bea', author_tag_old: null },         // someone else's
    { id: 'p5', credit: 'Ana Carrega', author_tag_old: 'Ana' },
  ]);
  const marks = db.sql.prepare(`SELECT target, credit_pending AS c FROM selections ORDER BY target`).all().map((r) => ({ ...r }));
  assert.deepEqual(marks, [{ target: 'PTS2E1', c: 1 }, { target: 'S1', c: 1 }, { target: 'S2', c: 0 }]);
  // A second change before the first is done keeps the value on Panoramax.
  await changeCredit(db, 'ana', 'Terceiro Nome', LATER);
  assert.equal(row<{ o: string }>(db, `SELECT author_tag_old AS o FROM photos WHERE id = 'p1'`).o, 'Ana');
});

test('syncCredits: new XMP on the copies, purge, Panoramax tags, then nothing left', async () => {
  const db = setup();
  const w = world(db);
  await changeCredit(db, 'ana', 'Ana Carrega', NOW);
  const before = w.r2.get('S2.jpg')!.etag;
  assert.deepEqual(await syncCredits(w.env, w.fetcher), { copies: 2, tags: 3 });

  for (const size of ['', '.thumb', '.full']) {
    const t = text(w.r2.get(`S1${size}.jpg`)!.bytes);
    assert.ok(t.includes('<rdf:li>Ana Carrega</rdf:li>'), size);
    assert.ok(!t.includes('<rdf:li>Ana</rdf:li>'), size);
    assert.equal(t.split('http://ns.adobe.com/xap/1.0/\0').length, 2, size);   // one XMP, not two
  }
  // A hidden photo's copies are never written back; someone else's are untouched.
  assert.ok(text(w.r2.get('PTS2E1.jpg')!.bytes).includes('<rdf:li>Ana</rdf:li>'));
  assert.equal(w.r2.get('S2.jpg')!.etag, before);
  assert.deepEqual(w.purges, [[
    'https://pictures.ocarroeletrico.com/S1.jpg',
    'https://pictures.ocarroeletrico.com/S1.thumb.jpg',
    'https://pictures.ocarroeletrico.com/S1.full.jpg',
  ]]);

  assert.deepEqual(w.patches.map((p) => p.url), ['https://pano.test/api/pictures/pic-1', 'https://pano.test/api/pictures/pic-2', 'https://pano.test/api/pictures/pic-5']);
  assert.deepEqual(w.patches[0].body, {
    semantics: [
      { action: 'delete', key: 'OlhaOPosto|author', value: 'Ana' },
      { action: 'delete', key: 'OlhaOPosto|author', value: 'Ana Carrega' },
      { action: 'add', key: 'OlhaOPosto|author', value: 'Ana Carrega' },
    ],
  });
  assert.equal(row<{ n: number }>(db, `SELECT COUNT(*) AS n FROM photos WHERE author_tag_old IS NOT NULL`).n, 0);
  assert.equal(row<{ n: number }>(db, `SELECT COUNT(*) AS n FROM selections WHERE credit_pending = 1`).n, 0);

  w.patches.length = 0;
  assert.deepEqual(await syncCredits(w.env, w.fetcher), { copies: 0, tags: 0 });
  assert.equal(w.patches.length, 0);
});

test('syncCredits: a failure halfway is retried by the next run', async () => {
  const db = setup();
  const down = world(db, { panoramax: 502, purge: 500 });
  await changeCredit(db, 'ana', 'Ana Carrega', NOW);
  await syncCredits(down.env, down.fetcher);
  // The copies are rewritten but the purge failed: still marked, like the tags.
  assert.ok(text(down.r2.get('S1.jpg')!.bytes).includes('Ana Carrega'));
  assert.equal(row<{ c: number }>(db, `SELECT credit_pending AS c FROM selections WHERE target = 'S1'`).c, 1);
  assert.equal(row<{ n: number }>(db, `SELECT COUNT(*) AS n FROM photos WHERE author_tag_old IS NOT NULL`).n, 3);

  const up = world(db);
  await syncCredits(up.env, up.fetcher);
  assert.ok(text(up.r2.get('S1.full.jpg')!.bytes).includes('<rdf:li>Ana Carrega</rdf:li>'));
  assert.equal(up.purges.length, 1);
  assert.equal(row<{ n: number }>(db, `SELECT COUNT(*) AS n FROM photos WHERE author_tag_old IS NOT NULL`).n, 0);
  assert.equal(row<{ n: number }>(db, `SELECT COUNT(*) AS n FROM selections WHERE credit_pending = 1`).n, 0);
});

test('syncCredits: a picture gone from Panoramax, a main photo swapped meanwhile, batches', async () => {
  const db = setup();
  const w = world(db, { panoramax: 404, secrets: false });
  await changeCredit(db, 'ana', 'Ana Carrega', NOW);
  // chooseMain wrote a new S1.jpg after the change: the rewrite must not overwrite it.
  const pictures = w.env.PICTURES as { get(k: string): Promise<unknown> };
  const get = pictures.get.bind(pictures);
  pictures.get = async (k: string) => {
    const o = await get(k);
    if (k === 'S1.jpg') w.r2.set(k, { bytes: jpeg(10, 10), etag: 'new' });
    return o;
  };
  await syncCredits(w.env, w.fetcher);
  assert.equal(w.r2.get('S1.jpg')!.etag, 'new');
  assert.ok(text(w.r2.get('S1.thumb.jpg')!.bytes).includes('Ana Carrega'));
  assert.equal(row<{ n: number }>(db, `SELECT COUNT(*) AS n FROM photos WHERE author_tag_old IS NOT NULL`).n, 0);
  assert.equal(row<{ c: number }>(db, `SELECT credit_pending AS c FROM selections WHERE target = 'S1'`).c, 0);

  // Many photos: one batch per run.
  const add = db.sql.prepare(`INSERT INTO photos (id, station_id, uploader_id, panoramax_id, credit, status, created_at) VALUES (?, 'S1', 'ana', ?, 'Ana Carrega', 'published', ?)`);
  for (let i = 0; i < TAG_BATCH + 3; i++) add.run(`m${i}`, `pic-m${i}`, `2026-02-${String(i % 28 + 1).padStart(2, '0')}`);
  await changeCredit(db, 'ana', 'Ana Outra', LATER);
  const ok = world(db);
  assert.equal((await syncCredits(ok.env, ok.fetcher)).tags, TAG_BATCH);
  assert.equal((await syncCredits(ok.env, ok.fetcher)).tags, 6);
  assert.equal((await syncCredits(ok.env, ok.fetcher)).tags, 0);
});

test('account page: the name form, the change and its waitUntil', async () => {
  const db = setup();
  db.sql.prepare(`INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, 'ana', 'x', '2999-01-01')`).run(await tokenHash('sess'));
  const w = world(db);
  const env = { ...w.env, OSM_CLIENT_ID: 'id', OSM_CLIENT_SECRET: 's' } as PublishEnv;
  const waits: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => { waits.push(p); } };
  const post = (fields: [string, string][], origin = SITE) => {
    const f = new FormData();
    for (const [k, v] of fields) f.append(k, v);
    return accountAction(new Request(`${SITE}/conta/acao`, {
      method: 'POST', body: f, headers: { cookie: '__Host-oop_session=sess', origin },
    }), env, {}, ctx, NOW, w.fetcher as typeof fetch);
  };
  const page = async (lang: 'pt' | 'en') => (await accountHtml(lang, new Request(`${SITE}/conta`, { headers: { cookie: '__Host-oop_session=sess' } }), env, {}, NOW)).text();

  assert.ok((await page('pt')).includes('value="Ana"'));
  assert.equal((await post([['action', 'set_credit'], ['credit', 'Ana Carrega']], 'https://evil.example')).status, 403);
  const bad = await post([['lang', 'en'], ['action', 'set_credit'], ['credit', 'joao silva']]);
  assert.equal(bad.headers.get('location'), '/en/account?erro=credit_taken#h-credit');
  assert.equal(waits.length, 0);

  const ok = await post([['lang', 'pt'], ['action', 'set_credit'], ['credit', ' Ana  Carrega ']]);
  assert.equal(ok.status, 303);
  assert.equal(ok.headers.get('location'), '/conta?ok=credit#h-credit');
  assert.equal(waits.length, 1);
  await Promise.all(waits);
  assert.equal(w.patches.length, 3);

  // The page now shows the pseudonym, the way back and when it can change again.
  const html = await page('pt');
  assert.ok(html.includes('value="Ana Carrega"'));
  assert.ok(html.includes('Voltar ao nome OSM'));
  assert.ok(html.includes('a partir de 2026-11-26 10:00 (UTC)'));
  assert.ok(html.includes('id="credit-name"') && /id="credit-name"[^>]* disabled/.test(html));
  assert.ok(html.includes('Ana Carrega</strong>'));
  assert.ok((await page('en')).includes('Go back to the OSM name'));
});
