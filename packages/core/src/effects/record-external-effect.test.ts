import { describe, expect, test } from 'vitest';
import { field } from '../fields/field.ts';
import { shape } from '../fields/shape.ts';
import type { ExternalEffect } from '../protocol/external-effect.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
import type { EffectEntry } from '../registry/effect-entry.ts';
import type { Registry } from '../registry/registry.ts';
import type { Unit } from '../storage/unit.ts';
import type { EffectScene } from './effect-scene.ts';
import { recordExternalEffect } from './record-external-effect.ts';

const effectId = '0198a1e0-0000-8000-8000-0000000000e1';

const notify = {
  ref: 'courier.notify',
  module: 'courier',
  name: 'notify',
  performer: 'external',
  executor: null,
  input: shape({ url: field.string() }),
  output: shape({}),
} as unknown as EffectEntry;

const record = {
  ref: 'courier.record',
  module: 'courier',
  kind: 'command',
  input: shape({}),
  outcomeWith: shape({ id: field.string() }),
} as unknown as ActionEntry;

/** A scene whose unit fails the test when touched: a refused request writes nothing. */
function untouchedScene(module = 'courier', extra: readonly ActionEntry[] = []): EffectScene {
  const touched = new Proxy(
    {},
    {
      get: (_target, name) => {
        throw new Error(`the effect touched unit.${String(name)}`);
      },
    },
  );
  return {
    unit: touched as Unit,
    run: {
      registry: {
        effects: new Map([[notify.ref, notify]]),
        actions: new Map([record, ...extra].map((action) => [action.ref, action])),
        executors: new Map(),
      } as unknown as Registry,
    },
    module,
  } as unknown as EffectScene;
}

function requested(withValue: Readonly<Record<string, unknown>>): ExternalEffect {
  return {
    type: notify.ref,
    input: { url: 'https://example.org' },
    continueWith: record.ref,
    with: withValue,
  } as unknown as ExternalEffect;
}

describe('recordExternalEffect, the with of a continuation', () => {
  test('a with that breaks the outcomeWith shape is refused as validation and writes nothing', async () => {
    await expect(
      recordExternalEffect(untouchedScene(), requested({ id: 7 }), effectId),
    ).rejects.toMatchObject({ kind: 'validation', issues: [{ path: ['id'] }] });
    await expect(
      recordExternalEffect(untouchedScene(), requested({}), effectId),
    ).rejects.toMatchObject({ kind: 'validation' });
  });

  test('a continuation that is a command of another module is refused and writes nothing', async () => {
    const foreign = { ...record, ref: 'ledger.record', module: 'ledger' } as ActionEntry;
    await expect(
      recordExternalEffect(
        untouchedScene('courier', [foreign]),
        { ...requested({ id: 'x' }), continueWith: foreign.ref } as ExternalEffect,
        effectId,
      ),
    ).rejects.toMatchObject({
      kind: 'internal',
      code: 'core.request_not_allowed',
      message: expect.stringContaining('no command of the module whose decision requests it'),
    });
  });
});
