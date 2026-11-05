import type { StorageRow } from '../storage/storage-row.ts';
import { type FoldStreamInput, foldStream } from './fold-stream.ts';

/**
 * The row of a chain entity as it was at an instant (section 6.7): the fold of its stream up to
 * the last event accepted at or before it. `undefined` before the first event.
 */
export async function rowAsOfInstant(
  input: Omit<FoldStreamInput, 'keep'> & { readonly at: Temporal.Instant },
): Promise<StorageRow | undefined> {
  const folded = await foldStream({
    ...input,
    keep: (event) => Temporal.Instant.compare(event.recordedAt, input.at) <= 0,
  });
  return folded.row;
}
