import type {
  ConsumerSpec,
  Outcome,
  RuntimeServiceContext,
  Scope,
  StorageRow,
} from '@keelwerk/core';
import { consumers, reactionDispatcher } from '@keelwerk/events';
import { pgliteFactory } from '../../../src/harness/pglite-factory.ts';
import { startTestRuntime } from '../../../src/harness/start-test-runtime.ts';
import { testCarrier } from '../../../src/harness/test-carrier.ts';
import { testPrincipal } from '../../../src/harness/test-principal.ts';
import type { TestRuntime } from '../../../src/harness/test-runtime.ts';
import type { TestRuntimeOptions } from '../../../src/harness/test-runtime-options.ts';
import type { JobSpy } from './job-spy.ts';
import { jobSpy } from './job-spy.ts';
import type { RelayApp } from './relay-app.ts';
import { relayApp } from './relay-app.ts';
import { relayControl } from './relay-control.ts';

/** The subject the signals of the tests belong to: a UUID, because the key tables hold one. */
export const relayOwner = '00000000-0000-4000-8000-0000000000a1';
export const relayOtherOwner = '00000000-0000-4000-8000-0000000000b2';

/** Where the reactions kit starts the clock. */
export const reactionsStart = Temporal.Instant.from('2026-03-01T08:00:00Z');

/** A running relay app with the dispatcher and the workers, two tenants and a clock the test moves. */
export interface ReactionsKit {
  readonly runtime: TestRuntime<RelayApp, 'acme' | 'globex'>;
  /** The watched job store, when the kit booted with `watched`. */
  readonly spy: JobSpy | undefined;
  /** The dispatcher's worker: `settled()` dispatches, `unpark` replays a parked stream. */
  readonly dispatcher: ReturnType<typeof consumers>;
  /** Seconds of clock pinned so far: the test's `now`. */
  now(): Temporal.Instant;
  /** Writes a signal as a signed-in user of the tenant; answers the outcome. */
  send(
    tenant: 'acme' | 'globex',
    input: {
      readonly channel: string;
      readonly text?: string;
      readonly owner?: string;
      readonly contact?: string;
      readonly internalNote?: string;
    },
  ): Promise<Outcome<{ signalId: string }>>;
  call<T = unknown>(tenant: 'acme' | 'globex', action: string, input: unknown): Promise<Outcome<T>>;
  /** The rows of an entity of the app in a tenant, as the module reads them, oldest first. */
  rows(tenant: 'acme' | 'globex', entity: string): Promise<readonly StorageRow[]>;
  scopeOf(tenant: 'acme' | 'globex'): Scope;
  /** Dispatches what the dispatcher has not seen, then runs the jobs that are due, until both are quiet. */
  settle(): Promise<void>;
  /** Pins the clock at `at` without running anything. */
  pin(at: Temporal.Instant): void;
  /** Pins the clock at `at` and settles. */
  advanceTo(at: Temporal.Instant): Promise<void>;
  stop(): Promise<void>;
}

