import type { Condition } from '../conditions/condition.ts';
import { isAlways } from './is-always.ts';

function describeValue(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(describeValue).join(', ')}]`;
  if (value instanceof Set) return `{${[...value].map(describeValue).join(', ')}}`;
  if (typeof value === 'bigint') return `${value}n`;
  if (typeof value === 'object' && value !== null) return String(value);
  return String(value);
}

const symbols: Readonly<Record<string, string>> = {
  eq: '=',
  ne: '!=',
  lt: '<',
  lte: '<=',
  gt: '>',
  gte: '>=',
  in: 'in',
  nin: 'not in',
  contains: 'contains',
  startsWith: 'starts with',
};

/** Renders a condition for support work (`ability.explain`, `keelwerk explain`). */
export function describeCondition(condition: Condition): string {
  switch (condition.op) {
    case 'never':
      return 'never';
    case 'isNull':
      return `${condition.field} is ${condition.value ? '' : 'not '}null`;
    case 'and':
      return isAlways(condition)
        ? 'always'
        : `(${condition.conditions.map(describeCondition).join(' and ')})`;
    case 'or':
      return condition.conditions.length === 0
        ? 'never'
        : `(${condition.conditions.map(describeCondition).join(' or ')})`;
    case 'not':
      return `not ${describeCondition(condition.condition)}`;
    case 'some':
    case 'none':
    case 'every':
    case 'is':
      return `${condition.op} ${condition.relation} where ${describeCondition(condition.where)}`;
    default:
      return `${condition.field} ${symbols[condition.op] ?? condition.op} ${describeValue(condition.value)}`;
  }
}
