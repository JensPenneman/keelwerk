import type { RelationDescriptor } from '@keelwerk/core';

/**
 * A relation as the hops a query walks. A plain relation is one hop. A relation through a join
 * entity (`relation.through`, 6.3) is two: owner to join row (the join's `by` against the owner's
 * `to`), then join row to target (the join's `via` against the target's `id`). The compilers of
 * the SQL family and the in-memory evaluator expand it the same way, so they agree.
 */
export function throughHops(
  relation: RelationDescriptor,
): readonly { readonly target: string; readonly relation: RelationDescriptor }[] {
  const { through } = relation;
  if (through === undefined) return [{ target: relation.target, relation }];
  const join = `${through.module}.${through.entity}`;
  return [
    {
      target: join,
      relation: {
        kind: 'many',
        target: join,
        by: through.by,
        to: through.to,
        contributedBy: relation.contributedBy,
      },
    },
    {
      target: relation.target,
      relation: {
        kind: 'one',
        target: relation.target,
        by: 'id',
        to: through.via,
        contributedBy: relation.contributedBy,
      },
    },
  ];
}
