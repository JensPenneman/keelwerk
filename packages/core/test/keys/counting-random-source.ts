import type { RandomSource } from '../../src/keys/random-source.ts';

/** A deterministic source for golden tests: bytes count up from `start` and continue across draws. */
export function countingRandomSource(start = 0): RandomSource {
  let next = start;
  return (bytes) => Uint8Array.from({ length: bytes }, () => next++ & 0xff);
}
