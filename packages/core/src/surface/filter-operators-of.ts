import type { FieldNode } from './field-node.ts';

const orderedKinds: ReadonlySet<string> = new Set([
  'integer',
  'float',
  'decimal',
  'serial',
  'instant',
  'date',
]);

const skippedKinds: ReadonlySet<string> = new Set(['secret', 'void', 'foreign', 'page']);

/**
 * The filter operators a field accepts on the wire (sections 14.3.4 and 16.4.4), in this order;
 * `[]` for a write-only field and for secret, void, foreign and page fields. Personal fields take
 * only the equality operators.
 */
export function filterOperatorsOf(node: FieldNode): readonly string[] {
  if (node.access === 'write' || skippedKinds.has(node.kind)) {
    return [];
  }
  if (node.personal === true) {
    return ['eq', 'isNull'];
  }
  switch (node.kind) {
    case 'string':
    case 'text':
      return [
        'eq',
        'ne',
        'lt',
        'lte',
        'gt',
        'gte',
        'in',
        'nin',
        'startsWith',
        'contains',
        'isNull',
      ];
    case 'binary':
      return ['eq', 'ne', 'isNull'];
    case 'list':
    case 'set':
      return ['contains', 'isNull'];
    case 'json':
    case 'shape':
    case 'richText':
    case 'blob':
      return ['isNull'];
    default:
      return orderedKinds.has(node.kind)
        ? ['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'in', 'nin', 'isNull']
        : ['eq', 'ne', 'in', 'nin', 'isNull'];
  }
}
