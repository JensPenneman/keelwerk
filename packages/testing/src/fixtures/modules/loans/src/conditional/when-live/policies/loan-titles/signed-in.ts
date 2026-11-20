import { defineRule, within } from '@keelwerk/core';
import { loansBase } from '../../../../base.ts';
import { loanTitles } from '../../actions/loan-titles.ts';
import { whenLive } from '../../condition.ts';

/** A signed-in user follows the titles of the loans they can read. */
export const signedIn = defineRule(within(loansBase, whenLive), loanTitles, {
  effect: 'allow',
  principal: 'user',
});
