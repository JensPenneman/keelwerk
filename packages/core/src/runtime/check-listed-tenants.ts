import { errors } from '../errors/errors.ts';

/**
 * Checks the tenant ids the rules of a flag's targeting list: each must be a tenant of the named
 * backend, or an existing tenant when no backend is named (20.10: targeting addresses the tenants
 * of one backend). Throws `validation` naming the first unknown or foreign id's path. `backendsOf`
 * reads the bare tenant rows of all distinct ids together: it must not resolve a namespace, which
 * fails for an app this process does not serve. `skipExistence` (a restore) lets a listed tenant
 * that is gone pass: it never matches; a tenant of another backend is still refused.
 */
export async function checkListedTenants(
  backendsOf: (tenantIds: readonly string[]) => Promise<ReadonlyMap<string, string>>,
  targeting: { readonly rules: readonly { readonly tenants?: readonly string[] | undefined }[] },
  backendId: string | undefined,
  options: { readonly skipExistence?: boolean } = {},
): Promise<void> {
  const distinct = new Set<string>();
  for (const rule of targeting.rules) for (const id of rule.tenants ?? []) distinct.add(id);
  if (distinct.size === 0) return;
  const owners = await backendsOf([...distinct]);
  for (const [index, rule] of targeting.rules.entries()) {
    for (const [position, id] of (rule.tenants ?? []).entries()) {
      const found = owners.get(id);
      if (found === undefined) {
        if (options.skipExistence === true) continue;
        throw errors.validation(`rules[${index}].tenants[${position}]: no tenant ${id} exists.`);
      }
      if (backendId !== undefined && found !== backendId) {
        throw errors.validation(
          `rules[${index}].tenants[${position}]: tenant ${id} is not a tenant of backend ${backendId}.`,
        );
      }
    }
  }
}
