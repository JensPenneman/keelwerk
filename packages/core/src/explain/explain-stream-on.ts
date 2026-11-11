/** Whether the explain stream is on: development, and `KEELWERK_EXPLAIN` is `1` (sections 11 and 13.6). */
export function explainStreamOn(options: {
  readonly development: boolean;
  readonly env: Readonly<Record<string, string | undefined>>;
}): boolean {
  return options.development && options.env.KEELWERK_EXPLAIN === '1';
}
