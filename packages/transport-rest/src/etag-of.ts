/** The entity tag of a row version: the version in double quotes (section 16.4.9). */
export function etagOf(version: number | bigint | string): string {
  return `"${version}"`;
}
