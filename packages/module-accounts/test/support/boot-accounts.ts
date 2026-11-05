import { defineApp } from '@keelwerk/core';
import {
  createLocalClient,
  startTestRuntime,
  type TestPrincipal,
  type TestRuntime,
  type TestRuntimeOptions,
} from '@keelwerk/testing';
import { accounts } from '../../src/module.generated.ts';

/** The accounts module alone, as an app. */
const accountsApp = defineApp({ id: 'accounts', modules: [accounts] as const });

/** Where the accounts app is stored in a test. */
export type StorageKind = 'memory' | 'pglite';

/** A booted accounts app and the way to reach it. */
export interface BootedAccounts {
  readonly runtime: TestRuntime<typeof accountsApp>;
  /** A local client of a tenant (acme unless named); the claim `operator: true` makes the principal an operator. */
  client(
    principal: TestPrincipal,
    tenant?: 'acme' | 'globex',
  ): ReturnType<typeof createLocalClient<typeof accountsApp>>;
}

/** Boots the accounts app alone with one backend and two tenants, acme and globex; `allowSelfRegistration` is the module's one setting. */
export async function bootAccounts(
  kind: StorageKind,
  settings: { readonly allowSelfRegistration?: boolean } = {},
  external?: TestRuntimeOptions['external'],
): Promise<BootedAccounts> {
  const runtime = await startTestRuntime(accountsApp, {
    adapter: kind,
    operators: true,
    tenants: ['acme', 'globex'],
    config: { accounts: settings },
    ...(external === undefined ? {} : { external }),
  });
  return {
    runtime,
    client: (principal, tenant = 'acme') => createLocalClient(runtime, { principal, tenant }),
  };
}
