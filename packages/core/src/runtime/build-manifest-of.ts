import { sha256 } from '../crypto/sha256.ts';
import type { BuildManifest } from '../events/build-identity.ts';
import { canonicalizeJson } from '../json/canonicalize-json.ts';
import type { AnyModule } from '../model/any-module.ts';
import { runtimeModule } from '../registry/runtime-module.ts';
import { version } from '../version.ts';
import type { SchemaTrack } from './schema-planner.ts';

/** What the build id reads of an app: its id, its head API version and the API versions it declares, if any. */
export interface BuildIdApp {
  readonly id: string;
  readonly head: string;
  readonly dates: readonly string[] | undefined;
}

/**
 * The manifest a build is identified by (section 19.1, S-22): the package versions of the core and of every module,
 * a checksum of each migration track's files, and the API versions of each app. `connect` derives
 * the process's build id from it, and `db apply --contract` derives the id from the same inputs.
 */
export function buildManifestOf(input: {
  readonly modules: readonly AnyModule[];
  readonly tracks: readonly SchemaTrack[];
  readonly apps: readonly BuildIdApp[];
}): BuildManifest {
  return {
    packages: {
      '@keelwerk/core': version,
      ...Object.fromEntries(
        input.modules.map((module) => [module.id, runtimeModule(module).version]),
      ),
    },
    migrations: Object.fromEntries(
      input.tracks.map((track) => [
        track.track,
        sha256(
          canonicalizeJson(
            track.files.map((file) => [file.id, sha256(canonicalizeJson(file.steps))]),
          ),
        ),
      ]),
    ),
    apiVersions: Object.fromEntries(input.apps.map((app) => [app.id, app.dates ?? [app.head]])),
  };
}
