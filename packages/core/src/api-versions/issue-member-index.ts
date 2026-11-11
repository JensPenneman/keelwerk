type Path = readonly PropertyKey[];

/** Where an issue path runs through a row position (`'*'` steps into an array item): the index of the member step after it, or -1. */
export function issueMemberIndex(path: Path, position: readonly string[]): number {
  const matches = position.every(
    (step, index) => path[index] === step || (step === '*' && typeof path[index] === 'number'),
  );
  return matches && typeof path[position.length] === 'string' ? position.length : -1;
}
