import { defineRule } from '@keelwerk/core';
import { lend } from '../../actions/lend.ts';
import { loansBase } from '../../base.ts';

export const signedIn = defineRule(loansBase, lend, { effect: 'allow', principal: 'user' });
