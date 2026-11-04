import { defineError, field, shape } from '@keelwerk/core';

export const stateUnknown = defineError('github.state_unknown', {
  kind: 'conflict',
  message: 'The state does not belong to an open connection start.',
  data: shape({ state: field.string() }),
});
