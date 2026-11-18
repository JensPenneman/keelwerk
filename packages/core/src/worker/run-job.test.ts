import { describe, expect, test, vi } from 'vitest';
import type { ControlStore } from '../control/control-store.ts';
import { createRestoreHold } from '../control/create-restore-hold.ts';
import type { Job } from '../jobs/job.ts';
import type { Clock } from '../kernel/clock.ts';
import type { Logger } from '../observability/logger.ts';
import type { JobOutcome } from '../storage/job-outcome.ts';
import { type RunJobContext, runJob } from './run-job.ts';

const ran = vi.hoisted(() => ({ executor: 0, deadline: 0 }));
vi.mock('../executors/run-effect-job.ts', () => ({
  runEffectJob: () => {
    ran.executor += 1;
    return Promise.resolve();
  },
}));
vi.mock('../executors/run-deadline-job.ts', () => ({
  runDeadlineJob: () => {
    ran.deadline += 1;
    return Promise.resolve();
  },
}));

const held = '0192f3a0-0000-7000-8000-000000000001';
const free = '0192f3a0-0000-7000-8000-000000000002';

function setup() {
  const completed: JobOutcome[] = [];
  const state = { unfinished: 1, ms: Date.parse('2026-11-18T10:00:00Z') };
  const clock: Clock = { now: () => Temporal.Instant.fromEpochMilliseconds(state.ms) };
  const control = {
    epochs: () => new Map(),
    ledger: {
      unfinished: async () => ({
        erasures: Array.from({ length: state.unfinished }, (_, seq) => ({ seq: BigInt(seq + 1) })),
        head: 0n,
      }),
    },
  } as unknown as ControlStore;
  const log = { error: () => undefined, warn: () => undefined } as unknown as Logger;
  const unit = {
    jobs: {
      complete: async (_attempt: unknown, _worker: string, outcome: JobOutcome) => {
        completed.push(outcome);
        return true;
      },
    },
  };
  const context = {
    worker: 'w',
    clock,
    source: {
      namespace: { id: 'ns' },
      registry: { actions: new Map() },
      handle: {
        adapter: {
          unit: async (_ns: unknown, _scope: unknown, fn: (u: unknown) => unknown) => fn(unit),
        },
      },
    },
    restoreHold: createRestoreHold(control, clock, [held], log),
  } as unknown as RunJobContext;
  const jobOf = (tenantId: string, run: object): Job =>
    ({
      signal: new AbortController().signal,
      stored: {
        run,
        kind: 'k',
        queue: 'effects',
        scope: { level: 'tenant', backendId: 'b', tenantId },
        attempt: { jobId: '1', attempt: 3 },
        retry: { delays: ['1s'], limit: 3 },
        causation: {},
      },
    }) as unknown as Job;
  return { completed, context, state, jobOf };
}

describe.each([
  ['an effect job', { executor: 'm.send', effect: 'e1' }, 'executor'],
  ['a deadline job', { effectDeadline: 'e1' }, 'deadline'],
] as const)('%s of a tenant a restore holds', (_name, run, counter) => {
  test('is given back for a second without a used attempt, and runs once the hold ended', async () => {
    const { completed, context, state, jobOf } = setup();
    const before = ran[counter];
    await runJob(jobOf(held, run), context);
    expect(ran[counter]).toBe(before);
    expect(completed).toHaveLength(1);
    const [outcome] = completed;
    expect(outcome).toMatchObject({ kind: 'retry', uncounted: true });
    if (outcome?.kind !== 'retry') return;
    expect(outcome.at).toEqual(Temporal.Instant.fromEpochMilliseconds(state.ms + 1000));
    expect(outcome.error).toMatchObject({ code: 'core.unavailable', retryAfter: 1 });

    // The erasure completed: the next read, a second later, lifts the hold and the job runs.
    state.unfinished = 0;
    state.ms += 1000;
    await runJob(jobOf(held, run), context);
    expect(ran[counter]).toBe(before + 1);
    expect(completed).toHaveLength(1);
  });

  test('of another tenant runs at once', async () => {
    const { completed, context, jobOf } = setup();
    const before = ran[counter];
    await runJob(jobOf(free, run), context);
    expect(ran[counter]).toBe(before + 1);
    expect(completed).toHaveLength(0);
  });
});
