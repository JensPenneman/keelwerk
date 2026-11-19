import type { Artifact } from '@keelwerk/core';
import type { TrpcStaticOptions } from '../trpc-static-options.ts';

/**
 * The type fragment of the transport (section 16.7.6, S-128): `export type TrpcRouter =
 * TrpcRouterOf<App>` in the app's generated file, with the `false` transformer argument for an app
 * that turns superjson off.
 */
export function trpcRouterFragment(
  options: TrpcStaticOptions,
): Extract<Artifact, { kind: 'type-fragment' }> {
  const json = options.transformer === 'json';
  return {
    kind: 'type-fragment',
    module: '@keelwerk/transport-trpc',
    names: ['TrpcRouterOf'],
    content: `export type TrpcRouter = TrpcRouterOf<App${json ? ', false' : ''}>`,
  };
}
