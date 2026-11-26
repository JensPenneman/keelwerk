import { madePrincipals } from './made-principals.ts';
import type { Principal } from './principal.ts';
import { rebuiltPrincipal } from './rebuilt-principal.ts';

/**
 * The principal a caller outside the kernel hands in: one the kernel made is kept (the mark on a
 * module's service principal is its identity), anything else is rebuilt from its data and frozen,
 * however frozen it looks.
 */
export function ownedPrincipal<P extends Principal>(principal: P): P {
  return madePrincipals.has(principal) ? principal : rebuiltPrincipal(principal);
}
