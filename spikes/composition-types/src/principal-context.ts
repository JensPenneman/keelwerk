import type { Scope } from './decide-context.ts';
import type { PrincipalKind, PrincipalOf } from './principal.ts';

/** What rule callbacks see: plain values of the invocation, never requests (section 8.1). */
export interface PrincipalContext<Pk extends PrincipalKind = PrincipalKind> {
  readonly principal: PrincipalOf<Pk>;
  readonly scope: Scope;
  readonly flags: { readonly [module: string]: { readonly [flag: string]: boolean | string } };
}
