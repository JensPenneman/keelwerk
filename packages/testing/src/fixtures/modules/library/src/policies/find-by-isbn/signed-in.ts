import { defineRule } from '@keelwerk/core';
import { findByIsbn } from '../../actions/find-by-isbn.ts';
import { libraryBase } from '../../base.ts';

export const signedIn = defineRule(libraryBase, findByIsbn, {
  effect: 'allow',
  principal: 'user',
});
