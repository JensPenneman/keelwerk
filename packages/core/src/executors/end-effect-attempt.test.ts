import { beforeEach, describe, expect, test, vi } from 'vitest';
import { coreError } from '../http/core-error.ts';
import type { StoredJob } from '../storage/stored-job.ts';
import type { RunJobContext } from '../worker/run-job.ts';
import type { BeganAttempt } from './begin-effect-attempt.ts';
import type { EffectAttemptJob } from './effect-attempt-job.ts';
import { endEffectAttempt } from './end-effect-attempt.ts';

vi.mock('./record-attempt.ts', () => ({ recordAttempt: () => Promise.resolve() }));
const settled = vi.hoisted(() => ({ calls: [] as { status: string; code: string }[] }));
vi.mock('./settle-effect.ts', () => ({
  settleEffect: (
    _unit: unknown,
    _target: unknown,
    outcome: { status: string; error: { code: string } },
  ) => {
    settled.calls.push({ status: outcome.status, code: outcome.error.code });
    return Promise.resolve(true);
  },
}));

beforeEach(() => {
  settled.calls.length = 0;
});

/** The end unit of an attempt whose timeout fired before its own executor was called. */
async function endUnrun(earlier: boolean): Promise<void> {
  const unit = {
    rows: {
      findOne: () => Promise.resolve({ id: 'eff-1', status: 'requested' }),
    },
    jobs: { complete: () => Promise.resolve(true) },
  };
  const context = {
    worker: 'w',
    clock: { now: () => Temporal.Instant.from('2026-01-01T00:00:00Z') },
    random: () => 0.5,
    writer: { build: { id: 'b', revision: 1 } },
    source: {
      namespace: { id: 'ns' },
      handle: {
        adapter: { unit: (_ns: unknown, _scope: unknown, fn: (u: unknown) => unknown) => fn(unit) },
      },
    },
  } as unknown as RunJobContext;
  const target = {
    stored: {
      id: 'job-1',
      queue: 'effects',
      // The attempt is the last the policy allows: no retry is left.
      attempt: { jobId: '1', attempt: earlier ? 2 : 1 },
      retry: { limit: earlier ? 2 : 1, delays: 'exponential' },
      scope: { level: 'deployment' },
      causation: {},
    } as unknown as StoredJob,
    registry: {
      actions: new Map(),
      entities: new Map([['core.effect', { descriptor: { ref: 'core.effect' } }]]),
    },
    effectId: 'eff-1',
    executor: {},
    entry: { module: 'queues' },
    requestId: 'req-1',
  } as unknown as EffectAttemptJob;
  const began = {
    kind: 'run',
    input: {},
    startedAt: '2026-01-01T00:00:00Z',
    started: 2,
    earlier,
  } as Extract<BeganAttempt, { readonly kind: 'run' }>;
  await endEffectAttempt(context, target, began, {
    ok: false,
    error: coreError('core.timeout'),
    unrun: true,
  });
}

describe('the end unit of an attempt whose timeout fired before its own executor was called', () => {
  test('settles the effect abandoned with core.effect_outcome_unknown when an earlier attempt began', async () => {
    await endUnrun(true);
    expect(settled.calls).toEqual([{ status: 'abandoned', code: 'core.effect_outcome_unknown' }]);
  });

  test('settles the effect failed with core.timeout on a first attempt', async () => {
    await endUnrun(false);
    expect(settled.calls).toEqual([{ status: 'failed', code: 'core.timeout' }]);
  });
});
