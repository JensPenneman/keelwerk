import type { Position } from '../storage/position.ts';
import type { StorageScope } from '../storage/storage-scope.ts';

/**
 * Produces the `queryState` of a `query` load from the position its snapshot saw and the scope it
 * read. The default is the decimal position; the state-token work package supplies the
 * `v1.<epoch>.<position>.<scope>.<check>` token of section 15.2.6.
 */
export type QueryStateEncoder = (position: Position, scope: StorageScope) => string;
