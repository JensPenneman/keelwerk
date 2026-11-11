import { defineRule } from '@keelwerk/core';
import { label } from '../../actions/label.ts';
import { passesBase } from '../../base.ts';

export const signedIn = defineRule(passesBase, label, { effect: 'allow', principal: 'user' });
