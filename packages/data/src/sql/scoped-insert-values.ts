import type { InsertQueryNode, SelectionNode, TableNode, ValuesNode } from 'kysely';
import { ColumnNode, PrimitiveValueListNode, ValueListNode, ValueNode } from 'kysely';
import { checkScopeAssignment } from './check-scope-assignment.ts';
import type { ScopeColumn } from './scope-column.ts';
import { scopeForbidden } from './scope-forbidden.ts';
import { scopedConflict } from './scoped-conflict.ts';

type Scope = { readonly column: ScopeColumn; readonly value: string };

/** The value a selection puts in its column when it is a plain bound value; `undefined` when it cannot be seen. */
function selectedValue(selection: SelectionNode | undefined): unknown {
  let node = selection?.selection as { kind: string; node?: unknown; value?: unknown } | undefined;
  if (node?.kind === 'AliasNode') node = node.node as typeof node;
  return node?.kind === 'ValueNode' ? node.value : undefined;
}

/** The inner select of an `insert ... select` must fill the scope column with the unit's value. */
function checkSelectedScope(node: InsertQueryNode, at: number, scope: Scope): void {
  const query = node.values;
  if (query?.kind !== 'SelectQueryNode') return;
  const select = query as { selections?: readonly SelectionNode[]; setOperations?: unknown[] };
  if (
    (select.setOperations ?? []).length > 0 ||
    selectedValue(select.selections?.[at]) !== scope.value
  ) {
    throw scopeForbidden(`an insert from a query must select the unit's ${scope.column}`, {
      column: scope.column,
    });
  }
}

/**
 * Enforces the scope column of the insert's target: every inserted row carries the unit's value
 * (added to a values list that lacks it, checked where present), an `insert ... select` must
 * select it as a bound value, and the update branch of an upsert is limited to the scope.
 */
export function scopedInsertValues(
  node: InsertQueryNode,
  into: TableNode,
  scope: Scope,
): InsertQueryNode {
  const isSelect = node.values?.kind === 'SelectQueryNode';
  if ((node.values?.kind !== 'ValuesNode' && !isSelect) || node.columns === undefined) {
    throw scopeForbidden('an insert into a scoped table must list its columns and values', {});
  }
  const at = node.columns.findIndex((column) => column.column.name === scope.column);
  for (const update of node.onConflict?.updates ?? []) {
    checkScopeAssignment(scope, update.column, update.value);
  }
  const base = scopedConflict(node, into, scope);
  if (isSelect) {
    if (at < 0) {
      throw scopeForbidden(`an insert from a query must list the ${scope.column} column`, {
        column: scope.column,
      });
    }
    checkSelectedScope(node, at, scope);
    return base;
  }
  const rows = (node.values as ValuesNode).values;
  if (at >= 0) {
    for (const row of rows) {
      const entry =
        row.kind === 'PrimitiveValueListNode'
          ? (row as PrimitiveValueListNode).values[at]
          : (row as ValueListNode).values[at] &&
            ((row as ValueListNode).values[at] as ValueNode).value;
      if (entry !== scope.value) {
        throw scopeForbidden(`a row carries another ${scope.column} than the unit's`, {
          column: scope.column,
        });
      }
    }
    return base;
  }
  return {
    ...base,
    columns: [...node.columns, ColumnNode.create(scope.column)],
    values: {
      ...(node.values as ValuesNode),
      values: rows.map((row) =>
        row.kind === 'PrimitiveValueListNode'
          ? PrimitiveValueListNode.create([...(row as PrimitiveValueListNode).values, scope.value])
          : ValueListNode.create([...(row as ValueListNode).values, ValueNode.create(scope.value)]),
      ),
    } as ValuesNode,
  };
}
