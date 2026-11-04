import type { Condition, EntityDescriptor, RelationDescriptor } from '@keelwerk/core';
import { malformedCondition } from '../sql/malformed-condition.ts';
import { throughHops } from '../sql/through-hops.ts';

/** One hop of a dotted relation path. */
export interface MemoryRelationStep {
  readonly owner: EntityDescriptor;
  readonly target: EntityDescriptor;
  readonly relation: RelationDescriptor;
}

/** Resolves `'team.members'` against the entities; malformed when a segment names nothing. */
export function memoryRelationPath(
  entity: EntityDescriptor,
  node: Extract<Condition, { readonly relation: string }>,
  entityOf: (ref: string) => EntityDescriptor | undefined,
): readonly MemoryRelationStep[] {
  const steps: MemoryRelationStep[] = [];
  let owner = entity;
  for (const segment of node.relation.split('.')) {
    const relation = Object.hasOwn(owner.relations, segment) ? owner.relations[segment] : undefined;
    if (relation === undefined) {
      throw malformedCondition(`${owner.ref} has no relation ${segment}`, {
        entity: owner.ref,
        relation: node.relation,
      });
    }
    for (const hop of throughHops(relation)) {
      const target = entityOf(hop.target);
      if (target === undefined) {
        throw malformedCondition(
          `the relation ${segment} of ${owner.ref} targets the unknown ${hop.target}`,
          { entity: owner.ref, relation: node.relation },
        );
      }
      steps.push({ owner, target, relation: hop.relation });
      owner = target;
    }
  }
  return steps;
}
