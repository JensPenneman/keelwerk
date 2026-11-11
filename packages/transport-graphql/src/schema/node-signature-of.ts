import type { FieldNode } from '@keelwerk/core';

/**
 * What decides whether two field nodes can share one GraphQL type: an enum is its values, a shape is
 * its members (name, access, optionality, whether it has a default, description and signature), a list is its item and every other node is its kind.
 * Constraints such as lengths and bounds do not change the type, so they stay out.
 */
export function nodeSignatureOf(node: FieldNode): string {
  switch (node.kind) {
    case 'enum':
      return `enum(${node.values.join('|')})`;
    case 'list':
    case 'set':
    case 'page':
      return `${node.kind}(${nodeSignatureOf(node.item)})`;
    case 'shape':
      return `shape(${Object.entries(node.fields)
        .map(
          ([name, member]) =>
            `${name}:${member.access ?? 'both'}:${member.optional === true}:${member.default !== undefined}:${JSON.stringify(member.description ?? '')}:${nodeSignatureOf(member)}`,
        )
        .join(',')})`;
    default:
      return node.kind;
  }
}
