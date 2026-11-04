import type { Principal } from './principal.ts';
import type { PrincipalKind } from './principal-kind.ts';
import type { PrincipalRef } from './principal-ref.ts';

/** The principal narrowed by an action's or rule's `principal` option. */
export type PrincipalOf<
  Pk extends PrincipalKind,
  Ref extends PrincipalRef = PrincipalRef,
> = Extract<Principal<Ref>, { readonly kind: Pk }>;
