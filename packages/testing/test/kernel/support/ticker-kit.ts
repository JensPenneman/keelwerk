import type { DataAdapter, Outcome, Scope, StorageRow } from '@keelwerk/core';
import { createScheduleTicker } from '@keelwerk/core';
import { pgliteFactory } from '../../../src/harness/pglite-factory.ts';
import { startTestRuntime } from '../../../src/harness/start-test-runtime.ts';
import { testCarrier } from '../../../src/harness/test-carrier.ts';
import { testPrincipal } from '../../../src/harness/test-principal.ts';
import type { TestRuntime } from '../../../src/harness/test-runtime.ts';
import type { TestRuntimeOptions } from '../../../src/harness/test-runtime-options.ts';
import type { JobSpy } from './job-spy.ts';
import { jobSpy } from './job-spy.ts';
import type { TickerApp } from './ticker-app.ts';
import { tickerApp } from './ticker-app.ts';

/** Where the ticker kit starts the clock: on the epoch grid of every five minutes. */
export const tickerStart = Temporal.Instant.from('2026-01-01T00:00:00Z');
/** The clock once the ticker has seeded the schedule rows of the backend and the tenants. */
export const seededAt = tickerStart.add({ minutes: 1 });
export const tickerOwner = '00000000-0000-4000-8000-0000000000a1';

export type TickerTenant = 'acme' | 'globex';

/** A running ticker app with the workers and a ticker, two tenants and a clock the test moves. */
export interface TickerKit {
  readonly runtime: TestRuntime<TickerApp, TickerTenant>;
  readonly spy: JobSpy;
  /** Pins the clock at `at`, then runs the ticker and the jobs until both are quiet. */
  advanceTo(at: Temporal.Instant): Promise<number>;
  call<T = unknown>(tenant: TickerTenant, action: string, input: unknown): Promise<Outcome<T>>;
  /** The rows of an entity in a tenant's scope, or in the backend's scope. */
  rows(scope: TickerTenant | 'backend', entity: string): Promise<readonly StorageRow[]>;
  scopeOf(scope: TickerTenant | 'backend'): Scope;
  stop(): Promise<void>;
}

/** Boots the ticker app (the clock then reads `seededAt`) on the in-memory adapter or PGlite with the kernel workers and the schedule ticker. */
export async function bootTicker(
  options: Pick<
    TestRuntimeOptions<TickerTenant>,
    'adapter' | 'external' | 'join' | 'logger' | 'eventWorkers' | 'drainSeconds'
  > & {
    readonly at?: Temporal.Instant;
    readonly secondTicker?: boolean;
    /** False boots a runtime with no worker and no ticker: it only accepts and commits. */
    readonly workers?: false;
    /** Receives the PGlite adapter the runtime opens, so a test can read the stored rows raw. */
    readonly onAdapter?: (adapter: DataAdapter) => void;
  } = {},
): Promise<TickerKit> {
  const descriptors = new Map(
    [...tickerApp.registry.entities].map(([ref, entry]) => [ref, entry.descriptor] as const),
  );
  const entities = (ref: string) => descriptors.get(ref);
  const { onAdapter } = options;
  const watched = jobSpy(
    entities,
    options.external?.factory ??
      (options.adapter === 'pglite'
        ? pgliteFactory({
            entities,
            ...(onAdapter === undefined
              ? {}
              : { onCreate: (_placement, adapter) => onAdapter(adapter) }),
          })
        : undefined),
  );
  const url =
    options.external?.url ?? (options.adapter === 'pglite' ? 'pglite://ticker' : 'memory://ticker');
  const {
    at,
    secondTicker,
    workers,
    onAdapter: _onAdapter,
    adapter: _adapter,
    external: _external,
    ...rest
  } = options;
  const runtime: TestRuntime<TickerApp, TickerTenant> = await startTestRuntime(tickerApp, {
    tenants: ['acme', 'globex'],
    clock: { now: () => at ?? tickerStart },
    ...(workers === false ? {} : { workers: true as const }),
    external: { factory: watched.factory, url },
    ...(secondTicker === true
      ? {
          eventWorkers: [
            {
              ...createScheduleTicker(),
              id: 'test.second-ticker',
              kind: 'eventWorker',
              provides: [],
              runs: [],
            },
          ],
        }
      : {}),
    ...rest,
  });
  const call: TickerKit['call'] = (tenant, action, input) =>
    runtime.invoker.invoke({
      action,
      input,
      carrier: testCarrier(runtime.tenants[tenant], testPrincipal(tickerOwner)),
      requestId: crypto.randomUUID(),
      signal: new AbortController().signal,
    });
  // The backend and the tenants are created after the runtime started, so the ticker's first fan-out
  // found none: its next one, a minute of clock later, seeds a row for each (`reseedMs`).
  await runtime.advanceTo(seededAt);
  const scopeOf = (scope: TickerTenant | 'backend'): Scope =>
    scope === 'backend'
      ? { level: 'backend', backendId: runtime.backendId }
      : { level: 'tenant', backendId: runtime.backendId, tenantId: runtime.tenants[scope].id };
  return {
    runtime,
    spy: watched.spy,
    advanceTo: (instant) => runtime.advanceTo(instant),
    call,
    rows: async (scope, entity) => {
      const descriptor = runtime.app.registry.entities.get(entity)?.descriptor;
      if (descriptor === undefined) throw new Error(`no entity ${entity}`);
      const page = await runtime.sealed.unit(
        runtime.namespace,
        scopeOf(scope),
        (unit) => unit.rows.find(descriptor, { sort: [{ field: 'createdAt', direction: 'asc' }] }),
        { readOnly: true },
      );
      return page.rows;
    },
    scopeOf,
    stop: () => runtime.stop(),
  };
}
