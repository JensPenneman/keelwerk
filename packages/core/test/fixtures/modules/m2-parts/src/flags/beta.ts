import { defineFlag } from '@keelwerk/core';

export const beta = defineFlag({
  kind: 'boolean',
  level: 'tenant',
  purpose: 'release',
  expires: '2027-06-30',
  default: false,
});
