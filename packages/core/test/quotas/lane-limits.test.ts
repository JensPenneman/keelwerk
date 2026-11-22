import { describe, expect, test } from 'vitest';
import { jobInput } from '../../src/effects/job-input.ts';
import { laneLimitsOf } from '../../src/quotas/lane-limits-of.ts';
import type { QueueLimits } from '../../src/quotas/queue-limits.ts';
import type { QuotaView } from '../../src/quotas/quota-view.ts';
import type { Scope } from '../../src/storage/scope.ts';
import type { StoredJobSpec } from '../../src/storage/stored-job-spec.ts';
import { createKernelQueue } from '../../src/worker/create-kernel-queue.ts';

const scope: Scope = {
  level: 'tenant',
  backendId: '00000000-0000-4000-8000-0000000000b1',
  tenantId: '00000000-0000-4000-8000-0000000000a1',
};
const now = Temporal.Instant.from('2026-11-19T10:00:00Z');

const deployment: Scope = { level: 'deployment' };
const viewOf = (queue: QueueLimits): QuotaView => ({
  limitOf: () => ({ kind: 'count', value: 0 }),
  queueOf: () => queue,
});
/** The lane members of `queue` in the tenant's scope under these limits. */
const laneOf = (queue: QueueLimits) => laneLimitsOf(viewOf(queue), scope, 'commands');

describe('lane limits of a job (section 12.2)', () => {
  test('without limits, and in the deployment scope, a job has cap 4 and no weight', () => {
    expect(laneLimitsOf(undefined, scope, 'commands')).toEqual({ laneCap: 4 });
    expect('laneWeight' in laneLimitsOf(undefined, scope, 'commands')).toBe(false);
    const view = viewOf({ running: 9, queued: 1, weight: 5 });
    expect(laneLimitsOf(view, deployment, 'commands')).toEqual({ laneCap: 4 });
    expect('laneWeight' in laneLimitsOf(view, deployment, 'commands')).toBe(false);
  });

  test('with limits a job has the running cap of its scope and queue and a weight of at least 1', () => {
    const asked: [Scope, string][] = [];
    const view: QuotaView = {
      limitOf: () => ({ kind: 'count', value: 0 }),
      queueOf: (of, queue) => {
        asked.push([of, queue]);
        return { running: 7, queued: 10, weight: 3 };
      },
    };
    expect(laneLimitsOf(view, scope, 'timers')).toEqual({ laneCap: 7, laneWeight: 3 });
    expect(asked).toEqual([[scope, 'timers']]);
    expect(laneOf({ running: 0, queued: 10, weight: 0 })).toEqual({ laneCap: 0, laneWeight: 1 });
  });

  test('a cap and a weight are whole numbers inside the integer columns', () => {
    const limits = (running: number, weight: number) => ({ running, queued: 10, weight });
    expect(laneOf(limits(0, 1))).toEqual({ laneCap: 0, laneWeight: 1 });
    expect(laneOf(limits(-1, -1))).toEqual({ laneCap: 0, laneWeight: 1 });
    expect(laneOf(limits(2.7, 2.7))).toEqual({ laneCap: 2, laneWeight: 2 });
    expect(laneOf(limits(2 ** 40, 2 ** 40))).toEqual({
      laneCap: 2_147_483_647,
      laneWeight: 2_147_483_647,
    });
    expect(laneOf(limits(2_147_483_647, 2_147_483_647))).toEqual({
      laneCap: 2_147_483_647,
      laneWeight: 2_147_483_647,
    });
  });

  test('a running that is not finite gives cap 4 and a weight that is not finite gives none', () => {
    const limits = (running: number, weight: number) => ({ running, queued: 10, weight });
    expect(laneOf(limits(Number.NaN, 3))).toEqual({ laneCap: 4, laneWeight: 3 });
    expect(laneOf(limits(Number.POSITIVE_INFINITY, 3))).toEqual({ laneCap: 4, laneWeight: 3 });
    expect(laneOf(limits(Number.NEGATIVE_INFINITY, 3))).toEqual({ laneCap: 4, laneWeight: 3 });
    for (const weight of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const lane = laneOf(limits(6, weight));
      expect(lane).toEqual({ laneCap: 6 });
      expect('laneWeight' in lane).toBe(false);
    }
  });

  test('jobInput carries the lane limits and the queued cap of its queue, unless it says why not', () => {
    const base = {
      scope,
      principal: { kind: 'system', via: 'core.system', reason: 'test', ref: null },
      causation: {},
      caller: 'app',
      build: { id: 'b', revision: 1 },
      now,
      queue: 'timers',
    } as unknown as Parameters<typeof jobInput>[0];
    const bare = jobInput({ ...base, limits: undefined });
    expect(bare.laneCap).toBe(4);
    expect('queuedCap' in bare).toBe(false);
    expect(bare.queue).toBe('timers');
    const limits = viewOf({ running: 9, queued: 11, weight: 2 });
    const limited = jobInput({ ...base, limits });
    expect(limited.laneCap).toBe(9);
    expect(limited.laneWeight).toBe(2);
    expect(limited.queuedCap).toBe(11);
    for (const exempt of ['accepted', 'definition'] as const) {
      const spared = jobInput({ ...base, limits, exempt });
      expect(spared.laneCap).toBe(9);
      expect('queuedCap' in spared).toBe(false);
    }
    expect('queuedCap' in jobInput({ ...base, caller: 'core', limits })).toBe(false);
  });

  test('the kernel queue enqueues with the limits of the job scope and queue, and no queued cap', async () => {
    const asked: [Scope, string][] = [];
    const quotas: QuotaView = {
      limitOf: () => ({ kind: 'count', value: 0 }),
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
    expect(enqueued[0] !== undefined && 'queuedCap' in enqueued[0]).toBe(false);
  });
});