/** Boots the relay app with the reaction dispatcher and the kernel workers. */
export async function bootReactions(
  options: Pick<
    TestRuntimeOptions<'acme' | 'globex'>,
    'adapter' | 'external' | 'logger' | 'join' | 'tenantApiVersions'
  > & {
    readonly queued?: number;
    readonly holdMs?: number;
    readonly workers?: NonNullable<TestRuntimeOptions<'acme' | 'globex'>['workers']>;
    /** The dispatcher's own spec, built from the real one (a test wraps its `consume`). */
    readonly wrap?: (spec: ConsumerSpec) => ConsumerSpec;
    /** Watches the job store (outcomes, takes, gates): of the in-memory adapter, of PGlite, or of the `external` factory. */
    readonly watched?: true;
    readonly env?: Readonly<Record<string, string | undefined>>;
    /** The consumers' lease; the batch deadline is a third of it, in real time. */
    readonly leaseMs?: number;
    /** The app to run; default: the relay app. A variant with other reactions is cast to its type by the caller. */
    readonly app?: RelayApp;
  } = {},
): Promise<ReactionsKit> {
  relayControl.attempts.clear();
  const real = reactionDispatcher({
    ...(options.queued === undefined ? {} : { queued: options.queued }),
    ...(options.holdMs === undefined ? {} : { holdMs: options.holdMs }),
  });
  const dispatcher = consumers({
    consumers: [
      options.wrap === undefined
        ? real
        : // The wrapper takes the id and the mark of the real dispatcher, as the specs it builds keep them.
          Object.assign(
            (context: RuntimeServiceContext) => options.wrap?.(real(context)) as ConsumerSpec,
            real,
          ),
    ],
    runs: ['asyncReactions'],
    ...(options.leaseMs === undefined ? {} : { leaseMs: options.leaseMs }),
  });
  const descriptors = new Map(
    [...(options.app ?? relayApp).registry.entities].map(
      ([ref, entry]) => [ref, entry.descriptor] as const,
    ),
  );
  const entities = (ref: string) => descriptors.get(ref);
  const watched =
    options.watched === true
      ? jobSpy(
          entities,
          options.external?.factory ??
            (options.adapter === 'pglite' ? pgliteFactory({ entities }) : undefined),
        )
      : undefined;
  const watchedUrl =
    options.external?.url ??
    (options.adapter === 'pglite' ? 'pglite://watched' : 'memory://watched');
  let at = reactionsStart;
  const {
    queued: _queued,
    holdMs: _holdMs,
    workers,
    wrap: _wrap,
    watched: _watched,
    leaseMs: _leaseMs,
    app,
    ...rest
  } = options;
  const runtime = await startTestRuntime(app ?? relayApp, {
    tenants: ['acme', 'globex'],
    clock: { now: () => at },
    workers: workers ?? true,
    eventWorkers: [dispatcher],
    ...rest,
    ...(watched === undefined ? {} : { external: { factory: watched.factory, url: watchedUrl } }),
  });
  const scopeOf = (tenant: 'acme' | 'globex'): Scope => ({
    level: 'tenant',
    backendId: runtime.backendId,
    tenantId: runtime.tenants[tenant].id,
  });
  const call = <T>(tenant: 'acme' | 'globex', action: string, input: unknown) =>
    runtime.invoker.invoke<unknown, T>({
      action,
      input,
      carrier: testCarrier(runtime.tenants[tenant], testPrincipal(relayOwner)),
      requestId: crypto.randomUUID(),
      signal: new AbortController().signal,
    });
  // A round that did nothing is not proof of rest on every adapter (a retry that just became due is
  // promoted by the wake the drain gives), so two quiet rounds in a row end the settling.
  const settle = async (): Promise<void> => {
    let quiet = 0;
    for (let round = 0; round < 40; round += 1) {
      const dispatched = await dispatcher.settled();
      const ran = await runtime.drainJobs();
      quiet = dispatched === 0 && ran === 0 ? quiet + 1 : 0;
      if (quiet >= 2) return;
    }
    throw new Error('the reactions did not settle in 40 rounds');
  };
  return {
    runtime,
    spy: watched?.spy,
    dispatcher,
    now: () => at,
    send: (tenant, input) =>
      call(tenant, 'relay.send', {
        channel: input.channel,
        text: input.text ?? 'hello',
        owner: input.owner ?? relayOwner,
        ...(input.contact === undefined ? {} : { contact: input.contact }),
        ...(input.internalNote === undefined ? {} : { internalNote: input.internalNote }),
      }),
    call,
    rows: async (tenant, entity) => {
      const descriptor = runtime.app.registry.entities.get(entity)?.descriptor;
      if (descriptor === undefined) throw new Error(`no entity ${entity}`);
      const page = await runtime.sealed.unit(
        runtime.namespace,
        scopeOf(tenant),
        (unit) => unit.rows.find(descriptor, { sort: [{ field: 'createdAt', direction: 'asc' }] }),
        { readOnly: true },
      );
      return page.rows;
    },
    scopeOf,
    settle,
    pin: (instant) => {
      at = instant;
    },
    advanceTo: async (instant) => {
      at = instant;
      await settle();
    },
    stop: () => runtime.stop(),
  };
}

/** Every event of a tenant, as stored, in position order. */
export async function tenantEventsOf(kit: ReactionsKit, tenant: 'acme' | 'globex') {
  const { runtime } = kit;
  const page = await runtime.adapter.unit(
    runtime.namespace,
    kit.scopeOf(tenant),
    (unit) => unit.events.readAll(null, { limit: 1000 }),
    { readOnly: true },
  );
  return page.events;
}
