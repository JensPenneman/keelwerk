import { describe, expect, test } from 'vitest';
import { jobInput } from '../../src/effects/job-input.ts';
import { laneLimitsOf } from '../../src/quotas/lane-limits-of.ts';
import type { QuotaLimits } from '../../src/quotas/quota-limits.ts';
import type { Scope } from '../../src/storage/scope.ts';
import type { StoredJobSpec } from '../../src/storage/stored-job-spec.ts';
import { createKernelQueue } from '../../src/worker/create-kernel-queue.ts';

const scope: Scope = {
  level: 'tenant',
  backendId: '00000000-0000-4000-8000-0000000000b1',
  tenantId: '00000000-0000-4000-8000-0000000000a1',
};
const now = Temporal.Instant.from('2026-11-19T10:00:00Z');

describe('lane limits of a job (section 12.2)', () => {
  test('without limits a job has cap 4 and no weight', () => {
    expect(laneLimitsOf(undefined)).toEqual({ laneCap: 4 });
    expect('laneWeight' in laneLimitsOf(undefined)).toBe(false);
  });

  test('with limits a job has the running cap and a weight of at least 1', () => {
    expect(laneLimitsOf({ running: 7, queued: 10, weight: 3 })).toEqual({
      laneCap: 7,
      laneWeight: 3,
    });
    expect(laneLimitsOf({ running: 0, queued: 10, weight: 0 })).toEqual({
      laneCap: 0,
      laneWeight: 1,
    });
  });

  test('a cap and a weight are whole numbers inside the integer columns', () => {
    const limits = (running: number, weight: number) => ({ running, queued: 10, weight });
    expect(laneLimitsOf(limits(0, 1))).toEqual({ laneCap: 0, laneWeight: 1 });
    expect(laneLimitsOf(limits(-1, -1))).toEqual({ laneCap: 0, laneWeight: 1 });
    expect(laneLimitsOf(limits(2.7, 2.7))).toEqual({ laneCap: 2, laneWeight: 2 });
    expect(laneLimitsOf(limits(2 ** 40, 2 ** 40))).toEqual({
      laneCap: 2_147_483_647,
      laneWeight: 2_147_483_647,
    });
    expect(laneLimitsOf(limits(2_147_483_647, 2_147_483_647))).toEqual({
      laneCap: 2_147_483_647,
      laneWeight: 2_147_483_647,
    });
  });

  test('a running that is not finite gives cap 4 and a weight that is not finite gives none', () => {
    const limits = (running: number, weight: number) => ({ running, queued: 10, weight });
    expect(laneLimitsOf(limits(Number.NaN, 3))).toEqual({ laneCap: 4, laneWeight: 3 });
    expect(laneLimitsOf(limits(Number.POSITIVE_INFINITY, 3))).toEqual({
      laneCap: 4,
      laneWeight: 3,
    });
    expect(laneLimitsOf(limits(Number.NEGATIVE_INFINITY, 3))).toEqual({
      laneCap: 4,
      laneWeight: 3,
    });
    for (const weight of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const lane = laneLimitsOf(limits(6, weight));
      expect(lane).toEqual({ laneCap: 6 });
      expect('laneWeight' in lane).toBe(false);
    }
  });

  test('jobInput carries the lane limits it is given', () => {
    const base = {
      scope,
      principal: { kind: 'system', via: 'core.system', reason: 'test', ref: null },
      causation: {},
      caller: 'core',
      build: { id: 'b', revision: 1 },
      now,
    } as unknown as Parameters<typeof jobInput>[0];
    expect(jobInput(base).laneCap).toBe(4);
    const limited = jobInput({ ...base, limits: { running: 9, queued: 1, weight: 2 } });
    expect(limited.laneCap).toBe(9);
    expect(limited.laneWeight).toBe(2);
  });

  test('the kernel queue enqueues with the limits of the job scope and queue', async () => {
    const asked: [Scope, string][] = [];
    const quotas: Pick<QuotaLimits, 'queueOf'> = {
      queueOf: (of, queue) => {
        asked.push([of, queue]);
        return { running: 6, queued: 100, weight: 5 };
      },
    };
    const enqueued: StoredJobSpec[] = [];
    const queue = createKernelQueue({
      sources: [],
      worker: 'w',
      clock: { now: () => now },
      log: { warn: () => undefined } as never,
      writer: undefined as never,
      quotas,
    });
    await queue.enqueue(
      {
        scope,
        queue: 'reactions',
        run: { action: 'a', input: 1 },
        principal: { resolver: 'system', principalId: 'p' },
        causation: {},
        build: { id: 'b', revision: 1 },
      } as never,
      {
        jobs: {
          enqueue: async (spec: StoredJobSpec) => {
            enqueued.push(spec);
            return 'id';
          },
        },
      } as never,
    );
    expect(asked).toEqual([[scope, 'reactions']]);
    expect(enqueued[0]?.laneCap).toBe(6);
    expect(enqueued[0]?.laneWeight).toBe(5);
  });
});
