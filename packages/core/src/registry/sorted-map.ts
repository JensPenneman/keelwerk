import { compareCodePoints } from '../conditions/compare-code-points.ts';

/** A map that iterates in code point order of its keys, as the registry's maps do. */
export function sortedMap<V>(entries: Iterable<readonly [string, V]>): ReadonlyMap<string, V> {
  return new Map([...entries].sort(([left], [right]) => compareCodePoints(left, right)));
}
