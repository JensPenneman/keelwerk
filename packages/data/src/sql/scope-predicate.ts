import type { TableNode } from 'kysely';
import { BinaryOperationNode, ColumnNode, OperatorNode, ReferenceNode, ValueNode } from 'kysely';
import type { ScopeColumn } from './scope-column.ts';

/** `<table or alias>.<scope column> = <value>`. */
export function scopePredicate(
  column: ScopeColumn,
  source: TableNode,
  value: string,
): BinaryOperationNode {
  return BinaryOperationNode.create(
    ReferenceNode.create(ColumnNode.create(column), source),
    OperatorNode.create('='),
    ValueNode.create(value),
  );
}
