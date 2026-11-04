import { randomBytes } from 'node:crypto';
import type { RandomSource } from './random-source.ts';

/** The production source: the operating system's CSPRNG. */
export const defaultRandomSource: RandomSource = (bytes) => new Uint8Array(randomBytes(bytes));
