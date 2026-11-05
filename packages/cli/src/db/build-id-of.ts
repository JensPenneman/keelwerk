import type { SurfaceSource } from '@keelwerk/core';
import { buildIdentity, buildManifestOf, coreApiVersions } from '@keelwerk/core';
import { tracksOfApp } from './tracks-of-app.ts';

/**
 * The build id the deployment's files would run as (section 19.1, S-22): the runtime's own
 * manifest, built from the same inputs `connect` reads (the apps' modules, the tracks they ship,
 * the apps' API versions), so `db apply --contract` compares like with like.
 */
export async function buildIdOf(apps: readonly SurfaceSource[]): Promise<string> {
  const modules = [
    ...new Map(apps.flatMap((app) => app.modules).map((module) => [module.id, module])).values(),
  ];
  const tracks = (await Promise.all(apps.map((app) => tracksOfApp(app)))).flat();
  return buildIdentity(
    buildManifestOf({
      modules,
      tracks,
      apps: apps.map((app) => ({
        id: app.id,
        head: app.api?.dates.at(-1) ?? coreApiVersions.dates.at(-1) ?? '',
        dates: app.api?.dates,
      })),
    }),
  ).id;
}
