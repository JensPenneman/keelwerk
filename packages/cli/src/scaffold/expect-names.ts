import { usageFailure } from '../context/usage-failure.ts';

/** The names after the module id, checked against the counts a kind accepts. */
export function expectNames(
  kind: string,
  names: readonly string[],
  counts: readonly number[],
  shape: string,
): readonly string[] {
  if (!counts.includes(names.length)) {
    throw usageFailure(`keelwerk new ${kind} takes a reference of the form ${shape}.`);
  }
  return names;
}
