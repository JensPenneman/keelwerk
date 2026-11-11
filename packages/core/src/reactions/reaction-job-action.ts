import { KeelwerkError } from '../errors/keelwerk-error.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
import type { Registry } from '../registry/registry.ts';
import type { Scope } from '../storage/scope.ts';
import { reactionActionOf } from './reaction-action-of.ts';
import { reactionJobInputShape } from './reaction-job-input-shape.ts';

/**
 * The command a reaction job decides as: `reactionActionOf(reaction, { scope: scope.level, since },
 * reactionJobInputShape)`. `not_implemented` (`core.not_implemented`) unless `ref` is an async
 * reaction of the registry.
 */
export function reactionJobAction(
  registry: Registry,
  ref: string,
  scope: Scope,
  since: string,
): ActionEntry {
  const reaction = registry.reactions.get(ref);
  if (reaction === undefined || reaction.timing !== 'async') {
    throw new KeelwerkError({
      kind: 'not_implemented',
      code: 'core.not_implemented',
      message: `"${ref}" is not an asynchronous reaction of this app.`,
    });
  }
  return reactionActionOf(reaction, { scope: scope.level, since }, reactionJobInputShape);
}
