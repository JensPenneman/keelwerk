import { defineApp } from '@keelwerk/core';
import { describe, expectTypeOf, test } from 'vitest';
import type { Library } from '../fixtures/apps/library/src/app.ts';
import { library } from '../fixtures/modules/library/src/module.generated.ts';
import type { ExpectValidApp, HasAction, HasEntity } from './index.ts';

// @ts-expect-error duplicateModuleIds: the same module twice
const duplicated = defineApp({ id: 'twice', modules: [library, library] as const });

describe('the type helpers', () => {
  test('ExpectValidApp is true for an app that composes', () => {
    expectTypeOf<ExpectValidApp<Library>>().toEqualTypeOf<true>();
  });

  test('ExpectValidApp names the check an app fails', () => {
    expectTypeOf<ExpectValidApp<typeof duplicated>>().toHaveProperty('duplicateModuleIds');
    expectTypeOf<ExpectValidApp<typeof duplicated>>().not.toEqualTypeOf<true>();
  });

  test('HasEntity and HasAction tell what the app has', () => {
    expectTypeOf<HasEntity<Library, 'library.book'>>().toEqualTypeOf<true>();
    expectTypeOf<HasEntity<Library, 'library.shelf'>>().toEqualTypeOf<false>();
    expectTypeOf<HasAction<Library, 'library.addBook'>>().toEqualTypeOf<true>();
    expectTypeOf<HasAction<Library, 'library.removeBook'>>().toEqualTypeOf<false>();
  });

  test('a union of references is true only when the app has every one', () => {
    expectTypeOf<HasEntity<Library, 'library.book' | 'library.shelf'>>().toEqualTypeOf<false>();
    expectTypeOf<
      HasAction<Library, 'library.addBook' | 'library.removeBook'>
    >().toEqualTypeOf<false>();
    expectTypeOf<
      HasAction<Library, 'library.addBook' | 'library.findByIsbn'>
    >().toEqualTypeOf<true>();
  });
});
