/**
 * A copy of a stored or returned value, so a caller that changes bytes, a set or a JSON document
 * never changes the store. `Temporal` values, strings, numbers and bigints are immutable.
 */
export function memoryCloneValue(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Uint8Array) return value.slice();
  if (value instanceof Set) return new Set([...value].map(memoryCloneValue));
  if (value instanceof Date) return new Date(value.getTime());
  if (Array.isArray(value)) return value.map(memoryCloneValue);
  const proto: unknown = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return value;
  const copy: Record<string, unknown> = {};
  for (const [name, member] of Object.entries(value)) copy[name] = memoryCloneValue(member);
  return copy;
}
