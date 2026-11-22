import { expectTypeOf, test } from 'vitest';
import { jobInput } from '../../src/effects/job-input.ts';
import type { QuotaLimits } from '../../src/quotas/quota-limits.ts';
import type { QuotaView } from '../../src/quotas/quota-view.ts';

// A path that reads a limit has asked the cache for fresh rows first: the cache has no member that
// reads one, and an enqueue cannot leave its limits or its queue out without a type error.

type JobInputOptions = Parameters<typeof jobInput>[0];
declare const cache: QuotaLimits;
declare const base: Omit<JobInputOptions, 'queue' | 'limits'>;

test('the quota cache hands out limits only through fresh()', () => {
  expectTypeOf<QuotaLimits>().toEqualTypeOf<{ fresh(): Promise<QuotaView> }>();
  // @ts-expect-error a limit is read from the view `fresh()` answers, never from the cache
  cache.limitOf;
  // @ts-expect-error a queue's limits are read from the view `fresh()` answers, never from the cache
  cache.queueOf;
});

test('jobInput needs its queue and its limits', () => {
  // @ts-expect-error the limits are missing: pass the view, or `undefined` where a process has none
  jobInput({ ...base, queue: 'commands' });
  // @ts-expect-error the queue is missing
  jobInput({ ...base, limits: undefined });
  expectTypeOf(jobInput({ ...base, queue: 'commands', limits: undefined })).toHaveProperty(
    'laneCap',
  );
});
