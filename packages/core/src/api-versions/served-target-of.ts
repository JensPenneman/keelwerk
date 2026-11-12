import type { ApiVersions } from '../dsl/define-api-versions.ts';
import { acceptsVersion } from './accepts-version.ts';

/**
 * Where a pin to the retired `version` moves: the oldest declared date newer than `version` that
 * `resolveVersion` still serves today, the head when none is. A declaration does not have to order
 * its sunsets like its dates, so this is never the oldest served date overall: a version whose
 * support was extended stays below it.
 */
export function servedTargetOf(api: ApiVersions, version: string, today: string): string {
  return api.dates.find((date) => date > version && acceptsVersion(api, date, today)) ?? api.head;
}
