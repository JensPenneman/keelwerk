import { defineRule } from '@keelwerk/core';
import { closeAll } from '../../actions/close-all.ts';
import { loansBase } from '../../base.ts';

export const staff = defineRule(loansBase, closeAll, { effect: 'allow', principal: 'operator' });
