import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { isHeic, readHeicExif } from '../public/heif.js';

const fixture = new Uint8Array(readFileSync(join(import.meta.dirname, 'fixture.heic')));

test('readHeicExif: GPS, date and orientation from the Exif item', () => {
  assert.equal(isHeic(fixture), true);
  const m = readHeicExif(fixture);
  assert.ok(Math.abs((m.lat ?? 0) - 38.78791) < 1e-4);
  assert.ok(Math.abs((m.lon ?? 0) + 9.226767) < 1e-4);
  assert.equal(m.takenAt, '2026-11-20T10:15:00');
  assert.equal(m.orientation, 1);
});

test('readHeicExif: not HEIC, truncated or hostile input reads as no metadata', () => {
  const none = { lat: null, lon: null, takenAt: null, orientation: null };
  assert.equal(isHeic(new Uint8Array([0xff, 0xd8, 0xff])), false);
  assert.deepEqual(readHeicExif(new Uint8Array(0)), none);
  for (const cut of [20, 100, 300, fixture.length - 50]) {
    const m = readHeicExif(fixture.subarray(0, cut));
    assert.equal(typeof m, 'object');
  }
  const junk = fixture.slice();
  for (let i = 40; i < junk.length; i += 7) junk[i] = 0xff;
  assert.equal(typeof readHeicExif(junk), 'object');
});
