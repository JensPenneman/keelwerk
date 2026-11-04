/**
 * `translate` (section 9.2): the version changes the session's API version lacks, applied to the
 * input (oldest first) and to the output (newest first). The identity until M2, when the first
 * version change exists.
 */
export function translate<T>(_direction: 'input' | 'output', value: T): T {
  return value;
}
