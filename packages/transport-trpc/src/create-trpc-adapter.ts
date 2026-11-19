import type { TransportAdapter } from '@keelwerk/core';
import { checkTrpcSurface } from './check/check-trpc-surface.ts';
import { trpcRouterFragment } from './fragment/trpc-router-fragment.ts';
import { mountTrpc } from './mount/mount-trpc.ts';
import type { TrpcConfig } from './trpc-config.ts';
import type { TrpcStaticOptions } from './trpc-static-options.ts';

/**
 * The tRPC adapter (section 16.7): `check`, the tRPC surface check, the type fragment of the router
 * as its artefact, and `mount`, which builds the router of every API version at `listen` and
 * registers one handler on the host under the path.
 */
export function createTrpcAdapter(
  options: TrpcStaticOptions = {},
): TransportAdapter<TrpcStaticOptions, TrpcConfig> {
  return {
    name: 'trpc',
    capabilities: { streaming: ['sse'], batching: true, binary: false },
    static: options,
    check: (surface) => checkTrpcSurface(surface),
    artifacts: () => [trpcRouterFragment(options)],
    mount: (ctx) => mountTrpc(ctx, options),
  };
}
