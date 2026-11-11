import type { ApiSurface, Artifact, MountContext, VersionProjection } from '@keelwerk/core';
import { versionProjection } from '@keelwerk/core';
import { buildRouteTable } from './build-route-table.ts';
import { checkRestSurface } from './check/check-rest-surface.ts';
import { openApiDocuments } from './openapi-documents.ts';
import { problemPages } from './problem-pages.ts';
import type { RestConfig } from './rest-config.ts';
import type { RestStaticOptions } from './rest-static-options.ts';
import type { RestVersionMount } from './rest-version-mount.ts';

function mountOf(
  surface: ApiSurface,
  options: RestStaticOptions,
  artifacts: (surface: ApiSurface) => readonly Artifact[],
): RestVersionMount {
  const refused = checkRestSurface(surface, options)[0];
  if (refused !== undefined) {
    throw new TypeError(
      `${refused.code}: ${refused.subject}: ${refused.message} (API version ${surface.apiVersion})`,
    );
  }
  return {
    surface,
    table: buildRouteTable(surface, options),
    problem: problemPages(surface),
    documents: openApiDocuments(artifacts(surface)),
  };
}

/**
 * The REST mount of each API version (section 18.2): the route table, problem pages and OpenAPI
 * documents of the surface at that version, built and checked for every declared version at
 * mount, so a version whose surface the REST check refuses fails at start. A context without
 * `surfaces` (a hand-built one) serves its one surface at every version.
 */
export function perVersionMount(
  ctx: MountContext<RestConfig>,
  options: RestStaticOptions,
  artifacts: (surface: ApiSurface) => readonly Artifact[],
): VersionProjection<RestVersionMount> {
  if (ctx.surfaces !== undefined) {
    const { surfaces } = ctx;
    const mounts = versionProjection(surfaces.versions, (version) =>
      mountOf(surfaces.at(version), options, artifacts),
    );
    for (const version of mounts.versions) mounts.at(version);
    return mounts;
  }
  let single: RestVersionMount | undefined;
  return {
    versions: [ctx.surface.apiVersion],
    at: () => {
      single ??= mountOf(ctx.surface, options, artifacts);
      return single;
    },
  };
}
