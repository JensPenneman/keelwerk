import { defineRule } from '@keelwerk/core';
import { loansBase } from '../../base.ts';
import { loan } from '../../entities/loan.ts';

export const auditors = defineRule(loansBase, loan, {
  effect: 'allow',
  actions: ['read'],
  principal: 'user',
  where: (ctx) =>
    ctx.principal.roles.includes('auditor') ? {} : { borrower: ctx.principal.subject },
  fields: [],
  reason: 'An auditor reads every loan, without the maskable note.',
});
