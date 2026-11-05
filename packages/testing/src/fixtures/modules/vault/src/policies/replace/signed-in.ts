import { defineRule } from '@keelwerk/core';
import { replace } from '../../actions/replace.ts';
import { vaultBase } from '../../base.ts';

export const signedIn = defineRule(vaultBase, replace, { effect: 'allow', principal: 'user' });
