import assert from 'node:assert/strict';
import { test } from 'node:test';

import { allowed, type RateLimiter } from '../src/ratelimit.ts';

const limiter = (successes: boolean[]): RateLimiter & { keys: string[] } => {
  const keys: string[] = [];
  return { keys, async limit({ key }) { keys.push(key); return { success: successes.shift() ?? false }; } };
};

test('allowed: follows the limiter, per key', async () => {
  const l = limiter([true, false]);
  assert.equal(await allowed(l, 'u1'), true);
  assert.equal(await allowed(l, 'u1'), false);
  assert.deepEqual(l.keys, ['u1', 'u1']);
});

test('allowed: fails open without a binding, a key, or when the limiter throws', async () => {
  assert.equal(await allowed(undefined, 'u1'), true);
  assert.equal(await allowed(limiter([false]), null), true);
  assert.equal(await allowed({ limit: async () => { throw new Error('down'); } }, 'u1'), true);
});
