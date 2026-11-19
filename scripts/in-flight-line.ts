/**
 * The log line naming the test files that run now, longest running first (ties by path), each with
 * its whole seconds since it started; undefined when no file runs.
 * Format: `Test files in flight: <path> (<s> s), <path> (<s> s)`.
 */
export function inFlightLine(
  started: ReadonlyMap<string, number>,
  now: number,
): string | undefined {
  if (started.size === 0) {
    return undefined;
  }
  const files = [...started].sort(
    ([pathA, startA], [pathB, startB]) =>
      startA - startB || (pathA < pathB ? -1 : pathA > pathB ? 1 : 0),
  );
  return `Test files in flight: ${files
    .map(([path, start]) => `${path} (${Math.floor((now - start) / 1000)} s)`)
    .join(', ')}`;
}
