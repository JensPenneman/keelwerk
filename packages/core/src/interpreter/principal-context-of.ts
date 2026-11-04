import type { PrincipalContext } from '../contexts/principal-context.ts';
import type { Principal } from '../principals/principal.ts';
import type { Registry } from '../registry/registry.ts';
import type { Scope } from '../storage/scope.ts';

/** The principal context rule callbacks see: the principal, the scope and the flag snapshot (the declared defaults in M1, S-23). */
export function principalContextOf(
  registry: Registry,
  principal: Principal,
  scope: Scope,
): PrincipalContext {
  const flags: Record<string, Record<string, boolean | string>> = {};
  for (const module of registry.modules) {
    const values: Record<string, boolean | string> = {};
    for (const [name, flag] of Object.entries(module.flags)) {
      if (typeof flag.default === 'boolean' || typeof flag.default === 'string') {
        values[name] = flag.default;
      }
    }
    flags[module.id] = values;
  }
  return { principal, scope, flags };
}
