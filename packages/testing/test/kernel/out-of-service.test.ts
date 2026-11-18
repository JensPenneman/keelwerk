import type { DataAdapter, DataAdapterFactory } from '@keelwerk/core';
import type { PgliteAdapter } from '@keelwerk/data/pglite';
import { describe, expect, test, vi } from 'vitest';
import { pgliteFactory } from '../../src/harness/pglite-factory.ts';
import { pinnedLiveTimers } from '../../src/harness/pinned-live-timers.ts';
import { testCarrier } from '../../src/harness/test-carrier.ts';
import { ada, boot, deploymentOf } from './support/runtime-kit.ts';

describe('a process that finds a restore under it takes itself out of service (14.7.6)', () => {
  test('a changed timeline closes the gate: outOfService settles, the process row reads draining and the invoker refuses', {
    timeout: 120_000,
  }, async () => {
    const adapters = new Map<string, DataAdapter>();
    const base = pgliteFactory({
      onCreate: (placementId, adapter) => adapters.set(placementId, adapter),
    });
    let timeline = '';
    const factory: DataAdapterFactory = {
      ...base,
      create: (placement, env) => {
        const adapter = base.create(placement, env);
        return {
          ...adapter,
          identity: async () => {
            const identity = await adapter.identity();
            return { ...identity, timeline: `${identity.timeline}${timeline}` };
          },
        };
      },
    };
    let now = Temporal.Instant.from('2026-11-18T10:00:00Z');
    const clock = { now: () => now };
    const timers = pinnedLiveTimers(clock);
    const runtime = await boot(deploymentOf('pglite', { factory }), { clock, timers });
    const control = adapters.get('control') as unknown as PgliteAdapter;
    const stateOfProcess = async (): Promise<string | undefined> =>
      (
        await control.asOwner(
          async (database) =>
            (
              await database.query<{ state: string }>(
                `select state from "kw__control".core__process`,
              )
            ).rows,
        )
      )[0]?.state;
    expect(await stateOfProcess()).toBe('ready');

    // A restore under the process: the cluster's timeline is no longer the one it started with.
    timeline = '-restored';
    now = now.add({ seconds: 61 });
    await timers.fire();
    const left = await Promise.race([
      runtime.outOfService,
      new Promise<string>((resolve) => setTimeout(() => resolve('still serving'), 5000)),
    ]);
    expect(left).toBe('identity');
    await vi.waitFor(async () => expect(await stateOfProcess()).toBe('draining'));
    const refused = await runtime.invoker.invoke({
      action: 'library.addBook',
      input: { title: 'Dune', isbn: '978-0441172719' },
      carrier: testCarrier({ name: 'acme', id: crypto.randomUUID() }, ada),
      requestId: crypto.randomUUID(),
      signal: new AbortController().signal,
      commandId: crypto.randomUUID(),
    });
    expect(refused).toMatchObject({ ok: false, error: { code: 'core.unavailable' } });
  });
});
