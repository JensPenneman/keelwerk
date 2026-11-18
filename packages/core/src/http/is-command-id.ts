import { isOpaqueId } from '../ids/is-opaque-id.ts';

/**
 * Whether a caller-chosen command id (the idempotency key) is acceptable (section 16.4.8): an
 * opaque id, a UUID of version 4 or 7, or a ULID (`isOpaqueId`). REST checks its `Idempotency-Key`
 * header with it and GraphQL its `commandId` member, so one id behaves alike over both; any other
 * text never reaches the receipt table, the chain or a job, where it could hold a personal value.
 */
export function isCommandId(value: string): boolean {
  return isOpaqueId(value);
}
