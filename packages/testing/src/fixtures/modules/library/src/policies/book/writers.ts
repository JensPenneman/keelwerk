import { defineRule } from '@keelwerk/core';
import { libraryBase } from '../../base.ts';
import { book } from '../../entities/book.ts';

export const writers = defineRule(libraryBase, book, {
  effect: 'allow',
  actions: ['write'],
  principal: 'user',
  reason: 'A signed-in user adds and edits books.',
});
