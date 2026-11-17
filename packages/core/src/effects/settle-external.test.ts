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

const ship = { ref: 'dispatch.ship', module: 'dispatch', performer: 'external' } as EffectEntry;
const stamp = { ref: 'dispatch.stamp', module: 'dispatch', performer: 'external' } as EffectEntry;
const foreign = { ref: 'other.thing', module: 'other', performer: 'external' } as EffectEntry;
const id = '0198a2c4-7e10-7a3b-8c5d-3f2a1b9d4e61';

/** A scene over a store that holds one effect row of `type`, and the queries it was asked. */
function sceneOf(type: string, module: string) {
  const queries: { readonly forUpdate?: boolean }[] = [];
  const scene = {
    module,
    run: {
      registry: {
        entities: new Map([['core.effect', { descriptor: { ref: 'core.effect' } }]]),
        effects: new Map([ship, stamp, foreign].map((entry) => [entry.ref, entry])),
      },
    },
    unit: {
      rows: {
        findOne: async (_descriptor: unknown, query: { readonly forUpdate?: boolean }) => {
          queries.push(query);
          return { id, type, status: 'requested', performer: 'external', input: {} };
        },
      },
    },
  } as unknown as EffectScene;
  return { scene, queries };
}

const draft = (over: Partial<SettleEffect> = {}): SettleEffect => ({
  kind: 'settle',
  type: 'settle',
  effect: id,
  outcome: { ok: true, value: {} },
  ...over,
});

describe('settleExternal reads the row of a call it may refuse without a lock', () => {
  test('a settle tied to another effect type is refused as an unknown id, and locks nothing', async () => {
    const { scene, queries } = sceneOf('dispatch.stamp', 'dispatch');
    await expect(
      settleExternal(scene, draft({ effectType: 'dispatch.ship' })),
    ).rejects.toMatchObject({ kind: 'not_found' });
    expect(queries).toHaveLength(1);
    expect(queries[0]?.forUpdate).not.toBe(true);
  });

  test("a settle of another module's effect is refused as an unknown id, and locks nothing", async () => {
    const { scene, queries } = sceneOf('other.thing', 'rogue');
    await expect(settleExternal(scene, draft())).rejects.toMatchObject({ kind: 'not_found' });
    expect(queries).toHaveLength(1);
    expect(queries[0]?.forUpdate).not.toBe(true);
  });
});
