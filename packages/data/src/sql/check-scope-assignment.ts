import type { OperationNode, ValueNode } from 'kysely';
import { nodeName } from './node-name.ts';
import type { ScopeColumn } from './scope-column.ts';
import { scopeForbidden } from './scope-forbidden.ts';

/** Refuses an assignment that gives the scope column a value other than the unit's. */
export function checkScopeAssignment(
  scope: { readonly column: ScopeColumn; readonly value: string },
  column: OperationNode,
  value: OperationNode,
): void {
  if (nodeName(column) !== scope.column) return;
  if (value.kind !== 'ValueNode' || (value as ValueNode).value !== scope.value) {
    throw scopeForbidden(`a row may not be moved to another ${scope.column}`, {
      column: scope.column,
    });
  }
}
