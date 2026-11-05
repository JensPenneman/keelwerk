import { defineRule } from '@keelwerk/core';
import { libraryBase } from '../../base.ts';
import { book } from '../../entities/book.ts';

export const operators = defineRule(libraryBase, book, {
  effect: 'allow',
  actions: ['get', 'query'],
  principal: 'operator',
  reason: 'An operator who entered the tenant reads its books.',
});
