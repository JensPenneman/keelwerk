import type { QuotaEntry } from './quota-entry.ts';
import type { RuntimeModule } from './runtime-module.ts';

/** The quota dimensions the bases declare, by reference. */
export function buildQuotaEntries(
  ordered: readonly RuntimeModule[],
): ReadonlyMap<string, QuotaEntry> {
  const quotas = new Map<string, QuotaEntry>();
  for (const module of ordered) {
    for (const [name, dimension] of Object.entries(module.base.quotas ?? {})) {
      const ref = `${module.id}.${name}`;
      quotas.set(ref, {
        ref,
        module: module.id,
        name,
        kind: dimension.kind,
        default: dimension.default,
        level: dimension.level,
      });
    }
  }
  return quotas;
}
