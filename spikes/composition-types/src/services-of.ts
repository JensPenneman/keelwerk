import type { CamelCase } from './camel-case.ts';
import type { Maybe } from './loads-of.ts';
import type {
  ModuleById,
  OptionalIds,
  OptionalModules,
  PresentIds,
  PresentModules,
} from './module-presence.ts';
import type { Service } from './service.ts';

type Callers<S> = {
  readonly [K in keyof S]: S[K] extends Service<
    unknown,
    infer A extends readonly unknown[],
    infer R
  >
    ? (...args: A) => R
    : never;
};
type ServicesOfModule<D> = D extends { readonly services: infer S } ? Callers<S> : {};

/** `ctx.services`: the services of the module's dependencies only (section 5.5); optional ones through the Maybe accessor. */
export type ServicesOf<B, W> = {
  readonly [I in PresentIds<B, W> as CamelCase<I>]: ServicesOfModule<
    ModuleById<PresentModules<B, W>, I>
  >;
} & {
  readonly [I in OptionalIds<B, W> as CamelCase<I>]: Maybe<
    ServicesOfModule<ModuleById<OptionalModules<B, W>, I>>
  >;
};
