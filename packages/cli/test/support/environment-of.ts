/** An environment from name and value pairs; the names are upper-case, which an object literal may not spell. */
export function environmentOf(
  ...pairs: readonly (readonly [string, string])[]
): Record<string, string> {
  return Object.fromEntries(pairs);
}
