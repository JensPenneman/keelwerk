import { defineFlag } from '@keelwerk/core';

export const limit = defineFlag({
  kind: 'number',
  level: 'backend',
  purpose: 'operational',
  default: 10,
});
