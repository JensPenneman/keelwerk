import type { Registry } from '@keelwerk/core';
import { field, shape } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { bootKeys, fill, storedName } from './support/admission-kit.ts';
import { ada, call, kit, publicQuery } from './support/invoker-kit.ts';
import { namespace, tenant } from './support/run-read-kit.ts';

describe('admission buckets by module', () => {
  test('two modules naming the same bucket get separate rows', async () => {
    const keys = await bootKeys();
    const named = () => ({
      kind: 'charge' as const,
      demand: {
        admit: [{ bucket: 'shared', capacity: 1, refillPerSecond: 0.001 }],
        onDeclaredError: [],
      },
    });
    const probe = publicQuery(
      'twoModules',
      // biome-ignore lint/correctness/useYield: a handler that loads nothing
      function* () {
        return {};
      },
      { input: shape({ who: field.string() }) },
    );
    const registry: Registry = {
      ...probe.registry,
      fills: new Map([
        ...probe.registry.fills,
        ['core.invocationMiddleware', [fill(named, 'alpha'), fill(named, 'beta')]],
      ]),
    };
    const { invoker, adapter } = kit({ registry, keys });
    // one row would hold one token for two takes of one: the second would be refused
    expect((await invoker.invoke(call(probe.ref, { who: 'x' }, { carrier: ada }))).ok).toBe(true);
    for (const module of ['alpha', 'beta']) {
      const stored = await storedName(keys, tenant, 'shared', module);
      const read = await adapter.unit(namespace, tenant, (unit) =>
        unit.buckets.check(stored, 1, { capacity: 1, refillPerSecond: 0.001 }),
      );
      expect(read.ok).toBe(false);
    }
    expect((await invoker.invoke(call(probe.ref, { who: 'x' }, { carrier: ada }))).ok).toBe(false);
  });
});
