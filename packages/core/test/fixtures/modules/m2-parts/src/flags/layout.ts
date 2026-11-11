import { defineFlag } from '@keelwerk/core';

export const layout = defineFlag({
  kind: 'variant',
  level: 'tenant',
  purpose: 'operational',
  variants: ['control', 'compact'],
  default: 'control',
});
