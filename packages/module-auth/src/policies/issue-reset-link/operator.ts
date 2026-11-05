import { defineRule } from '@keelwerk/core';
import { issueResetLink } from '../../actions/issue-reset-link.ts';
import { authBase } from '../../base.ts';

export const operator = defineRule(authBase, issueResetLink, {
  effect: 'allow',
  principal: 'operator',
});
