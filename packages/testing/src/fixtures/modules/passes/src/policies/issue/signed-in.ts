import { defineRule } from '@keelwerk/core';
import { issue } from '../../actions/issue.ts';
import { passesBase } from '../../base.ts';

export const signedIn = defineRule(passesBase, issue, { effect: 'allow', principal: 'user' });
