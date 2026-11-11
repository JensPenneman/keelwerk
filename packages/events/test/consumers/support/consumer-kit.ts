import type {
  ConsumerSpec,
  Hlc,
  Logger,
  ParkedStream,
  Position,
  QueueSource,
  Scope,
  ScopeLookup,
  StorageScope,
  StoredEvent,
  StreamRef,
  Unit,
} from '@keelwerk/core';
import type { TestRuntime, TestRuntimeOptions } from '@keelwerk/testing';
import { createLocalClient, startTestRuntime, testPrincipal } from '@keelwerk/testing';
import { libraryApp } from '@keelwerk/testing/fixtures';
import type { ConsumerRunner } from '../../../src/consumers/consumer-runner.ts';
import { createConsumerRunner } from '../../../src/consumers/create-consumer-runner.ts';

const origin = Temporal.Instant.from('2026-03-01T08:00:00Z');

/** A line of the process log the runner wrote. */
interface LoggedLine {
  readonly level: 'debug' | 'info' | 'warn' | 'error';
  readonly message: string;
  readonly fields: Readonly<Record<string, unknown>>;
}

interface RunnerOptions {
  readonly leaseMs?: number;
  readonly batchSize?: number;
  readonly ready?: () => Promise<boolean>;
  /** A scope lookup other than the kit's, for a test that watches or interrupts the runner's turns. */
  readonly directory?: ScopeLookup;
  /** A source other than the kit's, for a test that wraps the adapter. */
  readonly source?: QueueSource;
}

/** What a consumer was called with: the scope of the unit and the events it got. */
interface ConsumerCall {
  readonly scope: StorageScope;
  readonly events: readonly StoredEvent[];
}

export type ConsumerKitKind = 'memory' | 'pglite';
export type Tenant = 'acme' | 'globex';

/** A stop deadline a few seconds ahead, for tests that do not exercise the deadline. */
export const soon = (): Temporal.Instant => Temporal.Now.instant().add({ seconds: 5 });

export const deploymentId = '00000000-0000-4000-8000-0000000000d1';

/** The clock of the kit: fixed until a test moves it. */
export interface KitClock {
  now(): Temporal.Instant;
  advance(milliseconds: number): void;
}

export interface CountingConsumer {
  readonly spec: ConsumerSpec;
  /** Every call, the failed ones too. */
  readonly calls: ConsumerCall[];
  /** The events of the calls that did not throw, in order. */
  readonly delivered: StoredEvent[];
  /** Events for which `consume` throws; default none. */
  poison: (event: StoredEvent) => boolean;
  /** What `consume` throws when `poison` matches; default an ordinary error. */
  failWith: () => unknown;
}

export interface ConsumerKit {
  readonly runtime: TestRuntime<typeof libraryApp, Tenant>;
  readonly clock: KitClock;
  readonly log: readonly LoggedLine[];
  /** The logger whose lines `log` collects. */
  readonly logger: Logger;
  readonly source: QueueSource;
  readonly directory: ScopeLookup;
  scopeOf(tenant: Tenant): Scope;
  scopeIdOf(tenant: Tenant): string;
  addBooks(tenant: Tenant, count: number): Promise<void>;
  eventsOf(tenant: Tenant): Promise<readonly StoredEvent[]>;
  /** Appends `count` plain events to the stream, which already holds `version` of them. */
  appendNotes(tenant: Tenant, stream: StreamRef, version: number, count: number): Promise<void>;
  checkpoint(consumer: string, tenant: Tenant): Promise<Position | null>;
  parked(consumer: string, tenant: Tenant): Promise<readonly ParkedStream[]>;
  /** A consumer that records every call and throws for the events `poison` names. */
  counting(id: string, over?: Partial<Omit<ConsumerSpec, 'consume'>>): CountingConsumer;
  runnerOf(spec: ConsumerSpec, owner: string, options?: RunnerOptions): ConsumerRunner;
  stop(): Promise<void>;
}

/** A consumer that records every call and throws for the events `poison` names. */
export function countingConsumer(
  id: string,
  over: Partial<Omit<ConsumerSpec, 'consume'>> = {},
): CountingConsumer {
  const calls: ConsumerCall[] = [];
  const delivered: StoredEvent[] = [];
  const consumer: CountingConsumer = {
    calls,
    delivered,
    poison: () => false,
    failWith: () => new Error('the consumer failed'),
    spec: {
      selector: {},
      start: 'beginning',
      ...over,
      id,
      consume: async (events, unit) => {
        calls.push({ scope: unit.scope, events });
        if (events.some((event) => consumer.poison(event))) throw consumer.failWith();
        delivered.push(...events);
      },
    },
  };
  return consumer;
}

/**
 * The library app with the tenants acme and globex on the adapter, a fixed clock the tests move by
 * hand, and a runner builder over the namespace the way the kernel sees it.
 */
