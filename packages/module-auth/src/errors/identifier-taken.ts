import { defineError } from '@keelwerk/core';

export const identifierTaken = defineError('auth.identifier_taken', {
  kind: 'conflict',
  message: 'This identifier already has a password.',
});
