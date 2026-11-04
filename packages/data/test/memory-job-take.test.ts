import type { StoredJob, WireError } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
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

const error: WireError = {
  kind: 'unavailable',
  code: 'x.down',
  message: 'down',
  retryable: true,
  requestId: 'r',
};

const tenantTwoScope = (): ReturnType<typeof jobSpec>['scope'] => ({
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

describe('FIFO per key', () => {
  test('a key with a running job makes the next job wait until completion', async () => {
    const memory = openMemory();
    const spec = (n: number): ReturnType<typeof jobSpec> =>
      jobSpec({
        ordering: 'fifo-per-key',
        key: { value: 'k', onConflict: 'keep' },
        run: { action: 'a', input: n },
      });
    await memory.run(tenantScope, (unit) => unit.jobs.enqueue(spec(1)));
    const [running] = await take(memory);
    expect(running).toBeDefined();
    const second = await memory.run(tenantScope, (unit) => unit.jobs.enqueue(spec(2)));
    expect(second).toBe('2');
    expect(await take(memory, 'w2')).toEqual([]);
    expect(
      await memory.run(namespaceScope, (unit) =>
        unit.jobs.complete(running?.attempt ?? { jobId: '', attempt: 0 }, 'w1', {
          kind: 'succeeded',
        }),
      ),
    ).toBe(true);
    const next = await take(memory, 'w2');
    expect(next.map((job) => job.run)).toEqual([{ action: 'a', input: 2 }]);
  });
});

describe('FIFO per key after an end that is not a success', () => {
  const fifo = (n: number, onConflict: 'keep' | 'replace' = 'keep'): ReturnType<typeof jobSpec> =>
    jobSpec({
      ordering: 'fifo-per-key',
      key: { value: 'k', onConflict },
      run: { action: 'a', input: n },
    });

  test('a dead letter of the key does not hold back the jobs enqueued after it', async () => {
    const memory = openMemory();
    await memory.run(tenantScope, (unit) => unit.jobs.enqueue(fifo(1)));
    const [first] = await take(memory);
    expect(
      await memory.run(namespaceScope, (unit) =>
        unit.jobs.complete(first?.attempt ?? { jobId: '', attempt: 0 }, 'w1', {
          kind: 'dead',
          error,
        }),
      ),
    ).toBe(true);
    await memory.run(tenantScope, (unit) => unit.jobs.enqueue(fifo(2)));
    expect((await take(memory, 'w2')).map((job) => job.run)).toEqual([{ action: 'a', input: 2 }]);
  });

  test('replacing the head of a key releases the job waiting behind it', async () => {
    const memory = openMemory();
    await memory.run(tenantScope, (unit) => unit.jobs.enqueue(fifo(1)));
    const [running] = await take(memory);
    await memory.run(tenantScope, (unit) => unit.jobs.enqueue(fifo(2)));
    await memory.run(namespaceScope, (unit) =>
      unit.jobs.complete(running?.attempt ?? { jobId: '', attempt: 0 }, 'w1', {
        kind: 'retry',
        at: stamp.add({ hours: 1 }),
        error,
      }),
    );
    await memory.run(tenantScope, (unit) => unit.jobs.enqueue(fifo(3, 'replace')));
    expect((await take(memory, 'w2')).map((job) => job.run)).toEqual([{ action: 'a', input: 2 }]);
  });
});

describe('the fair take', () => {
  test('priority classes first, then load per weight, caps never exceeded', async () => {
    const memory = openMemory();
    await memory.run(tenantScope, async (unit) => {
      await unit.jobs.enqueue(jobSpec({ priority: 'low', run: { action: 'low', input: 0 } }));
      await unit.jobs.enqueue(jobSpec({ run: { action: 'normal', input: 0 } }));
      await unit.jobs.enqueue(jobSpec({ priority: 'high', run: { action: 'high', input: 0 } }));
    });
    const order = (await take(memory, 'w1', { limit: 3 })).map(
      (job) => (job.run as { action: string }).action,
    );
    expect(order).toEqual(['high', 'normal', 'low']);
  });

  test('a lane never runs more than its cap', async () => {
    const memory = openMemory();
    await memory.run(tenantScope, async (unit) => {
      for (let i = 0; i < 5; i++) await unit.jobs.enqueue(jobSpec({ laneCap: 2 }));
    });
    expect(await take(memory)).toHaveLength(2);
    expect(await take(memory, 'w2')).toEqual([]);
    const [done] = await memory.read(namespaceScope, (unit) => unit.jobs.stats('commands'));
    expect(done).toMatchObject({ running: 2, due: 3 });
  });

  test('scopes share a take by load: the less served lane goes first and a busy one waits its turn', async () => {
    const memory = openMemory();
    await memory.run(tenantScope, async (unit) => {
      for (let i = 0; i < 4; i++)
        await unit.jobs.enqueue(jobSpec({ run: { action: 'one', input: i } }));
    });
    await memory.run(tenantTwo, async (unit) => {
      for (let i = 0; i < 4; i++) {
        await unit.jobs.enqueue(
          jobSpec({ scope: tenantTwoScope(), run: { action: 'two', input: i } }),
        );
      }
    });
    const actions = (jobs: readonly StoredJob[]): string[] =>
      jobs.map((job) => (job.run as { action: string }).action);
    const first = await take(memory, 'w1', { limit: 2, lanes: 2 });
    expect(actions(first).sort()).toEqual(['one', 'two']);
    const second = await take(memory, 'w1', { limit: 4, lanes: 2 });
    expect(actions(second).filter((action) => action === 'one')).toHaveLength(2);
    expect(actions(second).filter((action) => action === 'two')).toHaveLength(2);
  });

  test("only jobs at or below the worker's revision, in the worker's capability sets", async () => {
    const memory = openMemory();
    await memory.run(tenantScope, async (unit) => {
      await unit.jobs.enqueue(jobSpec({ build: { id: 'b', revision: 5 } }));
      await unit.jobs.enqueue(jobSpec({ capability: ['smtp-out', 'dns'] }));
    });
    expect(await take(memory, 'w', { maxRevision: 4 })).toHaveLength(0);
    expect(
      await take(memory, 'w', { maxRevision: 9, capabilitySets: ['dns,smtp-out'] }),
    ).toHaveLength(1);
    expect(await take(memory, 'w', { maxRevision: 9 })).toHaveLength(1);
  });

  test("a tenant unit takes only its own scope's jobs", async () => {
    const memory = openMemory();
    await memory.run(tenantScope, (unit) => unit.jobs.enqueue(jobSpec()));
    expect(
      (await memory.run(tenantTwo, (unit) => unit.jobs.take('commands', 'w', request))).jobs,
    ).toEqual([]);
    expect(
      (await memory.run(tenantScope, (unit) => unit.jobs.take('commands', 'w', request))).jobs,
    ).toHaveLength(1);
  });

  test('the taken job carries its spec, id, due time and the attempt the worker holds', async () => {
    const memory = openMemory();
    await memory.run(tenantScope, (unit) => unit.jobs.enqueue(jobSpec()));
    const [job] = await take(memory);
    expect(job).toMatchObject({
      id: '1',
      queue: 'commands',
      kind: 'action',
      attempt: { jobId: '1', attempt: 1 },
    });
    expect(job?.runAt.equals(stamp)).toBe(true);
  });
});

describe('groups', () => {
  test('concurrency limits the running jobs of a group, completion frees a slot', async () => {
    const memory = openMemory();
    await memory.run(tenantScope, async (unit) => {
      for (let i = 0; i < 3; i++) {
        await unit.jobs.enqueue(jobSpec({ group: { id: 'mx:example.com', concurrency: 1 } }));
      }
    });
    const [first] = await take(memory);
    expect(first).toBeDefined();
    expect(await take(memory, 'w2')).toEqual([]);
    await memory.run(namespaceScope, (unit) =>
      unit.jobs.complete(first?.attempt ?? { jobId: '', attempt: 0 }, 'w1', { kind: 'succeeded' }),
    );
    expect(await take(memory, 'w2')).toHaveLength(1);
  });

  test('a rate spends tokens and blocks the group until the next one', async () => {
    const memory = openMemory();
    await memory.run(tenantScope, async (unit) => {
      for (let i = 0; i < 4; i++) {
        await unit.jobs.enqueue(jobSpec({ group: { id: 'g', rate: '2/1s' } }));
      }
    });
    expect(await take(memory)).toHaveLength(2);
    expect(await take(memory, 'w2')).toEqual([]);
    memory.clock.advance(1000);
    expect(await take(memory, 'w3')).toHaveLength(2);
  });

  test('a rate_limited retry blocks the group until its retryAfter', async () => {
    const memory = openMemory();
    await memory.run(tenantScope, async (unit) => {
      await unit.jobs.enqueue(jobSpec({ group: { id: 'g', concurrency: 5 } }));
      await unit.jobs.enqueue(jobSpec({ group: { id: 'g', concurrency: 5 } }));
    });
    const [first] = await take(memory, 'w1', { limit: 1 });
    await memory.run(namespaceScope, (unit) =>
      unit.jobs.complete(first?.attempt ?? { jobId: '', attempt: 0 }, 'w1', {
        kind: 'retry',
        at: stamp.add({ seconds: 5 }),
        error: { ...error, kind: 'rate_limited', retryAfter: 10 },
      }),
    );
    expect(await take(memory, 'w2')).toEqual([]);
    memory.clock.advance(10_000);
    expect(await take(memory, 'w2')).toHaveLength(1);
  });
});
