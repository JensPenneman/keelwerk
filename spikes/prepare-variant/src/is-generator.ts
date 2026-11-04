/** Whether a handler returned a generator rather than a plain decision. */
export function isGenerator(value: unknown): value is Generator<unknown, unknown, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'next' in value &&
    typeof value.next === 'function' &&
    'return' in value &&
    typeof value.return === 'function' &&
    Symbol.iterator in value
  );
}
