import { cellOf } from './mark-cells.ts';
import type { Mark, MarkKind, MarkPosition, MarkSite } from './mark-types.ts';

const positions: readonly MarkPosition[] = ['top', 'element', 'nested'];

/** How a message names a position. */
const phrases: Readonly<Record<MarkPosition, string>> = {
  top: 'a top-level member',
  element: 'the element of a list or set',
  nested: 'a member inside a json member',
};

/** What a message says of the positions at which the kernel protects `kind` at `site`: the cells that are `true`. */
function protectedPhrase(site: MarkSite, kind: MarkKind): string {
  const found = positions
    .filter((position) => cellOf(site, kind, position) === true)
    .map((position) => phrases[position]);
  return found.length === 0 ? `no ${kind} mark` : `a ${kind} mark only on ${found.join(' or ')}`;
}

/**
 * What a refusal says, from the table alone: the kernel does not protect this mark at this position
 * at this place, and which positions it does protect there. It says nothing else, so it cannot be false.
 */
export function refusalText(site: MarkSite, mark: Mark): string {
  return `the kernel does not protect a ${mark.kind} mark on ${phrases[mark.position]} at this place; at this place it protects ${protectedPhrase(site, mark.kind)}.`;
}
