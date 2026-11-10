import { expectTypeOf, test } from 'vitest';
import type { Gen } from '../protocol/gen.ts';
import type { PrincipalFromRef } from './principal-from-ref.ts';
import type { PrincipalResolution } from './principal-resolution.ts';
import type { PrincipalResolver } from './principal-resolver.ts';

test('fromRef answers like resolve', () => {
  expectTypeOf<ReturnType<PrincipalFromRef['fromRef']>>().toEqualTypeOf<
    Gen<PrincipalResolution | null>
  >();
  expectTypeOf<ReturnType<PrincipalResolver['resolve']>>().toEqualTypeOf<
    Gen<PrincipalResolution | null>
  >();
});

test('PrincipalResolver.fromRef is optional', () => {
  expectTypeOf<Omit<PrincipalResolver, 'fromRef'>>().toExtend<PrincipalResolver>();
  expectTypeOf<Pick<PrincipalResolver, 'fromRef'>>().toEqualTypeOf<{
    readonly fromRef?: PrincipalFromRef['fromRef'];
  }>();
});
