import { defineError } from '@keelwerk/core';

export const invalidCredentials = defineError('auth.invalid_credentials', {
  kind: 'unauthenticated',
  message: 'Unknown identifier or wrong password.',
});
