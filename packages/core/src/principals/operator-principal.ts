import type { PrincipalBase } from './principal-base.ts';
import type { PrincipalRef } from './principal-ref.ts';

/** An operator. */
export interface OperatorPrincipal<Ref extends PrincipalRef = PrincipalRef>
  extends PrincipalBase<Ref> {
  readonly kind: 'operator';
  readonly id: string;
}
