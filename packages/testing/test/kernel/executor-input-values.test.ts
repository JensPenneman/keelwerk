import {
  defineApp,
  defineCommand,
  defineEffect,
  defineEffectExecutor,
  defineModule,
  defineModuleBase,
  defineRule,
  field,
  shape,
} from '@keelwerk/core';
import { describe, expect, test, vi } from 'vitest';
import { startTestRuntime } from '../../src/harness/start-test-runtime.ts';
import { testCarrier } from '../../src/harness/test-carrier.ts';
import { testPrincipal } from '../../src/harness/test-principal.ts';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const fields = {
  at: field.instant(),
  n: field.integer({ wide: true }),
  raw: field.binary(),
  tags: field.set(field.string()),
};
const base = defineModuleBase({ id: 'stamper', version: '0.1.0' });
const stamp = defineEffect(base, { input: shape(fields), output: shape({}) });
const received: unknown[] = [];
const executor = defineEffectExecutor(base, stamp, {
  run: (input) => {
    received.push(input);
    return Promise.resolve({});
  },
});
const request = defineCommand(base, {
  input: shape(fields),
  principal: 'user',
  decide: (input) => ({ effects: [stamp(input)] }),
});
const stamper = defineModule(base, {
  actions: { request },
  effects: { stamp },
  executors: { stamp: executor },
  policies: {
    request: { signedIn: defineRule(base, request, { effect: 'allow', principal: 'user' }) },
  },
});
const app = defineApp({ id: 'stampers', modules: [stamper] });

describe.each(['memory', 'pglite'] as const)('an executor input on %s', (adapter) => {
  test('reaches run as domain values: an instant, a wide integer, bytes and a set', async () => {
    received.length = 0;
    const runtime = await startTestRuntime(app, { adapter, workers: true, tenants: ['acme'] });
    try {
      const at = Temporal.Instant.from('2026-11-12T10:00:00Z');
      const outcome = await runtime.invoker.invoke({
        action: 'stamper.request',
        input: { at, n: 5n, raw: new Uint8Array([1, 2]), tags: new Set(['a', 'b']) },
        carrier: testCarrier(runtime.tenants.acme, testPrincipal('ada')),
        requestId: crypto.randomUUID(),
        signal: new AbortController().signal,
        commandId: crypto.randomUUID(),
      });
      expect(outcome).toMatchObject({ ok: true });
      await runtime.drainJobs();
      expect(received).toHaveLength(1);
      const [input] = received as [Record<string, unknown>];
      expect(input.at).toBeInstanceOf(Temporal.Instant);
      expect((input.at as Temporal.Instant).equals(at)).toBe(true);
      expect(input.n).toBe(5n);
      expect(input.raw).toBeInstanceOf(Uint8Array);
      expect([...(input.raw as Uint8Array)]).toEqual([1, 2]);
      expect(input.tags).toEqual(new Set(['a', 'b']));
    } finally {
      await runtime.stop();
    }
  });
});
