import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  Clock,
  DataAdapterFactory,
  EntityDescriptor,
  InfrastructureEntry,
} from '@keelwerk/core';
import { secret, startRuntime } from '@keelwerk/core';
import { memoryAdapter, schemaPlanner } from '@keelwerk/data';
import type { TestApp } from '../../harness/test-app.ts';
import { testMasterKeyName } from '../../harness/test-master-key-name.ts';
import { testSecrets } from '../../harness/test-secrets.ts';
import { withTestResolver } from '../../harness/with-test-resolver.ts';
import { transportPglite } from './transport-pglite.ts';
import type { TransportRuntime } from './transport-runtime.ts';
import { withCookieResolver } from './with-cookie-resolver.ts';

/** What `startTransportRuntime` takes. */
export interface TransportRuntimeOptions {
  /** The app to serve, with the transport modules the caller composed into it. */
  readonly app: TestApp;
  /** The deployment's HTTP host entry (`httpHost()` of `@keelwerk/transport-http`). */
  readonly host: InfrastructureEntry;
  /** The data adapter of the control store and the placement; default `'memory'`. */
  readonly adapter?: 'memory' | 'pglite';
  /** The backend's `config`, by module id (the REST module's `cors` and `docs`). */
  readonly config?: Readonly<Record<string, unknown>>;
  /** The tenants to create, by name; each gets the domain `<name>.example.test`. */
  readonly tenants?: readonly string[];
  /** The runtime's clock; default: the system clock. */
  readonly clock?: Clock;
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
  const names = options.tenants ?? ['acme', 'globex'];
  const directory = await mkdtemp(join(tmpdir(), 'kw-transport-'));
  const socket = join(directory, 'op.sock');
  const runtime = await startRuntime(
    {
      apps: [withCookieResolver(withTestResolver(app))],
      infrastructure: [factory, schemaPlanner(), testSecrets, options.host],
      control: { adapter: id },
      placements: { main: { adapter: id, strategy: 'shared-tables' } },
      operator: { socket },
      tenantResolution: [{ kind: 'hostname' }, { kind: 'header', header: 'x-tenant' }],
      keys: { masterKey: secret(testMasterKeyName) },
    },
    {
      role: 'all',
      listen: true,
      environment: 'test',
      ...(options.clock === undefined ? {} : { clock: options.clock }),
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
  const domains: Record<string, string> = {};
  for (const name of names) {
    const domain = `${name}.example.test`;
    const tenant = await runtime.control.createTenant({
      backendId: backend.id,
      name,
      domains: [domain],
    });
    tenants[name] = tenant.id;
    domains[name] = domain;
  }
  return {
    runtime,
    fetch: (request) => host.fetch(request),
    backendId: backend.id,
    backendConfig,
    tenants,
    domains,
    socket,
    stop: async () => {
      await runtime.stop(1000);
      await rm(directory, { recursive: true, force: true });
    },
  };
}
