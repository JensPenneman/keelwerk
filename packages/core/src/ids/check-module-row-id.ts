import { isRowId } from '../generated-actions/is-row-id.ts';
import { refuseRequest } from '../interpreter/refuse-request.ts';
import { isOpaqueId } from './is-opaque-id.ts';

/**
 * Checks the id a module names in `create({ id })`: a UUID of version 4 or 7 (either case) passes.
 * A row id is stored in the chain-hashed events, in `kw_subject_refs`, in every reference to the
 * row and in the partition of a serial, where an erasure does not reach it, so an id that is a hash
 * of a name (an address, a phone number) must never get there. Anything else, a ULID included (it
 * does not fit the uuid column of the event store), is `core.request_not_allowed` (internal); the
 * message never repeats the id. The compose check on the partition of a serial
 * (`checkSerialPartitions`) is the other rule on values that reach those stores; an author reads
 * the two together.
 */
export function checkModuleRowId(entity: string, id: string): void {
  if (isRowId(id) && isOpaqueId(id)) return;
  throw refuseRequest(
    `create of "${entity}"`,
    'a row id a module chooses is a UUID of version 4 or 7',
  );
}
