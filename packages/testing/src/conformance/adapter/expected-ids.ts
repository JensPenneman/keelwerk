import { conformanceId } from '@keelwerk/data/conformance';

/** The ids of rows `base + n` for each number, in id order. */
export function expectedIds(numbers: readonly number[], base: number): string[] {
  return numbers.map((n) => conformanceId(base + n)).sort();
}
