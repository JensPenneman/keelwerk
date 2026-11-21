/** The median and the spread of one cell over its rounds. */
export interface Summary {
  readonly median: number;
  readonly min: number;
  readonly max: number;
}

export function summarise(values: readonly number[]): Summary {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 1
      ? (sorted[middle] ?? Number.NaN)
      : ((sorted[middle - 1] ?? Number.NaN) + (sorted[middle] ?? Number.NaN)) / 2;
  return { median, min: sorted[0] ?? Number.NaN, max: sorted.at(-1) ?? Number.NaN };
}

/** `median (min-max)`, rounded to `digits` decimals. */
export function spread(summary: Summary, digits = 0): string {
  const text = (value: number) => value.toFixed(digits);
  return `${text(summary.median)} (${text(summary.min)}-${text(summary.max)})`;
}
