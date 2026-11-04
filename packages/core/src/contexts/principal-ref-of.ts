import type { Shape } from '../fields/shape.ts';
import type { ShapeValue } from '../fields/shape-value.ts';
import type { AnyModuleBase } from '../model/any-module-base.ts';
import type { PrincipalRef } from '../principals/principal-ref.ts';

/**
 * The principal reference as a module's parts see it (section 8.5, decision 92): with the fields the
 * base declares in `principalRef` when the module resolves principals, the bare reference otherwise.
 */
export type PrincipalRefOf<B extends AnyModuleBase> = B extends {
  readonly principalRef: Shape<infer F>;
}
  ? PrincipalRef & ShapeValue<F, B['id'], 'stored'>
  : PrincipalRef;
