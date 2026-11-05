import { defineError } from '@keelwerk/core';

export const tooManyRecords = defineError('auth.too_many_records', {
  kind: 'conflict',
  message: 'This subject has too many sessions or links to change in one step.',
});
