import { defineRule } from '../../../../define-rule.ts';
import { login } from '../../actions/login.ts';
import { authBase } from '../../base.ts';

export const open = defineRule(authBase, login, { effect: 'allow', public: true });
