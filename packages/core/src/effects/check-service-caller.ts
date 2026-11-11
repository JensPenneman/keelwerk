import { forbiddenError } from '../authorization/forbidden-error.ts';
import type { Principal } from '../principals/principal.ts';
import { serviceModuleOf } from '../principals/service-module-of.ts';

/**
 * Only the code of a module acts as `<module>.system` on that module's own actions (section 7.7):
 * the principal the kernel minted for M, an action of M and a caller that is not M is forbidden, so
 * the default rule of M never reaches into another module's code that holds M's principal.
 * Principals that are not minted for the action's module are not judged here; the rules decide.
 */
export function checkServiceCaller(
  principal: Principal,
  action: { readonly module: string; readonly ref: string },
  caller: string,
): void {
  const module = serviceModuleOf(principal);
  if (module === undefined || module !== action.module || caller === module) return;
  throw forbiddenError({
    rules: [],
    action: action.ref,
    reason: `Only the code of ${module} acts as ${module}.system on its own actions.`,
  });
}
