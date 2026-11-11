/** Whether a value is a plain object with named members: not null, not an array. */
export function isMemberRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
