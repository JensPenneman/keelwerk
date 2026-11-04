/** A timestamp column as a driver returns it (a `Date` or text), in epoch milliseconds. */
export function instantMs(value: unknown): number {
  return value instanceof Date ? value.getTime() : Date.parse(String(value));
}
