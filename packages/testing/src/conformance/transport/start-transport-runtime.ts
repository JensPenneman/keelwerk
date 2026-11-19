import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  Clock,
  DataAdapterFactory,
  EntityDescriptor,
  EventWorker,
  InfrastructureEntry,
  LiveTimers,
  Logger,
  WorkersProbe,
} from '@keelwerk/core';
import { secret, startRuntime } from '@keelwerk/core';
import { memoryAdapter, schemaPlanner } from '@keelwerk/data';
import { clientAddresses } from '../../harness/client-addresses.ts';
import { clientFetchOf } from '../../harness/client-fetch-of.ts';
import { drainJobs } from '../../harness/drain-jobs.ts';
import type { DrainState } from '../../harness/drain-state.ts';
import type { TestApp } from '../../harness/test-app.ts';
import { testMasterKeyName } from '../../harness/test-master-key-name.ts';
import type { TestPrincipalBook } from '../../harness/test-principal-book.ts';
import { testSecrets } from '../../harness/test-secrets.ts';
import { withTestResolver } from '../../harness/with-test-resolver.ts';
import { clientConnectOf } from './client-connect-of.ts';
import { transportBoundsOf } from './transport-bounds-of.ts';
import { transportPglite } from './transport-pglite.ts';
import type { TransportRuntime } from './transport-runtime.ts';
import { withCookieResolver } from './with-cookie-resolver.ts';
import { withRevocation } from './with-revocation.ts';

/** What `startTransportRuntime` takes. */
export interface TransportRuntimeOptions {
  /** The app to serve, with the transport modules the caller composed into it. */
  readonly app: TestApp;
  /**
   * The deployment's HTTP host entry (`httpHost()` of `@keelwerk/transport-http`). For the socket
   * cases pass a listening host that trusts the loopback:
   * `httpHost({ listen: { port: 0 }, trustedProxies: ['127.0.0.1'] })`; the hook sends its address
   * as the forwarded entry of the upgrade.
   */
  readonly host: InfrastructureEntry;
  /** The data adapter of the control store and the placement; default `'memory'`. */
  readonly adapter?: 'memory' | 'pglite';
  /** The backend's `config`, by module id (the REST module's `cors` and `docs`). */
  readonly config?: Readonly<Record<string, unknown>>;
  /** The tenants to create, by name; each gets the domain `<name>.example.test`. */
  readonly tenants?: readonly string[];
  /** The API version each named tenant is pinned to; a tenant not named follows the backend's default and the head. */
  readonly tenantApiVersions?: Readonly<Record<string, string>>;
  /** The runtime's clock; default: the system clock. */
  readonly clock?: Clock;
  /** The waits of a live carrier (see `pinnedLiveTimers`); default: timers on the runtime's clock. */
  readonly timers?: LiveTimers;
  /** Where the runtime logs; default: the core's no-op logger. A test passes a capturing logger to read what was logged. */
  readonly logger?: Logger;
  /**
   * Event workers added to the deployment's infrastructure, such as `consumers()` of
   * `@keelwerk/events`. With them, or with `workers`, the runtime runs role 'all' (the kernel's
   * workers serve every queue), so a command that is accepted is finished by a worker.
   */
  readonly eventWorkers?: readonly EventWorker[];
  /** Runs the kernel's workers on every queue; `drainJobs` of the runtime then waits for them. */
  readonly workers?: true;
}

/**
 * Boots a transport fixture app through `startRuntime` with `listen` on: the HTTP host is built
 * from the entry the caller passes, the app's transports mount on it, and one backend and its
 * tenants exist. The test principal resolver reads the `x-test-principal` header, so a request
 * holds its principal as plain data; the test cookie resolver reads the session cookie.
 */
