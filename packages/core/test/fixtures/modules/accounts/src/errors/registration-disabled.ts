import { defineError } from '@keelwerk/core';

export const registrationDisabled = defineError('accounts.registration_disabled', {
  kind: 'forbidden',
  message: 'Self-registration is disabled.',
});
