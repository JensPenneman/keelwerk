import type { ActionRef, AppActionTree, Registry, Row } from '@keelwerk/core';
import { describe, expectTypeOf, test } from 'vitest';
import type { Library } from './app.ts';

describe('the library fixture app', () => {
  test('has the book row and the two library actions', () => {
    expectTypeOf<Row<Library, 'library.book'>['isbn']>().toEqualTypeOf<string>();
    expectTypeOf<'library.addBook' | 'library.findByIsbn'>().toExtend<ActionRef<Library>>();
    expectTypeOf<
      AppActionTree<Library>['library']['actions']['addBook']['kind']
    >().toEqualTypeOf<'command'>();
  });

  test('carries the composed registry', () => {
    expectTypeOf<Library['registry']>().toEqualTypeOf<Registry>();
  });

  test('has the generated book actions, history included, and no watch', () => {
    expectTypeOf<
      | 'library.book.get'
      | 'library.book.query'
      | 'library.book.changes'
      | 'library.book.queryChanges'
      | 'library.book.set'
      | 'library.book.history'
    >().toExtend<ActionRef<Library>>();
    expectTypeOf<'library.book.watch'>().not.toExtend<ActionRef<Library>>();
  });
});
