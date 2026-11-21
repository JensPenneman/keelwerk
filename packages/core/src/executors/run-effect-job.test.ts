import { beforeEach, describe, expect, test, vi } from 'vitest';
import { recordingLogger } from '../../test/executor-kit.ts';
import { coreError } from '../http/core-error.ts';
import type { Job } from '../jobs/job.ts';
import type { StoredJob } from '../storage/stored-job.ts';
import type { RunJobContext } from '../worker/run-job.ts';
import type { AttemptResult } from './end-effect-attempt.ts';
import { runEffectJob } from './run-effect-job.ts';

const seam = vi.hoisted(() => ({
  result: undefined as unknown,
  calls: [] as string[],
}));
vi.mock('./effect-config-of.ts', () => ({ effectConfigOf: () => Promise.resolve({ value: {} }) }));
vi.mock('./begin-effect-attempt.ts', () => ({
  beginEffectAttempt: () => {
    seam.calls.push('begin');
    return Promise.resolve({
      kind: 'run',
      input: {},
      startedAt: '2026-01-01T00:00:00Z',
      started: 1,
    });
  },
}));
vi.mock('./perform-executor.ts', () => ({
  performExecutor: () => {
    seam.calls.push('perform');
    return Promise.resolve(seam.result);
  },
}));
vi.mock('./end-effect-attempt.ts', () => ({
  endEffectAttempt: () => {
    seam.calls.push('end');
    return Promise.resolve(undefined);
  },
}));
vi.mock('./close-unrun-attempt.ts', () => ({
  closeUnrunAttempt: () => {
    seam.calls.push('close');
    return Promise.resolve();
  },
}));

function setup(reason: unknown) {
  const abort = new AbortController();
  abort.abort(reason);
  const stored = {
    attempt: { jobId: '1', attempt: 1 },
    scope: { level: 'tenant', backendId: 'b', tenantId: 't' },
    run: { executor: 'mail.send', effect: 'eff-1' },
  } as unknown as StoredJob;
  const job = { stored, signal: abort.signal } as unknown as Job;
  const span = { setStatus: () => undefined, end: () => undefined };
  const context = {
    log: recordingLogger(),
    tracer: { startSpan: () => span },
    source: {
      registry: {
        executors: new Map([['mail.send', { effect: 'mail' }]]),
        effects: new Map([['mail', { ref: 'mail', module: 'queues' }]]),
      },
    },
  } as unknown as RunJobContext;
  return { job, context };
}

beforeEach(() => {
  seam.calls.length = 0;
});

describe('an effect attempt that is aborted', () => {
  test('before the executor ran is closed, then rejects with the signal reason', async () => {
    const reason = coreError('core.unavailable');
    seam.result = { ok: false, error: reason, unrun: true } satisfies AttemptResult;
    const { job, context } = setup(reason);
    await expect(runEffectJob(job, context)).rejects.toBe(reason);
    expect(seam.calls).toEqual(['begin', 'perform', 'close']);
  });

  test('while the executor ran is not closed: its start record stays open', async () => {
    const reason = coreError('core.unavailable');
    seam.result = { ok: false, error: reason } satisfies AttemptResult;
    const { job, context } = setup(reason);
    await expect(runEffectJob(job, context)).rejects.toBe(reason);
    expect(seam.calls).toEqual(['begin', 'perform']);
  });
});
