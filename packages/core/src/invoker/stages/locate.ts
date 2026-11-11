import type { VersionTranslation } from '../../api-versions/version-translation.ts';
import { KeelwerkError } from '../../errors/keelwerk-error.ts';
import type { ActionEntry } from '../../registry/action-entry.ts';
import type { Registry } from '../../registry/registry.ts';
import type { Scope } from '../../storage/scope.ts';
import { acceptedScopeLevels } from './accepted-scope-levels.ts';

/**
 * `locate` (section 9.2): the action in the app's registry. `not_implemented` when the app lacks
 * the module or the action; `forbidden` when the action's scope level does not match the session's.
 * At an older API version an action a version change renamed answers under its older reference
 * only: that reference maps to the head's, and the head's own reference is `not_implemented` there
 * (S-163).
 */
export function locate(
  registry: Registry,
  ref: string,
  scope: Scope,
  translation?: VersionTranslation,
): ActionEntry {
  const renamedAway = translation?.versionRefs.has(ref) === true && !translation.headRefs.has(ref);
  const action = renamedAway
    ? undefined
    : registry.actions.get(translation?.headRefs.get(ref) ?? ref);
  if (action === undefined) {
    throw new KeelwerkError({
      kind: 'not_implemented',
      code: 'core.not_implemented',
      message: `"${ref}" is not an action of this app.`,
    });
  }
  if (!acceptedScopeLevels[action.scope].includes(scope.level)) {
    throw new KeelwerkError({
      kind: 'forbidden',
      code: 'core.forbidden',
      message: `"${ref}" runs at the ${action.scope} level, not at ${scope.level}.`,
    });
  }
  return action;
}
