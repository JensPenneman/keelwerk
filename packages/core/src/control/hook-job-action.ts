import { KeelwerkError } from '../errors/keelwerk-error.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
import type { Registry } from '../registry/registry.ts';
import type { Scope } from '../storage/scope.ts';
import { hookActionOf } from './hook-action-of.ts';

/**
 * The command a hook job runs: `hookActionOf`. `not_implemented` (`core.not_implemented`) unless
 * `ref` is a hook of the registry whose unit is the level of the scope.
 */
export function hookJobAction(
  registry: Registry,
  ref: string,
  scope: Scope,
  since: string,
): ActionEntry {
  const hook = registry.hooks.get(ref);
  if (hook === undefined || hook.unit !== scope.level) {
    throw new KeelwerkError({
      kind: 'not_implemented',
      code: 'core.not_implemented',
      message: `"${ref}" is not a lifecycle hook of this app at this level.`,
    });
  }
  return hookActionOf(hook, since);
}
