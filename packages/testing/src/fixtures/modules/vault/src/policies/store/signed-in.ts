import { defineRule } from '@keelwerk/core';
import { store } from '../../actions/store.ts';
import { vaultBase } from '../../base.ts';

export const signedIn = defineRule(vaultBase, store, { effect: 'allow', principal: 'user' });
