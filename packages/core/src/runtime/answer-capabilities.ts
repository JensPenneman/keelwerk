import type { ApiVersions } from '../dsl/define-api-versions.ts';
import type { CapabilitiesDocument } from '../invoker/capabilities-document.ts';

/**
 * The answer of `core.capabilities` (section 18.7): the protocol majors this release serves and
 * the app's API versions (its head alone for an app that declares none) with their status on `today` (`YYYY-MM-DD`, UTC). A version whose sunset
 * has passed is `retired`; one whose deprecation date has come is `deprecated`.
 */
export function answerCapabilities(
  api: ApiVersions | null | undefined,
  head: string,
  today: string,
): CapabilitiesDocument {
  if (api === null || api === undefined || api.dates.length === 0) {
    return { protocols: { invocation: [1] }, apiVersions: [{ version: head, status: 'current' }] };
  }
  return {
    protocols: { invocation: [1] },
    apiVersions: api.dates.map((version) => {
      const deprecated = api.versions[version]?.deprecated;
      if (deprecated === undefined || today < deprecated.at) {
        return { version, status: 'current' as const };
      }
      return {
        version,
        status: today > deprecated.sunset ? ('retired' as const) : ('deprecated' as const),
        deprecated: { at: deprecated.at, sunset: deprecated.sunset },
      };
    }),
  };
}
