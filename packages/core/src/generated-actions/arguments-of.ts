import { invalidArgument } from './invalid-argument.ts';

/** The input as an object; absent is the empty object. */
export function argumentsOf(input: unknown): Readonly<Record<string, unknown>> {
  if (input === undefined || input === null) return {};
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw invalidArgument('input', 'The input must be an object.');
  }
  return input as Readonly<Record<string, unknown>>;
}
