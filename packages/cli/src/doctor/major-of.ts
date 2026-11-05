/** The major version of `1.2.3`; NaN when it has none. */
export function majorOf(version: string): number {
  return Number.parseInt(version.split('.')[0] ?? '', 10);
}
