import { type GraphQLResolveInfo, Kind, type SelectionSetNode } from 'graphql';

function hasField(
  selectionSet: SelectionSetNode,
  name: string,
  info: GraphQLResolveInfo,
  seen: Set<string>,
): boolean {
  for (const selection of selectionSet.selections) {
    switch (selection.kind) {
      case Kind.FIELD:
        if (selection.name.value === name) return true;
        break;
      case Kind.INLINE_FRAGMENT:
        if (hasField(selection.selectionSet, name, info, seen)) return true;
        break;
      case Kind.FRAGMENT_SPREAD: {
        const fragment = info.fragments[selection.name.value];
        if (fragment !== undefined && !seen.has(selection.name.value)) {
          seen.add(selection.name.value);
          if (hasField(fragment.selectionSet, name, info, seen)) return true;
        }
        break;
      }
    }
  }
  return false;
}

/** Whether the field being resolved selects `name` among its own members, through inline fragments and spreads (a nested field of that name does not count). */
export function selectionHasField(info: GraphQLResolveInfo, name: string): boolean {
  return info.fieldNodes.some(
    (node) =>
      node.selectionSet !== undefined && hasField(node.selectionSet, name, info, new Set<string>()),
  );
}
