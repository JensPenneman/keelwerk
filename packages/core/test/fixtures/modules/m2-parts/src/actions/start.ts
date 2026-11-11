import { defineCommand, field, shape } from '@keelwerk/core';
import { m2PartsBase } from '../base.ts';

export const start = defineCommand(m2PartsBase, {
  gate: 'beta',
  input: shape({ name: field.string() }),
  output: shape({ compact: field.boolean() }),
  *decide(_input, ctx) {
    const beta = yield* ctx.flags.m2Parts.beta;
    return { events: [], result: { compact: beta } };
  },
});
