import { describe, expect, test, vi } from 'vitest';
import type { InvokeEffect } from '../protocol/invoke-effect.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
import type { Registry } from '../registry/registry.ts';
import type { Unit } from '../storage/unit.ts';
import type { RunCommandInput } from '../write-path/run-command-input.ts';
import type { EffectScene } from './effect-scene.ts';
import { runInvokeEffect } from './run-invoke-effect.ts';

vi.mock('./authorize-invoke.ts', () => ({ authorizeInvoke: vi.fn() }));
vi.mock('./check-effect-scope.ts', () => ({ checkEffectScope: vi.fn(() => 'same') }));
vi.mock('./check-invoke-errors.ts', () => ({ checkInvokeErrors: vi.fn() }));
vi.mock('./validate-effect-input.ts', () => ({
  validateEffectInput: vi.fn((_shape: unknown, input: unknown) => input),
}));

const quotaSet = {
  ref: 'core.quota.set',
  module: 'core',
  kind: 'command',
  execution: 'sync',
} as unknown as ActionEntry;

/** A scene of a command whose run carries the marks the runtime's routing sets on it. */
function sceneOf(runNested: EffectScene['runNested'], marks: object): EffectScene {
  return {
    unit: { nested: (body: (unit: Unit) => unknown) => body({} as Unit) } as unknown as Unit,
    run: {
      registry: { actions: new Map([[quotaSet.ref, quotaSet]]) } as unknown as Registry,
      scope: { level: 'deployment' },
      principal: { kind: 'user' },
      action: { ref: 'core.quota.set' },
      ...marks,
    } as unknown as RunCommandInput,
    module: 'core',
    commandId: 'c1',
    depth: 0,
    runNested,
  } as unknown as EffectScene;
}

describe('the marks of a command that a nested invoke does not inherit', () => {
  test('a parent run that was checked for quota hands no mark to the nested run', async () => {
    const runNested = vi.fn(() => Promise.resolve({ output: {} }));
    const effect = { kind: 'invoke', action: quotaSet.ref, input: {} } as unknown as InvokeEffect;
    await runInvokeEffect(
      sceneOf(runNested, { quotaChecked: true, controlPath: true }),
      effect,
      'e1',
    );
    const [, nestedRun] = runNested.mock.calls[0] as unknown as [Unit, RunCommandInput];
    expect(nestedRun.action).toBe(quotaSet);
    expect(nestedRun).not.toHaveProperty('quotaChecked');
    expect(nestedRun).not.toHaveProperty('controlPath');
  });
});
