import { defineSubscription, field, mapItems, shape, within } from '@keelwerk/core';
import { loansBase } from '../../../base.ts';
import { whenLive } from '../condition.ts';

/** A public stream of the conformance app that stays open and carries nothing: the cases about the streams of anonymous callers hold it open. */
export const loanTicker = defineSubscription(within(loansBase, whenLive), {
  auth: { public: true },
  event: shape({ id: field.string() }),
  source: (_input, ctx, resume) =>
    mapItems(
      ctx.live.entity('loans', 'loan', { where: { borrower: { isNull: true } }, after: resume }),
      (change) => (change.type === 'removed' ? undefined : { id: change.id }),
    ),
});
