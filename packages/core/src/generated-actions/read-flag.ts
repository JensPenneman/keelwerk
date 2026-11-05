import { invalidArgument } from './invalid-argument.ts';

/** Whether a flag member is set; anything but a boolean is `validation`. */
export function readFlag(value: unknown, path: string): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value !== 'boolean') throw invalidArgument(path, 'It must be a boolean.');
  return value;
}
