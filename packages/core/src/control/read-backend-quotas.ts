import { targetingReadTimeoutMs } from '../flags/targeting-read-timeout-ms.ts';
import { backendQuotasOf } from '../quotas/backend-quotas-of.ts';
import type { Registry } from '../registry/registry.ts';
import type { DataAdapter } from '../storage/data-adapter.ts';
import type { NamespaceRef } from '../storage/namespace-ref.ts';

const pageSize = 500;

/**
 * The quota values of every backend, by backend id and dimension: the stored `config.core.quotas`
 * of each `core.backend` row (a backend with none is left out). One read-only deployment unit that
 * times out after `targetingReadTimeoutMs`, in pages of 500 sorted by id, reading only the
 * `config` column and never through `moduleConfigOf`, so a tenant's override of configuration can
 * never reach a quota value. A registry without `core.backend` answers none.
 */
export function readBackendQuotas(input: {
  readonly adapter: DataAdapter;
  readonly namespace: NamespaceRef;
  readonly registry: Registry;
}): Promise<ReadonlyMap<string, ReadonlyMap<string, string>>> {
  const { adapter, namespace, registry } = input;
  return adapter.unit(
    namespace,
    { level: 'deployment' },
    async (unit) => {
      const entry = registry.entities.get('core.backend');
      const found = new Map<string, ReadonlyMap<string, string>>();
      if (entry === undefined) return found;
      let after: string | undefined;
      for (;;) {
        const page = await unit.rows.find(entry.descriptor, {
          sort: [{ field: 'id', direction: 'asc' }],
          select: ['config'],
          includeArchived: true,
          page: after === undefined ? { first: pageSize } : { first: pageSize, after },
        });
        for (const row of page.rows) {
          const values = backendQuotasOf(row.config);
          if (values.size > 0) found.set(String(row.id), values);
        }
        if (!page.pageInfo.hasNextPage || page.pageInfo.endCursor === null) return found;
        after = page.pageInfo.endCursor;
      }
    },
    { readOnly: true, timeoutMs: targetingReadTimeoutMs },
  );
}