export async function startConsumerKit(
  kind: ConsumerKitKind,
  more: {
    /** Runs the app on a database the test started; the factory gets the kit's clock. */
    readonly external?: (clock: KitClock) => NonNullable<TestRuntimeOptions['external']>;
    readonly eventWorkers?: TestRuntimeOptions['eventWorkers'];
  } = {},
): Promise<ConsumerKit> {
  let current = origin;
  const clock: KitClock = {
    now: () => current,
    advance: (milliseconds) => {
      current = current.add({ milliseconds });
    },
  };
  const runtime = await startTestRuntime(libraryApp, {
    tenants: ['acme', 'globex'],
    adapter: kind,
    clock,
    ...(more.external === undefined ? {} : { external: more.external(clock) }),
    ...(more.eventWorkers === undefined ? {} : { eventWorkers: more.eventWorkers }),
  });
  const lines: LoggedLine[] = [];
  const log: Logger = {
    debug: (message, fields) => void lines.push({ level: 'debug', message, fields: fields ?? {} }),
    info: (message, fields) => void lines.push({ level: 'info', message, fields: fields ?? {} }),
    warn: (message, fields) => void lines.push({ level: 'warn', message, fields: fields ?? {} }),
    error: (message, fields) => void lines.push({ level: 'error', message, fields: fields ?? {} }),
    child: () => log,
  };
  const scopeOf = (tenant: Tenant): Scope => ({
    level: 'tenant',
    backendId: runtime.backendId,
    tenantId: runtime.tenants[tenant].id,
  });
  const { namespace } = runtime;
  const source: QueueSource = {
    namespace,
    handle: { adapter: runtime.sealed },
    registry: libraryApp.registry,
  };
  const known = [runtime.backendId, ...Object.values(runtime.tenants).map((tenant) => tenant.id)];
  const directory: ScopeLookup = {
    hostname: async () => undefined,
    backend: async (id) =>
      id === runtime.backendId
        ? {
            id,
            app: libraryApp.id,
            placementId: namespace.placementId,
            namespace,
            status: 'active',
          }
        : undefined,
    tenant: async (id) =>
      known.includes(id) && id !== runtime.backendId
        ? {
            id,
            backendId: runtime.backendId,
            placementId: namespace.placementId,
            namespace,
            status: 'active',
          }
        : undefined,
  };
  const ada = createLocalClient(runtime, { principal: testPrincipal('ada') });
  let isbn = 0;
  const unitOf = <T>(tenant: Tenant, fn: (unit: Unit) => Promise<T>): Promise<T> =>
    runtime.sealed.unit(namespace, scopeOf(tenant), fn);
  return {
    runtime,
    clock,
    log: lines,
    logger: log,
    source,
    directory,
    scopeOf,
    scopeIdOf: (tenant) => runtime.tenants[tenant].id,
    addBooks: async (tenant, count) => {
      const client = ada.as({ tenant });
      for (let n = 0; n < count; n += 1) {
        isbn += 1;
        await client.invoke('library.addBook', { title: `Book ${isbn}`, isbn: `isbn-${isbn}` });
      }
    },
    eventsOf: (tenant) =>
      unitOf(tenant, async (unit) => (await unit.events.readAll(null, { limit: 1000 })).events),
    appendNotes: (tenant, stream, version, count) =>
      runtime.adapter.unit(namespace, scopeOf(tenant), async (unit) => {
        await unit.events.append([
          {
            stream,
            expectedVersion: version,
            partition: null,
            events: Array.from({ length: count }, (_, index) => ({
              eventId: crypto.randomUUID(),
              name: version + index === 0 ? 'created' : 'changed',
              schemaVersion: 1,
              shape: `${'0'.repeat(63)}1`,
              data: { note: version + index + 1 },
              before: null,
              hlc: `0000${version + index + 1}` as Hlc,
              recordedAt: clock.now(),
              meta: {
                actor: { kind: 'system', id: null, via: 'consumer-test' },
                commandId: null,
                action: null,
                causationId: null,
                correlationId: crypto.randomUUID(),
                client: null,
                merge: null,
                traceparent: null,
                writer: { build: 'test', revision: 1 },
                flags: [],
                decision: null,
              },
              transient: false,
              prevHash: null,
              hash: null,
            })),
          },
        ]);
      }),
    checkpoint: (consumer, tenant) =>
      unitOf(tenant, (unit) => unit.consumers.checkpoint(consumer, runtime.tenants[tenant].id)),
    parked: (consumer, tenant) => unitOf(tenant, (unit) => unit.consumers.parked(consumer)),
    counting: countingConsumer,
    runnerOf: (spec, owner, options = {}) =>
      createConsumerRunner({
        spec,
        source: options.source ?? source,
        directory: options.directory ?? directory,
        deploymentId,
        owner,
        leaseMs: options.leaseMs ?? 30_000,
        batchSize: options.batchSize ?? 100,
        clock,
        log,
        ready: options.ready ?? (async () => true),
      }),
    stop: () => runtime.stop(),
  };
}
