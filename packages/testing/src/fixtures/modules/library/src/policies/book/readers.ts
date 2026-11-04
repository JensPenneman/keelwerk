import { defineRule } from '@keelwerk/core';
import { libraryBase } from '../../base.ts';
import { book } from '../../entities/book.ts';

export const readers = defineRule(libraryBase, book, {
  effect: 'allow',
  actions: ['read'],
  principal: 'user',
  reason: 'A signed-in user reads every book.',
});
