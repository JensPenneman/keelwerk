import type {
  AdapterEnvironment,
  DataAdapter,
  DataAdapterFactory,
  EntityDescriptor,
  NamespaceRef,
  WorkersProbe,
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
import { advanceTo } from './advance-to.ts';
import { drainJobs } from './drain-jobs.ts';
import type { DrainState } from './drain-state.ts';
import type { TestApp } from './test-app.ts';
import { testMasterKeyBytes } from './test-master-key-bytes.ts';
import { testMasterKeyName } from './test-master-key-name.ts';
import type { TestPrincipalBook } from './test-principal-book.ts';
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
  if (options.join !== undefined && options.external === undefined) {
    throw new Error('join attaches to a database another runtime created: it needs external');
  }
  const names: readonly string[] = options.tenants ?? ['acme', 'globex'];
  const source = options.clock ?? { now: () => Temporal.Now.instant() };
  let pinned: Temporal.Instant | undefined;
  const clock = { now: () => pinned ?? source.now() };
  const workers: DrainState = { probe: undefined, counted: 0 };
  const probed = Promise.withResolvers<void>();
  const book: TestPrincipalBook = { seen: new Map(), revoked: new Set() };
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
  const served = withTestResolver(app, options.operators === true, book);
  const runtime = await startRuntime(
    {
      apps: [served],
      infrastructure: [
        factory,
        schemaPlanner(),
        ...(kind === 'pglite' || external !== undefined ? [fallbackReporter()] : []),
        testSecrets,
        ...(options.flagProviders ?? []),
        ...(options.eventWorkers ?? []),
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
      tenantResolution: [{ kind: 'header', header: 'x-tenant', backendHeader: 'x-backend' }],
      keys: { masterKey: secret(testMasterKeyName) },
    },
    {
      role: options.workers === undefined && options.eventWorkers === undefined ? 'serve' : 'all',
      listen: false,
      environment: 'test',
      clock,
      ...(options.logger === undefined ? {} : { logger: options.logger }),
      ...(options.workers === undefined
        ? {}
        : {
            work: {
              ...(options.drainSeconds === undefined ? {} : { drainSeconds: options.drainSeconds }),
              slots:
                options.workers === true
                  ? { '*': 4 }
                  : Object.fromEntries(options.workers.queues.map((queue) => [queue, 4])),
              ...(options.workers === true || options.workers.capabilities === undefined
                ? {}
                : { capabilities: options.workers.capabilities }),
              ...(options.workers === true || options.workers.egress === undefined
                ? {}
                : { egress: options.workers.egress }),
              probe: (probe: WorkersProbe) => {
                workers.probe = probe;
                probed.resolve();
              },
            },
          }),
      ...(options.env === undefined ? {} : { env: options.env }),
    },
  );
  const { join } = options;
  const backend =
    join === undefined
      ? await runtime.control.createBackend({
          name: 'test',
          app: app.id,
          placement: placementName,
          ...(options.config === undefined ? {} : { config: options.config }),
        })
      : { id: join.backendId, config: options.config };
  const tenants: TestTenant[] = [];
  for (const name of names) {
    const joined = join?.tenants[name];
    if (join !== undefined && joined === undefined) {
      throw new Error(`join names no id for the tenant "${name}"`);
    }
    const pin = (options.tenantApiVersions as Readonly<Record<string, string>> | undefined)?.[name];
    const id =
      joined ??
      (
        await runtime.control.createTenant({
          backendId: backend.id,
          name,
          ...(pin === undefined ? {} : { apiVersion: pin }),
        })
      ).id;
    tenants.push({ name, id });
  }
  // The runtime starts its workers in the background and hands the probe over when they run.
  if (options.workers !== undefined) await probed.promise;
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
    control: { adapter: controlAdapter, namespace: controlNamespace },
    log: environment.log,
    tracer: environment.tracer,
    tenants: Object.fromEntries(tenants.map((tenant) => [tenant.name, tenant])) as Record<
      Name,
      TestTenant
    >,
    invoker: runtime.invoker,
    head: app.api?.dates.at(-1) ?? coreApiVersions.dates.at(-1) ?? '',
    drainJobs: () => drainJobs(workers),
    advanceTo: (at) =>
      advanceTo(
        {
          clock,
          pin: (instant) => {
            pinned = instant;
          },
          workers,
        },
        at,
      ),
    revoke: (subject) => {
      book.revoked.add(subject);
    },
    stop: (deadlineMs = 0) => runtime.stop(deadlineMs),
  };
}
