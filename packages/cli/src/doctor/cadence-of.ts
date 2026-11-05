/** Milliseconds of an ISO 8601 duration such as `PT15M` or `P1D`; undefined for `batch` and anything unreadable. */
export function cadenceOf(every: string | undefined): number | undefined {
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(every ?? '');
  if (match === null || every === 'P') return undefined;
  const [, days, hours, minutes, seconds] = match.map((part) => Number(part ?? 0));
  return ((days ?? 0) * 86_400 + (hours ?? 0) * 3600 + (minutes ?? 0) * 60 + (seconds ?? 0)) * 1000;
}
