import { beforeEach, describe, expect, test, vi } from 'vitest';
import { type LoggedLine, recordingLogger } from '../../test/executor-kit.ts';
import type { EffectAttemptRecord } from '../effects/effect-attempt-record.ts';
import { coreError } from '../http/core-error.ts';
import type { StoredJob } from '../storage/stored-job.ts';
import type { RunJobContext } from '../worker/run-job.ts';
import { abandonOnLostLease } from './abandon-on-lost-lease.ts';
import type { BeganAttempt } from './begin-effect-attempt.ts';
import { closeUnrunAttempt } from './close-unrun-attempt.ts';
import type { EffectAttemptJob } from './effect-attempt-job.ts';

const recorded = vi.hoisted(() => ({
  records: [] as { effectId: string; record: unknown }[],
  fail: undefined as Error | undefined,
}));
vi.mock('./record-attempt.ts', () => ({
  recordAttempt: (_unit: unknown, _registry: unknown, effectId: string, record: unknown) => {
    if (recorded.fail !== undefined) return Promise.reject(recorded.fail);
    recorded.records.push({ effectId, record });
    return Promise.resolve();
  },
}));

const began: Extract<BeganAttempt, { readonly kind: 'run' }> = {
  kind: 'run',
  input: {},
  startedAt: '2026-01-01T00:00:00Z',
  started: 1,
  earlier: false,
};

function setup() {
  const lines: LoggedLine[] = [];
  const context = {
    worker: 'w-1',
    clock: { now: () => Temporal.Instant.from('2026-01-01T00:00:05Z') },
    log: recordingLogger(lines),
    writer: { build: { id: 'b-1', revision: 1 } },
    source: {
      namespace: { id: 'ns' },
      handle: {
        adapter: {
          unit: async (_ns: unknown, _scope: unknown, fn: (u: unknown) => unknown) => fn({}),
        },
      },
    },
  } as unknown as RunJobContext;
  const target = {
    stored: {
      attempt: { jobId: '1', attempt: 2 },
      scope: { level: 'tenant', backendId: 'b', tenantId: 't' },
    } as unknown as StoredJob,
    registry: { actions: new Map() },
    effectId: 'eff-1',
    executor: {},
    entry: { module: 'queues' },
    requestId: 'req-1',
  } as unknown as EffectAttemptJob;
  return { lines, context, target };
}

beforeEach(() => {
  recorded.records.length = 0;
  recorded.fail = undefined;
});

describe('closeUnrunAttempt', () => {
  test('the end record carries the start, the end time and the closed projection of the reason', async () => {
    const { context, target } = setup();
    await closeUnrunAttempt(context, target, began, coreError('core.unavailable'));
    expect(recorded.records).toEqual([
      {
        effectId: 'eff-1',
        record: {
          process: 'w-1',
          build: 'b-1',
          attempt: 2,
          startedAt: '2026-01-01T00:00:00Z',
          endedAt: '2026-01-01T00:00:05Z',
          error: {
            kind: 'unavailable',
            code: 'core.unavailable',
            retryable: true,
            requestId: 'req-1',
          },
        },
      },
    ]);
  });

  test('a start record and the end record it wrote leave no open attempt', async () => {
    const { context, target } = setup();
    await closeUnrunAttempt(context, target, began, coreError('core.unavailable'));
    const [written] = recorded.records;
    const end = written?.record as EffectAttemptRecord;
    const start: EffectAttemptRecord = {
      process: 'w-1',
      build: 'b-1',
      attempt: 2,
      startedAt: began.startedAt,
    };
    expect(abandonOnLostLease([start], 2).open).toBe(2);
    expect(abandonOnLostLease([start, end], 2).open).toBeUndefined();
  });

  test('a failing unit is logged once with its code and swallowed', async () => {
    recorded.fail = new Error('the store is down');
    const { lines, context, target } = setup();
    await expect(
      closeUnrunAttempt(context, target, began, coreError('core.unavailable')),
    ).resolves.toBeUndefined();
    const warnings = lines.filter((line) => line.level === 'warn');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.fields).toEqual({ effect: 'eff-1', code: 'core.internal' });
  });
});
