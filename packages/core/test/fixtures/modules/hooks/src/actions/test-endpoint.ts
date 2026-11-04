import { defineCommand, field, shape } from '@keelwerk/core';
import { hooksBase } from '../base.ts';
import { post } from '../effects/post.ts';

export const testEndpoint = defineCommand(hooksBase, {
  output: shape({ status: field.integer().optional(), error: field.string().optional() }),
  principal: 'operator',
  *prepare(_input, ctx) {
    return yield* ctx.perform(
      post({ url: ctx.config.endpoint, signingKey: ctx.config.signingKey, body: '{}' }),
    );
  },
  decide: (_input, ctx) => ({
    result: ctx.prepared.ok
      ? { status: ctx.prepared.value.status }
      : { error: ctx.prepared.error.code },
  }),
});
