import type { VersionTranslation } from '../../api-versions/version-translation.ts';
import type { ActionEntry } from '../../registry/action-entry.ts';
import type { Registry } from '../../registry/registry.ts';
import type { Scope } from '../../storage/scope.ts';
import { locate } from './locate.ts';
import { unknownAction } from './unknown-action.ts';

/**
 * `locate` for a caller: an internal command is found only by a worker's job (`runsJob`); any other
 * caller gets the answer for an unknown action, before the scope level of the command can say
 * otherwise.
 */
export function locateVisible(
  registry: Registry,
  ref: string,
  scope: Scope,
  translation: VersionTranslation | undefined,
  runsJob: boolean,
): ActionEntry {
  if (!runsJob && registry.actions.get(translation?.headRefs.get(ref) ?? ref)?.internal === true) {
    throw unknownAction(ref);
  }
  return locate(registry, ref, scope, translation);
}
