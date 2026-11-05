import type { InvocationSession } from '@keelwerk/core';
import { answerExplain, field, shape } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { bootKeys, storedName, withRules } from './support/admission-kit.ts';
import { bookEntity, loanEntity, withCommand } from './support/command-kit.ts';
import { ada, backendId, call, failure, kit, tenantId } from './support/invoker-kit.ts';
import { namespace, open, tenant } from './support/run-read-kit.ts';

describe('dry run', () => {
  const operator = {
    scope: { level: 'deployment' },
    app: 'core',
    principal: { kind: 'operator', subject: 'op', roles: [], scopes: [] },
    apiVersion: '2026-11-04',
    deprecation: null,
    resolvedBy: 'local',
    revalidate: () => Promise.reject(new Error('unused')),
  } as unknown as InvocationSession;
  const everyone = () => ({
    kind: 'charge' as const,
    demand: {
      admit: [{ bucket: 'everyone', capacity: 2, refillPerSecond: 0.001 }],
      onDeclaredError: [],
    },
  });
  const prepare = async () => {
    const keys = await bootKeys();
    const probe = withCommand('dryProbe', () => ({}), 'library.addBook', {
      input: shape({ who: field.string() }),
    });
    const adapter = open([bookEntity, loanEntity]);
    const made = kit({ registry: withRules(probe.registry, [everyone]), adapter, keys });
    const explaining = answerExplain(made.invoker, {
      options: made.options,
      hybridClock: {} as never,
    });
    const dry = () =>
      explaining.invoke({
        action: 'core.explain',
        input: {
          mode: 'dry-run',
          ref: probe.ref,
          backend: backendId,
          tenant: tenantId,
          input: { who: 'x' },
        },
        carrier: { transport: 'cli', local: { inProcess: true } },
        session: operator,
        requestId: 'dry-1',
        signal: new AbortController().signal,
      });
    return { keys, adapter, made, probe, dry };
  };

  test('reports rate_limited from an exhausted bucket and leaves the bucket as it was', async () => {
    const { keys, adapter, made, probe, dry } = await prepare();
    for (let n = 0; n < 2; n++) {
      await made.invoker.invoke(call(probe.ref, { who: 'x' }, { carrier: ada }));
    }
    const stored = await storedName(keys, tenant, 'everyone');
    const level = () =>
      adapter.unit(namespace, tenant, (unit) =>
        unit.buckets.check(stored, 1, { capacity: 2, refillPerSecond: 0.001 }),
      );
    const before = await level();
    expect(before.ok).toBe(false);
    const refused = failure(await dry());
    expect(refused.kind).toBe('rate_limited');
    expect(refused.retryAfter).toBeGreaterThan(0);
    expect(await level()).toEqual(before);
  });

  test('does not use up tokens', async () => {
    const { keys, adapter, dry } = await prepare();
    for (let n = 0; n < 4; n++) {
      const outcome = await dry();
      expect(outcome.ok === false && outcome.error.kind).not.toBe('rate_limited');
    }
    const stored = await storedName(keys, tenant, 'everyone');
    const full = await adapter.unit(namespace, tenant, (unit) =>
      unit.buckets.check(stored, 2, { capacity: 2, refillPerSecond: 0.001 }),
    );
    expect(full.ok).toBe(true);
  });
});
