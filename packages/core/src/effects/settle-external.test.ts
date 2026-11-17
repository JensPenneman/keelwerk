import { describe, expect, test, vi } from 'vitest';
import { settleKeepingContinuation } from '../executors/settle-keeping-continuation.ts';
import { field } from '../fields/field.ts';
import { shape } from '../fields/shape.ts';
import type { SettleEffect } from '../protocol/settle-effect.ts';
import type { EffectEntry } from '../registry/effect-entry.ts';
import type { Registry } from '../registry/registry.ts';
import type { Unit } from '../storage/unit.ts';
import type { EffectScene } from './effect-scene.ts';
import { settleExternal } from './settle-external.ts';

vi.mock('../executors/settle-keeping-continuation.ts', () => ({
  settleKeepingContinuation: vi.fn(() => Promise.resolve({ status: 'succeeded', output: {} })),
}));

const effectId = '0198a1e0-0000-8000-8000-0000000000e1';
const lineage = { depth: 3, origin: '0198a1e0-0000-8000-8000-0000000000aa' } as const;
const entry = {
  ref: 'courier.notify',
  module: 'courier',
  output: shape({ tracking: field.string() }),
} as unknown as EffectEntry;
const settle = {
  kind: 'settle',
  effect: effectId,
  outcome: { ok: true, value: { tracking: 'T-1' } },
} as unknown as SettleEffect;

/** A scene over a unit that holds one requested external effect; `meta` is what the decision's events join. */
function scene(meta: Readonly<Record<string, unknown>>): EffectScene {
  const unit = {
    rows: {
      findOne: () =>
        Promise.resolve({
          id: effectId,
          type: entry.ref,
          performer: 'external',
          status: 'requested',
        }),
    },
    jobs: { cancel: () => Promise.resolve(false) },
  } as unknown as Unit;
  return {
    unit,
    run: {
      scope: { level: 'deployment' },
      build: { id: 'b', revision: 1 },
      registry: {
        entities: new Map([['core.effect', { descriptor: { ref: 'core.effect' } }]]),
        effects: new Map([[entry.ref, entry]]),
      } as unknown as Registry,
    },
    module: 'courier',
    commandId: 'c1',
    causeActor: { kind: 'service', id: 's1' },
    causeEventId: 'e1',
    meta,
    clock: { now: () => Temporal.Instant.from('2026-03-01T08:00:00Z') },
    hybridClock: {},
  } as unknown as EffectScene;
}

/** The causation the settle hands to the settled record and its continuation. */
async function causationOf(meta: Readonly<Record<string, unknown>>): Promise<unknown> {
  vi.mocked(settleKeepingContinuation).mockClear();
  await settleExternal(scene(meta), settle);
  const target = vi.mocked(settleKeepingContinuation).mock.calls[0]?.[1];
  return target?.cause.causation;
}

describe('settleExternal, the lineage of the settled record and its continuation', () => {
  test('the causation carries the lineage of the decision that settles', async () => {
    expect(await causationOf({ lineage })).toMatchObject({ commandId: 'c1', lineage });
  });

  test('a decision at depth 0 hands over no lineage', async () => {
    expect(await causationOf({})).not.toHaveProperty('lineage');
  });
});
