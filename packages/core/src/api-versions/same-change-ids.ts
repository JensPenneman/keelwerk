import { compareCodePoints } from '../conditions/compare-code-points.ts';

/** Whether two lists name the same change ids, whatever their order. */
export function sameChangeIds(left: readonly string[], right: readonly string[]): boolean {
  const one = [...left].sort(compareCodePoints);
  const other = [...right].sort(compareCodePoints);
  return one.length === other.length && one.every((id, index) => id === other[index]);
}
