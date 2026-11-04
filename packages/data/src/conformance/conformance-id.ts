/** A fixed UUID for row number `n`; ids sort in the order of `n`. */
export function conformanceId(n: number): string {
  return `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`;
}
