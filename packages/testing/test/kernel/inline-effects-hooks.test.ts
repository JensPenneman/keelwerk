import type { DataAdapterFactory, EntityDescriptor, Unit } from '@keelwerk/core';
import { memoryAdapter } from '@keelwerk/data';
import { afterEach, describe, expect, test } from 'vitest';
import { startTestRuntime } from '../../src/harness/start-test-runtime.ts';
import { testCarrier } from '../../src/harness/test-carrier.ts';
import { testOperator } from '../../src/harness/test-operator.ts';
import { type HookEndpoint, startHookEndpoint } from './support/hook-endpoint.ts';
import { hooksApp } from './support/hooks-kit.ts';

const cleanup: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.allSettled(cleanup.splice(0).map((close) => close()));
});

/** The hooks app with workers and one tenant, run by an operator of the test. */
async function startHooks(
  endpoint: HookEndpoint,
  adapter: 'memory' | 'pglite' | 'external',
  factory?: DataAdapterFactory,
) {
  const runtime = await startTestRuntime(hooksApp, {
    tenants: ['acme'],
    ...(factory === undefined
      ? { adapter: adapter === 'pglite' ? 'pglite' : 'memory' }
      : { external: { factory, url: 'memory://cut' } }),
    operators: true,
    config: { hooks: { endpoint: endpoint.url, signingKey: 'hook-signing-key' } },
    workers: { queues: ['posts', 'probes', 'commands'], egress: { allow: ['127.0.0.0/8'] } },
  });
  cleanup.push(
    () => runtime.stop(),
    () => endpoint.close(),
  );
  const scope = {
    level: 'tenant',
    backendId: runtime.backendId,
    tenantId: runtime.tenants.acme.id,
  } as const;
  const operator = (action: string, input: unknown) =>
    runtime.invoker.invoke<unknown, Record<string, unknown>>({
      action,
      input,
      carrier: testCarrier(runtime.tenants.acme, testOperator()),
      requestId: crypto.randomUUID(),
      signal: new AbortController().signal,
      commandId: crypto.randomUUID(),
    });
  /** `core.explain` is answered on the operator socket: the local carrier of the command line. */
  const explain = (input: Readonly<Record<string, unknown>>) =>
    runtime.invoker.invoke<unknown, Record<string, unknown>>({
      action: 'core.explain',
      input: { backend: runtime.backendId, tenant: runtime.tenants.acme.id, ...input },
      carrier: {
        transport: 'cli',
        headers: { 'x-tenant': runtime.tenants.acme.id },
        local: { inProcess: true },
      },
      requestId: crypto.randomUUID(),
      signal: new AbortController().signal,
    });
  const effectRows = async () => {
    const descriptor = runtime.app.registry.entities.get('core.effect')?.descriptor;
    if (descriptor === undefined) throw new Error('no core.effect');
    return runtime.adapter.unit(
      runtime.namespace,
      scope,
      async (unit) => (await unit.rows.find(descriptor, {})).rows,
    );
  };
  return { runtime, scope, operator, explain, effectRows };
}

/** The attempt records of an effect, in order, as stored. */
async function attemptsOf(started: Awaited<ReturnType<typeof startHooks>>, effectId: string) {
  const { runtime, scope } = started;
  return runtime.adapter.unit(runtime.namespace, scope, (unit) =>
    unit.streams.read('core.effectAttempt', effectId, null, 100),
  );
}

describe.each(['memory', 'pglite'] as const)('hooks.testEndpoint on %s (7.9.4, 7.9.5)', (kind) => {
  test('the operator gets the status of the endpoint, the effect is recorded succeeded with one request keyed by its id, and the dry run stops as would-perform', {
    timeout: 90_000,
  }, async () => {
    const endpoint = await startHookEndpoint();
    const started = await startHooks(endpoint, kind);
    const outcome = await started.operator('hooks.testEndpoint', {});
    if (!outcome.ok) throw outcome.error;
    expect(outcome.value).toMatchObject({ status: 200 });
    const [effect, ...others] = await started.effectRows();
    expect(others).toEqual([]);
    expect(effect).toMatchObject({
      type: 'hooks.post',
      status: 'succeeded',
      attempts: 1,
      output: { status: 200 },
    });
    expect(endpoint.requests).toHaveLength(1);
    expect(endpoint.requests[0]?.headers['idempotency-key']).toBe(String(effect?.id));
    expect(await attemptsOf(started, String(effect?.id))).toHaveLength(2);

    const explained = await started.explain({
      mode: 'dry-run',
      ref: 'hooks.testEndpoint',
      input: {},
    });
    if (!explained.ok) throw explained.error;
    expect(explained.value).toMatchObject({
      report: { status: 'would-perform', effect: 'hooks.post' },
    });
    expect(endpoint.requests).toHaveLength(1);
    expect(await started.effectRows()).toHaveLength(1);
  });
});

describe('an inline run that was cut (D4)', () => {
  test('an inline run whose settle unit fails stays requested and settles abandoned with core.effect_outcome_unknown when its guard job runs', {
    timeout: 90_000,
  }, async () => {
    const endpoint = await startHookEndpoint();
    const descriptors = new Map<string, EntityDescriptor>(
      [...hooksApp.registry.entities].map(([ref, entry]) => [ref, entry.descriptor] as const),
    );
    const base = memoryAdapter({ entities: (ref) => descriptors.get(ref) });
    let failures = 1;
    const factory: DataAdapterFactory = {
      ...base,
      create: (placement, env) => {
        const adapter = base.create(placement, env);
        return {
          ...adapter,
          unit: (namespace, scope, fn, options) =>
            adapter.unit(
              namespace,
              scope,
              (unit: Unit) =>
                fn({
                  ...unit,
                  jobs: {
                    ...unit.jobs,
                    cancel: (queue, key) => {
                      if (failures > 0) {
                        failures -= 1;
                        return Promise.reject(new Error('the store failed'));
                      }
                      return unit.jobs.cancel(queue, key);
                    },
                  },
                }),
              options,
            ),
        };
      },
    };
    const started = await startHooks(endpoint, 'external', factory);
    const outcome = await started.operator('hooks.testEndpoint', {});
    expect(outcome.ok).toBe(false);
    expect(endpoint.requests).toHaveLength(1);
    expect((await started.effectRows())[0]).toMatchObject({ status: 'requested' });
    await started.runtime.advanceTo(started.runtime.clock.now().add({ seconds: 71 }));
    expect((await started.effectRows())[0]).toMatchObject({
      status: 'abandoned',
      error: { code: 'core.effect_outcome_unknown' },
    });
    expect(endpoint.requests).toHaveLength(1);
  });
});
