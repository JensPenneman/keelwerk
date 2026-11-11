import { defineRule } from '@keelwerk/core';
import { addFeaturedBook } from '../../actions/add-featured-book.ts';
import { libraryBase } from '../../base.ts';

export const signedIn = defineRule(libraryBase, addFeaturedBook, {
  effect: 'allow',
  principal: 'user',
});
