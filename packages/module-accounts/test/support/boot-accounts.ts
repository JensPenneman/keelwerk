import type { Runtime } from '@keelwerk/core';
import { coreApiVersions, defineApp, secret, startRuntime } from '@keelwerk/core';
import { fallbackReporter, memoryAdapter, schemaPlanner } from '@keelwerk/data';
import { createLocalClient, type TestPrincipal } from '@keelwerk/testing';
import { accounts } from '../../src/module.generated.ts';
import { pgliteFactory } from './pglite-factory.ts';
import { masterKeyName, testSecrets } from './test-secrets.ts';
import { withTestResolver } from './with-test-resolver.ts';

/** The accounts module alone, as an app. */
const accountsApp = defineApp({ id: 'accounts', modules: [accounts] as const });

/** Where the accounts app is stored in a test. */
export type StorageKind = 'memory' | 'pglite';

/** A booted accounts app and the way to reach it. */
export interface BootedAccounts {
  readonly runtime: Runtime;
  /** A local client of a tenant (acme unless named); the claim `operator: true` makes the principal an operator. */
  client(
    principal: TestPrincipal,
    tenant?: 'acme' | 'globex',
  ): ReturnType<typeof createLocalClient<typeof accountsApp>>;
}

/** Boots the accounts app alone with one backend and two tenants, acme and globex. */
export async function bootAccounts(kind: StorageKind): Promise<BootedAccounts> {
  const factory = kind === 'memory' ? memoryAdapter() : pgliteFactory();
  const served = withTestResolver(accountsApp);
  const runtime = await startRuntime(
    {
      apps: [served],
      infrastructure: [factory, schemaPlanner(), fallbackReporter(), testSecrets],
      control: { adapter: kind },
      placements: { main: { adapter: kind, strategy: 'shared-tables' } },
      tenantResolution: [{ kind: 'header', header: 'x-tenant' }],
      keys: { masterKey: secret(masterKeyName) },
    },
    { role: 'all', listen: false, environment: 'test' },
  );
  const backend = await runtime.control.createBackend({
    name: 'accounts',
    app: 'accounts',
    placement: 'main',
  });
  const acme = await runtime.control.createTenant({ backendId: backend.id, name: 'acme' });
  const globex = await runtime.control.createTenant({ backendId: backend.id, name: 'globex' });
  const tenants = {
    acme: { name: 'acme', id: acme.id },
    globex: { name: 'globex', id: globex.id },
  };
  const head = accountsApp.api?.dates.at(-1) ?? coreApiVersions.dates.at(-1) ?? '';
  return {
    runtime,
    client: (principal, tenant = 'acme') =>
      createLocalClient(
        { app: served, invoker: runtime.invoker, tenants, head },
        { principal, tenant },
      ),
  };
}
