import { errors } from '../errors/errors.ts';
import { isOpaqueId } from './is-opaque-id.ts';
import { refuseReservedCommandId } from './refuse-reserved-command-id.ts';

/**
 * Checks a command id a caller chose (a client, an `enqueue` effect, a CLI flag): `undefined`
 * passes; the kernel's own form is refused first (`refuseReservedCommandId`,
 * `core.command_id_reserved`); then anything but a UUID of version 4 or 7, or a ULID
 * (`isOpaqueId`) is a `validation` error at the path `['commandId']`. A command id is stored in
 * clear text in receipts, in the chain-hashed meta of events and in jobs, where an erasure does not
 * reach it, so a caller's text that names a person or a row never gets there. The message never
 * repeats the id.
 */
export function checkCallerCommandId(commandId: string | undefined): void {
  refuseReservedCommandId(commandId);
  if (commandId === undefined || isOpaqueId(commandId)) return;
  throw errors.validation('A command id is a UUID of version 4 or 7, or a ULID.', {
    issues: [
      { path: ['commandId'], message: 'A command id is a UUID of version 4 or 7, or a ULID.' },
    ],
  });
}
