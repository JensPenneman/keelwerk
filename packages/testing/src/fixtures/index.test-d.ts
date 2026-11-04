import { defineModule } from '@keelwerk/core';
import { describe, expectTypeOf, test } from 'vitest';
import type { Library } from './index.ts';
import { addBook } from './modules/library/src/actions/add-book.ts';
import { findByIsbn } from './modules/library/src/actions/find-by-isbn.ts';
import { libraryBase } from './modules/library/src/base.ts';
import { signedIn as addBookSignedIn } from './modules/library/src/policies/add-book/signed-in.ts';
import { readers } from './modules/library/src/policies/book/readers.ts';
import { signedIn as findByIsbnSignedIn } from './modules/library/src/policies/find-by-isbn/signed-in.ts';

describe('the library fixture manifest', () => {
  test('has the type of the same module written in one file', () => {
    const written = defineModule(libraryBase, {
      actions: { addBook, findByIsbn },
      policies: {
        addBook: { signedIn: addBookSignedIn },
        book: { readers },
        findByIsbn: { signedIn: findByIsbnSignedIn },
      },
    });
    expectTypeOf<Library>().toEqualTypeOf<typeof written>();
  });
});
