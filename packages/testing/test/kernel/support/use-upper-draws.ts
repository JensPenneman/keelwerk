import { afterAll } from 'vitest';
import { holdUpperDraws } from './hold-upper-draws.ts';

/**
 * Holds the upper draws (`holdUpperDraws`) for every test of the calling file: taken when this is
 * called and released in `afterAll`. Call it at module top level, before anything boots a runtime
 * (also a boot in a top-level await), so every worker captures the held source.
 */
export function useUpperDraws(): void {
  const release = holdUpperDraws();
  afterAll(() => {
    release();
  });
}
