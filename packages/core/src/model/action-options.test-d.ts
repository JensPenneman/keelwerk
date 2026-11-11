import { expectTypeOf, test } from 'vitest';
import type { ActionOptions } from './action-options.ts';

test('an action may declare the invocation scope (an additive change to the DSL)', () => {
  type Scope = NonNullable<ActionOptions<never, never, readonly [], 'user'>['scope']>;
  expectTypeOf<'invocation'>().toExtend<Scope>();
  expectTypeOf<'tenant'>().toExtend<Scope>();
  expectTypeOf<'galaxy'>().not.toExtend<Scope>();
});
