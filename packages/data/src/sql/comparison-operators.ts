import type { ComparisonCondition } from './comparison-condition.ts';
import type { ColumnRef } from './entity-table.ts';

const textKinds: ReadonlySet<string> = new Set(['string', 'text', 'enum', 'subject', 'timeZone']);

const isNullOnlyKinds: ReadonlySet<string> = new Set(['json', 'richText', 'blob']);

export function comparisonOperators(
  column: ColumnRef,
): ReadonlySet<ComparisonCondition['op']> | undefined {
  const { field } = column;
  const ordered: ComparisonCondition['op'][] = [
    'eq',
    'ne',
    'lt',
    'lte',
    'gt',
    'gte',
    'in',
    'nin',
    'isNull',
  ];
  if (column.derived !== undefined) {
    return column.derived.kind === 'binary' ? new Set(['eq', 'ne', 'in', 'nin']) : undefined;
  }
  if (field.personal !== false) return new Set(['isNull']);
  if (field.sealed || field.kind === 'secret' || field.kind === 'verifier') return new Set();
  if (isNullOnlyKinds.has(field.kind)) return new Set(['isNull']);
  switch (field.kind) {
    case 'list':
      return field.merge === 'sequence' ? new Set(['isNull']) : new Set(['contains', 'isNull']);
    case 'set':
      return new Set(['contains', 'isNull']);
    case 'binary':
      return new Set(['eq', 'ne', 'isNull']);
    default:
      return new Set(textKinds.has(field.kind) ? [...ordered, 'contains', 'startsWith'] : ordered);
  }
}
