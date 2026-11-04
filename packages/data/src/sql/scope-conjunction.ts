import type { AndNode, OperationNode, ParensNode } from 'kysely';
import { predicateKey } from './predicate-key.ts';

/** The scope predicates a filter already demands of every row: those in its top-level conjunction. */
export function scopeConjunction(
  node: OperationNode,
  found: Set<string> = new Set(),
): ReadonlySet<string> {
  if (node.kind === 'AndNode') {
    scopeConjunction((node as AndNode).left, found);
    scopeConjunction((node as AndNode).right, found);
  } else if (node.kind === 'ParensNode') {
    scopeConjunction((node as ParensNode).node, found);
  } else {
    const known = predicateKey(node);
    if (known !== undefined) found.add(known);
  }
  return found;
}
