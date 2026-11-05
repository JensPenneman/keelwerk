import type { DataAdapterFactory, DeploymentDefinition } from '@keelwerk/core';
import { secret, startRuntime } from '@keelwerk/core';
import { fallbackReporter, schemaPlanner } from '@keelwerk/data';
import { libraryApp } from '../../src/fixtures/index.ts';
import { testMasterKeyName } from '../../src/harness/test-master-key-name.ts';
import { testSecrets } from '../../src/harness/test-secrets.ts';
import { withTestResolver } from '../../src/harness/with-test-resolver.ts';
import { type Slice2Adapters, slice2Adapters } from './slice-2-adapters.ts';

const app = withTestResolver(libraryApp);

/** Where a slice-2 run stores: the adapter factory, its id and the placement url when it has one. */
export interface Slice2Target {
  readonly factory: DataAdapterFactory;
  readonly url?: string;
  /** True when the database dies with the adapter (in-memory, PGlite): the adapters then outlive a runtime. */
  readonly volatile: boolean;
}

/** What `startSlice2` answers. */
export interface Slice2 {
  /** The app the deployment serves, with the test resolver in place. */
  readonly app: typeof app;
  readonly adapters: Slice2Adapters;
  deployment(planner?: ReturnType<typeof schemaPlanner>): DeploymentDefinition;
  boot(
    environment: 'test' | 'production',
    planner?: ReturnType<typeof schemaPlanner>,
  ): ReturnType<typeof startRuntime>;
}

export function slice2(target: Slice2Target): Slice2 {
  const adapters = slice2Adapters(target.factory, target.volatile);
  const url = target.url === undefined ? {} : { url: target.url };
  const deployment = (planner = schemaPlanner()): DeploymentDefinition => ({
    apps: [app],
    infrastructure: [adapters.factory, planner, fallbackReporter(), testSecrets],
    control: { adapter: target.factory.id, ...url },
    placements: { main: { adapter: target.factory.id, strategy: 'shared-tables', ...url } },
    tenantResolution: [{ kind: 'header', header: 'x-tenant' }],
    keys: { masterKey: secret(testMasterKeyName) },
  });
  return {
    app,
    adapters,
    deployment,
    boot: (environment, planner) =>
      startRuntime(deployment(planner), { role: 'all', listen: false, environment }),
  };
}
