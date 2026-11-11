import { describe, expect, test } from 'vitest';
import type { ControlStore } from '../control/control-store.ts';
import { field } from '../fields/field.ts';
import { shape } from '../fields/shape.ts';
import { deriveUuidV8 } from '../ids/derive-uuid-v8.ts';
import type { EffectEntry } from '../registry/effect-entry.ts';
import type { Registry } from '../registry/registry.ts';
import type { StoredJobSpec } from '../storage/stored-job-spec.ts';
import type { Unit } from '../storage/unit.ts';
import { enqueueContinuation } from './enqueue-continuation.ts';
import { settleEffect } from './settle-effect.ts';

/** A unit and a registry that fail the test when touched: nothing may be written. */
const untouched = new Proxy(
  {},
  {
    get: (_target, name) => {
      throw new Error(`the settle touched ${String(name)}`);
    },
  },
);

const entry = { ref: 'hooks.post', module: 'hooks' } as unknown as EffectEntry;
const cause = {
  scope: { level: 'deployment' },
  causation: {},
  build: { id: 'b', revision: 1 },
} as const;
const outcome = { ok: true, value: {} } as const;

describe('settleEffect', () => {
  test.each(['succeeded', 'failed', 'abandoned'])(
    'an effect that is %s is not settled again: nothing is written and nothing is enqueued',
    async (status) => {
      const settled = await settleEffect(
        untouched as Unit,
        {
          registry: untouched as Registry,
          entry,
          row: { id: 'e1', status },
          cause,
          writer: untouched as ControlStore['writer'],
          clock: { now: () => Temporal.Instant.from('2026-03-01T08:00:00Z') },
        },
        { status: 'succeeded', output: {} },
        1,
      );
      expect(settled).toBe(false);
    },
  );
});

describe('settleEffect, under the row lock', () => {
  const registry = {
    entities: new Map([['core.effect', { descriptor: { ref: 'core.effect' } }]]),
  } as unknown as Registry;

  test('a row that was settled while this settle waited is found settled under the lock: nothing is written', async () => {
    const locked: unknown[] = [];
    const unit = {
      rows: {
        // The caller read `requested` before the other unit committed; the locked read sees the settled row.
        findOne: (_entity: unknown, query: unknown) => {
          locked.push(query);
          return Promise.resolve({ id: 'e1', status: 'succeeded' });
        },
      },
    } as unknown as Unit;
    const settled = await settleEffect(
      unit,
      {
        registry,
        entry,
        row: { id: 'e1', status: 'requested' },
        cause,
        writer: untouched as ControlStore['writer'],
        clock: { now: () => Temporal.Instant.from('2026-03-01T08:00:00Z') },
      },
      { status: 'succeeded', output: {} },
      1,
    );
    expect(settled).toBe(false);
    expect(locked).toEqual([{ where: { op: 'eq', field: 'id', value: 'e1' }, forUpdate: true }]);
  });
});

describe('enqueueContinuation', () => {
  test('an effect without a continuation enqueues nothing', async () => {
    await expect(
      enqueueContinuation(untouched as Unit, {
        registry: untouched as Registry,
        row: { id: 'e1', status: 'requested' },
        settledEventId: 'v1',
        outcome,
        cause,
        now: Temporal.Instant.from('2026-03-01T08:00:00Z'),
      }),
    ).resolves.toBeUndefined();
  });

  test('a continuation that names no command is internal', async () => {
    await expect(
      enqueueContinuation({} as Unit, {
        registry: { actions: new Map() } as unknown as Registry,
        row: { id: 'e1', continuation: 'hooks.nope' },
        settledEventId: 'v1',
        outcome,
        cause,
        now: Temporal.Instant.from('2026-03-01T08:00:00Z'),
      }),
    ).rejects.toMatchObject({ kind: 'internal' });
  });
});

/** A unit whose job queue keeps the first job of a key, as every adapter does for `onConflict: 'keep'`. */
function queueingUnit(): { readonly unit: Unit; readonly jobs: Map<string, StoredJobSpec> } {
  const jobs = new Map<string, StoredJobSpec>();
  const unit = {
    jobs: {
      enqueue: (spec: StoredJobSpec) => {
        const key = spec.key?.value ?? '';
        if (!jobs.has(key) || spec.key?.onConflict !== 'keep') jobs.set(key, spec);
        return Promise.resolve();
      },
    },
  } as unknown as Unit;
  return { unit, jobs };
}

describe('enqueueContinuation, idempotence', () => {
  const continuation = {
    ref: 'hooks.recordOutcome',
    module: 'hooks',
    kind: 'command',
    input: shape({ id: field.string() }),
  };
  const registry = { actions: new Map([[continuation.ref, continuation]]) } as unknown as Registry;
  const row = {
    id: 'e1',
    commandId: 'c1',
    continuation: continuation.ref,
    continuationWith: { id: 'd1' },
  };
  const request = (unit: Unit) =>
    enqueueContinuation(unit, {
      registry,
      row,
      settledEventId: 'v1',
      outcome,
      cause,
      now: Temporal.Instant.from('2026-03-01T08:00:00Z'),
    });

  test('one effect enqueues one job, however often it is handed over, with the derived command id', async () => {
    const { unit, jobs } = queueingUnit();
    await request(unit);
    await request(unit);
    expect(jobs.size).toBe(1);
    const job = jobs.get('continuation:e1');
    expect(job?.key).toEqual({ value: 'continuation:e1', onConflict: 'keep' });
    expect(job?.run).toMatchObject({
      action: 'hooks.recordOutcome',
      commandId: deriveUuidV8('continuation', 'e1'),
    });
    expect(job?.causation).toMatchObject({ commandId: 'c1', eventId: 'v1' });
    expect(job?.principal).toMatchObject({ principalId: 'hooks.system' });
  });

  test("a continuation of module A after module B's effect runs as A.system, caused by the settled record", async () => {
    const { unit, jobs } = queueingUnit();
    const own = { ...continuation, ref: 'courier.after', module: 'courier' };
    await enqueueContinuation(unit, {
      registry: { actions: new Map([[own.ref, own]]) } as unknown as Registry,
      row: { ...row, continuation: own.ref },
      settledEventId: 'v9',
      outcome,
      cause,
      now: Temporal.Instant.from('2026-03-01T08:00:00Z'),
    });
    const job = jobs.get('continuation:e1');
    expect(job?.principal).toEqual({ resolver: 'core.module', principalId: 'courier.system' });
    expect(job?.causation).toMatchObject({ commandId: 'c1', eventId: 'v9' });
  });
});
