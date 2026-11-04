import { defineRule } from '../../../../define-rule.ts';
import { register } from '../../actions/register.ts';
import { accountsBase } from '../../base.ts';

export const open = defineRule(accountsBase, register, { effect: 'allow', public: true });
