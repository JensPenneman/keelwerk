import type { PrincipalBase } from './principal-base.ts';
import type { PrincipalRef } from './principal-ref.ts';

/** No principal. */
export interface AnonymousPrincipal<Ref extends PrincipalRef = PrincipalRef>
  extends PrincipalBase<Ref> {
  readonly kind: 'anonymous';
}
