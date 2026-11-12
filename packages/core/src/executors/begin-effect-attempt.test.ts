import { beforeEach, describe, expect, test, vi } from 'vitest';
import {
  type CountedValue,
  type LoggedLine,
  recordingLogger,
  recordingMeter,
} from '../../test/executor-kit.ts';
import { field } from '../fields/field.ts';
import { shape } from '../fields/shape.ts';
import type { JobOutcome } from '../storage/job-outcome.ts';
import type { StoredJob } from '../storage/stored-job.ts';
import type { RunJobContext } from '../worker/run-job.ts';
import { beginEffectAttempt } from './begin-effect-attempt.ts';
import type { EffectAttemptJob } from './effect-attempt-job.ts';

const opening = vi.hoisted(() => ({
  answer: { input: {}, erased: [] as string[], mismatched: [] as string[] },
}));
vi.mock('../effects/open-effect-input.ts', () => ({
  openEffectInput: () => Promise.resolve(opening.answer),
}));
vi.mock('./latest-attempt-records.ts', () => ({
  latestAttemptRecords: () => Promise.resolve({ records: [], started: new Set<number>() }),
}));
vi.mock('./record-attempt.ts', () => ({ recordAttempt: () => Promise.resolve() }));
const settled = vi.hoisted(() => ({ errors: [] as { code: string }[] }));
vi.mock('./settle-keeping-continuation.ts', () => ({
  settleKeepingContinuation: async (
    _unit: unknown,
    _target: unknown,
    settledOf: () => Promise<{ error: { code: string } }>,
  ) => {
    settled.errors.push((await settledOf()).error);
  },
}));

const effectId = 'eff-1';

function setup(commitFailures = 0, input: unknown = {}) {
  let failures = commitFailures;
  const completed: JobOutcome[] = [];
  const lines: LoggedLine[] = [];
  const counted: CountedValue[] = [];
  const unit = {
    namespace: { id: 'ns' },
    rows: { findOne: () => Promise.resolve({ id: effectId, status: 'requested', input: {} }) },
    jobs: {
      complete: (_attempt: unknown, _worker: string, outcome: JobOutcome) => {
        completed.push(outcome);
        return Promise.resolve(true);
      },
      heartbeat: () => Promise.resolve([{}]),
    },
  };
  const context = {
    worker: 'w',
    clock: { now: () => Temporal.Instant.from('2026-01-01T00:00:00Z') },
    log: recordingLogger(lines),
    meter: recordingMeter(counted),
    writer: { build: { id: 'b', revision: 1 } },
    source: {
      namespace: { id: 'ns' },
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
  } as unknown as RunJobContext;
  const target = {
    stored: {
      id: 'job-1',
      queue: 'queues-mail',
      attempt: { jobId: '1', attempt: 1 },
      scope: { level: 'tenant', backendId: 'b', tenantId: 't' },
      causation: {},
    } as unknown as StoredJob,
    registry: {
      actions: new Map(),
      entities: new Map([['core.effect', { descriptor: { ref: 'core.effect' } }]]),
    },
    effectId,
    executor: {},
    entry: { module: 'queues', input },
    requestId: 'req-1',
  } as unknown as EffectAttemptJob;
  return { completed, lines, counted, context, target };
}

beforeEach(() => {
  settled.errors.length = 0;
  opening.answer = { input: {}, erased: [], mismatched: [] };
});

describe('an effect attempt whose input cannot be opened', () => {
  test('a destroyed key settles core.key_destroyed, with one info line and one count for the queue', async () => {
    opening.answer = { input: {}, erased: ['to'], mismatched: [] };
    const { completed, lines, counted, context, target } = setup();
    expect(await beginEffectAttempt(context, target, {})).toEqual({ kind: 'finished' });
    expect(settled.errors).toEqual([expect.objectContaining({ code: 'core.key_destroyed' })]);
    expect(completed.map((outcome) => outcome.kind)).toEqual(['failed']);
    expect(lines.filter((line) => line.level === 'info')).toHaveLength(1);
    expect(counted).toEqual([
      { name: 'keelwerk.jobs.key_destroyed', value: 1, attributes: { queue: 'queues-mail' } },
    ]);
  });

  test('a commit that fails once leaves one info line and one count in the end', async () => {
    opening.answer = { input: {}, erased: ['to'], mismatched: [] };
    const { lines, counted, context, target } = setup(1);
    await expect(beginEffectAttempt(context, target, {})).rejects.toThrow('the commit failed');
    expect(lines.filter((line) => line.level === 'info')).toEqual([]);
    expect(counted).toEqual([]);
    expect(await beginEffectAttempt(context, target, {})).toEqual({ kind: 'finished' });
    expect(lines.filter((line) => line.level === 'info')).toHaveLength(1);
    expect(counted).toEqual([
      { name: 'keelwerk.jobs.key_destroyed', value: 1, attributes: { queue: 'queues-mail' } },
    ]);
  });

  test('an envelope sealed for another effect fails core.forbidden and is no erasure: no line, no count', async () => {
    opening.answer = { input: {}, erased: [], mismatched: ['to'] };
    const { completed, lines, counted, context, target } = setup();
    expect(await beginEffectAttempt(context, target, {})).toEqual({ kind: 'finished' });
    expect(settled.errors).toEqual([expect.objectContaining({ code: 'core.forbidden' })]);
    expect(completed.map((outcome) => outcome.kind)).toEqual(['failed']);
    expect(lines).toEqual([]);
    expect(counted).toEqual([]);
  });
});

describe('an effect attempt whose stored input is opened', () => {
  const dated = shape({ at: field.instant() });

  test('an input that fits its fields runs the executor with the decoded members', async () => {
    opening.answer = { input: { at: '2026-01-01T00:00:00Z' }, erased: [], mismatched: [] };
    const { completed, lines, context, target } = setup(0, dated);
    const began = await beginEffectAttempt(context, target, {});
    expect(began).toEqual(
      expect.objectContaining({
        kind: 'run',
        input: { at: Temporal.Instant.from('2026-01-01T00:00:00Z') },
      }),
    );
    expect(completed).toEqual([]);
    expect(lines).toEqual([]);
  });

  test('an input that does not fit its fields ends failed with the internal error: no line, no count', async () => {
    opening.answer = { input: { at: 'not an instant' }, erased: [], mismatched: [] };
    const { completed, lines, counted, context, target } = setup(0, dated);
    expect(await beginEffectAttempt(context, target, {})).toEqual({ kind: 'finished' });
    expect(settled.errors).toEqual([expect.objectContaining({ code: 'core.internal' })]);
    expect(completed.map((outcome) => outcome.kind)).toEqual(['failed']);
    expect(lines).toEqual([]);
    expect(counted).toEqual([]);
  });

  test('a destroyed key ends the effect before its input is decoded: key_destroyed, not internal', async () => {
    opening.answer = { input: { at: 'not an instant' }, erased: ['at'], mismatched: [] };
    const { context, target } = setup(0, dated);
    expect(await beginEffectAttempt(context, target, {})).toEqual({ kind: 'finished' });
    expect(settled.errors).toEqual([expect.objectContaining({ code: 'core.key_destroyed' })]);
  });
});
