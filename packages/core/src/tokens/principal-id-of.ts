import type { Principal } from '../principals/principal.ts';

/** The id of a principal as tokens and events name it. */
export function principalIdOf(principal: Principal): string | null {
  if (principal.kind === 'user') return principal.subject;
  if (principal.kind === 'service' || principal.kind === 'operator') return principal.id;
  return principal.ref?.principalId ?? null;
}
