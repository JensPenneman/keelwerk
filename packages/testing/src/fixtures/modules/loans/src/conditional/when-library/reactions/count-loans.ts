import { defineReaction, within } from '@keelwerk/core';
import { loansBase } from '../../../base.ts';
import { whenLibrary } from '../condition.ts';

export const countLoans = defineReaction(within(loansBase, whenLibrary), {
  on: 'loans.loan.created',
  timing: 'inline',
  react: () => [],
});
