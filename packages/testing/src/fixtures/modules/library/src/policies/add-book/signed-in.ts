import { defineRule } from '@keelwerk/core';
import { addBook } from '../../actions/add-book.ts';
import { libraryBase } from '../../base.ts';

export const signedIn = defineRule(libraryBase, addBook, { effect: 'allow', principal: 'user' });
