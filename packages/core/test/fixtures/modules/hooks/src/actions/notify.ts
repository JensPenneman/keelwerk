import { defineCommand, field, shape } from '@keelwerk/core';
import { hooksBase } from '../base.ts';
import { post } from '../effects/post.ts';
import { delivery } from '../entities/delivery.ts';
import { recordOutcome } from './delivery/record-outcome.ts';

export const notify = defineCommand(hooksBase, {
  input: shape({ payload: field.text() }),
  output: shape({ deliveryId: field.ref.own('delivery') }),
  *decide(input, ctx) {
    const id = yield* ctx.newId(delivery);
    return {
      events: [ctx.write.hooks.delivery.create({ id, body: input.payload })],
      effects: [
        post(
          { url: ctx.config.endpoint, signingKey: ctx.config.signingKey, body: input.payload },
          { continueWith: recordOutcome, with: { id } },
        ),
      ],
      result: { deliveryId: id },
    };
  },
});
