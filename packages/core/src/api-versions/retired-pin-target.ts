import type { ApiVersions } from '../dsl/define-api-versions.ts';
import { KeelwerkError } from '../errors/keelwerk-error.ts';
import { acceptsVersion } from './accepts-version.ts';
import { servedTargetOf } from './served-target-of.ts';

/**
 * Where `pin` moves today: undefined when `resolveVersion` serves it, or when it is no declared
 * date (`core.api_version_unknown` and `core.api_version_invalid` are no retirement); else the
 * oldest served version newer than it (`servedTargetOf`). The one check of `repinRetiredPins` and of
 * a credential's pin at resolution. Pure; throws nothing but errors that are no keelwerk errors.
 */
export function retiredPinTarget(api: ApiVersions, pin: string, today: string): string | undefined {
  try {
    return acceptsVersion(api, pin, today) ? undefined : servedTargetOf(api, pin, today);
  } catch (error) {
    if (error instanceof KeelwerkError) return undefined;
    throw error;
  }
}
