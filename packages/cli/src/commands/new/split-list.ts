/** `a,b` becomes `['a', 'b']`; absent becomes empty. */
export function splitList(value: string | undefined): readonly string[] {
  return value === undefined
    ? []
    : value
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item !== '');
}
