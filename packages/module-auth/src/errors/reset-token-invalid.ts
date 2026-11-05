import { defineError } from '@keelwerk/core';

export const resetTokenInvalid = defineError('auth.reset_token_invalid', {
  kind: 'unauthenticated',
  message: 'This reset link is invalid, expired or already used.',
});
