/**
 * The `position` an action job's input names (a reaction job's: the event's position in the log, as
 * decimal text), or undefined when the input names none or one that is no whole number.
 */
export function jobPositionOf(input: unknown): bigint | undefined {
  if (typeof input !== 'object' || input === null) return undefined;
  const position: unknown = Reflect.get(input, 'position');
  return typeof position === 'string' && /^\d{1,30}$/.test(position) ? BigInt(position) : undefined;
}
