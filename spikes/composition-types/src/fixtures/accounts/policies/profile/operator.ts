import { defineRule } from '../../../../define-rule.ts';
import { accountsBase } from '../../base.ts';
import { profile } from '../../entities/profile.ts';

export const operator = defineRule(accountsBase, profile, {
  effect: 'allow',
  actions: ['*'],
  principal: 'operator',
});
