import assert from 'node:assert/strict';
import { test } from 'node:test';

import { boundingBox, distanceM, NEAR_DEFAULT_M, NEAR_MAX_M, parseNear } from '../src/types.ts';

const p = (query: string) => parseNear(new URLSearchParams(query));

test('parseNear: no coordinates means a word search', () => {
  assert.equal(p(''), null);
  assert.equal(p('q=lisboa&limit=5'), null);
});

test('parseNear: valid coordinates, default and explicit radius', () => {
  assert.deepEqual(p('lat=38.7223&lon=-9.1393'), { lat: 38.7223, lon: -9.1393, radius: NEAR_DEFAULT_M });
  assert.deepEqual(p('lat=38&lon=-9&radius=1500'), { lat: 38, lon: -9, radius: 1500 });
  assert.deepEqual(p(`lat=0&lon=0&radius=${NEAR_MAX_M}`), { lat: 0, lon: 0, radius: NEAR_MAX_M });
});

test('parseNear: blanks, junk and out-of-range values are refused', () => {
  for (const bad of [
    'lat=&lon=', 'lat= &lon= ', 'lat=38.7', 'lon=-9.1', 'radius=500',
    'lat=abc&lon=-9', 'lat=38.7&lon=1e2', 'lat=0x10&lon=0', 'lat=38.7&lon=-9.1&radius=',
    'lat=91&lon=0', 'lat=0&lon=181', 'lat=38.7&lon=-9.1&radius=0',
    `lat=38.7&lon=-9.1&radius=${NEAR_MAX_M + 1}`, 'lat=38.7&lon=-9.1&radius=500.5', 'lat=38.7&lon=-9.1&radius=-1',
    'lat=Infinity&lon=0', 'lat=NaN&lon=0',
  ]) {
    assert.equal(p(bad), 'bad', bad);
  }
});

test('distanceM: known distances', () => {
  assert.equal(distanceM(38.7, -9.1, 38.7, -9.1), 0);
  // 0.009 degrees of latitude is about 1 km anywhere.
  assert.ok(Math.abs(distanceM(38.7, -9.1, 38.709, -9.1) - 1000.8) < 1);
  // Lisbon (Praça do Comércio) to Porto (Avenida dos Aliados): about 274 km.
  const lxPorto = distanceM(38.7075, -9.1364, 41.1485, -8.6110);
  assert.ok(lxPorto > 272_000 && lxPorto < 276_000, String(lxPorto));
});

test('boundingBox holds the whole circle at Portuguese latitudes', () => {
  for (const lat of [32.6, 37.0, 38.7, 42.1]) {
    const q = { lat, lon: -9, radius: 500 };
    const b = boundingBox(q);
    // The box edges are just beyond the radius, north-south and east-west.
    for (const [la, lo] of [[b.maxLat, q.lon], [b.minLat, q.lon], [q.lat, b.maxLon], [q.lat, b.minLon]]) {
      const d = distanceM(q.lat, q.lon, la, lo);
      assert.ok(d >= 500 && d < 510, `${lat}: ${d}`);
    }
  }
});
