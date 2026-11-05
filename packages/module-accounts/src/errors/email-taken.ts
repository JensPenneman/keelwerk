import { defineError, field, shape } from '@keelwerk/core';

export const emailTaken = defineError('accounts.email_taken', {
  kind: 'conflict',
  message: 'This e-mail address is already in use.',
  data: shape({ email: field.string() }),
});
