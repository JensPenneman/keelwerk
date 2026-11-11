import { shape } from '../fields/shape.ts';
import type { StandardSchemaV1 } from '../fields/standard-schema-v1.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
import type { ReactionEntry } from '../registry/reaction-entry.ts';

/**
 * The action a reaction's decision runs as: the interpreter answers requests against an action, so
 * a reaction is described as a module command named by its id, in the scope of the command whose
 * event it reacts to (an inline reaction), or of its job (an async one, whose input is the event
 * reference). An inline reaction runs in the unit of its command, so a failure of an effect it
 * performs fails that command and reaches that command's client: it declares the errors of the
 * command (`scoped.errors`, with their specs), which is what an error map of its `invoke` is checked
 * against. An async reaction's job declares none.
 */
export function reactionActionOf(
  reaction: ReactionEntry,
  scoped: Pick<ActionEntry, 'scope' | 'since'> &
    Partial<Pick<ActionEntry, 'errors' | 'errorSpecs'>>,
  input: StandardSchemaV1 = shape({}),
): ActionEntry {
  const name = reaction.id.slice(reaction.id.indexOf('.') + 1);
  return {
    ref: reaction.id,
    module: reaction.contributedBy ?? reaction.module,
    name,
    mount: 'module',
    kind: 'command',
    instance: false,
    input,
    output: shape({}),
    errors: scoped.errors ?? [],
    ...(scoped.errorSpecs === undefined ? {} : { errorSpecs: scoped.errorSpecs }),
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
