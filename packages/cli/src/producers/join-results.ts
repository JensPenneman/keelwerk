import type { ProducerResult } from './producer-result.ts';

/** The results of several runs as one, in the order given. */
export function joinResults(results: readonly ProducerResult[]): ProducerResult {
  return {
    written: results.flatMap((result) => result.written),
    notes: results.flatMap((result) => result.notes),
    failures: results.flatMap((result) => result.failures),
  };
}
