import { describe, expectTypeOf, it } from 'vitest';
import type { ErrorKind } from './error-kind.ts';
import { errorKinds } from './error-kinds.ts';

describe('errorKinds', () => {
  it('is a list of error kinds', () => {
    expectTypeOf(errorKinds).toEqualTypeOf<readonly ErrorKind[]>();
  });
});
