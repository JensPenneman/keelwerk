import { describe, expect, test } from 'vitest';
import { field } from '../fields/field.ts';
import { shape } from '../fields/shape.ts';
import type { SetTimerEffect } from '../protocol/set-timer-effect.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
import type { Registry } from '../registry/registry.ts';
import type { Unit } from '../storage/unit.ts';
import type { EffectScene } from './effect-scene.ts';
import { runTimerEffects } from './run-timer-effects.ts';

const remind = {
  ref: 'billing.remind',
  module: 'billing',
  kind: 'command',
  scope: 'tenant',
  input: shape({ note: field.string() }),
} as unknown as ActionEntry;

const key = 'remind:ada@example.com';

/** A scene whose unit fails the test when touched: a refused request writes nothing. */
function untouchedScene(): EffectScene {
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
      registry: { actions: new Map([[remind.ref, remind]]) } as unknown as Registry,
      scope: { level: 'tenant', backendId: 'backend-1', tenantId: 'tenant-1' },
      principal: { kind: 'user' },
    },
    clock: { now: () => Temporal.Instant.from('2026-03-01T08:00:00Z') },
    module: 'billing',
  } as unknown as EffectScene;
}

const timer = (extra: object): SetTimerEffect =>
  ({ kind: 'setTimer', key, invoke: remind.ref, action: remind.ref, ...extra }) as never;

const id = '0198a1e0-0000-8000-8000-0000000000e1';

describe('a refused setTimer', () => {
  test('a refused setTimer names its module and never its key', async () => {
    const error = await runTimerEffects(
      untouchedScene(),
      timer({ input: { note: 'x' } }),
      id,
    ).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ kind: 'internal', code: 'core.request_not_allowed' });
    expect((error as Error).message).toContain('billing');
    expect((error as Error).message).not.toContain(key);
    expect(JSON.stringify(error)).not.toContain('ada@example.com');
  });

  test('a setTimer whose input is not valid names its module and never its key', async () => {
    const error = await runTimerEffects(
      untouchedScene(),
      timer({ after: '5s', input: { note: 7 } }),
      id,
    ).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ kind: 'validation' });
    expect((error as Error).message).toContain('billing');
    expect(JSON.stringify(error)).not.toContain('ada@example.com');
  });
});
