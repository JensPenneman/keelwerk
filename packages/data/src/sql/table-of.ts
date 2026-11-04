import type { OperationNode, TableNode } from 'kysely';

/** The table a `from`, `join`, `into` or `update` item names and its alias; `opaque` for raw SQL. */
export function tableOf(
  item: OperationNode,
): { readonly table: TableNode; readonly alias: string | undefined } | 'opaque' | undefined {
  if (item.kind === 'TableNode') return { table: item as TableNode, alias: undefined };
  if (item.kind === 'RawNode') return 'opaque';
  if (item.kind !== 'AliasNode') return undefined;
  const { node, alias } = item as unknown as { node: OperationNode; alias: { name?: string } };
  if (node.kind === 'TableNode') return { table: node as TableNode, alias: alias.name };
  return node.kind === 'RawNode' ? 'opaque' : undefined;
}
