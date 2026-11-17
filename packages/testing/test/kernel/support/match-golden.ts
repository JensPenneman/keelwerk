import { expect } from 'vitest';
import { golden } from './runtime-kit.ts';

/** Compares `value` with the committed file `golden/<name>.json`. */
export function matchGolden(name: string, value: unknown): void {
  expect(value).toEqual(golden(name));
}
