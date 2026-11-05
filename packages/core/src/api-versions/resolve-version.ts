import type { ApiVersionMap } from '../dsl/define-api-versions.ts';
import { KeelwerkError } from '../errors/keelwerk-error.ts';

const dateFormat = /^\d{4}-\d{2}-\d{2}$/;

function refuse(
  kind: 'validation' | 'not_found',
  code: string,
  message: string,
  version: string,
): never {
  throw new KeelwerkError({ kind, code, message, details: { version } });
}

/** The facts the choice of an API version rests on (section 18.3). */
export interface VersionChoice {
  /** The app's versions, oldest first. */
  readonly dates: readonly string[];
  readonly versions: ApiVersionMap;
  /** The request's own: header, query parameter or hello. */
  readonly requested?: string | undefined;
  /** The credential's pin. */
  readonly credential?: string | undefined;
  /** The tenant's pin, else the backend's default. */
  readonly pinned?: string | undefined;
  /** Today, `YYYY-MM-DD` in UTC. */
  readonly today: string;
}

/** The session's version and, when it is deprecated, the dates the response announces. */
export interface ChosenVersion {
  readonly apiVersion: string;
  readonly deprecation: { readonly at: string; readonly sunset?: string } | null;
}

/**
 * The session's API version: the request's, else the credential's, else the tenant's pin or the
 * backend's default, else the head (section 18.3). Text that is not `YYYY-MM-DD` is
 * `core.api_version_invalid`; a date below the oldest declared version, or past the sunset of its
 * entry, is `core.api_version_retired`; any other date is `core.api_version_unknown`. Pure: the
 * caller supplies today's date.
 */
export function resolveVersion(choice: VersionChoice): ChosenVersion {
  const { dates, versions, today } = choice;
  const head = dates.at(-1) ?? '';
  const apiVersion = choice.requested ?? choice.credential ?? choice.pinned ?? head;
  if (!dateFormat.test(apiVersion)) {
    return refuse(
      'validation',
      'core.api_version_invalid',
      `The API version '${apiVersion}' is not a date of the form YYYY-MM-DD.`,
      apiVersion,
    );
  }
  if (!dates.includes(apiVersion)) {
    const oldest = dates[0] ?? '';
    return apiVersion < oldest
      ? refuse(
          'not_found',
          'core.api_version_retired',
          `The API version '${apiVersion}' is no longer served.`,
          apiVersion,
        )
      : refuse(
          'validation',
          'core.api_version_unknown',
          `'${apiVersion}' is not an API version of this app.`,
          apiVersion,
        );
  }
  const deprecated = versions[apiVersion]?.deprecated;
  if (deprecated === undefined) return { apiVersion, deprecation: null };
  if (today > deprecated.sunset) {
    return refuse(
      'not_found',
      'core.api_version_retired',
      `The API version '${apiVersion}' was retired on ${deprecated.sunset}.`,
      apiVersion,
    );
  }
  return {
    apiVersion,
    deprecation: today >= deprecated.at ? { at: deprecated.at, sunset: deprecated.sunset } : null,
  };
}
