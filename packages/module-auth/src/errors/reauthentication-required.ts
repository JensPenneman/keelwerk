import { defineError } from '@keelwerk/core';

export const reauthenticationRequired = defineError('auth.reauthentication_required', {
  kind: 'forbidden',
  message: 'Confirm your password or sign in again to change a credential.',
});
