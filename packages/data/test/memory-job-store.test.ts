import type { StoredJob, WireError } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { backendScope } from './support/backend-scope.ts';
import { failure } from './support/failure.ts';
import { jobSpec } from './support/job-spec.ts';
import type { MemoryFixture } from './support/memory-fixture.ts';
import { openMemory } from './support/memory-fixture.ts';
import { namespaceScope } from './support/namespace-scope.ts';
import { stamp } from './support/stamp.ts';
import { tenantScope } from './support/tenant-scope.ts';
import { tenantTwo } from './support/tenant-two.ts';

const request = {
  limit: 10,
  capabilitySets: [''],
  maxRevision: 100,
  leaseMs: 30_000,
};

const _error: WireError = {
  kind: 'unavailable',
  code: 'x.down',
  message: 'down',
  retryable: true,
  requestId: 'r',
};

const _tenantTwoScope = (): ReturnType<typeof jobSpec>['scope'] => ({
  level: 'tenant',
  backendId: '00000000-0000-4000-8000-0000000000b1',
  tenantId: '00000000-0000-4000-8000-0000000000a2',
});

async function take(
  memory: MemoryFixture,
  worker = 'w1',
  over: Partial<typeof request> & { readonly lanes?: number } = {},
): Promise<readonly StoredJob[]> {
  return (
    await memory.run(namespaceScope, (unit) =>
      unit.jobs.take('commands', worker, { ...request, ...over }),
    )
  ).jobs;
}

const stats = (memory: MemoryFixture, queue?: string): Promise<readonly unknown[]> =>
  memory.read(namespaceScope, (unit) => unit.jobs.stats(queue));

describe('enqueue and the lane counts', () => {
  test('a due job is available and counted on its lane; a later one is scheduled until promoted', async () => {
    const memory = openMemory();
    const ids = await memory.run(tenantScope, async (unit) => [
      await unit.jobs.enqueue(jobSpec()),
      await unit.jobs.enqueue(jobSpec({ runAt: stamp.add({ seconds: 60 }) })),
    ]);
    expect(ids).toEqual(['1', '2']);
    expect((await stats(memory))[0]).toMatchObject({ queue: 'commands', due: 1 });
    expect(await take(memory, 'w1', { limit: 5, leaseMs: 600_000 })).toHaveLength(1);
    expect(await memory.run(namespaceScope, (unit) => unit.jobs.promote('commands', 10))).toBe(0);
    memory.clock.advance(61_000);
    expect(await memory.run(namespaceScope, (unit) => unit.jobs.promote('commands', 10))).toBe(1);
    expect(await take(memory, 'w1')).toHaveLength(1);
  });

  test('a rolled-back unit enqueues nothing, a savepoint likewise', async () => {
    const memory = openMemory();
    await memory
      .run(tenantScope, async (unit) => {
        await unit.jobs.enqueue(jobSpec());
        throw new Error('boom');
      })
      .catch(() => undefined);
    expect(await take(memory)).toEqual([]);
    await memory.run(tenantScope, async (unit) => {
      await unit.jobs.enqueue(jobSpec({ key: { value: 'a', onConflict: 'keep' } }));
      await unit
        .nested(async (inner) => {
          await inner.jobs.enqueue(jobSpec({ key: { value: 'b', onConflict: 'keep' } }));
          throw new Error('undo');
        })
        .catch(() => undefined);
    });
    expect((await take(memory)).map((job) => job.key?.value)).toEqual(['a']);
  });

  test('a job of another scope is refused, so is any enqueue from a read-only or namespace unit', async () => {
    const memory = openMemory();
    expect(
      (await failure(memory.run(tenantTwo, (unit) => unit.jobs.enqueue(jobSpec())))).code,
    ).toBe('core.forbidden');
    expect(
      (await failure(memory.run(backendScope, (unit) => unit.jobs.enqueue(jobSpec())))).code,
    ).toBe('core.forbidden');
    expect(
      (await failure(memory.run(namespaceScope, (unit) => unit.jobs.enqueue(jobSpec())))).code,
    ).toBe('core.forbidden');
    expect(
      (await failure(memory.read(tenantScope, (unit) => unit.jobs.enqueue(jobSpec())))).kind,
    ).toBe('internal');
  });
});

