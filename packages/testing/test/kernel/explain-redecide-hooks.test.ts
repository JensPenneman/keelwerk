import { describe, expect, test } from 'vitest';
import { startTestRuntime } from '../../src/harness/start-test-runtime.ts';
import { testCarrier } from '../../src/harness/test-carrier.ts';
import { testOperator } from '../../src/harness/test-operator.ts';
import { startHookEndpoint } from './support/hook-endpoint.ts';
import { hooksApp } from './support/hooks-kit.ts';

describe('core.explain mode redecide of a command that wrote no decision record', () => {
  test('hooks.testEndpoint writes only inline effect records: explain answers validation, not a difference', {
    timeout: 90_000,
  }, async () => {
    const endpoint = await startHookEndpoint();
    const runtime = await startTestRuntime(hooksApp, {
      tenants: ['acme'],
      operators: true,
      config: { hooks: { endpoint: endpoint.url, signingKey: 'hook-signing-key' } },
      workers: { queues: ['posts', 'probes', 'commands'], egress: { allow: ['127.0.0.0/8'] } },
    });
    try {
      const commandId = crypto.randomUUID();
      const ran = await runtime.invoker.invoke({
        action: 'hooks.testEndpoint',
        input: {},
        carrier: testCarrier(runtime.tenants.acme, testOperator()),
        requestId: crypto.randomUUID(),
        signal: new AbortController().signal,
        commandId,
      });
      expect(ran.ok).toBe(true);
      const answer = await runtime.invoker.invoke({
        action: 'core.explain',
        input: {
          backend: runtime.backendId,
          tenant: runtime.tenants.acme.id,
          mode: 'redecide',
          commandId,
          input: {},
        },
        carrier: {
          transport: 'cli',
          headers: { 'x-tenant': runtime.tenants.acme.id },
          local: { inProcess: true },
        },
        requestId: crypto.randomUUID(),
        signal: new AbortController().signal,
      });
      expect(answer).toMatchObject({
        ok: false,
        error: {
          kind: 'validation',
          message: expect.stringContaining('wrote no events with a decision record'),
        },
      });
    } finally {
      await runtime.stop();
      await endpoint.close();
    }
  });
});
