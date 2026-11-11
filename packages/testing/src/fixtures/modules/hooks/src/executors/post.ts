import { createHmac } from 'node:crypto';
import { defineEffectExecutor, errors } from '@keelwerk/core';
import { hooksBase } from '../base.ts';
import { post as postEffect } from '../effects/post.ts';

/** One POST is all or nothing, so its retries are mechanical and belong to the executor: the effect id is the idempotency key of every attempt. */
export const post = defineEffectExecutor(hooksBase, postEffect, {
  queue: 'hooks',
  inline: true,
  timeout: '10s',
  group: ({ input }) => ({ id: `host:${new URL(input.url).host}`, concurrency: 2 }),
  retry: { delays: 'exponential', maxDelay: '30m', giveUpAfter: 'PT24H' },
  run: async (input, ctx) => {
    const key = await ctx.secrets.reveal(input.signingKey, 'sign an outbound webhook');
    const response = await ctx.egress.fetch(input.url, {
      method: 'POST',
      body: input.body,
      headers: {
        'content-type': 'application/json',
        'idempotency-key': ctx.effect.id,
        'x-signature-256': createHmac('sha256', key).update(input.body).digest('hex'),
      },
      signal: ctx.signal,
    });
    if (response.status === 429 || response.status >= 500) {
      throw errors.unavailable(`The endpoint answered ${response.status}.`);
    }
    return { status: response.status };
  },
});
