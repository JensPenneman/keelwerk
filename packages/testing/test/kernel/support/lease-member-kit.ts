import { postgresAdapter } from '@keelwerk/adapter-postgres';
import type { DataAdapterFactory } from '@keelwerk/core';
import {
  type PinnedLiveTimers,
  pinnedLiveTimers,
} from '../../../src/harness/pinned-live-timers.ts';
import { startTestRuntime } from '../../../src/harness/start-test-runtime.ts';
import type { TestDatabase } from '../../support/test-database.ts';
import { concurrencyApp } from './concurrency-app.ts';
import { barrier } from './concurrency-kit.ts';
import type { MovableClock } from './movable-clock.ts';
import { sweptStore } from './swept-store.ts';

/**
 * The adapter factory of one member: the PostgreSQL adapter over the case's database, with the
 * units that sweep (a unit that called `expire`) reported when they have committed (`sweptStore`),
 * and the enqueue of the job store held at the member's barrier for the tenant it is armed for.
 */
function watchedFactory(
  database: TestDatabase,
  hooks: { readonly swept: () => void; readonly hold: (tenant: string) => Promise<void> },
): DataAdapterFactory {
  return sweptStore(postgresAdapter({ ownerUrl: database.adminUrl }), {
    swept: hooks.swept,
    unit: (unit) => ({
      ...unit,
      jobs: {
        ...unit.jobs,
        enqueue: async (job) => {
          await hooks.hold(job.scope.level === 'tenant' ? job.scope.tenantId : '');
          return unit.jobs.enqueue(job);
        },
      },
    }),
  });
}

/**
 * One process of the case: a runtime of the flow app on the case's database, with pinned timers on
 * the shared clock. `join` attaches it to the deployment another member created.
 */
export async function bootMember(input: {
  readonly database: TestDatabase;
  readonly clock: MovableClock;
  readonly join?: {
    readonly backendId: string;
    readonly tenants: Readonly<Record<string, string>>;
  };
}) {
  const timers: PinnedLiveTimers = pinnedLiveTimers(input.clock.clock);
  const gate = barrier();
  let armed: string | undefined;
  let swept = Promise.withResolvers<void>();
  const factory = watchedFactory(input.database, {
    swept: () => {
      swept.resolve();
      swept = Promise.withResolvers<void>();
    },
    hold: (tenant) => (tenant === armed ? gate.pass() : Promise.resolve()),
  });
  const runtime = await startTestRuntime(concurrencyApp, {
    operators: true,
    tenants: ['acme', 'globex'],
    clock: input.clock.clock,
    timers,
    external: { factory, url: input.database.appUrl },
    ...(input.join === undefined ? {} : { join: input.join }),
  });
  return {
    runtime,
    gate,
    /** From now on a command of the tenant waits at the member's barrier when it enqueues. */
    arm: (tenantId: string) => {
      armed = tenantId;
    },
    /**
     * Moves the shared clock by `ms`, fires what is due on this member and answers once its pass has
     * swept and committed, the last unit of a pass, and its keeper waits again for the next one.
     */
    pass: async (ms: number) => {
      const done = swept.promise;
      input.clock.step(ms);
      await timers.fire();
      await done;
      // What follows the commit of the sweep is microtasks only: the keeper sets its next wait
      // before this turn of the event loop ends.
      await new Promise<void>((resolve) => setImmediate(resolve));
    },
    /** The ids of the deployment, for a member that joins it. */
    ids: () => ({
      backendId: runtime.backendId,
      tenants: { acme: runtime.tenants.acme.id, globex: runtime.tenants.globex.id },
    }),
  };
}

export type Member = Awaited<ReturnType<typeof bootMember>>;
