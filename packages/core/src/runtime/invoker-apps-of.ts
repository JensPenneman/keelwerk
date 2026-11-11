import type { InvokerApp } from '../invoker/invoker-app.ts';
import { moduleConfigShapes } from '../invoker/module-config-shapes.ts';
import type { Clock } from '../kernel/clock.ts';
import type { RuntimeLiveHub } from '../live/runtime-live-hub.ts';
import type { Logger } from '../observability/logger.ts';
import { liveHubFillerOf } from './live-hub-filler-of.ts';
import type { ServedApp } from './served-app.ts';

/**
 * The invoker's view of each served app. Each runtime opens its own hub for each app it serves, so two
 * runtimes of one app share nothing; every hub opened is added to `hubs`, which the stop phase closes.
 */
export function invokerAppsOf(
  served: readonly ServedApp[],
  input: { readonly clock: Clock; readonly log: Logger; readonly hubs: RuntimeLiveHub[] },
): Map<string, InvokerApp> {
  return new Map<string, InvokerApp>(
    served.map((app) => {
      const hub = liveHubFillerOf(app.registry)?.open({
        clock: input.clock,
        log: input.log.child({ app: app.id }),
      });
      if (hub !== undefined) input.hubs.push(hub);
      return [
        app.id,
        {
          registry: app.registry,
          head: app.head,
          ...(app.source.api === null || app.source.api === undefined
            ? {}
            : { api: app.source.api }),
          configShapes: moduleConfigShapes(app.source.modules),
          ...(hub === undefined ? {} : { liveHub: hub }),
        },
      ];
    }),
  );
}
