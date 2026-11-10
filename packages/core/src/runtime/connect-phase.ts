import { trace } from '@opentelemetry/api';
import { hybridClock } from '../clock/hybrid-clock.ts';
import { serverNodeId } from '../clock/server-node-id.ts';
import { createComputePool } from '../compute/create-compute-pool.ts';
import { controlNamespace } from '../control/control-namespace.ts';
import { createControlStore } from '../control/create-control-store.ts';
import { createScopeKeyWrapper } from '../control/create-scope-key-wrapper.ts';
import { findControlRows } from '../control/find-control-rows.ts';
import { loadModuleMigrations } from '../control/load-module-migrations.ts';
import { presumedGoneAfterMs } from '../control/presumed-gone-after-ms.ts';
import { provisionNamespace } from '../control/provision-namespaces.ts';
import { registerPlacements } from '../control/register-placements.ts';
import { registerProcess } from '../control/register-process.ts';
import { resolveDeploymentId } from '../control/resolve-deployment-id.ts';
import { withScopeKeys } from '../control/scope-keys.ts';
import type { EnvRef } from '../dsl/env.ts';
import { sealingAdapter } from '../encryption/sealing-adapter.ts';
import { errors } from '../errors/errors.ts';
import { buildIdentity } from '../events/build-identity.ts';
import type { PlacementHandle } from '../invoker/placement-handle.ts';
import type { ScopeLookup } from '../invoker/scope-lookup.ts';
import type { Clock } from '../kernel/clock.ts';
import type { ComputePool } from '../kernel/compute-pool.ts';
import { createKeyService } from '../keys/create-key-service.ts';
import { defaultRandomSource } from '../keys/default-random-source.ts';
import type { ForkableKeyService } from '../keys/forkable-key-service.ts';
import type { Logger } from '../observability/logger.ts';
import type { AdapterCapabilities } from '../storage/adapter-capabilities.ts';
import type { AdapterEnvironment } from '../storage/adapter-environment.ts';
import type { DataAdapter } from '../storage/data-adapter.ts';
import type { DataAdapterFactory } from '../storage/data-adapter-factory.ts';
import type { PlacementConfig } from '../storage/placement-config.ts';
import { buildManifestOf } from './build-manifest-of.ts';
import type { Composed } from './compose-phase.ts';
import type { Connected } from './connected.ts';
import type { DeploymentDefinition } from './deployment-definition.ts';
import { masterKeySourceOf } from './master-key-source-of.ts';
import type { RuntimeOptions } from './runtime-options.ts';
import { secretResolverOf } from './secret-resolver-of.ts';
import type { ServedApp } from './served-app.ts';

/** The member of a placement or control entry, as `PlacementConfig` takes it. */
function placementConfigOf(
  id: string,
  entry: { readonly adapter: string; readonly [member: string]: unknown },
  env: Readonly<Record<string, string | undefined>>,
): PlacementConfig {
  const { adapter: _adapter, url, strategy, apps, naming, pool, ...rest } = entry;
  let resolved: string | undefined;
  if (typeof url === 'string') resolved = url;
  else if (typeof url === 'object' && url !== null && Reflect.get(url, 'kind') === 'env') {
    const name = (url as EnvRef).name;
    resolved = env[name];
    if (resolved === undefined) {
      throw errors.validation(
        `The url of "${id}" reads the environment variable ${name}, which is not set.`,
      );
    }
  }
  const known = ['shared-tables', 'schema-per-tenant', 'database-per-tenant'] as const;
  return {
    id,
    strategy: known.find((candidate) => candidate === strategy) ?? 'shared-tables',
    ...(resolved === undefined ? {} : { url: resolved }),
    ...(Array.isArray(apps) ? { apps: apps as readonly string[] } : {}),
    ...(typeof naming === 'object' && naming !== null
      ? { naming: naming as NonNullable<PlacementConfig['naming']> }
      : {}),
    ...(typeof pool === 'object' && pool !== null
      ? { pool: pool as NonNullable<PlacementConfig['pool']> }
      : {}),
    options: rest,
  };
}

function factoryFor(composed: Composed, adapter: string): DataAdapterFactory {
  const factory = composed.infrastructure.adapters.get(adapter);
  if (factory === undefined) {
    throw errors.validation(
      `No infrastructure entry provides the data adapter "${adapter}"; list its factory in the deployment's infrastructure.`,
    );
  }
  return factory;
}

/** What `connect` is given. */
export interface ConnectInput {
  readonly deployment: DeploymentDefinition;
  readonly options: RuntimeOptions;
  readonly composed: Composed;
  readonly served: readonly ServedApp[];
  readonly log: Logger;
  readonly clock: Clock;
  readonly signal: AbortSignal;
}

/**
 * `connect` (section 3.3): the secrets and the master key, the identity of this process (node id,
 * build), the control adapter and the key service over it, the control namespace, the placements
 * the process opens, and `core.placement` and `core.process`. A single-process adapter refuses a
 * second live process. Everything opened is closed again when a step fails.
 */
