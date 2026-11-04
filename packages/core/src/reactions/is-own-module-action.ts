import type { Principal } from '../principals/principal.ts';
import { moduleResolver } from './module-resolver.ts';

/** The core's default rule: a module's service principal may invoke the actions of its own module (section 7.7). */
export function isOwnModuleAction(
  principal: Principal,
  action: { readonly module: string },
): boolean {
  return (
    principal.kind === 'service' &&
    principal.via === moduleResolver &&
    principal.id === `${action.module}.system`
  );
}
