import { chainColumns } from './chain-columns.ts';

/**
 * The select list of a read that loads a row for a write: every field of the entity and the chain
 * columns, which the default projection leaves out, so the write chains from the row without
 * reading the stream.
 */
export function chainSelect(fieldNames: Iterable<string>): readonly string[] {
  return [...fieldNames, ...chainColumns];
}
