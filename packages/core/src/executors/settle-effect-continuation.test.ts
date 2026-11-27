import { describe, expect, test, vi } from 'vitest';
import type { ControlStore } from '../control/control-store.ts';
import { errors } from '../errors/errors.ts';
import type { EffectEntry } from '../registry/effect-entry.ts';
import type { Registry } from '../registry/registry.ts';
import type { Unit } from '../storage/unit.ts';
import { enqueueContinuation } from './enqueue-continuation.ts';
import { settleEffect } from './settle-effect.ts';

vi.mock('../effects/write-effect-record.ts', () => ({
  writeEffectRecord: () => Promise.resolve('settled-event'),
}));
vi.mock('../write-path/registry-behaviours.ts', () => ({ registryBehaviours: () => ({}) }));
vi.mock('./enqueue-continuation.ts', () => ({ enqueueContinuation: vi.fn() }));

const row = {
  id: 'e1',
  type: 'hooks.post',
  status: 'requested',
  commandId: 'c1',
  continuation: 'hooks.after',
};
const unit = { rows: { findOne: () => Promise.resolve(row) } } as unknown as Unit;
const entry = {
  ref: 'hooks.post',
  module: 'hooks',
  executor: null,
  input: {},
  output: {},
} as unknown as EffectEntry;

/** A registry that holds the type of the effect (and, for `executor`, an executor that is not inline) or not. */
function registryOf(held: boolean, executor = false): Registry {
  return {
    entities: new Map([['core.effect', { descriptor: { ref: 'core.effect' } }]]),
    effects: new Map(
      held ? [['hooks.post', { ...entry, executor: executor ? 'hooks.send' : null }]] : [],
    ),
    executors: new Map(),
  } as unknown as Registry;
}

function settle(held = true, executor = false) {
  return settleEffect(
    unit,
    {
      registry: registryOf(held, executor),
      row,
      cause: { scope: { level: 'deployment' }, causation: {}, build: { id: 'b', revision: 1 } },
      writer: {
        build: { id: 'b', revision: 1 },
        hybridClock: {},
      } as unknown as ControlStore['writer'],
      clock: { now: () => Temporal.Instant.from('2026-03-01T08:00:00Z') },
      limits: undefined,
    },
    { status: 'succeeded', output: {} },
    1,
  );
}

describe('settleEffect hands over the continuation of an effect the build holds', () => {
  test('a known effect hands its row to the continuation, and an effect the build no longer holds hands nothing', async () => {
    vi.mocked(enqueueContinuation).mockClear();
    expect(await settle()).toBe(true);
    expect(enqueueContinuation).toHaveBeenCalledTimes(1);
    vi.mocked(enqueueContinuation).mockClear();
    expect(await settle(false)).toBe(true);
    expect(enqueueContinuation).not.toHaveBeenCalled();
  });

  test('a build that kept the type but lost the executor of the effect still hands the continuation over', async () => {
    vi.mocked(enqueueContinuation).mockClear();
    expect(await settle(true, true)).toBe(true);
    expect(enqueueContinuation).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['internal', errors.internal('the enqueue failed')],
    ['validation', errors.validation('the input no longer fits', { issues: [] })],
  ])(
    'a %s error while a known continuation is enqueued is rethrown: the effect is not settled without it',
    async (_kind, error) => {
      vi.mocked(enqueueContinuation).mockRejectedValueOnce(error);
      await expect(settle()).rejects.toBe(error);
    },
  );
});
