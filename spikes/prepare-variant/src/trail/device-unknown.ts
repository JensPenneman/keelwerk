import { defineError, field, shape } from '@keelwerk/core';

export const deviceUnknown = defineError('trail.device_unknown', {
  kind: 'not_found',
  message: 'No device has this id.',
  data: shape({ deviceId: field.string() }),
});
