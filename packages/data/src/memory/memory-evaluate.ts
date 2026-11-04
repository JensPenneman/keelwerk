import type { Condition, EntityDescriptor, StorageRow } from '@keelwerk/core';
import { evaluateCondition } from '@keelwerk/core';
import { entityTable } from '../sql/entity-table.ts';
import { memoryRelationPath } from './memory-relation-path.ts';

function present(value: unknown): boolean {
  return value !== null && value !== undefined;
}

/** Where the interpreter finds the rows of a relation's target and the target's descriptor. */
export interface MemoryRelationSource {
  entityOf(ref: string): EntityDescriptor | undefined;
  /** The target entity's rows in the unit's scope (a tenant unit cannot reach a backend entity). */
  rowsOf(entity: EntityDescriptor): Iterable<StorageRow>;
}

/**
 * The core interpreter over one row, with the quantifiers answered from the unit's own rows: the
 * in-memory adapter's quantifier implementation is the reference (14.3.4). `some` and `is` hold
 * when a related, non-archived row satisfies the `where`; `none` negates `some`; `every` holds
 * when no related row fails it, so for an empty relation. A multi-hop path nests the same
 * existence test, exactly as the SQL form does.
 */
export function memoryEvaluate(
  source: MemoryRelationSource,
  entity: EntityDescriptor,
  condition: Condition,
  row: StorageRow,
): boolean {
  const table = entityTable(entity, null, 'e');
  return evaluateCondition(condition, row, {
    kindOf: (field) => table.column(field)?.field.kind,
    matching: (node, owner) => {
      const steps = memoryRelationPath(entity, node, source.entityOf);
      const negated = node.op === 'every';
      const exists = (index: number, from: StorageRow): boolean => {
        const step = steps[index];
        if (step === undefined) return false;
        const key = from[step.relation.to];
        if (!present(key)) return false;
        for (const related of source.rowsOf(step.target)) {
          if (present(related.archivedAt)) continue;
          const link = evaluateCondition(
            { op: 'eq', field: 'by', value: key },
            { by: related[step.relation.by] },
          );
          if (!link) continue;
          const holds =
            index === steps.length - 1
              ? negated !== memoryEvaluate(source, step.target, node.where, related)
              : exists(index + 1, related);
          if (holds) return true;
        }
        return false;
      };
      const found = exists(0, owner);
      return node.op === 'none' || negated ? !found : found;
    },
  });
}
