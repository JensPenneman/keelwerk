import { connectRewindCheck } from '../anchors/connect-rewind-check.ts';
import { startAnchoring } from '../anchors/start-anchoring.ts';
import { latestTenantEntry } from '../control/latest-tenant-entry.ts';
import { setProcessState } from '../control/set-process-state.ts';
import { coreApiVersions } from '../core-module/core-api-versions.ts';
import { defineApp } from '../dsl/define-app.ts';
import { answerExplain } from '../explain/answer-explain.ts';
import { explainStream } from '../explain/explain-stream.ts';
import { createFlagChain } from '../flags/create-flag-chain.ts';
import { createInvoker } from '../invoker/create-invoker.ts';
import type { InvokerApp } from '../invoker/invoker-app.ts';
import type { InvokerOptions } from '../invoker/invoker-options.ts';
import { moduleConfigShapes } from '../invoker/module-config-shapes.ts';
import { createOperatorTokenResolver } from '../principals/operator-token-resolver.ts';
import type { ApiSurface } from '../surface/api-surface.ts';
import { deriveSurface } from '../surface/derive-surface.ts';
import type { SurfaceSource } from '../surface/surface-source.ts';
import { createCommandRunner } from '../write-path/create-command-runner.ts';
import { anchorScopes } from './anchor-scopes.ts';
import { answerRuntimeQueries } from './answer-runtime-queries.ts';
import { composePhase } from './compose-phase.ts';
import { connectPhase } from './connect-phase.ts';
import { createControlPath } from './create-control-path.ts';
import { createRuntimeControl } from './create-runtime-control.ts';
import { defaultLogger } from './default-logger.ts';
import type { DeploymentDefinition } from './deployment-definition.ts';
import { drainingInvoker } from './draining-invoker.ts';
import { listenPhase } from './listen-phase.ts';
import type { Listening } from './listening.ts';
import { migratePhase } from './migrate-phase.ts';
import { refuseUnknownApiVersion } from './refuse-unknown-api-version.ts';
import { registerTelemetry } from './register-telemetry.ts';
import { routeControlCommands } from './route-control-commands.ts';
import type { Runtime } from './runtime.ts';
import { runtimeEnvironment } from './runtime-environment.ts';
import type { RuntimeOptions } from './runtime-options.ts';
import { setupPhase } from './setup-phase.ts';
import type { Started } from './start-phase.ts';
import { startPhase } from './start-phase.ts';
import { stopPhase } from './stop-phase.ts';

/**
 * The core's one boot entry point (section 3.3, S-49): runs `compose`, `setup`, `connect`,
 * `migrate`, `start` and `listen` in order and answers the running process; `stop` is the drain.
 * A phase that fails closes what the earlier ones opened and rethrows. With `listen: false` the
 * process connects and migrates only (the CLI's project mode, tests).
 */
