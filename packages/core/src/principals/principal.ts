import type { AnonymousPrincipal } from './anonymous-principal.ts';
import type { OperatorPrincipal } from './operator-principal.ts';
import type { PrincipalRef } from './principal-ref.ts';
import type { ServicePrincipal } from './service-principal.ts';
import type { SystemPrincipal } from './system-principal.ts';
import type { UserPrincipal } from './user-principal.ts';

/** Any principal. */
export type Principal<Ref extends PrincipalRef = PrincipalRef> =
  | AnonymousPrincipal<Ref>
  | UserPrincipal<Ref>
  | ServicePrincipal<Ref>
  | OperatorPrincipal<Ref>
  | SystemPrincipal<Ref>;
