/** `caseless`: NFKC, then locale-independent lower case (14.7.9.3). */
export function caseless(value: string): string {
  return value.normalize('NFKC').toLowerCase();
}
