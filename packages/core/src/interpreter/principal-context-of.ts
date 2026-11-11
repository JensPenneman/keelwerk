import type { PrincipalContext } from '../contexts/principal-context.ts';
import type { FlagSnapshot } from '../flags/flag-snapshot.ts';
import type { Principal } from '../principals/principal.ts';
import type { Registry } from '../registry/registry.ts';
import type { Scope } from '../storage/scope.ts';

/**
 * The principal context rule callbacks see: the principal, the scope and the flags. Without a
 * snapshot the flags are the declared defaults (M1, S-23). With one, each boolean or string flag
 * is read from the snapshot when a rule first touches it, so the snapshot's evaluations list
 * only what the rules read (20.6).
 */
export function principalContextOf(
  registry: Registry,
  principal: Principal,
  scope: Scope,
  snapshot?: FlagSnapshot | undefined,
): PrincipalContext {
  const flags: Record<string, Record<string, boolean | string>> = {};
  for (const module of registry.modules) {
    const values: Record<string, boolean | string> = {};
    for (const [name, flag] of Object.entries(module.flags)) {
      if (typeof flag.default !== 'boolean' && typeof flag.default !== 'string') continue;
      if (snapshot === undefined) {
        values[name] = flag.default;
        continue;
      }
      const key = `${module.id}.${name}`;
      Object.defineProperty(values, name, {
        enumerable: true,
        get: () => snapshot.read<boolean | string>(key).value,
      });
    }
    flags[module.id] = values;
  }
  return { principal, scope, flags };
}
