import { postgresAdapter } from '@keelwerk/adapter-postgres';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { startTestRuntime } from '../../src/harness/start-test-runtime.ts';
import { testCarrier } from '../../src/harness/test-carrier.ts';
import { testOperator } from '../../src/harness/test-operator.ts';
import type { RestartablePostgres } from '../../src/postgres/index.ts';
import { startPostgres } from '../../src/postgres/index.ts';
import type { HookEndpoint } from './support/hook-endpoint.ts';
import { startHookEndpoint } from './support/hook-endpoint.ts';
import { hooksApp } from './support/hooks-kit.ts';

let postgres: RestartablePostgres | undefined;
let serverDown = false;

beforeAll(async () => {
  postgres = await startPostgres({ restartable: true });
}, 180_000);

afterAll(async () => {
  if (serverDown) await postgres?.startServer();
  await postgres?.stop();
});

test('an inline effect in flight when the connection is lost: the command answers core.unavailable, the effect stays requested, and its guard job settles it abandoned with core.effect_outcome_unknown', {
  timeout: 240_000,
}, async () => {
  if (postgres === undefined) throw new Error('the container did not start');
  const reached = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const endpoint: HookEndpoint = await startHookEndpoint(
    () => {
      reached.resolve();
      return 200;
    },
    0,
    release.promise,
  );
  const runtime = await startTestRuntime(hooksApp, {
    tenants: ['acme'],
    external: {
      factory: postgresAdapter({ ownerUrl: postgres.adminUrl, applicationName: 'inline-loss' }),
      url: postgres.appUrl,
    },
    operators: true,
    config: { hooks: { endpoint: endpoint.url, signingKey: 'hook-signing-key' } },
    workers: { queues: ['posts', 'probes', 'commands'], egress: { allow: ['127.0.0.0/8'] } },
  });
  try {
    const scope = {
      level: 'tenant',
      backendId: runtime.backendId,
      tenantId: runtime.tenants.acme.id,
    } as const;
    const effectRows = async () => {
      const descriptor = runtime.app.registry.entities.get('core.effect')?.descriptor;
      if (descriptor === undefined) throw new Error('no core.effect');
      return runtime.adapter.unit(
        runtime.namespace,
        scope,
        async (unit) => (await unit.rows.find(descriptor, {})).rows,
      );
    };
    const running = runtime.invoker.invoke<unknown, Record<string, unknown>>({
      action: 'hooks.testEndpoint',
      input: {},
      carrier: testCarrier(runtime.tenants.acme, testOperator()),
      requestId: crypto.randomUUID(),
      signal: new AbortController().signal,
      commandId: crypto.randomUUID(),
    });
    // The executor's request reached the endpoint: the effect is recorded `requested` and no
    // connection is held while it runs. The server goes away before the endpoint answers.
    await reached.promise;
    await postgres.stopServer();
    serverDown = true;
    release.resolve();
    const outcome = await running;
    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.error.code).toBe('core.unavailable');
    await postgres.startServer();
    serverDown = false;
    // The settle unit never committed: the effect stays requested, and the request was made once.
    expect((await effectRows())[0]).toMatchObject({ status: 'requested' });
    expect(endpoint.requests).toHaveLength(1);
    // Its guard job settles it, as after a crash: the outcome of the request is unknown.
    await runtime.advanceTo(runtime.clock.now().add({ seconds: 71 }));
    expect((await effectRows())[0]).toMatchObject({
      status: 'abandoned',
      error: { code: 'core.effect_outcome_unknown' },
    });
    expect(endpoint.requests).toHaveLength(1);
  } finally {
    await runtime.stop();
    await endpoint.close();
  }
});
