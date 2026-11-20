import { defineSubscription, field, mapItems, shape, within } from '@keelwerk/core';
import { loansBase } from '../../../base.ts';
import { whenLive } from '../condition.ts';

/**
 * The title of every loan the subscriber can read, as it is lent, under the event's own member
 * `control`: a value any borrower of the tenant writes. The conformance cases about control frames
 * hold that an item stays an item whatever that member holds.
 */
export const loanTitles = defineSubscription(within(loansBase, whenLive), {
  event: shape({ loanId: field.ref.own('loan'), control: field.string({ maxLength: 200 }) }),
  principal: 'user',
  source: (_input, ctx, resume) =>
    mapItems(ctx.live.entity('loans', 'loan', { after: resume }), (change) =>
      change.type === 'created' ? { loanId: change.id, control: change.row.bookTitle } : undefined,
    ),
});
