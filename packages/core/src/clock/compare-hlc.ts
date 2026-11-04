import type { Hlc } from '../events/hlc.ts';

const orderLength = 16;

/** Orders two clock values by their first 16 characters, then by node id (section 14.5.3). */
export function compareHlc(a: Hlc, b: Hlc): -1 | 0 | 1 {
  const left = a.slice(0, orderLength);
  const right = b.slice(0, orderLength);
  if (left !== right) {
    return left < right ? -1 : 1;
  }
  const leftNode = a.slice(orderLength + 1);
  const rightNode = b.slice(orderLength + 1);
  if (leftNode === rightNode) {
    return 0;
  }
  return leftNode < rightNode ? -1 : 1;
}
