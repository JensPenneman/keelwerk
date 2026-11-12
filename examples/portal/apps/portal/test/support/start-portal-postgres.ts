import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { postgresAdapter } from '@keelwerk/adapter-postgres';
import type { DataAdapterFactory, Runtime } from '@keelwerk/core';
import { secret, startRuntime } from '@keelwerk/core';
import { fallbackReporter, schemaPlanner } from '@keelwerk/data';
import type { TransportRuntime } from '@keelwerk/testing';
import { clientFetchOf } from '@keelwerk/testing';
import { httpHost } from '@keelwerk/transport-http';
import { portal } from '../../src/app.ts';
import { portalConfig } from './portal-config.ts';
import { masterKeyName, portalSecrets } from './portal-secrets.ts';

/** Where the portal is stored on PostgreSQL and which accelerations it may use. */
export interface PostgresPortalOptions {
  readonly adminUrl: string;
  readonly appUrl: string;
  /** Wraps the adapter factory, so a test can observe what the kernel receives. */
  readonly wrap?: (factory: DataAdapterFactory) => DataAdapterFactory;
  readonly accelerations?: { readonly rowLocks?: boolean; readonly notify?: boolean };
  readonly tenants?: readonly string[];
}

/** A running portal on PostgreSQL: the transport runtime and the runtime beneath it. */
export interface RunningPortal extends TransportRuntime {
  readonly runtime: Runtime;
}

/**
 * Boots the portal on PostgreSQL through `startRuntime` with the HTTP host listening in process,
 * the way a deployment does: only the app's own principal resolvers, the master key from a secret
 * provider, one backend and its tenants (each on the domain `<name>.example.test`).
 */
export async function startPortalPostgres(options: PostgresPortalOptions): Promise<RunningPortal> {
  const base = postgresAdapter({
    ownerUrl: options.adminUrl,
    ...(options.accelerations === undefined ? {} : { accelerations: options.accelerations }),
  });
  const factory = options.wrap?.(base) ?? base;
  const directory = await mkdtemp(join(tmpdir(), 'kw-portal-'));
  const socket = join(directory, 'op.sock');
  const runtime = await startRuntime(
    {
      apps: [portal],
      infrastructure: [factory, schemaPlanner(), fallbackReporter(), portalSecrets, httpHost()],
      control: { adapter: factory.id, url: options.appUrl },
      placements: {
        main: { adapter: factory.id, strategy: 'shared-tables', url: options.appUrl },
      },
      operator: { socket },
      tenantResolution: [{ kind: 'hostname' }, { kind: 'header', header: 'x-tenant' }],
      keys: { masterKey: secret(masterKeyName) },
    },
    { role: 'all', listen: true, environment: 'test' },
  );
  const host = runtime.host;
  if (host === undefined) throw new Error('The runtime has no HTTP host.');
  const backend = await runtime.control.createBackend({
    name: 'portal',
    app: portal.id,
    placement: 'main',
    config: portalConfig,
  });
  const tenants: Record<string, string> = {};
  const domains: Record<string, string> = {};
  for (const name of options.tenants ?? ['acme', 'globex']) {
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
    fetch: clientFetchOf(host),
    backendId: backend.id,
    backendConfig: portalConfig,
    tenants,
    domains,
    socket,
    stop: async () => {
      await runtime.stop(1000);
      await rm(directory, { recursive: true, force: true });
    },
  };
}
