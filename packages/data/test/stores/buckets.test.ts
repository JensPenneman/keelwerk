import { expect, test } from 'vitest';
import { failure } from '../support/failure.ts';
import { storeSuite } from '../support/store-suite.ts';
import { tenantScope } from '../support/tenant-scope.ts';
import { tenantTwo } from '../support/tenant-two.ts';

const memory = storeSuite();

const limits = { capacity: 3, refillPerSecond: 0.5 };

test('a bucket starts full, empties by cost and then says when a token is back', async () => {
  const takes = [];
  for (let i = 0; i < 4; i++) {
    takes.push(await memory.run(tenantScope, (unit) => unit.buckets.take('k', 1, limits)));
  }
  expect(takes).toEqual([{ ok: true }, { ok: true }, { ok: true }, { ok: false, retryAfter: 2 }]);
});

test('time refills the bucket up to its capacity', async () => {
  for (let i = 0; i < 3; i++)
    await memory.run(tenantScope, (unit) => unit.buckets.take('k', 1, limits));
  memory.clock.advance(2000);
  expect(await memory.run(tenantScope, (unit) => unit.buckets.take('k', 1, limits))).toEqual({
    ok: true,
  });
  expect(await memory.run(tenantScope, (unit) => unit.buckets.take('k', 1, limits))).toEqual({
    ok: false,
    retryAfter: 2,
  });
  memory.clock.advance(1_000_000);
  expect(await memory.run(tenantScope, (unit) => unit.buckets.take('k', 3, limits))).toEqual({
    ok: true,
  });
});

test('a refused take reports the wait for the whole cost, and takes nothing', async () => {
  await memory.run(tenantScope, (unit) => unit.buckets.take('k', 2, limits));
  expect(await memory.run(tenantScope, (unit) => unit.buckets.take('k', 3, limits))).toEqual({
    ok: false,
    retryAfter: 4,
  });
  expect(await memory.run(tenantScope, (unit) => unit.buckets.take('k', 1, limits))).toEqual({
    ok: true,
  });
});

test('buckets are per scope and per key, and a rolled-back take is not spent', async () => {
  await memory.run(tenantScope, (unit) => unit.buckets.take('k', 3, limits));
  expect(await memory.run(tenantTwo, (unit) => unit.buckets.take('k', 3, limits))).toEqual({
    ok: true,
  });
  expect(await memory.run(tenantScope, (unit) => unit.buckets.take('other', 3, limits))).toEqual({
    ok: true,
  });
  memory.clock.advance(10_000);
  await memory
    .run(tenantScope, async (unit) => {
      await unit.buckets.take('k', 3, limits);
      throw new Error('boom');
    })
    .catch(() => undefined);
  expect(await memory.run(tenantScope, (unit) => unit.buckets.take('k', 3, limits))).toEqual({
    ok: true,
  });
});

test('a bucket without capacity or refill is refused', async () => {
  const refused = (
    capacity: number,
    refillPerSecond: number,
  ): Promise<{ kind: string; code: string }> =>
    failure(
      memory.run(tenantScope, (unit) => unit.buckets.take('k', 1, { capacity, refillPerSecond })),
    );
  expect((await refused(0, 1)).code).toBe('core.malformed_request');
  expect((await refused(1, 0)).code).toBe('core.malformed_request');
});