export async function startRuntime(
  deployment: DeploymentDefinition,
  options: RuntimeOptions,
): Promise<Runtime> {
  const log = options.logger ?? defaultLogger;
  const clock = options.clock ?? { now: () => Temporal.Now.instant() };
  const environment = runtimeEnvironment(options);
  const development = environment !== 'production';
  const flushTelemetry = await registerTelemetry({
    telemetry: deployment.telemetry,
    env: options.env ?? {},
    log,
  });

  log.debug('phase', { phase: 'compose' });
  const composed = composePhase(deployment, options);
  log.debug('phase', { phase: 'setup' });
  const served = setupPhase(composed.apps);
  const abort = new AbortController();
  log.debug('phase', { phase: 'connect' });
  const connected = await connectPhase({
    deployment,
    options,
    composed,
    served,
    log,
    clock,
    signal: abort.signal,
  });
  let started: Started | undefined;
  try {
    log.debug('phase', { phase: 'migrate' });
    const migrated = await migratePhase({ deployment, composed, served, connected, development });
    const rewound = await connectRewindCheck(composed.infrastructure.ledgers, (wanted) =>
      anchorScopes(connected, migrated, wanted),
    );
    for (const scopeId of rewound) {
      log.error('a scope is behind its newest anchor: the database may have been restored', {
        scope: scopeId,
      });
    }

    const apps = new Map<string, InvokerApp>(
      served.map((app) => [
        app.id,
        {
          registry: app.registry,
          head: app.head,
          ...(app.source.api === null || app.source.api === undefined
            ? {}
            : { api: app.source.api }),
          configShapes: moduleConfigShapes(app.source.modules),
        },
      ]),
    );
    const sole = served.length === 1 ? served[0] : undefined;
    apps.set('core', {
      registry: sole?.registry ?? connected.control.registry,
      head: coreApiVersions.dates.at(-1) ?? '',
      api: coreApiVersions,
    });
    const controlPath = createControlPath({ deployment, served, connected, migrated });
    const invokerOptions: InvokerOptions = {
      apps,
      directory: migrated.directory.lookup,
      placement: (name) => connected.placements.get(name),
      control: {
        scope: { level: 'deployment' },
        namespace: connected.control.namespace,
        handle: {
          adapter: connected.control.adapter,
          capabilities: connected.control.capabilities,
        },
      },
      ...(deployment.tenantResolution === undefined
        ? {}
        : { tenantResolution: deployment.tenantResolution }),
      clock,
      epochOf: (scope) => connected.control.epochOf(scope),
      operatorTokens: createOperatorTokenResolver(connected.control),
      tenantEntry: (tenantId, actor) => latestTenantEntry(connected.control, tenantId, actor),
      operatorHosts: deployment.operator?.hosts ?? [],
      keys: connected.keys,
      compute: connected.compute,
      log,
      environment,
      flagProviders: createFlagChain({
        providers: composed.infrastructure.flagProviders,
        environment,
        env: options.env ?? {},
      }),
      build: connected.build,
      commands: routeControlCommands(
        createCommandRunner({
          deploymentId: connected.control.deploymentId,
          nodeId: connected.nodeId,
          hybridClock: connected.hybridClock,
        }),
        controlPath,
      ),
    };
    const inner = createInvoker(invokerOptions);
    const servedById = new Map(served.map((app) => [app.id, app]));
    const answering = answerRuntimeQueries(
      refuseUnknownApiVersion(inner, servedById, connected.control, clock),
      servedById,
      connected.control,
      clock,
      invokerOptions,
    );
    // `core.explain` (section 16.9.7) and the explain stream of development (section 11).
    const explaining = explainStream(
      answerExplain(answering, { options: invokerOptions, hybridClock: connected.hybridClock }),
      {
        env: options.env ?? {},
        development,
        write: (line) => log.info(line),
        clock,
      },
    );
    const draining = drainingInvoker(explaining);

    // A deployment-scope session (the operator socket) belongs to the app `core`, which the
    // invoker answers from the one served app, or else from the registry of the control app.
    const coreHead = coreApiVersions.dates.at(-1) ?? '';
    let coreApp: SurfaceSource | undefined;
    const coreSource = (): SurfaceSource => {
      if (sole !== undefined) return sole.source;
      coreApp ??= defineApp({ id: 'core', modules: [], execution: {}, api: coreApiVersions });
      return coreApp;
    };
    const surface = (appId: string, version?: string): ApiSurface => {
      const app = served.find((candidate) => candidate.id === appId);
      if (app !== undefined) return deriveSurface(app.source, version ?? app.head).surface;
      if (appId !== 'core') {
        throw new RangeError(`The process does not serve app "${appId}".`);
      }
      return deriveSurface(coreSource(), version ?? sole?.head ?? coreHead).surface;
    };

    log.debug('phase', { phase: 'start' });
    const ready = startPhase({
      connected,
      migrated,
      options,
      composed,
      apps: servedById,
      invoker: draining.invoker,
      clock,
    });
    started = ready;
    const anchoring = await startAnchoring({
      deployment,
      connected,
      migrated,
      sinks: composed.infrastructure.ledgers,
      appIds: served.map((app) => app.id),
      clock,
      log,
    });
    log.debug('phase', { phase: 'listen' });
    const listening: Listening = options.listen
      ? await listenPhase({
          entry: composed.infrastructure.hostEntry,
          host: composed.infrastructure.host,
          deployment,
          served,
          invoker: draining.invoker,
          log,
          development,
          deploymentId: connected.deploymentId,
          control: connected.control,
          clock,
          surface,
        })
      : { host: undefined, instance: undefined, mounts: [] };
    await setProcessState(connected.control, connected.processId, 'ready');

    let stopping: Promise<void> | undefined;
    return {
      invoker: draining.invoker,
      surface,
      registry: (appId) => {
        const app = served.find((candidate) => candidate.id === appId);
        if (app === undefined) throw new RangeError(`The process does not serve app "${appId}".`);
        return app.source.registry;
      },
      ...(listening.host === undefined ? {} : { host: listening.host }),
      ...(listening.port === undefined ? {} : { port: listening.port }),
      ...(listening.operatorSocket === undefined
        ? {}
        : { operatorSocket: listening.operatorSocket }),
      control: createRuntimeControl({ path: controlPath, served, connected, migrated, anchoring }),
      stop: (deadlineMs) => {
        log.debug('phase', { phase: 'stop' });
        stopping ??= (async () => {
          const due = performance.now() + deadlineMs;
          await stopPhase(
            {
              connected,
              started: ready,
              draining,
              mounts: listening.mounts,
              host: listening.instance,
              abort,
              anchoring,
            },
            deadlineMs,
          );
          await flushTelemetry(Math.max(0, due - performance.now()));
        })();
        return stopping;
      },
    };
  } catch (error) {
    abort.abort();
    started?.unfollow();
    await setProcessState(connected.control, connected.processId, 'stopped').catch(() => undefined);
    await Promise.allSettled([
      connected.compute.close(),
      ...connected.adapters.map((adapter) => adapter.close(0)),
    ]);
    throw error;
  }
}
