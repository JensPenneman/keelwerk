import type { PrincipalKind } from '../principals/principal-kind.ts';
import type { PrincipalOf } from '../principals/principal-of.ts';
import type { Scope } from '../storage/scope.ts';

/** What rule callbacks see: plain values of the invocation, never requests (section 8.1). */
export interface PrincipalContext<Pk extends PrincipalKind = PrincipalKind> {
  readonly principal: PrincipalOf<Pk>;
  readonly scope: Scope;
  readonly flags: { readonly [module: string]: { readonly [flag: string]: boolean | string } };
}
