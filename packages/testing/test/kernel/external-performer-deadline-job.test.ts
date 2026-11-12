import type { StoredJobSpec } from '@keelwerk/core';
import { deriveEffectId } from '@keelwerk/core';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { startTestRuntime } from '../../src/harness/start-test-runtime.ts';
import { testCarrier } from '../../src/harness/test-carrier.ts';
import { testPrincipal } from '../../src/harness/test-principal.ts';
import { dispatchApp } from './support/dispatch-app.ts';
import { jobSpy } from './support/job-spy.ts';

vi.setConfig({ testTimeout: 90_000, hookTimeout: 120_000 });

const stops: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const stop of stops.splice(0)) await stop();
});

/** The dispatch app on the in-memory adapter whose job store a test watches, with workers. */
async function startWatchedDispatch() {
  const descriptors = new Map(
    [...dispatchApp.registry.entities].map(([ref, entry]) => [ref, entry.descriptor] as const),
  );
  const { spy, factory } = jobSpy((ref) => descriptors.get(ref));
  const runtime = await startTestRuntime(dispatchApp, {
    tenants: ['acme'],
    workers: true,
    external: { factory, url: 'memory://watched' },
  });
  stops.push(() => runtime.stop());
  const { acme } = runtime.tenants;
  const scope = { level: 'tenant', backendId: runtime.backendId, tenantId: acme.id } as const;
  const call = (action: string, input: unknown, commandId = crypto.randomUUID()) =>
    runtime.invoker.invoke<unknown, Record<string, unknown>>({
      action,
      input,
      carrier: testCarrier(acme, testPrincipal('ada')),
      requestId: crypto.randomUUID(),
      signal: new AbortController().signal,
      commandId,
    });
  const requested = async (deadline?: Temporal.Instant) => {
    const commandId = crypto.randomUUID();
    const outcome = await call(
      'dispatch.send',
      {
        owner: '0198a2c4-7e10-7a3b-8c5d-3f2a1b9d4e61',
        parcel: 'p-1',
        depot: 'north',
        recipient: 'ada@example.org',
        ...(deadline === undefined ? {} : { deadline }),
      },
      commandId,
    );
    expect(outcome).toMatchObject({ ok: true });
    return deriveEffectId(scope, commandId, 0);
  };
  const changes = async (id: string) =>
    (
      await runtime.adapter.unit(runtime.namespace, scope, (unit) =>
        unit.events.readStream({ type: 'core.effect', id }),
      )
    ).map((event) => event.type);
  const effectRow = async (id: string) => {
    const descriptor = runtime.app.registry.entities.get('core.effect')?.descriptor;
    if (descriptor === undefined) throw new Error('no core.effect');
    const found = await runtime.sealed.unit(
      runtime.namespace,
      scope,
      async (unit) => (await unit.rows.find(descriptor, {})).rows,
    );
    return found.find((row) => row.id === id);
  };
  /** Puts a deadline job of the kernel's own shape into `timers`, due now, for an effect id. */
  const enqueueDeadline = (effectDeadline: string) =>
    runtime.adapter.unit(runtime.namespace, scope, (unit) =>
      unit.jobs.enqueue({
        kind: 'effect',
        queue: 'timers',
        run: { effectDeadline },
        scope,
        principal: { resolver: 'core.module', principalId: 'dispatch.system' },
        causation: {},
        build: { id: 'test-build', revision: 1 },
        laneCap: 4,
        createdAt: runtime.clock.now(),
        runAt: runtime.clock.now(),
      } as StoredJobSpec),
    );
  return { runtime, spy, requested, changes, effectRow, enqueueDeadline, call };
}

describe('the deadline job of an external effect', () => {
  test('a deadline job for an effect that is already settled completes succeeded and writes nothing', async () => {
    const booted = await startWatchedDispatch();
    const { runtime, spy } = booted;
    const id = await booted.requested(runtime.clock.now().add({ hours: 1 }));
    expect(
      await booted.call('dispatch.report', { effectId: id, ok: true, tracking: 'T-1' }),
    ).toMatchObject({ ok: true });
    await runtime.drainJobs();
    spy.completions.length = 0;
    await booted.enqueueDeadline(id);
    await runtime.drainJobs();
    expect(spy.completions.map((completion) => completion.outcome.kind)).toEqual(['succeeded']);
    expect(await booted.changes(id)).toEqual(['core.effect.created', 'core.effect.changed']);
    expect(await booted.effectRow(id)).toMatchObject({ status: 'succeeded' });
  });

  test('a deadline job for an effect that has no row completes succeeded', async () => {
    const booted = await startWatchedDispatch();
    const { runtime, spy } = booted;
    await booted.enqueueDeadline('eff-missing');
    await runtime.drainJobs();
    expect(spy.completions.map((completion) => completion.outcome.kind)).toEqual(['succeeded']);
    expect(await booted.effectRow('eff-missing')).toBeUndefined();
  });

  test('a deadline job that has lost its lease rolls its settle back', async () => {
    const booted = await startWatchedDispatch();
    const { runtime, spy } = booted;
    const id = await booted.requested(runtime.clock.now().add({ hours: 1 }));
    await runtime.drainJobs();
    spy.completions.length = 0;
    let lost = 1;
    spy.complete = () => (lost-- > 0 ? false : undefined);
    await runtime.advanceTo(runtime.clock.now().add({ hours: 1, seconds: 1 }));
    await runtime.drainJobs();
    expect(spy.completions.map((completion) => completion.granted)).toContain(false);
    expect(await booted.effectRow(id)).toMatchObject({ status: 'requested' });
    expect(await booted.changes(id)).toEqual(['core.effect.created']);
  });
});
