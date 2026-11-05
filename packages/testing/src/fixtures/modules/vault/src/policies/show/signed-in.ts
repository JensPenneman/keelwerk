import { defineRule } from '@keelwerk/core';
import { show } from '../../actions/show.ts';
import { vaultBase } from '../../base.ts';

export const signedIn = defineRule(vaultBase, show, { effect: 'allow', principal: 'user' });
