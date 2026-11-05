import { invalidArgument } from './invalid-argument.ts';

/** A size or count: an integer of at least 1, at most the entity's maximum (a page over it is `validation`, never a silent cap). */
export function readSize(value: unknown, path: string, maximum: number): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw invalidArgument(path, 'It must be a positive integer.');
  }
  if (value > maximum) throw invalidArgument(path, `It must be at most ${maximum}.`);
  return value;
}
