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

describe('leases, heartbeats and completion', () => {
  test('a heartbeat renews only the attempts the worker holds', async () => {
    const memory = openMemory();
    await memory.run(tenantScope, async (unit) => {
      await unit.jobs.enqueue(jobSpec());
      await unit.jobs.enqueue(jobSpec());
    });
    const jobs = await take(memory, 'w1');
    const attempts = jobs.map((job) => job.attempt);
    const held = await memory.run(namespaceScope, (unit) =>
      unit.jobs.heartbeat(
        [...attempts, { jobId: '99', attempt: 1 }, { jobId: '1', attempt: 7 }],
        'w1',
        60_000,
      ),
    );
    expect(held).toEqual(attempts);
    expect(
      await memory.run(namespaceScope, (unit) => unit.jobs.heartbeat(attempts, 'other', 1000)),
    ).toEqual([]);
    memory.clock.advance(40_000);
    expect(await take(memory, 'w2')).toEqual([]);
  });

  test('an expired lease is reclaimed by the next take and the stale worker is fenced out', async () => {
    const memory = openMemory();
    await memory.run(tenantScope, (unit) => unit.jobs.enqueue(jobSpec()));
    const [first] = await take(memory, 'w1');
    memory.clock.advance(31_000);
    const [second] = await take(memory, 'w2');
    expect(second?.attempt).toEqual({ jobId: '1', attempt: 2 });
    const stale = await memory.run(namespaceScope, (unit) =>
      unit.jobs.complete(first?.attempt ?? { jobId: '', attempt: 0 }, 'w1', { kind: 'succeeded' }),
    );
    expect(stale).toBe(false);
    const fresh = await memory.run(namespaceScope, (unit) =>
      unit.jobs.complete(second?.attempt ?? { jobId: '', attempt: 0 }, 'w2', { kind: 'succeeded' }),
    );
    expect(fresh).toBe(true);
  });

  test('three lost leases make a dead letter that keeps its input', async () => {
    const memory = openMemory();
    await memory.run(tenantScope, (unit) => unit.jobs.enqueue(jobSpec({ deadLetter: 'dl' })));
    for (let i = 1; i <= 3; i++) {
      expect(await take(memory, `w${i}`)).toHaveLength(1);
      memory.clock.advance(31_000);
    }
    expect(await take(memory, 'w4')).toEqual([]);
    const history = await memory.read(namespaceScope, (unit) => unit.jobs.stats('commands'));
    expect(history[0]).toMatchObject({ running: 0, due: 0 });
  });

  test('success removes the job, retry schedules it, failure and dead letter end it', async () => {
    const memory = openMemory();
    await memory.run(tenantScope, async (unit) => {
      for (let i = 0; i < 4; i++)
        await unit.jobs.enqueue(jobSpec({ run: { action: 'a', input: i } }));
    });
    const jobs = await take(memory);
    const outcomes = [
      { kind: 'succeeded' },
      { kind: 'retry', at: stamp.add({ seconds: 10 }), error },
      { kind: 'failed', error },
      { kind: 'dead', error },
    ] as const;
    for (const [index, outcome] of outcomes.entries()) {
      const attempt = jobs[index]?.attempt ?? { jobId: '', attempt: 0 };
      expect(
        await memory.run(namespaceScope, (unit) => unit.jobs.complete(attempt, 'w1', outcome)),
      ).toBe(true);
      expect(
        await memory.run(namespaceScope, (unit) => unit.jobs.complete(attempt, 'w1', outcome)),
      ).toBe(false);
    }
    expect(await take(memory, 'w2')).toEqual([]);
    memory.clock.advance(10_000);
    expect(await memory.run(namespaceScope, (unit) => unit.jobs.promote('commands', 10))).toBe(1);
    const [retried] = await take(memory, 'w2');
    expect(retried?.attempt).toEqual({ jobId: '2', attempt: 2 });
  });

  test("a completion in another scope's unit does not find the job", async () => {
    const memory = openMemory();
    await memory.run(tenantScope, (unit) => unit.jobs.enqueue(jobSpec()));
    const [job] = await take(memory);
    const attempt = job?.attempt ?? { jobId: '', attempt: 0 };
    expect(
      await memory.run(tenantTwo, (unit) =>
        unit.jobs.complete(attempt, 'w1', { kind: 'succeeded' }),
      ),
    ).toBe(false);
    expect(
      await memory.run(tenantScope, (unit) =>
        unit.jobs.complete(attempt, 'w1', { kind: 'succeeded' }),
      ),
    ).toBe(true);
  });
});

describe('statistics', () => {
  test('per queue and capability set: due, running, next due time, oldest wait', async () => {
    const memory = openMemory();
    await memory.run(tenantScope, async (unit) => {
      await unit.jobs.enqueue(jobSpec());
      await unit.jobs.enqueue(jobSpec({ capability: ['smtp-out'] }));
      await unit.jobs.enqueue(jobSpec({ queue: 'timers', runAt: stamp.add({ seconds: 30 }) }));
    });
    memory.clock.advance(5000);
    const all = (await stats(memory)) as {
      queue: string;
      capabilities: string[];
      due: number;
      oldestDueSeconds: number;
    }[];
    expect(all.map((row) => [row.queue, row.capabilities, row.due])).toEqual([
      ['commands', [], 1],
      ['commands', ['smtp-out'], 1],
      ['timers', [], 0],
    ]);
    expect(all[0]?.oldestDueSeconds).toBe(5);
    const timers = (await stats(memory, 'timers')) as { nextDueAt: Temporal.Instant | null }[];
    expect(timers[0]?.nextDueAt?.equals(stamp.add({ seconds: 30 }))).toBe(true);
    expect(await memory.read(tenantTwo, (unit) => unit.jobs.stats())).toEqual([]);
  });
});
