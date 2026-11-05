import { defineRule } from '@keelwerk/core';
import { check } from '../../actions/check.ts';
import { vaultBase } from '../../base.ts';

export const signedIn = defineRule(vaultBase, check, { effect: 'allow', principal: 'user' });
