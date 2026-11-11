const separator = '\u0000';

/** The key of one schedule row, or of a provisioned group, in the ticker's memory: the parts joined by a NUL. */
export function scheduleRowKey(first: string, second: string): string {
  return `${first}${separator}${second}`;
}
