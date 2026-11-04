/** The name at an index of a list the caller has already length-checked. */
export function nameAt(names: readonly string[], index: number): string {
  const name = names[index];
  if (name === undefined) {
    throw new RangeError(`no name at ${index}`);
  }
  return name;
}
