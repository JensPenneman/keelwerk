import { defineRule } from '@keelwerk/core';
import { resetPassword } from '../../actions/reset-password.ts';
import { authBase } from '../../base.ts';

export const open = defineRule(authBase, resetPassword, { effect: 'allow', public: true });
