import { errors } from '../errors/errors.ts';
import type { Principal } from '../principals/principal.ts';
import type { PrincipalRef } from '../principals/principal-ref.ts';
import { serviceModuleOf } from '../principals/service-module-of.ts';
import { moduleResolver } from '../reactions/module-resolver.ts';

/** The resolvers only the kernel answers for, and the one kind of principal each may name. */
const kernelResolverKinds: ReadonlyMap<string, Principal['kind']> = new Map([
  ['core.system', 'system'],
  ['core.operator', 'operator'],
  ['core.operatorToken', 'operator'],
  ['core.runtime', 'operator'],
  ['core.invoker', 'anonymous'],
]);

/** The id a principal is known by in references and actor records. */
function idOf(principal: Principal): string | null {
  if (principal.kind === 'user') return principal.subject;
  if (principal.kind === 'service') return principal.id;
  return principal.ref?.principalId ?? null;
}

/**
 * What a job stores of a principal (section 7.4): its reference, or the resolver and id it is
 * known by, never a snapshot of roles and claims. A system principal is stored under its reason.
 * The reference of a module's service principal is derived from the module the kernel minted it
 * for; a principal that only names the module resolver, or one of the kernel's other resolvers without
 * being the kind of principal the kernel mints for it (the system principal, an operator, the placeholder), is internal: a stored reference of the kernel's own resolvers comes from the
 * kernel's own principals only.
 */
export function principalRefOf(principal: Principal): PrincipalRef {
  const module = serviceModuleOf(principal);
  if (module !== undefined) return { resolver: moduleResolver, principalId: `${module}.system` };
  const named = principal.ref?.resolver ?? principal.via;
  if (
    named === moduleResolver ||
    (named !== undefined &&
      kernelResolverKinds.has(named) &&
      kernelResolverKinds.get(named) !== principal.kind)
  ) {
    throw errors.internal(
      `A principal of kind ${principal.kind} names the kernel's resolver "${named}" without the kernel having minted it.`,
    );
  }
  if (principal.ref !== null) return principal.ref;
  const id = principal.kind === 'system' ? principal.reason : (idOf(principal) ?? principal.kind);
  return { resolver: principal.via, principalId: id };
}
