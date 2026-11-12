import { defineRule } from '@keelwerk/core';
import { addBookAt } from './add-book-at.ts';
import { laterBase } from './base.ts';

export const laterCallers = defineRule(laterBase, addBookAt, {
  effect: 'allow',
  principal: 'user',
});
