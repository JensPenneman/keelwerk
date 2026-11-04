import { shape } from '../fields/shape.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
import type { ReactionEntry } from '../registry/reaction-entry.ts';

/**
 * The action a reaction's decision runs as: the interpreter answers requests against an action, so
 * a reaction is described as a module command named by its id, in the scope of the command whose
 * event it reacts to.
 */
export function reactionActionOf(reaction: ReactionEntry, scoped: ActionEntry): ActionEntry {
  const name = reaction.id.slice(reaction.id.indexOf('.') + 1);
  return {
    ref: reaction.id,
    module: reaction.contributedBy ?? reaction.module,
    name,
    mount: 'module',
    kind: 'command',
    instance: false,
    input: shape({}),
    output: shape({}),
    errors: [],
    auth: 'policy',
    scope: scoped.scope,
    execution: 'sync',
    idempotent: false,
    offline: false,
    resumable: false,
    hints: {},
    since: scoped.since,
    changedIn: [],
    handler: reaction.react,
  };
}
