import type { ApiVersions } from '../dsl/define-api-versions.ts';
import { KeelwerkError } from '../errors/keelwerk-error.ts';
import { resolveVersion } from './resolve-version.ts';

/**
 * Whether `resolveVersion` serves `requested` today: false when it throws `core.api_version_retired`,
 * the other refusals (`core.api_version_unknown`, `core.api_version_invalid`) as it throws them.
 */
export function acceptsVersion(api: ApiVersions, requested: string, today: string): boolean {
  try {
    resolveVersion({ dates: api.dates, versions: api.versions, requested, today });
    return true;
  } catch (error) {
    if (error instanceof KeelwerkError && error.code === 'core.api_version_retired') return false;
    throw error;
  }
}
