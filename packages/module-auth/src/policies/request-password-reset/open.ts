import { defineRule } from '@keelwerk/core';
import { requestPasswordReset } from '../../actions/request-password-reset.ts';
import { authBase } from '../../base.ts';

export const open = defineRule(authBase, requestPasswordReset, { effect: 'allow', public: true });