describe('keys: keep, replace, coalesce', () => {
  const keyed = (
    onConflict: 'keep' | 'replace' | 'coalesce',
    over = {},
  ): ReturnType<typeof jobSpec> => jobSpec({ key: { value: 'k', onConflict }, ...over });

  test('keep leaves the pending job and returns its id', async () => {
    const memory = openMemory();
    const ids = await memory.run(tenantScope, async (unit) => [
      await unit.jobs.enqueue(keyed('keep', { run: { action: 'a', input: 1 } })),
      await unit.jobs.enqueue(keyed('keep', { run: { action: 'a', input: 2 } })),
    ]);
    expect(ids).toEqual(['1', '1']);
    const jobs = await take(memory);
    expect(jobs.map((job) => job.run)).toEqual([{ action: 'a', input: 1 }]);
  });

  test('replace swaps the pending job for the new one', async () => {
    const memory = openMemory();
    const ids = await memory.run(tenantScope, async (unit) => [
      await unit.jobs.enqueue(keyed('replace', { run: { action: 'a', input: 1 } })),
      await unit.jobs.enqueue(keyed('replace', { run: { action: 'a', input: 2 } })),
    ]);
    expect(ids).toEqual(['1', '2']);
    const jobs = await take(memory);
    expect(jobs.map((job) => [job.id, job.run])).toEqual([['2', { action: 'a', input: 2 }]]);
  });

  test('coalesce keeps one job and moves its time to the earliest', async () => {
    const memory = openMemory();
    await memory.run(tenantScope, async (unit) => {
      await unit.jobs.enqueue(keyed('coalesce', { runAt: stamp.add({ seconds: 60 }) }));
      await unit.jobs.enqueue(keyed('coalesce', { runAt: stamp.add({ seconds: 5 }) }));
    });
    memory.clock.advance(6000);
    expect(await memory.run(namespaceScope, (unit) => unit.jobs.promote('commands', 10))).toBe(1);
    expect(await take(memory)).toHaveLength(1);
  });

  test('a key acts within its lane only, and a running job is not pending', async () => {
    const memory = openMemory();
    await memory.run(tenantScope, async (unit) => {
      await unit.jobs.enqueue(keyed('keep'));
      await unit.jobs.enqueue(keyed('keep', { priority: 'high' }));
    });
    expect(await take(memory)).toHaveLength(2);
    const again = await memory.run(tenantScope, (unit) => unit.jobs.enqueue(keyed('keep')));
    expect(again).toBe('3');
  });

  test('cancel removes the pending jobs of a key and counts them', async () => {
    const memory = openMemory();
    await memory.run(tenantScope, async (unit) => {
      await unit.jobs.enqueue(jobSpec({ key: { value: 'a', onConflict: 'replace' } }));
      await unit.jobs.enqueue(
        jobSpec({ key: { value: 'b', onConflict: 'replace' }, runAt: stamp.add({ hours: 1 }) }),
      );
      await unit.jobs.enqueue(
        jobSpec({ key: { value: 'b', onConflict: 'replace' }, queue: 'other' }),
      );
    });
    expect(await memory.run(tenantScope, (unit) => unit.jobs.cancel('commands', 'b'))).toBe(1);
    expect(await memory.run(tenantScope, (unit) => unit.jobs.cancel('commands', 'b'))).toBe(0);
    expect(await memory.run(tenantTwo, (unit) => unit.jobs.cancel('commands', 'a'))).toBe(0);
    expect(await memory.run(tenantScope, (unit) => unit.jobs.cancel('commands', 'a'))).toBe(1);
    expect(await take(memory)).toEqual([]);
  });
});
