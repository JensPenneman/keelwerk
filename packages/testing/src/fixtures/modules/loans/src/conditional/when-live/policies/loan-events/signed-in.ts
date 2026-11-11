import { defineRule, within } from '@keelwerk/core';
import { loansBase } from '../../../../base.ts';
import { loanEvents } from '../../actions/loan-events.ts';
import { whenLive } from '../../condition.ts';

/** A signed-in user follows the loans they can read: the subscription's own source filters by borrower. */
export const signedIn = defineRule(within(loansBase, whenLive), loanEvents, {
  effect: 'allow',
  principal: 'user',
});
