import type { Principal } from '../principals/principal.ts';
import type { PrincipalRef } from '../principals/principal-ref.ts';

/** The id a principal is known by in references and actor records. */
function idOf(principal: Principal): string | null {
  if (principal.kind === 'user') return principal.subject;
  if (principal.kind === 'service') return principal.id;
  return principal.ref?.principalId ?? null;
}

/**
 * What a job stores of a principal (section 7.4): its reference, or the resolver and id it is
 * known by, never a snapshot of roles and claims. A system principal is stored under its reason.
 */
export function principalRefOf(principal: Principal): PrincipalRef {
  if (principal.ref !== null) return principal.ref;
  const id = principal.kind === 'system' ? principal.reason : (idOf(principal) ?? principal.kind);
  return { resolver: principal.via, principalId: id };
}
