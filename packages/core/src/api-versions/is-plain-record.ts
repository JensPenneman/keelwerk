/**
 * Whether a value is a plain object: an object literal or one made by `Object.create(null)` or
 * `JSON.parse`. A class instance (a Set, a Date), an array and `null` are not.
 */
export function isPlainRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
