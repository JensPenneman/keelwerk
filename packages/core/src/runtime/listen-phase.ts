import { metrics, trace } from '@opentelemetry/api';
import { errors } from '../errors/errors.ts';
import type { Invoker } from '../invoker/invoker.ts';
import type { Logger } from '../observability/logger.ts';
import { deriveSurface } from '../surface/derive-surface.ts';
import type { MountHandle } from '../transport/mount-handle.ts';
import type { TransportHost } from '../transport/transport-host.ts';
import type { ServedApp } from './served-app.ts';

/**
 * `listen` (section 3.3): the HTTP host mounts each app's transports. Every transport of every
 * served app mounts once, at its app's head surface, in development with the `development` audience.
 * Returns the handles `stop` closes.
 */
export async function listenPhase(input: {
  readonly host: TransportHost | undefined;
  readonly served: readonly ServedApp[];
  readonly invoker: Invoker;
  readonly log: Logger;
  readonly development: boolean;
  readonly configOf: (app: string) => (scope: unknown) => unknown;
}): Promise<readonly MountHandle[]> {
  const { host } = input;
  if (host === undefined) {
    if (input.served.some((app) => app.transports.length > 0)) {
      throw errors.validation(
        'The apps mount transports, and the deployment lists no HTTP host (contracts.httpHost) to serve them.',
      );
    }
    return [];
  }
  const handles: MountHandle[] = [];
  for (const app of input.served) {
    const { surface } = deriveSurface(app.source, app.head);
    for (const transport of app.transports) {
      handles.push(
        await transport.mount({
          app: app.id,
          surface,
          invoker: input.invoker,
          host,
          config: input.configOf(app.id) as never,
          telemetry: { tracer: trace.getTracer('keelwerk'), meter: metrics.getMeter('keelwerk') },
          log: input.log.child({ app: app.id, transport: transport.name }),
          ...(input.development ? { development: true } : {}),
        }),
      );
    }
  }
  return handles;
}
