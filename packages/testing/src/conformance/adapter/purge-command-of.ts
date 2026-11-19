/** The command a stream numbered `number` belongs to in the purge cases. */
export function purgeCommandOf(number: number): string {
  return `purge-${number}`;
}
