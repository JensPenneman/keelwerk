import { defineRule } from '@keelwerk/core';
import { login } from '../../actions/login.ts';
import { authBase } from '../../base.ts';

export const open = defineRule(authBase, login, { effect: 'allow', public: true });
