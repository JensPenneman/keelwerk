import { sha256 } from '../crypto/sha256.ts';
import { canonicalizeJson } from '../json/canonicalize-json.ts';

/** What a build is identified by (S-22): package versions, migration checksums per track and API versions. */
export interface BuildManifest {
  /** Package name to exact version. */
  readonly packages: Readonly<Record<string, string>>;
  /** Migration track to the checksum of its applied files. */
  readonly migrations: Readonly<Record<string, string>>;
  /** App id to that app's API versions (section 19.1). */
  readonly apiVersions: Readonly<Record<string, readonly string[]>>;
}

/** The `writer` of an event before it is renamed into the envelope: the build id and its revision. */
export interface BuildIdentity {
  readonly id: string;
  readonly revision: number;
}

/**
 * The identity a process writes events with (S-22): the build id is the SHA-256 of the canonical
 * build manifest, so the same build has the same id on every machine, and the revision is 1 until
 * rollouts exist (M4).
 */
export function buildIdentity(manifest: BuildManifest, revision = 1): BuildIdentity {
  return {
    id: sha256(
      canonicalizeJson({
        packages: manifest.packages,
        migrations: manifest.migrations,
        apiVersions: Object.fromEntries(
          Object.entries(manifest.apiVersions).map(([app, versions]) => [
            app,
            [...versions].sort(),
          ]),
        ),
      }),
    ),
    revision,
  };
}
