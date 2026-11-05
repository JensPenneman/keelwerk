import { defineRule } from '@keelwerk/core';
import { logout } from '../../actions/logout.ts';
import { authBase } from '../../base.ts';

export const signedIn = defineRule(authBase, logout, { effect: 'allow', principal: 'user' });
