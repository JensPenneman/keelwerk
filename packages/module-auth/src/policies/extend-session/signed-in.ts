import { defineRule } from '@keelwerk/core';
import { extendSession } from '../../actions/extend-session.ts';
import { authBase } from '../../base.ts';

export const signedIn = defineRule(authBase, extendSession, { effect: 'allow', principal: 'user' });
