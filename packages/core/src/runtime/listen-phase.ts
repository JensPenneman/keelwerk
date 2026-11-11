import { metrics, trace } from '@opentelemetry/api';
import type { VersionProjection } from '../api-versions/version-projection.ts';
import type { ControlStore } from '../control/control-store.ts';
import { errors } from '../errors/errors.ts';
import type { Invoker } from '../invoker/invoker.ts';
import type { Clock } from '../kernel/clock.ts';
import type { LiveTimers } from '../live/live-timers.ts';
import type { Logger } from '../observability/logger.ts';
import type { ApiSurface } from '../surface/api-surface.ts';
import type { MountHandle } from '../transport/mount-handle.ts';
import type { TransportHost } from '../transport/transport-host.ts';
import { backendConfigs } from './backend-configs.ts';
import type { DeploymentDefinition } from './deployment-definition.ts';
import type { HostEntry, HostInstance } from './host-entry.ts';
import type { Listening } from './listening.ts';
import { liveCarrierOf } from './live-carrier-of.ts';
import type { ServedApp } from './served-app.ts';

function corsOf(config: unknown): readonly string[] {
  const cors =
    typeof config === 'object' && config !== null ? Reflect.get(config, 'cors') : undefined;
  return Array.isArray(cors)
    ? cors.filter((origin): origin is string => typeof origin === 'string')
    : [];
}

/**
 * `listen` (section 3.3): the HTTP host is built from its entry with the runtime's invoker, each
 * app's transports mount once at the app's head surface (in development with the `development`
 * audience) and the host opens its listeners. A host the deployment lists as a ready value is used
 * as it is. Returns the host and the handles `stop` closes.
 */
export async function listenPhase(input: {
  readonly entry: HostEntry | undefined;
  readonly host: TransportHost | undefined;
  readonly deployment: DeploymentDefinition;
  readonly served: readonly ServedApp[];
  readonly invoker: Invoker;
  readonly log: Logger;
  readonly development: boolean;
  readonly deploymentId: string;
  /** The control store the transports' backend configuration is read from (S-70). */
  readonly control: ControlStore;
  readonly clock: Clock;
  readonly timers: LiveTimers;
  readonly surface: (appId: string, version?: string) => ApiSurface;
  /** The app's surface at each declared version: the one the runtime's `surface` serves, so a mount and the host answer the same document. */
  readonly surfaces: (app: ServedApp) => VersionProjection<ApiSurface>;
}): Promise<Listening> {
  const telemetry = { tracer: trace.getTracer('keelwerk'), meter: metrics.getMeter('keelwerk') };
  const configs = backendConfigs(input.control, input.clock);
  const invoker = configs.around(input.invoker);
  const moduleIdOf = (app: ServedApp, name: string, transport: unknown): string =>
    app.registry.fills.get('core.transports')?.find((fill) => fill.fill === transport)?.module ??
    name;
  const instance = input.entry?.create({
    invoker,
    surface: input.surface,
    telemetry,
    log: input.log,
    ...(input.deployment.operator?.socket === undefined
      ? {}
      : { operator: { socket: input.deployment.operator.socket } }),
    allowedOrigins: (session, transportName) => {
      const own = input.served.find((app) => app.id === session.app);
      const domains = configs.domainsOf(session.scope).map((name) => `https://${name}`);
      const transport =
        transportName === undefined
          ? undefined
          : own?.transports.find((candidate) => candidate.name === transportName);
      if (own === undefined || transport === undefined) return domains;
      const cors = corsOf(
        configs.configOf(moduleIdOf(own, transport.name, transport))(session.scope),
      );
      return [...cors, ...domains];
    },
    ready: () => input.control.read(async () => true).catch(() => false),
    liveCarrier: (appId, name) => {
      const own = input.served.find((app) => app.id === appId);
      return own === undefined ? undefined : liveCarrierOf(own.registry, name);
    },
    ...(input.development ? { development: true } : {}),
    clock: input.clock,
    timers: input.timers,
  });
  const host = instance ?? input.host;
  if (host === undefined) {
    if (input.served.some((app) => app.transports.length > 0)) {
      throw errors.validation(
        'The apps mount transports, and the deployment lists no HTTP host (contracts.httpHost) to serve them.',
      );
    }
    return { host: undefined, instance: undefined, mounts: [] };
  }
  const mounts: MountHandle[] = [];
  let bound: Awaited<ReturnType<HostInstance['listen']>> | undefined;
  try {
    for (const app of input.served) {
      const surfaces = input.surfaces(app);
      const surface = surfaces.at(app.head);
      for (const transport of app.transports) {
        mounts.push(
          await transport.mount({
            app: app.id,
            surface,
            surfaces,
            deploymentId: input.deploymentId,
            invoker,
            host,
            config: configs.configOf(moduleIdOf(app, transport.name, transport)) as never,
            telemetry,
            log: input.log.child({ app: app.id, transport: transport.name }),
            ...(input.development ? { development: true } : {}),
            clock: input.clock,
          }),
        );
      }
    }
    bound = await instance?.listen();
  } catch (error) {
    const closed = AbortSignal.abort();
    await Promise.allSettled(mounts.map((mount) => mount.close(closed)));
    await instance?.stop(0).catch(() => undefined);
    throw error;
  }
  return {
    host,
    instance,
    mounts,
    ...(bound?.port === undefined ? {} : { port: bound.port }),
    ...(bound?.operatorSocket === undefined ? {} : { operatorSocket: bound.operatorSocket }),
  };
}
