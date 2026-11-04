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

  test('has no generated book actions, because the fixture switches them off', () => {
    expectTypeOf<'library.book.get'>().not.toExtend<ActionRef<Library>>();
  });
});
