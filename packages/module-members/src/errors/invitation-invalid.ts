import { defineError } from '@keelwerk/core';

export const invitationInvalid = defineError('members.invitation_invalid', {
  kind: 'not_found',
  message: 'This invitation is invalid, expired, withdrawn or already used.',
});
