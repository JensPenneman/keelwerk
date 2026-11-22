import { type VersionProjection, versionProjection } from '../api-versions/version-projection.ts';
import { coreApiVersions } from '../core-module/core-api-versions.ts';
import { defineApp } from '../dsl/define-app.ts';
import type { ApiSurface } from '../surface/api-surface.ts';
import { deriveSurface } from '../surface/derive-surface.ts';
import type { SurfaceSource } from '../surface/surface-source.ts';
import { AppNotServedError } from './app-not-served-error.ts';
import type { ServedApp } from './served-app.ts';

/**
 * The surfaces the runtime serves: one for each declared version of each served app, derived at
 * first use and kept, so the host, the transports' mounts and `runtime.surface` serve the same
 * document (hash and ETag included). `sole` is the one served app of a process that serves one.
 * `surface` answers by app id and version; `surfacesOf` answers every version of one app.
 */
export function servedSurfaces(
  served: readonly ServedApp[],
  sole: ServedApp | undefined,
): {
  readonly surface: (appId: string, version?: string) => ApiSurface;
  readonly surfacesOf: (app: ServedApp) => VersionProjection<ApiSurface>;
} {
  // A deployment-scope session (the operator socket) belongs to the app `core`, which the
  // invoker answers from the one served app, or else from the registry of the control app.
  const coreHead = coreApiVersions.dates.at(-1) ?? '';
  let coreApp: SurfaceSource | undefined;
  const coreSource = (): SurfaceSource => {
    if (sole !== undefined) return sole.source;
    coreApp ??= defineApp({ id: 'core', modules: [], execution: {}, api: coreApiVersions });
    return coreApp;
  };
  // One surface per declared version of each app, derived at first use and kept, so the host, the
  // transports' mounts and `runtime.surface` serve the same document (hash and ETag included).
  const projections = new Map<string, VersionProjection<ApiSurface>>();
  const datesOf = (app: ServedApp): readonly string[] => app.source.api?.dates ?? [app.head];
  const projectionOf = (
    id: string,
    source: SurfaceSource,
    versions: readonly string[],
  ): VersionProjection<ApiSurface> => {
    let projection = projections.get(id);
    if (projection === undefined) {
      projection = versionProjection(versions, (version) => deriveSurface(source, version).surface);
      projections.set(id, projection);
    }
    return projection;
  };
  const surface = (appId: string, version?: string): ApiSurface => {
    const app = served.find((candidate) => candidate.id === appId);
    if (app !== undefined)
      return projectionOf(app.id, app.source, datesOf(app)).at(version ?? app.head);
    if (appId !== 'core') {
      throw new AppNotServedError(appId);
    }
    // A session of the app `core` carries a version of the operator endpoint's own calendar, which
    // the one served app need not declare; both calendars are served.
    const head = sole?.head ?? coreHead;
    const dates = [
      ...new Set([...coreApiVersions.dates, ...(sole?.source.api?.dates ?? [])]),
    ].sort();
    return projectionOf('core', coreSource(), dates).at(version ?? head);
  };

  return { surface, surfacesOf: (app) => projectionOf(app.id, app.source, datesOf(app)) };
}
