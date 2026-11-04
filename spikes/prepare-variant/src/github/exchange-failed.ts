import { defineError, field, shape } from '@keelwerk/core';

export const exchangeFailed = defineError('github.exchange_failed', {
  kind: 'unavailable',
  message: 'GitHub did not accept the code.',
  data: shape({ reason: field.string() }),
});
