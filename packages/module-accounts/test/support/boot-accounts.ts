import { defineApp } from '@keelwerk/core';
import {
  createLocalClient,
  startTestRuntime,
  type TestPrincipal,
  type TestRuntime,
  type TestRuntimeOptions,
} from '@keelwerk/testing';
import { accounts } from '../../src/module.generated.ts';
import { directoryRule } from './directory-rule.ts';
import { readers } from './readers-module.ts';

/** The accounts module alone, as an app. */
const accountsApp = defineApp({ id: 'accounts', modules: [accounts] as const });

/** The accounts module and an application's own rule that gives a directory (by a membership of the app's own kind). */
const directoryApp: typeof accountsApp = defineApp({
  id: 'accounts',
  modules: [accounts, readers] as const,
  policies: { add: [directoryRule] },
}) as unknown as typeof accountsApp;

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
  withDirectoryRule = false,
): Promise<BootedAccounts> {
  const runtime = await startTestRuntime(withDirectoryRule ? directoryApp : accountsApp, {
    adapter: kind,
    operators: true,
    tenants: ['acme', 'globex'],
    config: { accounts: settings },
    ...(external === undefined ? {} : { external }),
  });
  return {
    runtime: runtime as TestRuntime<typeof accountsApp>,
    client: (principal, tenant = 'acme') =>
      createLocalClient(runtime as TestRuntime<typeof accountsApp>, { principal, tenant }),
  };
}
