import type { ApiVersions } from '../dsl/define-api-versions.ts';

/**
 * The ids of the module version changes one API version adopts, in declared order: the strings of
 * `api.versions[apiVersion].changes` (an object there is an app-level change, which this release
 * does not serve). Empty for no changes, no declared versions or a date the app does not declare.
 */
export function adoptedChanges(
  api: ApiVersions | null | undefined,
  apiVersion: string,
): readonly string[] {
  const changes = api?.versions[apiVersion]?.changes ?? [];
  return changes.filter((change): change is string => typeof change === 'string');
}
