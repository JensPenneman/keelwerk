import type { TransportAdapter } from '@keelwerk/core';
import { checkOrpcSurface } from './check/check-orpc-surface.ts';
import { mountOrpc } from './mount/mount-orpc.ts';
import type { OrpcConfig } from './orpc-config.ts';
import { orpcFragment } from './orpc-fragment.ts';
import type { OrpcStaticOptions } from './orpc-static-options.ts';

/**
 * The oRPC adapter (section 16.7.7): `check`, the oRPC surface check, the type fragment with the
 * typed client tree of the app as its artefact, and `mount`, which builds the router of every API
 * version at `listen` and registers the handlers on the host. Streaming is server-sent events;
 * there is no batching and no binary transport.
 */
export function createOrpcAdapter(
  options: OrpcStaticOptions = {},
): TransportAdapter<OrpcStaticOptions, OrpcConfig> {
  return {
    name: 'orpc',
    capabilities: { streaming: ['sse'], batching: false, binary: false },
    static: options,
    check: (surface) => checkOrpcSurface(surface),
    artifacts: () => [orpcFragment(options)],
    mount: (ctx) => mountOrpc(ctx, options),
  };
}
