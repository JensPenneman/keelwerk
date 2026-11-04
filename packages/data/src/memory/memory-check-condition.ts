import type { Condition, EntityDescriptor } from '@keelwerk/core';
import { KeelwerkError } from '@keelwerk/core';
import { comparisonOperators } from '../sql/comparison-operators.ts';
import { entityTable } from '../sql/entity-table.ts';
import { malformedCondition } from '../sql/malformed-condition.ts';
import { memoryRelationPath } from './memory-relation-path.ts';

/**
 * Refuses what the compiled filter refuses (14.3.4): an unknown field or relation, an operator
 * the field's kind does not take, a personal field the planner has not rewritten (`unsupported`,
 * `core.personal_operator`, the kernel's bounded path of S-37), and operands of the wrong shape.
 * A filter is never widened, so the reference adapter fails where the SQL adapters fail. `reach`
 * refuses a related entity the unit's scope cannot reach, as the scoping plugin refuses its table.
 */
export function memoryCheckCondition(
  entity: EntityDescriptor,
  condition: Condition,
  entityOf: (ref: string) => EntityDescriptor | undefined,
  reach: (entity: EntityDescriptor) => void,
): void {
  switch (condition.op) {
    case 'never':
      return;
    case 'and':
    case 'or':
      for (const inner of condition.conditions)
        memoryCheckCondition(entity, inner, entityOf, reach);
      return;
    case 'not':
      memoryCheckCondition(entity, condition.condition, entityOf, reach);
      return;
    case 'some':
    case 'none':
    case 'every':
    case 'is': {
      const path = memoryRelationPath(entity, condition, entityOf);
      const last = path.at(-1);
      if (last === undefined)
        throw malformedCondition('a relation quantifier names no relation', {});
      for (const step of path) reach(step.target);
      memoryCheckCondition(last.target, condition.where, entityOf, reach);
      return;
    }
    default:
      break;
  }
  const column = entityTable(entity, null, 'e').column(condition.field);
  if (column === undefined) {
    throw malformedCondition(`${entity.ref} has no field ${condition.field}`, {
      entity: entity.ref,
      field: condition.field,
    });
  }
  const allowed = comparisonOperators(column);
  if (allowed === undefined || !allowed.has(condition.op)) {
    if (column.field.personal !== false || column.derived !== undefined) {
      const reason =
        condition.op === 'startsWith' || condition.op === 'contains'
          ? 'prefix and trigram tags are not written in M1 (the kernel scans)'
          : 'the encryption planner has not rewritten it onto an index field';
      throw new KeelwerkError({
        kind: 'unsupported',
        code: 'core.personal_operator',
        message: `${condition.op} on the personal field ${condition.field} is not available: ${reason}`,
        details: { op: condition.op, field: condition.field, reason },
      });
    }
    throw malformedCondition(
      `${condition.op} is not available on ${column.field.kind} field ${condition.field}`,
      { op: condition.op, field: condition.field, kind: column.field.kind },
    );
  }
  if (condition.op === 'isNull' && typeof condition.value !== 'boolean') {
    throw malformedCondition(`the isNull operand of ${column.path} must be a boolean`, {
      field: column.path,
    });
  }
  if ((condition.op === 'in' || condition.op === 'nin') && !Array.isArray(condition.value)) {
    throw malformedCondition(`the ${condition.op} operand of ${condition.field} must be an array`, {
      op: condition.op,
      field: condition.field,
    });
  }
}