export async function connectPhase(input: ConnectInput): Promise<Connected> {
  const { deployment, composed, served, log, clock } = input;
  const secrets = secretResolverOf(
    composed.infrastructure.secretProviders,
    input.options.env ?? {},
    log,
  );
  const master = await masterKeySourceOf(deployment.keys?.masterKey, secrets);
  const controlConfig = placementConfigOf('control', deployment.control, input.options.env ?? {});
  const nodeId = serverNodeId(globalThis.crypto.getRandomValues(new Uint8Array(8)));
  const processClock = hybridClock(nodeId);
  const modules = [
    ...new Map(
      served.flatMap((app) => app.source.modules).map((module) => [module.id, module]),
    ).values(),
  ];
  const { planner } = composed.infrastructure;
  const selections = served.map((app) => app.source.modules.map((module) => module.id));
  const tracks =
    planner === undefined ? [] : await loadModuleMigrations(planner, modules, selections);
  const build = buildIdentity(
    buildManifestOf({
      modules,
      tracks,
      apps: served.map((app) => ({ id: app.id, head: app.head, dates: app.source.api?.dates })),
    }),
  );

  const base = {
    log,
    tracer: trace.getTracer('keelwerk'),
    secrets,
    signal: input.signal,
    clock,
  };
  const controlRegistry = served[0]?.registry;
  if (controlRegistry === undefined) throw errors.internal('The process serves no app.');
  const deploymentId = await resolveDeploymentId({
    factory: factoryFor(composed, deployment.control.adapter),
    config: controlConfig,
    environment: base,
    namespace: controlNamespace('control'),
    planner,
    registry: controlRegistry,
    adapterName: deployment.control.adapter,
  });

  let keys: ForkableKeyService | undefined;
  let directory: ScopeLookup | undefined;
  const keyWrapper = createScopeKeyWrapper({
    keys: () => {
      if (keys === undefined) throw errors.internal('The key service is not open yet.');
      return keys;
    },
    directory: () => {
      if (directory === undefined) throw errors.internal('The scope directory is not open yet.');
      return directory;
    },
    deploymentId,
    random: defaultRandomSource,
  });
  const environment: AdapterEnvironment = {
    ...base,
    deploymentId,
    keyWrapper,
  };

  const opened: DataAdapter[] = [];
  let pool: ComputePool | undefined;
  const closeAll = async (): Promise<void> => {
    await Promise.allSettled([...opened.map((adapter) => adapter.close(0)), pool?.close()]);
  };
  try {
    const controlAdapter = factoryFor(composed, deployment.control.adapter).create(
      controlConfig,
      environment,
    );
    opened.push(controlAdapter);
    const controlCapabilities = await controlAdapter.connect();
    const recordFallbacks = (placement: string, capabilities: AdapterCapabilities): void => {
      for (const row of composed.infrastructure.fallbackReporter?.report(capabilities) ?? []) {
        log.info('the adapter lacks a capability; the kernel path runs in its place', {
          placement,
          capability: row.capability,
          path: row.path,
          cost: row.cost,
        });
      }
    };
    recordFallbacks('control', controlCapabilities);
    const namespace = controlNamespace('control');
    keys = createKeyService({
      master,
      deploymentId,
      withScopeKeys: withScopeKeys(controlAdapter, namespace),
      clock,
      log,
    });
    const compute = createComputePool();
    pool = compute;
    const registry = controlRegistry;
    if (planner !== undefined) {
      await provisionNamespace({
        adapter: controlAdapter,
        namespace,
        planner,
        registry,
        level: 'control',
        jobGroups: [],
      });
    } else if (controlCapabilities.dialect !== 'memory') {
      throw errors.validation(
        `The control adapter "${deployment.control.adapter}" needs the schema planner in the deployment's infrastructure to create the control namespace.`,
      );
    }
    const control = createControlStore({
      adapter: controlAdapter,
      capabilities: controlCapabilities,
      namespace,
      registry,
      deploymentId,
      clock,
      keys,
      compute,
      log,
      hybridClock: processClock,
      build,
    });

    const placements = new Map<string, PlacementHandle>();
    for (const [name, entry] of Object.entries(deployment.placements)) {
      const adapter = factoryFor(composed, entry.adapter).create(
        placementConfigOf(name, entry, input.options.env ?? {}),
        environment,
      );
      opened.push(adapter);
      const capabilities = await adapter.connect();
      recordFallbacks(name, capabilities);
      // The kernel reaches a placement through the sealing layer: personal values are sealed and
      // queried by tag on the way to the adapter (14.7.9).
      const sealing = keys;
      if (sealing === undefined) throw errors.internal('The key service is not open.');
      placements.set(name, {
        adapter: sealingAdapter(adapter, {
          keys: sealing,
          maxScan: capabilities.encryptedQueries.maxScan,
          describe: (namespace, ref) =>
            served.find((app) => app.id === namespace.appId)?.registry.entities.get(ref)
              ?.descriptor,
        }),
        capabilities,
      });
    }
    const placementIds = await registerPlacements(control, deployment.placements);

    const single = [
      controlCapabilities,
      ...[...placements.values()].map((handle) => handle.capabilities),
    ].some((capabilities) => capabilities?.processes === 'single');
    if (single) {
      const rows = await findControlRows(control, 'core.process', {});
      const now = clock.now().epochMilliseconds;
      const live = rows.some((row) => {
        if (row.state === 'stopped') return false;
        const beat = row.heartbeatAt;
        return (
          !(beat instanceof Temporal.Instant) || now - beat.epochMilliseconds < presumedGoneAfterMs
        );
      });
      if (live) {
        throw errors.unavailable(
          'A placement of this deployment runs in one process only, and another process is registered.',
        );
      }
    }
    const roles =
      input.options.role === 'all' ? (['serve', 'work'] as const) : ([input.options.role] as const);
    const processId = await registerProcess(control, { node: nodeId, roles });
    if (keys === undefined) throw errors.internal('The key service is not open.');
    return {
      deploymentId,
      nodeId,
      hybridClock: processClock,
      build,
      secrets,
      keys,
      compute,
      control,
      placements,
      placementIds,
      tracks,
      processId,
      log,
      signal: input.signal,
      adapters: opened,
      bindDirectory: (bound) => {
        directory = bound;
      },
    };
  } catch (error) {
    await closeAll();
    throw error;
  }
}
