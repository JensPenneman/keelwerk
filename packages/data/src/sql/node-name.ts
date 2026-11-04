import type { ColumnNode, OperationNode, ReferenceNode } from 'kysely';

export function nodeName(node: OperationNode): string | undefined {
  if (node.kind === 'ColumnNode') return (node as ColumnNode).column.name;
  if (node.kind === 'ReferenceNode') return nodeName((node as ReferenceNode).column);
  return undefined;
}
