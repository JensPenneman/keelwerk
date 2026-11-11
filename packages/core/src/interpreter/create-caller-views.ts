import type { AuthorizedAction } from '../authorization/authorized-action.ts';
import type { NormalizedRule } from '../authorization/normalized-rule.ts';
import type { AnswerContext } from '../kernel/answer-context.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
import type { EntityEntry } from '../registry/entity-entry.ts';
import type { CallerView } from '../repositories/caller-view.ts';
import { callerView } from '../repositories/caller-view.ts';
import { principalContextOf } from './principal-context-of.ts';

/** The action a plain `forCaller()` read is planned as: the entity's own `query`. */
function queryOf(entry: EntityEntry): AuthorizedAction {
  return {
    ref: `${entry.ref}.query`,
    module: entry.module,
    entity: entry.ref,
    name: 'query',
    kind: 'query',
    generated: 'query',
    instance: false,
    auth: 'policy',
    scope: entry.descriptor.tenancy === 'backend' ? 'backend' : 'tenant',
  };
}

/** The caller's view of an entity for the running invocation; one plan per entity, compiled on first use. */
export type CallerViews = (entry: EntityEntry, context: AnswerContext) => CallerView;

/**
 * Builds the views of one invocation. The invoked query's own plan serves the entity it is
 * mounted on (`ctx.target`, and `forCaller()` within it; a command's reads are planned as `query`); every other entity is planned as its
 * generated `query` (section 8.4).
 */
export function createCallerViews(
  rules: readonly NormalizedRule[],
  invoked: ActionEntry | undefined,
): CallerViews {
  const views = new Map<string, CallerView>();
  return (entry, context) => {
    const known = views.get(entry.ref);
    if (known !== undefined) return known;
    const action: AuthorizedAction =
      invoked?.entity === entry.ref && invoked.kind === 'query' ? invoked : queryOf(entry);
    const view = callerView({
      entry,
      rules,
      action,
      context: principalContextOf(
        context.registry,
        context.principal,
        context.scope,
        context.flagSnapshot,
      ),
    });
    views.set(entry.ref, view);
    return view;
  };
}
