import { effectJobError } from '../executors/effect-job-error.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import type { InlineAnswer } from './inline-answer.ts';

/**
 * A settled `core.effect` row as the answer of a `perform`: a succeeded effect answers its output as
 * the record keeps it, a failed or abandoned one the closed projection of its error as a wire error.
 */
export function inlineAnswerOf(row: StorageRow): InlineAnswer {
  if (row.status === 'succeeded') return { ok: true, value: row.output };
  return {
    ok: false,
    error: effectJobError(row.error as Parameters<typeof effectJobError>[0]),
  };
}
