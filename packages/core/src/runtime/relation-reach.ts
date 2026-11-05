import type { RelationNode } from '../authorization/condition-to-mongo.ts';
import type { InvokerOptions } from '../invoker/invoker-options.ts';
import type { ScopeTarget } from '../invoker/scope-target.ts';
import type { Registry } from '../registry/registry.ts';
import type { Scope } from '../storage/scope.ts';
import { reachCap } from './reach-cap.ts';

async function targetOf(
  options: Pick<InvokerOptions, 'directory' | 'placement' | 'control'>,
  scope: Scope,
): Promise<ScopeTarget | undefined> {
  if (scope.level === 'deployment') return options.control;
  const record =
    scope.level === 'tenant'
      ? await options.directory.tenant(scope.tenantId)
      : await options.directory.backend(scope.backendId);
  const handle = record === undefined ? undefined : options.placement(record.placementId);
  return record === undefined || handle === undefined
    ? undefined
    : { scope, namespace: record.namespace, handle };
}

/** The ids of the rows of an entity that meet a relation quantifier; `undefined` when the set is unbounded or cannot be read. */
export type RelationReach = (
  entity: string,
  node: RelationNode,
) => Promise<readonly string[] | undefined>;

/**
 * Resolves a relation quantifier of a rule to the ids it admits (section 8.7): the entity's rows
 * that meet the quantifier, read in one read-only unit of the session's scope. More than
 * `reachCap` ids, an entity the app does not hold, or a read that fails all answer `undefined`,
 * and the rule is exported `serverOnly`.
 */
export function relationReach(
  options: Pick<InvokerOptions, 'directory' | 'placement' | 'control'>,
  scope: Scope,
  registry: Registry,
): RelationReach {
  return async (entity, node) => {
    const descriptor = registry.entities.get(entity)?.descriptor;
    if (descriptor === undefined) return undefined;
    try {
      const target = await targetOf(options, scope);
      if (target === undefined) return undefined;
      const page = await target.handle.adapter.unit(
        target.namespace,
        target.scope,
        (unit) =>
          unit.rows.find(descriptor, {
            where: node,
            select: ['id'],
            page: { first: reachCap + 1 },
          }),
        { readOnly: true },
      );
      return page.rows.length > reachCap ? undefined : page.rows.map((row) => String(row.id));
    } catch {
      return undefined;
    }
  };
}
