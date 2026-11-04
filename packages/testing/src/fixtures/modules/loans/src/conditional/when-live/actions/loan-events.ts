import { defineSubscription, field, mapItems, shape, within } from '@keelwerk/core';
import { loansBase } from '../../../base.ts';
import { whenLive } from '../condition.ts';

export const loanEvents = defineSubscription(within(loansBase, whenLive), {
  event: shape({ loanId: field.ref.own('loan'), kind: field.enum(['created', 'closed']) }),
  principal: 'user',
  source: (_input, ctx, resume) =>
    mapItems(
      ctx.live.entity('loans', 'loan', {
        where: { borrower: ctx.principal.subject },
        after: resume,
      }),
      (change) =>
        change.type === 'removed'
          ? undefined
          : { loanId: change.id, kind: change.type === 'created' ? 'created' : 'closed' },
    ),
});
