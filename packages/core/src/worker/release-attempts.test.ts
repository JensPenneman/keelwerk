import { expect, test, vi } from 'vitest';
import type { JobAttempt } from '../storage/job-attempt.ts';
import type { HeldJob } from './held-job.ts';
import { releaseAttempts } from './release-attempts.ts';

interface Call {
  readonly namespace: string;
  readonly scope: unknown;
  readonly attempts: readonly JobAttempt[];
  readonly worker: string;
}

function adapterOf(placementId: string, calls: Call[], fail: ReadonlySet<string> = new Set()) {
  return {
    placementId,
    unit: async (
      namespace: { readonly id: string },
      scope: unknown,
      fn: (unit: unknown) => Promise<readonly JobAttempt[]>,
    ) => {
      if (fail.has(namespace.id)) throw new Error(`namespace ${namespace.id} is down`);
      return fn({
        jobs: {
          release: async (attempts: readonly JobAttempt[], worker: string) => {
            calls.push({ namespace: namespace.id, scope, attempts, worker });
            return attempts;
          },
        },
      });
    },
  };
}

function heldOf(adapter: ReturnType<typeof adapterOf>, namespace: string, jobId: string): HeldJob {
  return {
    job: { stored: { attempt: { jobId, attempt: 1 } } },
    source: { handle: { adapter }, namespace: { id: namespace } },
  } as unknown as HeldJob;
}

test('one release per placement and namespace, in a namespace unit, answers the attempts released', async () => {
  const calls: Call[] = [];
  const adapter = adapterOf('main', calls);
  const other = adapterOf('other', calls);
  const released = await releaseAttempts(
    [
      heldOf(adapter, 'n1', '1'),
      heldOf(adapter, 'n1', '2'),
      heldOf(adapter, 'n2', '3'),
      heldOf(other, 'n1', '4'),
    ],
    'p-1',
  );
  expect(released).toBe(4);
  expect(calls).toHaveLength(3);
  expect(calls.map((call) => [call.namespace, call.attempts.map((a) => a.jobId)]).sort()).toEqual([
    ['n1', ['1', '2']],
    ['n1', ['4']],
    ['n2', ['3']],
  ]);
  for (const call of calls) {
    expect(call.scope).toEqual({ level: 'namespace', reason: 'jobs' });
    expect(call.worker).toBe('p-1');
  }
});

test('a failing unit reaches onError and counts nothing, the other namespaces are released', async () => {
  const calls: Call[] = [];
  const adapter = adapterOf('main', calls, new Set(['n1']));
  const onError = vi.fn();
  const released = await releaseAttempts(
    [heldOf(adapter, 'n1', '1'), heldOf(adapter, 'n2', '2')],
    'p-1',
    onError,
  );
  expect(released).toBe(1);
  expect(onError).toHaveBeenCalledTimes(1);
  expect(calls.map((call) => call.namespace)).toEqual(['n2']);
});

test('nothing held releases nothing and opens no unit', async () => {
  expect(await releaseAttempts([], 'p-1')).toBe(0);
});
