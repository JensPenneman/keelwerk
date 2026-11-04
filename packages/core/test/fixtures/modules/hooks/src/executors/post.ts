import { defineEffectExecutor, KeelwerkError } from '@keelwerk/core';
import { hooksBase } from '../base.ts';
import { post as postEffect } from '../effects/post.ts';

export const post = defineEffectExecutor(hooksBase, postEffect, {
  inline: true,
  timeout: '10s',
  group: ({ input }) => ({ id: `host:${new URL(input.url).host}`, concurrency: 2 }),
  retry: { delays: 'exponential', maxDelay: '30m' },
  run: async (input, ctx) => {
    const key = await ctx.secrets.reveal(input.signingKey, 'sign an outbound webhook');
    const response = await ctx.egress.fetch(input.url, {
      method: 'POST',
      body: input.body,
      headers: { 'idempotency-key': ctx.effect.id, 'x-signature-length': String(key.length) },
      signal: ctx.signal,
    });
    if (response.status >= 500) {
      throw new KeelwerkError({
        kind: 'unavailable',
        code: 'hooks.endpoint_unavailable',
        message: `The endpoint answered ${response.status}.`,
      });
    }
    return { status: response.status };
  },
});
