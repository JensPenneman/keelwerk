import { defineError, field, shape } from '@keelwerk/core';

export const alreadyLent = defineError('loans.already_lent', {
  kind: 'conflict',
  message: 'This book is already lent out.',
  data: shape({ bookTitle: field.string() }),
});
