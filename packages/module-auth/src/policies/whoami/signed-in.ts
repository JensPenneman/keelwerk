import { defineRule } from '@keelwerk/core';
import { whoami } from '../../actions/whoami.ts';
import { authBase } from '../../base.ts';

export const signedIn = defineRule(authBase, whoami, { effect: 'allow', principal: 'user' });
