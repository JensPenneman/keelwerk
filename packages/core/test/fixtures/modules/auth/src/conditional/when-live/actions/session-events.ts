import { defineSubscription, field, mapItems, shape, within } from '@keelwerk/core';
import { authBase } from '../../../base.ts';
import { whenLive } from '../condition.ts';

export const sessionEvents = defineSubscription(within(authBase, whenLive), {
  event: shape({ sessionId: field.ref.own('session'), kind: field.enum(['created', 'revoked']) }),
  principal: 'user',
  source: (_input, ctx, resume) =>
    mapItems(
      ctx.live.entity('auth', 'session', {
        where: { subject: ctx.principal.subject },
        after: resume,
      }),
      (change) =>
        change.type === 'removed'
          ? undefined
          : { sessionId: change.id, kind: change.type === 'created' ? 'created' : 'revoked' },
    ),
});
