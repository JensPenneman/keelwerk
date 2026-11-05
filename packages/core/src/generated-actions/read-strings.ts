import { invalidArgument } from './invalid-argument.ts';

/** A list of strings. */
export function readStrings(value: unknown, path: string): readonly string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw invalidArgument(path, 'It must be a list of strings.');
  }
  return value as readonly string[];
}
