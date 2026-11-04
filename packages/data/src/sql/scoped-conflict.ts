import type { InsertQueryNode, TableNode } from 'kysely';
import { AndNode, ParensNode, WhereNode } from 'kysely';
import { predicateKey } from './predicate-key.ts';
import type { ScopeColumn } from './scope-column.ts';
import { scopeConjunction } from './scope-conjunction.ts';
import { scopePredicate } from './scope-predicate.ts';

/**
 * The update branch of an upsert is a statement of its own: it may touch only a row of the
 * unit's scope, so `<target>.<scope column> = value` joins its WHERE, whatever the database's
 * row-level security does.
 */
export function scopedConflict(
  node: InsertQueryNode,
  into: TableNode,
  scope: { readonly column: ScopeColumn; readonly value: string },
): InsertQueryNode {
  const conflict = node.onConflict;
  if (conflict === undefined || (conflict.updates ?? []).length === 0) return node;
  const predicate = scopePredicate(scope.column, into, scope.value);
  const existing = conflict.updateWhere;
  if (
    existing !== undefined &&
    scopeConjunction(existing.where).has(predicateKey(predicate) ?? '')
  ) {
    return node;
  }
  const combined =
    existing === undefined
      ? predicate
      : AndNode.create(ParensNode.create(existing.where), predicate);
  return { ...node, onConflict: { ...conflict, updateWhere: WhereNode.create(combined) } };
}
