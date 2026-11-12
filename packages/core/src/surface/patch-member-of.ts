import type { FieldNode } from './field-node.ts';

/**
 * The node of a patch member (sections 6.7 and 16.5.5): the field's node, optional and without its
 * default, so no transport fills a default into a patch and no document names one.
 */
export function patchMemberOf(node: FieldNode): FieldNode {
  const { default: _default, ...rest } = node;
  return { ...rest, optional: true };
}
