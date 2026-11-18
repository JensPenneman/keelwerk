import { expect, test, vi } from 'vitest';
import { RestoreHoldRefusal } from '../control/restore-hold-refusal.ts';
import { errors } from '../errors/errors.ts';
import type { Job } from '../jobs/job.ts';
import { reactionQueue } from '../reactions/reaction-queue.ts';
import type { JobOutcome } from '../storage/job-outcome.ts';
import { runActionJob } from './run-action-job.ts';
import type { RunJobContext } from './run-job.ts';

const backendCommand = { kind: 'command', ref: 'm.up', module: 'm', scope: 'backend', input: {} };

function setup(
  run: { action: string; input: unknown; commandId?: string },
  extra: Record<string, unknown> = {},
) {
  const completed: JobOutcome[] = [];
  const invoke = vi.fn(async (_request: unknown) => ({ ok: true }));
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
    clock: { now: () => Temporal.Instant.from('2026-01-01T00:00:00Z') },
    random: () => 0.5,
    invoker: { invoke },
    source: {
      namespace: { id: 'ns' },
      registry: { actions: new Map([['m.up', backendCommand]]), reactions: new Map() },
      handle: {
        adapter: {
          unit: async (_ns: unknown, _scope: unknown, fn: (u: unknown) => unknown) => fn(unit),
        },
      },
    },
  } as unknown as RunJobContext;
  const job = {
    signal: new AbortController().signal,
    stored: {
      run,
      queue: 'commands',
      scope: { level: 'tenant', backendId: 'b', tenantId: 't' },
      attempt: { jobId: '1', attempt: 1 },
      createdAt: Temporal.Instant.from('2026-01-01T00:00:00Z'),
      causation: {},
      ...extra,
    },
  } as unknown as Job;
  return { completed, invoke, context, job };
}

test('a job that crosses scopes and has no command id fails and does not run', async () => {
  const { completed, invoke, context, job } = setup({ action: 'm.up', input: {} });
  await runActionJob(job, context);
  expect(invoke).not.toHaveBeenCalled();
  expect(completed).toHaveLength(1);
  expect(completed[0]).toMatchObject({
    kind: 'failed',
    error: { code: 'core.request_not_allowed' },
  });
});

test('the stored retry policy reaches the carrier of the job', async () => {
  const retry = { delays: ['12h'], limit: 5, maxDelay: '12h' };
  const { invoke, context, job } = setup(
    { action: 'm.up', input: {} },
    { retry, queue: reactionQueue },
  );
  await runActionJob(job, context);
  expect(invoke).toHaveBeenCalledTimes(1);
  const [call] = invoke.mock.calls[0] ?? [];
  expect(call).toMatchObject({ carrier: { job: { retry } } });
});

test('a job a held tenant refused waits a second and keeps its attempt, however many it has used', async () => {
  const { completed, invoke, context, job } = setup(
    { action: 'm.up', input: {} },
    {
      queue: reactionQueue,
      attempt: { jobId: '1', attempt: 3 },
      retry: { delays: ['1s'], limit: 3 },
    },
  );
  invoke.mockResolvedValueOnce({ ok: false, error: new RestoreHoldRefusal() } as never);
  await runActionJob(job, context);
  expect(completed).toHaveLength(1);
  const [outcome] = completed;
  expect(outcome).toMatchObject({ kind: 'retry', uncounted: true });
  if (outcome?.kind !== 'retry') return;
  expect(outcome.at).toEqual(Temporal.Instant.from('2026-01-01T00:00:01Z'));
  expect(outcome.error).toMatchObject({ code: 'core.unavailable', retryAfter: 1 });

  // Any other unavailable at the last attempt gives up, as before.
  const other = setup(
    { action: 'm.up', input: {} },
    {
      queue: reactionQueue,
      attempt: { jobId: '1', attempt: 3 },
      retry: { delays: ['1s'], limit: 3 },
    },
  );
  other.invoke.mockResolvedValueOnce({ ok: false, error: errors.unavailable('down') } as never);
  await runActionJob(other.job, other.context);
  expect(other.completed[0]).toMatchObject({ kind: 'failed' });
});
