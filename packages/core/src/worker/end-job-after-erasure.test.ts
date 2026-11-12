import { describe, expect, test } from 'vitest';
import {
  type CountedValue,
  type LoggedLine,
  recordingLogger,
  recordingMeter,
} from '../../test/executor-kit.ts';
import { timerQueue } from '../effects/timer-queue.ts';
import type { JobOutcome } from '../storage/job-outcome.ts';
import type { StoredJob } from '../storage/stored-job.ts';
import { PersonalKeyDestroyed } from '../write-path/personal-key-destroyed.ts';
import { endJobAfterErasure } from './end-job-after-erasure.ts';

const subject = '0197a1c2-7b3e-7c11-9a55-3f2e8d6b4a12';

function setup(commitFailures = 0) {
  let failures = commitFailures;
  const completed: JobOutcome[] = [];
  const lines: LoggedLine[] = [];
  const counted: CountedValue[] = [];
  const unit = {
    jobs: {
      complete: (_attempt: unknown, _worker: string, outcome: JobOutcome) => {
        completed.push(outcome);
        return Promise.resolve(true);
      },
    },
  };
  const context = {
    worker: 'w',
    clock: { now: () => Temporal.Instant.from('2026-01-01T00:00:00Z') },
    log: recordingLogger(lines),
    meter: recordingMeter(counted),
    writer: { build: { id: 'b', revision: 1 }, hybridClock: {} },
    source: {
      namespace: { id: 'ns' },
      registry: { actions: new Map() },
      handle: {
        adapter: {
          // A commit that fails runs the body and then rejects: what the body did is rolled back.
          unit: async (_ns: unknown, _scope: unknown, fn: (u: unknown) => unknown) => {
            const answer = await fn(unit);
            if (failures > 0) {
              failures -= 1;
              throw new Error('the commit failed');
            }
            return answer;
          },
        },
      },
    },
  } as unknown as Parameters<typeof endJobAfterErasure>[0];
  const jobOf = (queue: string): StoredJob =>
    ({
      id: `job-${queue}`,
      queue,
      run: { action: 'm.go', input: { who: subject } },
      scope: { level: 'tenant', backendId: 'b', tenantId: 't' },
      attempt: { jobId: '1', attempt: 1 },
      causation: {},
    }) as unknown as StoredJob;
  return { completed, lines, counted, context, jobOf };
}

describe('a job whose personal key is destroyed (14.7.5, D8)', () => {
  test.each([
    [timerQueue, 'succeeded'],
    ['commands', 'failed'],
  ])(
    'on the %s queue it ends %s with one info line that names no subject and one count for the queue',
    async (queue, kind) => {
      const { completed, lines, counted, context, jobOf } = setup();
      // The lost message of a real run names no value either, but the line must not carry it.
      await endJobAfterErasure(context, jobOf(queue), new PersonalKeyDestroyed(`gone ${subject}`));
      expect(completed.map((outcome) => outcome.kind)).toEqual([kind]);
      expect(lines.filter((line) => line.level === 'info')).toHaveLength(1);
      expect(lines).toHaveLength(1);
      expect(JSON.stringify(lines)).not.toContain(subject);
      expect(counted).toEqual([
        { name: 'keelwerk.jobs.key_destroyed', value: 1, attributes: { queue } },
      ]);
      if (kind === 'failed') {
        expect(completed[0]).toMatchObject({ error: { code: 'core.key_destroyed' } });
      }
    },
  );
});

describe('a job whose settle does not commit (14.7.5, D8)', () => {
  test.each([timerQueue, 'commands'])(
    'on the %s queue a commit that fails once leaves one info line and one count in the end',
    async (queue) => {
      const { lines, counted, context, jobOf } = setup(1);
      const error = new PersonalKeyDestroyed('gone');
      await expect(endJobAfterErasure(context, jobOf(queue), error)).rejects.toThrow(
        'the commit failed',
      );
      expect(lines).toEqual([]);
      expect(counted).toEqual([]);
      await endJobAfterErasure(context, jobOf(queue), error);
      expect(lines.filter((line) => line.level === 'info')).toHaveLength(1);
      expect(counted).toEqual([
        { name: 'keelwerk.jobs.key_destroyed', value: 1, attributes: { queue } },
      ]);
    },
  );
});
