import { defineRule } from '@keelwerk/core';
import { retire } from '../../actions/retire.ts';
import { vaultBase } from '../../base.ts';

export const signedIn = defineRule(vaultBase, retire, { effect: 'allow', principal: 'user' });
