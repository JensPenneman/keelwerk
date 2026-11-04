import type { Condition, EntityDescriptor, StorageRow } from '@keelwerk/core';
import { evaluateCondition } from '@keelwerk/core';
import type { OracleDataset } from './oracle-dataset.ts';

function live(row: StorageRow): boolean {
  return row.archivedAt === undefined || row.archivedAt === null;
}

/**
 * The oracle of the dual-evaluation suite (14.3.4, 14.10): the core interpreter over plain rows,
 * with relation quantifiers answered from the dataset. A related row joins when its `by` field
 * equals the row's `to` field and it is not archived; `some` needs one related row that matches,
 * `none` needs no such row, `every` holds for an empty relation, and `is` is false on an absent
 * reference. It reads no adapter, so a case that compares an adapter with it states the
 * expectation independently of the adapter.
 */
export function oracleEvaluate(
  entity: EntityDescriptor,
  condition: Condition,
  row: StorageRow,
  dataset: OracleDataset,
): boolean {
  return evaluateCondition(condition, row, {
    kindOf: (field) => entity.fields[field]?.kind,
    matching: (node, current) => {
      const relation = entity.relations[node.relation];
      if (relation === undefined) {
        throw new TypeError(`${entity.ref} has no relation ${node.relation}`);
      }
      const target = dataset.entity(relation.target);
      const key = current[relation.to];
      const related =
        key === undefined || key === null
          ? []
          : dataset.rows(target.ref).filter((other) => live(other) && other[relation.by] === key);
      const holds = (other: StorageRow): boolean =>
        oracleEvaluate(target, node.where, other, dataset);
      switch (node.op) {
        case 'some':
        case 'is':
          return related.some(holds);
        case 'none':
          return !related.some(holds);
        case 'every':
          return related.every(holds);
      }
    },
  });
}
