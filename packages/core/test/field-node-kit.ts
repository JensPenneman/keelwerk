import type { AnyField } from '../src/fields/field-def.ts';
import type { FieldNode } from '../src/surface/field-node.ts';
import { fieldNodeOf } from '../src/surface/field-node-of.ts';

/** The node of a field declared by module 'library', whose entities all use the prefix 'book'. */
export function nodeOf(def: AnyField, tag = 1): FieldNode {
  return fieldNodeOf(def, { declaredBy: 'library', tag, prefixOf: () => 'book' });
}
