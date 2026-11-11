import { describe, expectTypeOf, test } from 'vitest';
import type { CoreBase } from '../core-module/core-base-type.ts';
import type { ExtensionPoint } from '../dsl/extension-point.ts';
import { extensionPoint } from '../dsl/extension-point.ts';
import type { LiveHub } from '../live/live-hub.ts';
import type { ExtensionValue } from './extension-value.ts';

describe('ExtensionValue', () => {
  test('a min 0 single point reads T or undefined', () => {
    expectTypeOf<ExtensionValue<ExtensionPoint<number, 'single', true>>>().toEqualTypeOf<
      number | undefined
    >();
    expectTypeOf(extensionPoint.single<number>({ min: 0 })).toEqualTypeOf<
      ExtensionPoint<number, 'single', true>
    >();
  });

  test('a plain single point reads T', () => {
    expectTypeOf<ExtensionValue<ExtensionPoint<number, 'single'>>>().toEqualTypeOf<number>();
    expectTypeOf(extensionPoint.single<number>()).toEqualTypeOf<ExtensionPoint<number, 'single'>>();
  });

  test('the other modes read lists', () => {
    expectTypeOf<ExtensionValue<ExtensionPoint<number, 'set'>>>().toEqualTypeOf<
      readonly number[]
    >();
  });

  test('liveHub reads LiveHub or undefined', () => {
    expectTypeOf<ExtensionValue<CoreBase['extensionPoints']['liveHub']>>().toEqualTypeOf<
      LiveHub | undefined
    >();
  });

  test('a single point refuses a min above 1', () => {
    // @ts-expect-error a single point takes min 0 or 1 only
    extensionPoint.single<number>({ min: 2 });
  });
});
