import { defineQuery, field, shape } from '@keelwerk/core';
import { loansBase } from '../base.ts';

export const about = defineQuery(loansBase, {
  auth: { public: true },
  input: shape({}),
  output: shape({ module: field.string() }),
  read: () => ({ module: 'loans' }),
});
