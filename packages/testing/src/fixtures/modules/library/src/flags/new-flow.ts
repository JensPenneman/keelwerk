import { defineFlag } from '@keelwerk/core';

export const newFlow = defineFlag({
  kind: 'boolean',
  default: false,
  level: 'tenant',
  purpose: 'release',
  expires: '2027-06-30',
});
