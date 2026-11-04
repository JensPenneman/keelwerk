import type { PrincipalBase } from './principal-base.ts';
import type { PrincipalRef } from './principal-ref.ts';

/** The system principal of `invoke(..., { as: system(reason) })`. */
export interface SystemPrincipal<Ref extends PrincipalRef = PrincipalRef>
  extends PrincipalBase<Ref> {
  readonly kind: 'system';
  readonly reason: string;
}
