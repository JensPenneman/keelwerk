import type { ApiVersions } from '../dsl/define-api-versions.ts';
import { KeelwerkError } from '../errors/keelwerk-error.ts';
import { acceptsVersion } from './accepts-version.ts';
import { servedTargetOf } from './served-target-of.ts';

/** A retired version and the version its pins move to: the oldest served version newer than it (`servedTargetOf`). */
export interface RetiredVersion {
  readonly version: string;
  readonly floor: string;
}

/**
 * Pure. `version` is retired when `resolveVersion({ dates, versions, requested: version, today })`
 * throws `core.api_version_retired`; then answers its target as `floor`: the oldest declared date
 * newer than `version` that `resolveVersion` accepts (the head when none), which lies above an older
 * version whose sunset was extended. Refuses: a version it accepts (deprecated before
 * its sunset, or never deprecated) with `core.conflict` (409), details `{ version, sunset? }`;
 * `core.api_version_unknown` / `_invalid` as `resolveVersion` throws them; an app without declared
 * versions with `core.api_version_unknown`.
 */
export function retireVersion(
  api: ApiVersions | null | undefined,
  version: string,
  today: string,
): RetiredVersion {
  if (api === null || api === undefined) {
    throw new KeelwerkError({
      kind: 'validation',
      code: 'core.api_version_unknown',
      message: `'${version}' is not an API version of this app.`,
      details: { version },
    });
  }
  if (acceptsVersion(api, version, today)) {
    const sunset = api.versions[version]?.deprecated?.sunset;
    throw new KeelwerkError({
      kind: 'conflict',
      code: 'core.conflict',
      message:
        sunset === undefined
          ? `The API version '${version}' is not deprecated.`
          : `The API version '${version}' is served until ${sunset}.`,
      details: { version, ...(sunset === undefined ? {} : { sunset }) },
    });
  }
  return { version, floor: servedTargetOf(api, version, today) };
}
