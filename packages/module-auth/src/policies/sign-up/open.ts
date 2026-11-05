import { defineRule } from '@keelwerk/core';
import { signUp } from '../../actions/sign-up.ts';
import { authBase } from '../../base.ts';

export const open = defineRule(authBase, signUp, { effect: 'allow', public: true });
