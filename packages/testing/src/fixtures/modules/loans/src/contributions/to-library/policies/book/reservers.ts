import { defineRule, within } from '@keelwerk/core';
import { loansBase } from '../../../../base.ts';
import { toLibrary } from '../../contribution.ts';

export const reservers = defineRule(within(loansBase, toLibrary), 'book', {
  effect: 'allow',
  actions: ['reserve'],
  principal: 'user',
});
