import { describe, expectTypeOf, test } from 'vitest';
import type { AppPolicies } from './define-app.ts';

describe('AppPolicies', () => {
  test('replace maps a module id to its replacement rules', () => {
    expectTypeOf<AppPolicies['replace']>().toEqualTypeOf<
      { readonly [module: string]: readonly object[] } | undefined
    >();
  });
});
