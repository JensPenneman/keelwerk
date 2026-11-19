/**
 * The block of log lines that names the slowest entries: `<title>:` then at most `limit` entries,
 * slowest first (ties by name ascending), each `${(duration / 1000).toFixed(2).padStart(8)} s  ${name}`.
 * Returns [] when `timings` is empty. Durations are milliseconds.
 */
export function slowestLines(
  title: string,
  timings: readonly { readonly name: string; readonly duration: number }[],
  limit: number,
): readonly string[] {
  if (timings.length === 0) {
    return [];
  }
  const slowest = [...timings]
    .sort((a, b) => b.duration - a.duration || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .slice(0, limit);
  return [
    `${title}:`,
    ...slowest.map(
      ({ name, duration }) => `${(duration / 1000).toFixed(2).padStart(8)} s  ${name}`,
    ),
  ];
}
