import { startAnchoring } from '../anchors/start-anchoring.ts';
import { setProcessState } from '../control/set-process-state.ts';
import { coreApiVersions } from '../core-module/core-api-versions.ts';
import { answerExplain } from '../explain/answer-explain.ts';
import { explainDecisions } from '../explain/explain-decisions.ts';
import { explainStream } from '../explain/explain-stream.ts';
import { createFlagChain } from '../flags/create-flag-chain.ts';
import { startFlagProviders } from '../flags/start-flag-providers.ts';
import { createTargetingCache } from '../flags/targeting-cache.ts';
import { createInvoker } from '../invoker/create-invoker.ts';
import { liveTimersOf } from '../live/live-timers-of.ts';
import type { RuntimeLiveHub } from '../live/runtime-live-hub.ts';
import { createConcurrencyLeases } from '../quotas/concurrency-leases.ts';
import { createConnectionSlot } from '../quotas/connection-slot.ts';
import { answerRuntimeQueries } from './answer-runtime-queries.ts';
import { AppNotServedError } from './app-not-served-error.ts';
import { composePhase } from './compose-phase.ts';
import { connectPhase } from './connect-phase.ts';
import { connectWhileUnavailable } from './connect-while-unavailable.ts';
import { createControlPath } from './create-control-path.ts';
import { createRuntimeControl } from './create-runtime-control.ts';
import { createServiceGate } from './create-service-gate.ts';
import { defaultLogger } from './default-logger.ts';
import type { DeploymentDefinition } from './deployment-definition.ts';
import { drainingInvoker } from './draining-invoker.ts';
import { invokerAppsOf } from './invoker-apps-of.ts';
import { invokerOptionsOf } from './invoker-options-of.ts';
import { listenPhase } from './listen-phase.ts';
import type { Listening } from './listening.ts';
import { migratePhase } from './migrate-phase.ts';
import { refuseUnknownApiVersion } from './refuse-unknown-api-version.ts';
import { registerTelemetry } from './register-telemetry.ts';
import { restoreCheck } from './restore-check.ts';
import type { Runtime } from './runtime.ts';
import { runtimeEnvironment } from './runtime-environment.ts';
import type { RuntimeOptions } from './runtime-options.ts';
import { servedRegistry } from './served-registry.ts';
import { servedSurfaces } from './served-surfaces.ts';
import { setupPhase } from './setup-phase.ts';
import type { Started } from './start-phase.ts';
import { startPhase } from './start-phase.ts';
import { startQuotaCache } from './start-quota-cache.ts';
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
  const hubs: RuntimeLiveHub[] = [];
  try {
    log.debug('phase', { phase: 'migrate' });
    const migrated = await migratePhase({ deployment, composed, served, connected, development });
    const quotas = await startQuotaCache({
      deployment,
      connected,
      clock,
      log,
      signal: options.signal,
    });
    const restore = await restoreCheck({
      connected,
      migrated,
      served,
      sinks: composed.infrastructure.ledgers,
      quotas,
      clock,
      log,
    });

    // Each runtime opens its own hub for each app it serves, so two runtimes of one app share nothing.
    const apps = invokerAppsOf(served, { clock, log, hubs });
    const sole = served.length === 1 ? served[0] : undefined;
    apps.set('core', {
      registry: sole?.registry ?? servedRegistry(connected.control.registry),
      head: coreApiVersions.dates.at(-1) ?? '',
      api: coreApiVersions,
    });
    const leases = createConcurrencyLeases({
      holder: connected.processId,
      run: (fn) => connected.control.writeLeases(fn),
    });
    const streamOptions = {
      env: options.env ?? {},
      development,
      write: (line: string) => log.info(line),
      clock,
    };
    const decisions = explainDecisions(streamOptions);
    const targeting = createTargetingCache({
      flags: connected.control.flags,
      clock,
      log,
      signal: connected.signal,
    });
    // No process serves before the first load of the rows: a kill switch must not read open for it.
    await connectWhileUnavailable('control', () => targeting.firstLoad(), {
      log,
      signal: options.signal,
    });
    const flagProviders = createFlagChain({
      providers: composed.infrastructure.flagProviders,
      environment,
      env: options.env ?? {},
      targeting: targeting.provider,
    });
    startFlagProviders(flagProviders, connected.signal, log);
    const flagSources = { providers: flagProviders, targeting };
    const controlPath = createControlPath({
      deployment,
      served,
      connected,
      migrated,
      quotas,
      flagSources,
    });
    const invokerOptions = invokerOptionsOf({
      deployment,
      connected,
      migrated,
      served,
      apps,
      controlPath,
      restoreHold: restore.hold,
      decisions,
      flagProviders,
      targeting,
      quotas,
      leases,
      environment,
      clock,
      log,
    });
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
      { ...streamOptions, ...(decisions === undefined ? {} : { decisions }) },
    );
    const gate = createServiceGate();
    const draining = drainingInvoker(explaining, gate);
    void gate.whenClosed.then(() =>
      setProcessState(connected.control, connected.processId, 'draining').catch(
        (error: unknown) => {
          log.warn('the process could not be marked draining', { cause: error });
        },
      ),
    );

    const { surface, surfacesOf } = servedSurfaces(served, sole);

    log.debug('phase', { phase: 'start' });
    const ready = startPhase({
      connected,
      migrated,
      options,
      composed,
      apps: servedById,
      invoker: draining.invoker,
      clock,
      quotas,
      leases,
      flagProviders,
      targeting,
      gate,
      restoreHold: restore.hold,
    });
    started = ready;
    const anchoring = await startAnchoring({
      deployment,
      connected,
      migrated,
      sinks: composed.infrastructure.ledgers,
      anchors: restore.anchors,
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
          timers: options.timers ?? liveTimersOf(clock),
          holdConnection: createConnectionSlot({
            leases,
            quotas,
            registryOf: (appId) =>
              served.find((app) => app.id === appId)?.registry ?? connected.control.registry,
          }),
          surface,
          surfaces: surfacesOf,
        })
      : { host: undefined, instance: undefined, mounts: [] };
    await setProcessState(connected.control, connected.processId, 'ready');

    let stopping: Promise<void> | undefined;
    return {
      invoker: draining.invoker,
      outOfService: gate.outOfService,
      surface,
      registry: (appId) => {
        const app = served.find((candidate) => candidate.id === appId);
        if (app === undefined) throw new AppNotServedError(appId);
        return app.source.registry;
      },
      ...(listening.host === undefined ? {} : { host: listening.host }),
      ...(listening.port === undefined ? {} : { port: listening.port }),
      ...(listening.operatorSocket === undefined
        ? {}
        : { operatorSocket: listening.operatorSocket }),
      control: createRuntimeControl({
        path: controlPath,
        served,
        connected,
        migrated,
        quotas,
        flagSources,
        anchoring,
      }),
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
              hubs,
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
    await Promise.allSettled(hubs.map((hub) => hub.close(AbortSignal.abort())));
    await setProcessState(connected.control, connected.processId, 'stopped').catch(() => undefined);
    await Promise.allSettled([
      connected.compute.close(),
      ...connected.adapters.map((adapter) => adapter.close(0)),
    ]);
    throw error;
  }
}
