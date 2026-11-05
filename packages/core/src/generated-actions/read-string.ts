import { invalidArgument } from './invalid-argument.ts';

/** An optional string. */
export function readString(value: unknown, path: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw invalidArgument(path, 'It must be a string.');
  return value;
}
