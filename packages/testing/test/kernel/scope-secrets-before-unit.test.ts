import type { DataAdapter } from '@keelwerk/core';
import { entityBehavioursOf, field, KeelwerkError, normalizeRule, shape } from '@keelwerk/core';
import { redecide } from '@keelwerk/core/replay';
import { describe, expect, test } from 'vitest';
import { conformanceApp } from '../../src/fixtures/index.ts';
import { runDirect } from './support/command-kit.ts';
import { deriveOnlyKeys } from './support/derive-only-keys.ts';
import { command, effectsKit, registryWith } from './support/effects-kit.ts';
import { clock, namespace, open, silent, tenant } from './support/run-read-kit.ts';

/**
 * An adapter that tells when one of its units is open, and keys that tell it at every derivation.
 */
function watched(inner: DataAdapter) {
  const state = { open: 0, derivedInUnit: [] as string[], derived: 0 };
  const adapter: DataAdapter = {
    ...inner,
    unit: async (namespace, scope, work, options) => {
      state.open += 1;
      try {
        return await inner.unit(namespace, scope, work, options);
      } finally {
        state.open -= 1;
      }
    },
  };
  const keys = {
    derive: (scope: unknown, info: string, length: number) => {
      state.derived += 1;
      if (state.open > 0) state.derivedInUnit.push(info);
      return deriveOnlyKeys.derive(scope as never, info, length);
    },
  } as unknown as typeof deriveOnlyKeys;
  return { state, adapter, keys };
}

describe('the secrets taken from the scope key', () => {
  test('a timer, a keyed enqueue and a cancel take the job key secret derived before the unit opened', async () => {
    const registry = registryWith({
      actions: [
        command('launch', () => ({
          effects: [
            {
              kind: 'setTimer',
              type: 'setTimer',
              key: 'offline:1',
              action: 'library.later',
              input: { n: 1 },
              after: '1h',
            },
            { kind: 'cancelTimer', type: 'cancelTimer', key: 'offline:2' },
            {
              kind: 'enqueue',
              type: 'enqueue',
              action: 'library.later',
              input: { n: 2 },
              key: 'k-1',
            },
          ],
        })),
        command('later', () => []),
      ],
    });
    const { adapter: inner } = effectsKit(registry);
    const { state, adapter, keys } = watched(inner);
    await runDirect({
      registry,
      adapter,
      action: 'library.launch',
      input: {},
      commandId: '00000000-0000-7000-8000-000000000001',
      keys,
    });
    expect(state.derived).toBeGreaterThan(0);
    expect(state.derivedInUnit).toEqual([]);
  });

  test('a generated set takes the state token key derived before the unit opened', async () => {
    const { state, adapter, keys } = watched(open());
    const result = await runDirect({
      adapter,
      action: 'library.book.set',
      input: { create: [{ title: 'C', isbn: 'c', addedBy: 'ada' }] },
      commandId: '00000000-0000-7000-8000-000000000002',
      keys,
    });
    expect((result.output as { created: string[] }).created).toHaveLength(1);
    expect(state.derived).toBeGreaterThan(0);
    expect(state.derivedInUnit).toEqual([]);
  });

  test('a refused command with a personal member records its failed receipt without a derivation inside a unit', async () => {
    const registry = registryWith({
      actions: [
        command(
          'refuse',
          () => {
            throw new KeelwerkError({
              kind: 'validation',
              code: 'core.validation',
              message: 'It is refused.',
            });
          },
          { input: shape({ note: field.string().personal() }) },
        ),
      ],
    });
    const { adapter: inner } = effectsKit(registry);
    const { state, adapter, keys } = watched(inner);
    const { invoke } = effectsKit(registry, { adapter, keys });
    const commandId = '00000000-0000-7000-8000-000000000003';
    const outcome = await invoke('library.refuse', { note: 'ada@example.com' }, { commandId });
    expect(outcome).toMatchObject({ ok: false, error: { code: 'core.validation' } });
    const receipt = await adapter.unit(namespace, tenant, (unit) => unit.receipts.get(commandId));
    expect(receipt).toBeDefined();
    expect(state.derived).toBeGreaterThan(0);
    expect(state.derivedInUnit).toEqual([]);
  });

  test('a re-decide of a command that set a timer derives nothing inside its unit', async () => {
    const registry = registryWith({
      actions: [
        command(
          'launch',
          (_input, ctx) => ({
            events: [
              (
                ctx as { write: { library: { book: { create(v: object): unknown } } } }
              ).write.library.book.create({ title: 'T', isbn: 't-1', addedBy: 'ada' }),
            ],
            effects: [
              {
                kind: 'setTimer',
                type: 'setTimer',
                key: 'offline:1',
                action: 'library.later',
                input: { n: 1 },
                after: '1h',
              },
            ],
          }),
          { input: shape({ note: field.string().personal() }) },
        ),
        command('later', () => []),
      ],
    });
    const { adapter: inner } = effectsKit(registry);
    const { state, adapter, keys } = watched(inner);
    const commandId = '00000000-0000-7000-8000-000000000004';
    await runDirect({
      registry,
      adapter,
      action: 'library.launch',
      input: { note: 'x' },
      commandId,
      keys,
    });
    state.derivedInUnit.length = 0;
    const result = await redecide({
      registry,
      adapter,
      namespace,
      scope: tenant,
      commandId,
      input: { note: 'x' },
      apiVersion: '2026-11-04',
      behaviours: entityBehavioursOf(conformanceApp.modules),
      rules: [...registry.rules.values()]
        .filter((rule) => rule.disabled !== true)
        .map(normalizeRule),
      keys,
      compute: {} as never,
      clock,
      log: silent,
      trace: {} as never,
    });
    expect(result.redecided.effects).toEqual(['setTimer']);
    expect(state.derivedInUnit).toEqual([]);
  });
});
