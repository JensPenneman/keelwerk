import type {
  AdapterEnvironment,
  DataAdapter,
  DataAdapterFactory,
  EntityDescriptor,
  NamespaceRef,
} from '@keelwerk/core';
import {
  coreApiVersions,
  createKeyService,
  KeelwerkError,
  moduleConfigOf,
  moduleConfigShapes,
  sealingAdapter,
  secret,
  startRuntime,
} from '@keelwerk/core';
import { fallbackReporter, memoryAdapter, schemaPlanner } from '@keelwerk/data';
import type { TestApp } from './test-app.ts';
import { testMasterKeyBytes } from './test-master-key-bytes.ts';
import { testMasterKeyName } from './test-master-key-name.ts';
import type { TestRuntime } from './test-runtime.ts';
import type { TestRuntimeOptions } from './test-runtime-options.ts';
import { testSecrets } from './test-secrets.ts';
import type { TestTenant } from './test-tenant.ts';
import { withTestResolver } from './with-test-resolver.ts';

const placementName = 'main';

/**
 * Starts the app in process the way a deployment does: `startRuntime` over the in-memory adapter
 * (or the one the options name), the control store, one backend and the named tenants created
 * through the operator's control API. Callers reach it through `createLocalClient`.
 */
export async function startTestRuntime<
  const App extends TestApp,
  const Name extends string = 'acme' | 'globex',
>(app: App, options: TestRuntimeOptions<Name> = {}): Promise<TestRuntime<App, Name>> {
  const problems = app.registry.problems.filter((problem) => problem.severity === 'error');
  if (problems.length > 0) {
    throw new KeelwerkError({
      kind: 'internal',
      code: 'core.internal',
      message: `The app does not compose: ${problems.map((problem) => problem.message).join('; ')}`,
    });
  }
  const names: readonly string[] = options.tenants ?? ['acme', 'globex'];
  const clock = options.clock ?? { now: () => Temporal.Now.instant() };
  const descriptors = new Map<string, EntityDescriptor>(
    [...app.registry.entities].map(([ref, entry]) => [ref, entry.descriptor] as const),
  );
  const created: DataAdapter[] = [];
  const namespaces: NamespaceRef[] = [];
  let environment: AdapterEnvironment | undefined;
  // The control store holds the scope keys the sealing layer's index keys come from.
  let control: { adapter: DataAdapter; namespace?: NamespaceRef } | undefined;
  let maxScan = 0;
  // The runtime provisions the namespaces; the harness only notes which ones, to address them.
  const observed = (adapter: DataAdapter): DataAdapter => ({
    ...adapter,
    connect: async () => {
      const capabilities = await adapter.connect();
      maxScan = capabilities.encryptedQueries.maxScan;
      return capabilities;
    },
    schema: {
      ...adapter.schema,
      provision: async (namespace, snapshots, options) => {
        await adapter.schema.provision(namespace, snapshots, options);
        namespaces.push(namespace);
        if (namespace.id === 'ns-control' && control !== undefined) control.namespace = namespace;
      },
    },
  });
  const given = typeof options.adapter === 'object' ? options.adapter : undefined;
  const kind = options.adapter === 'pglite' ? 'pglite' : 'memory';
  const external = options.external;
  const base: DataAdapterFactory =
    external !== undefined
      ? external.factory
      : kind === 'pglite'
        ? (await import('./pglite-factory.ts')).pgliteFactory({
            clock,
            entities: (ref) => descriptors.get(ref),
          })
        : memoryAdapter({ clock, entities: (ref) => descriptors.get(ref) });
  const factory: DataAdapterFactory =
    given === undefined
      ? {
          ...base,
          create: (placement, env) => {
            const adapter = observed(base.create(placement, env));
            if (placement.id === 'control') control = { adapter };
            if (placement.id === placementName) {
              created.push(adapter);
              environment = env;
            }
            return adapter;
          },
        }
      : {
          ...base,
          id: 'given',
          create: (_placement, env) => {
            const adapter = observed(given);
            control = { adapter };
            created.push(adapter);
            environment = env;
            return adapter;
          },
        };
  const served = withTestResolver(app, options.operators === true);
  const runtime = await startRuntime(
    {
      apps: [served],
      infrastructure: [
        factory,
        schemaPlanner(),
        ...(kind === 'pglite' || external !== undefined ? [fallbackReporter()] : []),
        testSecrets,
      ],
      control:
        external === undefined
          ? { adapter: given === undefined ? kind : 'memory' }
          : { adapter: base.id, url: external.url },
      placements: {
        [placementName]: {
          adapter: external !== undefined ? base.id : given === undefined ? kind : 'given',
          strategy: 'shared-tables',
          ...(external === undefined ? {} : { url: external.url }),
        },
      },
      tenantResolution: [{ kind: 'header', header: 'x-tenant' }],
      keys: { masterKey: secret(testMasterKeyName) },
    },
    {
      role: 'all',
      listen: false,
      environment: 'test',
      clock,
      ...(options.logger === undefined ? {} : { logger: options.logger }),
    },
  );
  const backend = await runtime.control.createBackend({
    name: 'test',
    app: app.id,
    placement: placementName,
    ...(options.config === undefined ? {} : { config: options.config }),
  });
  const tenants: TestTenant[] = [];
  for (const name of names) {
    const tenant = await runtime.control.createTenant({ backendId: backend.id, name });
    tenants.push({ name, id: tenant.id });
  }
  const adapter = created[0];
  const namespace = namespaces.find((candidate) => candidate.appId === app.id);
  if (adapter === undefined || environment === undefined || namespace === undefined) {
    throw new Error('the test runtime did not open its placement');
  }
  if (control?.namespace === undefined)
    throw new Error('the test runtime did not open its control store');
  const { adapter: controlAdapter, namespace: controlNamespace } = control;
  const master = { version: 1, material: testMasterKeyBytes };
  const keys = createKeyService({
    master: { current: async () => master, byVersion: async () => master },
    deploymentId: environment.deploymentId,
    withScopeKeys: (fn) =>
      controlAdapter.unit(controlNamespace, { level: 'deployment' }, (unit) => {
        if (unit.scopeKeys === undefined) throw new Error('the control store has no scope keys');
        return fn(unit.scopeKeys);
      }),
    clock,
  });
  return {
    app,
    adapter,
    sealed: sealingAdapter(adapter, {
      keys,
      maxScan,
      describe: (_namespace, ref) => descriptors.get(ref),
    }),
    backendId: backend.id,
    keys,
    clock,
    config: moduleConfigOf(moduleConfigShapes(app.modules), backend.config),
    namespace,
    log: environment.log,
    tracer: environment.tracer,
    tenants: Object.fromEntries(tenants.map((tenant) => [tenant.name, tenant])) as Record<
      Name,
      TestTenant
    >,
    invoker: runtime.invoker,
    head: app.api?.dates.at(-1) ?? coreApiVersions.dates.at(-1) ?? '',
    stop: () => runtime.stop(0),
  };
}
