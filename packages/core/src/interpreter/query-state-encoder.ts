import type { Position } from '../storage/position.ts';
import type { StorageScope } from '../storage/storage-scope.ts';
import type { QueryStateSource } from './query-state-source.ts';

/**
 * Produces the `queryState` of a `query` load from the position its snapshot saw, the scope it
 * read and what it read. The default is the decimal position; the invoker supplies the
 * `v1.<epoch>.<position>.<scope>.<check>` token of section 15.2.6.
 */
export type QueryStateEncoder = (
  position: Position,
  scope: StorageScope,
  source?: QueryStateSource,
) => string;