export async function startTransportRuntime(
  options: TransportRuntimeOptions,
): Promise<TransportRuntime> {
  const { app } = options;
  const descriptors = new Map(
    [...app.registry.entities].map(([ref, entry]) => [ref, entry.descriptor] as const),
  );
  const lookup = (ref: string): EntityDescriptor | undefined => descriptors.get(ref);
  const id = options.adapter ?? 'memory';
  const factory: DataAdapterFactory =
    id === 'pglite' ? transportPglite({ entities: lookup }) : memoryAdapter({ entities: lookup });
  const book: TestPrincipalBook = { seen: new Map(), revoked: new Set() };
  const names = options.tenants ?? ['acme', 'globex'];
  const directory = await mkdtemp(join(tmpdir(), 'kw-transport-'));
  const socket = join(directory, 'op.sock');
  const working = options.workers === true || options.eventWorkers !== undefined;
  const drain: DrainState = { probe: undefined, counted: 0 };
  const probed = Promise.withResolvers<void>();
  const runtime = await startRuntime(
    {
      apps: [withRevocation(withCookieResolver(withTestResolver(app, false, book)), book)],
      infrastructure: [
        factory,
        schemaPlanner(),
        testSecrets,
        ...(options.eventWorkers ?? []),
        options.host,
      ],
      control: { adapter: id },
      placements: { main: { adapter: id, strategy: 'shared-tables' } },
      operator: { socket },
      tenantResolution: [
        { kind: 'hostname' },
        { kind: 'header', header: 'x-tenant' },
        { kind: 'path' },
      ],
      keys: { masterKey: secret(testMasterKeyName) },
    },
    {
      // Serve only unless the caller asks for workers: the cases read receipts that stay `accepted`, which a worker would finish.
      role: working ? 'all' : 'serve',
      ...(working
        ? {
            work: {
              slots: { '*': 4 },
              probe: (probe: WorkersProbe) => {
                drain.probe = probe;
                probed.resolve();
              },
            },
          }
        : {}),
      listen: true,
      environment: 'test',
      ...(options.clock === undefined ? {} : { clock: options.clock }),
      ...(options.timers === undefined ? {} : { timers: options.timers }),
      ...(options.logger === undefined ? {} : { logger: options.logger }),
    },
  );
  const host = runtime.host;
  if (host === undefined) {
    throw new Error('The runtime has no HTTP host: pass the `httpHost()` entry as `host`.');
  }
  const backendConfig = { ...options.config };
  const backend = await runtime.control.createBackend({
    name: 'conformance',
    app: app.id,
    placement: 'main',
    config: backendConfig,
  });
  const tenants: Record<string, string> = {};
  const deprecatedPins: Record<string, string> = {};
  const domains: Record<string, string> = {};
  for (const name of names) {
    const domain = `${name}.example.test`;
    const pin = options.tenantApiVersions?.[name];
    const tenant = await runtime.control.createTenant({
      backendId: backend.id,
      name,
      domains: [domain],
      ...(pin === undefined ? {} : { apiVersion: pin }),
    });
    tenants[name] = tenant.id;
    if (pin !== undefined && app.api?.versions[pin]?.deprecated !== undefined) {
      deprecatedPins[name] = pin;
    }
    domains[name] = domain;
  }
  // The runtime starts its workers in the background and hands the probe over when they run.
  if (working) await probed.promise;
  const addresses = clientAddresses();
  return {
    runtime,
    fetch: clientFetchOf(host, addresses),
    ...(runtime.port !== undefined && { connect: clientConnectOf(runtime.port, addresses) }),
    backendId: backend.id,
    backendConfig,
    tenants,
    domains,
    bounds: transportBoundsOf(options.host),
    headApiVersion: app.api?.dates.at(-1) ?? '',
    deprecatedPins,
    revoke: (subject) => {
      book.revoked.add(subject);
    },
    socket,
    drainJobs: () => drainJobs(drain),
    stop: async () => {
      await runtime.stop(1000);
      await rm(directory, { recursive: true, force: true });
    },
  };
}
