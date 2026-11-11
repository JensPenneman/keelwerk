import { defineCommand, outcomeOf } from '@keelwerk/core';
import { hooksBase } from '../../base.ts';
import { post } from '../../effects/post.ts';
import { delivery } from '../../entities/delivery.ts';

export const recordOutcome = defineCommand(hooksBase, delivery, {
  input: outcomeOf(post),
  decide: (input, _current, ctx) => {
    const status = input.outcome.ok ? input.outcome.value.status : undefined;
    return [
      ctx.events.settled({
        status: status !== undefined && status < 300 ? 'delivered' : 'failed',
        responseStatus: status,
      }),
    ];
  },
});
