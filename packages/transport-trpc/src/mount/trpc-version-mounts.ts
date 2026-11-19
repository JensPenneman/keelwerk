import {
  type ApiSurface,
  type MountContext,
  type VersionProjection,
  versionProjection,
} from '@keelwerk/core';
import { buildTrpcRouter } from '../router/build-trpc-router.ts';
import type { TrpcConfig } from '../trpc-config.ts';
import type { TrpcStaticOptions } from '../trpc-static-options.ts';
import type { TrpcVersionMount } from './trpc-version-mount.ts';

function mountOf(
  surface: ApiSurface,
  options: TrpcStaticOptions,
  development: boolean,
): TrpcVersionMount {
  return { surface, router: buildTrpcRouter(surface, options, development) };
}

/**
 * The tRPC mount of each API version (section 18.2): the router of the surface at that version,
 * built for every declared version at mount, so a version whose surface the tRPC check refuses fails
 * at start. A context without `surfaces` (a hand-built one) serves its one surface at every version.
 */
export function trpcVersionMounts(
  ctx: MountContext<TrpcConfig>,
  options: TrpcStaticOptions,
): VersionProjection<TrpcVersionMount> {
  const development = ctx.development === true;
  if (ctx.surfaces !== undefined) {
    const { surfaces } = ctx;
    const mounts = versionProjection(surfaces.versions, (version) =>
      mountOf(surfaces.at(version), options, development),
    );
    for (const version of mounts.versions) mounts.at(version);
    return mounts;
  }
  const head = mountOf(ctx.surface, options, development);
  return { versions: [ctx.surface.apiVersion], at: () => head };
}
