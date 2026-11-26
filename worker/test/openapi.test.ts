import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import worker from '../src/index.ts';
import { openApiSpec } from '../src/openapi.ts';

const INDEX = readFileSync(join(import.meta.dirname, '..', 'src', 'index.ts'), 'utf8');

// Every /api/v1 route in index.ts: a quoted path ('/api/v1/ranking') or a
// regex (/^\/api\/v1\/stations\/([^/]+)$/), both normalised to {} for a parameter.
function indexRoutes(): Set<string> {
  const routes = new Set<string>();
  for (const m of INDEX.matchAll(/'(\/api\/v1\/[A-Za-z0-9._/-]+)'/g)) routes.add(m[1]);
  for (const m of INDEX.matchAll(/\/\^((?:\\\/api\\\/v1)(?:\\\/(?:[A-Za-z0-9._-]+|\(\[\^\/\]\+\)))*)\$\//g)) {
    routes.add(m[1].replace(/\\\//g, '/').replace(/\(\[\^\/\]\+\)/g, '{}'));
  }
  return routes;
}
const specRoutes = () => new Set(Object.keys(openApiSpec().paths).map((p) => '/api/v1' + p.replace(/\{[^}]+\}/g, '{}')));

test('openapi: every /api/v1 route in index.ts is in the spec, and the spec has no other', () => {
  const inIndex = indexRoutes();
  const inSpec = specRoutes();
  // A sanity floor, so a broken extraction cannot pass by finding nothing.
  assert.ok(inIndex.size >= 10, `found only ${[...inIndex]}`);
  assert.deepEqual([...inIndex].filter((r) => !inSpec.has(r)).sort(), [], 'routes missing from the spec');
  assert.deepEqual([...inSpec].filter((r) => !inIndex.has(r)).sort(), [], 'spec paths with no route');
});

test('openapi: the methods match what index.ts serves for the write routes', () => {
  const paths = openApiSpec().paths as Record<string, Record<string, unknown>>;
  assert.deepEqual(Object.keys(paths['/photos']), ['post']);
  assert.deepEqual(Object.keys(paths['/photos/{id}']).sort(), ['delete', 'get']);
  assert.deepEqual(Object.keys(paths['/selections/{target}']), ['put']);
  assert.deepEqual(Object.keys(paths['/stations']), ['get']);
  for (const m of ["method === 'DELETE'", "method === 'PUT'", "pathname === '/api/v1/photos'", "pathname === '/api/v1/stations'"]) {
    assert.ok(INDEX.includes(m), m);
  }
});

test('openapi: a well-formed 3.1 document, every $ref resolves, every operation has an id', () => {
  const spec = openApiSpec();
  assert.equal(spec.openapi, '3.1.0');
  const text = JSON.stringify(spec);
  for (const m of text.matchAll(/#\/components\/schemas\/([A-Za-z]+)/g)) {
    assert.ok(m[1] in spec.components.schemas, `missing schema ${m[1]}`);
  }
  const ops = Object.values(spec.paths).flatMap((p) => Object.values(p as Record<string, { operationId?: string }>));
  const ids = ops.map((o) => o.operationId);
  assert.ok(ids.every(Boolean));
  assert.equal(new Set(ids).size, ids.length);
  // Writes say how to authenticate.
  const del = (spec.paths['/photos/{id}'] as { delete: { security: unknown[] } }).delete;
  assert.deepEqual(del.security, [{ bearer: [] }, { session: [] }]);
});

test('GET /api/v1/openapi.json serves the spec with open CORS', async () => {
  const res = await worker.fetch(new Request('https://olhaoposto.ocarroeletrico.com/api/v1/openapi.json'), {} as never, {} as never);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  assert.match(res.headers.get('content-type') ?? '', /application\/json/);
  const body = await res.json() as { openapi: string; servers: { url: string }[] };
  assert.equal(body.openapi, '3.1.0');
  assert.equal(body.servers[0].url, 'https://olhaoposto.ocarroeletrico.com/api/v1');
});
