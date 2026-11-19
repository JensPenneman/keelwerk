import { targetingReadTimeoutMs } from '../flags/targeting-read-timeout-ms.ts';
import type { Registry } from '../registry/registry.ts';
import type { DataAdapter } from '../storage/data-adapter.ts';
import type { NamespaceRef } from '../storage/namespace-ref.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import type { ControlQuotas, QuotaRow } from './control-quotas.ts';

const pageSize = 500;

function quotaRowOf(row: StorageRow): QuotaRow {
  return {
    id: String(row.id),
    slot: String(row.slot),
    dimension: String(row.dimension),
    backendId: String(row.backendId),
    tenantId: row.tenantId === null || row.tenantId === undefined ? null : String(row.tenantId),
    limit: row.limit === null || row.limit === undefined ? null : String(row.limit),
    version: Number(row.version),
  };
}

/**
 * The quota rows over the adapter's unit and feed; no adapter member of its own. `rows()` reads
 * every `core.quota` row in one read-only deployment unit that times out after
 * `targetingReadTimeoutMs`, in pages of 500 sorted by id; it answers none when the registry has no
 * `core.quota`.
 */
export function createControlQuotas(input: {
  readonly adapter: DataAdapter;
  readonly namespace: NamespaceRef;
  readonly registry: Registry;
}): ControlQuotas {
  const { adapter, namespace, registry } = input;
  return {
    rows: () =>
      adapter.unit(
        namespace,
        { level: 'deployment' },
        async (unit) => {
          const entry = registry.entities.get('core.quota');
          if (entry === undefined) return [];
          const found: QuotaRow[] = [];
          let after: string | undefined;
          for (;;) {
            const page = await unit.rows.find(entry.descriptor, {
              sort: [{ field: 'id', direction: 'asc' }],
              page: after === undefined ? { first: pageSize } : { first: pageSize, after },
            });
            for (const row of page.rows) found.push(quotaRowOf(row));
            if (!page.pageInfo.hasNextPage || page.pageInfo.endCursor === null) return found;
            after = page.pageInfo.endCursor;
          }
        },
        { readOnly: true, timeoutMs: targetingReadTimeoutMs },
      ),
    changes: (signal) => ({
      async *[Symbol.asyncIterator](): AsyncGenerator<unknown> {
        for await (const wake of adapter.feed.wake([namespace], signal)) yield wake;
      },
    }),
  };
}
