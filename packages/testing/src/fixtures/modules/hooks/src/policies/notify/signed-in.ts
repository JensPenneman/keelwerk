import { defineRule } from '@keelwerk/core';
import { notify } from '../../actions/notify.ts';
import { hooksBase } from '../../base.ts';

export const signedIn = defineRule(hooksBase, notify, { effect: 'allow', principal: 'user' });
