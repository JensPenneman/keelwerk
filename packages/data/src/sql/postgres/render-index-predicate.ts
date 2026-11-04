import type { Condition } from '@keelwerk/core';
import { errors, physicalColumnName } from '@keelwerk/core';
import { quoteIdentifier } from './quote-identifier.ts';
import { sqlLiteral } from './sql-literal.ts';

const comparisons = { eq: '=', ne: '<>', lt: '<', lte: '<=', gt: '>', gte: '>=' } as const;

/**
 * The predicate of a partial index (section 14.5.1): `eq`, `ne`, `in`, `isNull` and the
 * combinators over the entity's own fields, which map to their physical columns. Anything else
 * cannot be indexed and throws.
 */
export function renderIndexPredicate(condition: Condition): string {
  const column = (field: string): string => quoteIdentifier(physicalColumnName(field));
  switch (condition.op) {
    case 'eq':
    case 'ne': {
      if (condition.value === null) {
        return `${column(condition.field)} is ${condition.op === 'eq' ? '' : 'not '}null`;
      }
      return `${column(condition.field)} ${comparisons[condition.op]} ${sqlLiteral(condition.value)}`;
    }
    case 'in':
    case 'nin': {
      const values = Array.isArray(condition.value) ? condition.value : [];
      const list = `array[${values.map(sqlLiteral).join(', ')}]`;
      return condition.op === 'in'
        ? `${column(condition.field)} = any (${list})`
        : `not (${column(condition.field)} = any (${list}))`;
    }
    case 'isNull':
      return `${column(condition.field)} is ${condition.value ? '' : 'not '}null`;
    case 'and':
    case 'or':
      return condition.conditions
        .map((inner) => `(${renderIndexPredicate(inner)})`)
        .join(` ${condition.op} `);
    case 'not':
      return `not (${renderIndexPredicate(condition.condition)})`;
    default:
      throw errors.unsupported(`a partial index cannot test ${condition.op}`);
  }
}
