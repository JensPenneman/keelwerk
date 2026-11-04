import type { AnyModuleBase } from './define-module-base.ts';
import type { PrincipalRef } from './principal.ts';
import type { Shape } from './shape.ts';
import type { ShapeValue } from './shape-value.ts';

/**
 * The principal reference as a module's parts see it (section 8.5): with the fields the base
 * declares in `principalRef` when the module resolves principals, the bare reference otherwise.
 */
export type PrincipalRefOf<B extends AnyModuleBase> = B extends {
  readonly principalRef: Shape<infer F>;
}
  ? PrincipalRef & ShapeValue<F, B['id'], 'stored'>
  : PrincipalRef;
