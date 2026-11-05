import type { RelationAnswerer } from '../../authorization/relation-answerer.ts';
import { refuseRequest } from '../../interpreter/refuse-request.ts';
import type { ActionEntry } from '../../registry/action-entry.ts';
import type { Registry } from '../../registry/registry.ts';
import type { SessionDetails } from '../session-details.ts';
import { targetOf } from './target-of.ts';

/**
 * Answers the relation quantifiers of a rule after the unit closed (the shape stage): each one in
 * a read-only unit of the store the related entity lives in, over the rows as committed.
 */
export function relationsAfter(
  registry: Registry,
  action: ActionEntry,
  details: SessionDetails,
): RelationAnswerer {
  return (entity, node, ids) => {
    const related = registry.entities.get(entity);
    if (related === undefined) {
      return Promise.reject(
        refuseRequest(
          `the ${node.op} on "${node.relation}" of ${entity}`,
          'the entity is not part of this app',
        ),
      );
    }
    const { backendTarget, target: own } = details.resolved;
    const target =
      related.descriptor.tenancy === 'backend' && backendTarget !== null
        ? backendTarget
        : (own ?? targetOf(action, details));
    return target.handle.adapter.unit(
      target.namespace,
      target.scope,
      (unit) => unit.rows.matching(related.descriptor, ids, node),
      { readOnly: true },
    );
  };
}
