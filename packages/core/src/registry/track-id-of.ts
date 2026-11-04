/** The track id of a part: 'auth->accounts' with a `when` list in brackets, 'auth[accounts]' for a conditional part. The `when` names are sorted, so one set gives one id. */
export function trackIdOf(from: string, to: string | null, whenNames: readonly string[]): string {
  const bracket = whenNames.length === 0 ? '' : `[${[...whenNames].sort().join(',')}]`;
  return to === null || to === from ? `${from}${bracket}` : `${from}->${to}${bracket}`;
}
