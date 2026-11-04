import type {
  BinaryOperationNode,
  OperationNode,
  OperatorNode,
  ReferenceNode,
  ValueNode,
} from 'kysely';
import { nodeName } from './node-name.ts';
import { scopeKey } from './scope-key.ts';

/** `table.column = value` of a scope predicate, as a comparable string; `undefined` for any other node. */
export function predicateKey(node: OperationNode): string | undefined {
  if (node.kind !== 'BinaryOperationNode') return undefined;
  const { leftOperand, operator, rightOperand } = node as BinaryOperationNode;
  if (leftOperand.kind !== 'ReferenceNode' || rightOperand.kind !== 'ValueNode') return undefined;
  if ((operator as OperatorNode).operator !== '=') return undefined;
  const { column, table } = leftOperand as ReferenceNode;
  const owner =
    table === undefined ? '' : scopeKey(table.table.schema?.name, table.table.identifier.name);
  return `${owner}|${nodeName(column)}|${String((rightOperand as ValueNode).value)}`;
}
