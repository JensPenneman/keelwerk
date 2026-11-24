import { field, shape } from '@keelwerk/core';

/** What `invite` and `createOwner` answer: the id, the accept token unless a delivery took it, and the expiry. */
export const invitationOutput = shape({
  id: field.ref.own('invitation'),
  token: field.string().optional(),
  expiresAt: field.instant(),
});
