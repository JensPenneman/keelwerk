import { defineRule } from '@keelwerk/core';
import { loansBase } from '../../base.ts';
import { loan } from '../../entities/loan.ts';

export const borrowers = defineRule(loansBase, loan, {
  effect: 'allow',
  actions: ['read'],
  principal: 'user',
  where: (ctx) => ({ borrower: ctx.principal.subject }),
  fields: ['note'],
});
