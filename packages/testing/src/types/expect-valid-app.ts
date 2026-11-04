import type { AnyModule, AppChecks } from '@keelwerk/core';

/**
 * `true` when `defineApp` raised no composition check for the app, otherwise the check
 * properties it raised, each naming its problem (decision 31a): assert it with
 * `expectTypeOf<ExpectValidApp<MyApp>>().toEqualTypeOf<true>()`.
 */
export type ExpectValidApp<A> = A extends {
  readonly modules: readonly [AnyModule, ...infer Authored extends readonly AnyModule[]];
  readonly appActions: infer Actions;
  readonly execution: infer Execution;
}
  ? unknown extends AppChecks<Authored, Actions, Execution>
    ? true
    : AppChecks<Authored, Actions, Execution>
  : never;
