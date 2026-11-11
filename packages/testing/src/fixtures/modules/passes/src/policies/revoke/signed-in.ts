import { defineRule } from '@keelwerk/core';
import { revoke } from '../../actions/revoke.ts';
import { passesBase } from '../../base.ts';

export const signedIn = defineRule(passesBase, revoke, { effect: 'allow', principal: 'user' });
