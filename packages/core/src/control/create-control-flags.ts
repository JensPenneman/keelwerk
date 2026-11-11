import { targetingReadTimeoutMs } from '../flags/targeting-read-timeout-ms.ts';
import type { Registry } from '../registry/registry.ts';
import type { DataAdapter } from '../storage/data-adapter.ts';
import type { NamespaceRef } from '../storage/namespace-ref.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import type { ControlFlags, FlagTargetingRow } from './control-flags.ts';

const pageSize = 500;

function targetingRowOf(row: StorageRow): FlagTargetingRow {
  return {
    id: String(row.id),
    key: String(row.key),
    backendId: row.backendId === null || row.backendId === undefined ? null : String(row.backendId),
    version: Number(row.version),
    targeting: row.targeting,
    ...(row.previous === null || row.previous === undefined ? {} : { previous: row.previous }),
  };
}

/** The flag rows over the adapter's unit and feed; no adapter member of its own. */
export function createControlFlags(input: {
  readonly adapter: DataAdapter;
  readonly namespace: NamespaceRef;
  readonly registry: Registry;
}): ControlFlags {
  const { adapter, namespace, registry } = input;
  const options = { readOnly: true, timeoutMs: targetingReadTimeoutMs };
  return {
    rows: () =>
      adapter.unit(
        namespace,
        { level: 'deployment' },
        async (unit) => {
          const entry = registry.entities.get('core.flag');
          if (entry === undefined) return [];
          const found: FlagTargetingRow[] = [];
          let after: string | undefined;
          for (;;) {
            const page = await unit.rows.find(entry.descriptor, {
              sort: [{ field: 'id', direction: 'asc' }],
              page: after === undefined ? { first: pageSize } : { first: pageSize, after },
            });
            for (const row of page.rows) found.push(targetingRowOf(row));
            if (!page.pageInfo.hasNextPage || page.pageInfo.endCursor === null) return found;
            after = page.pageInfo.endCursor;
          }
        },
        options,
      ),
    row: (id) =>
      adapter.unit(
        namespace,
        { level: 'deployment' },
        async (unit) => {
          const entry = registry.entities.get('core.flag');
          if (entry === undefined) return undefined;
          const found = await unit.rows.find(entry.descriptor, {
            where: { op: 'eq', field: 'id', value: id },
            page: { first: 1 },
          });
          const row = found.rows[0];
          return row === undefined ? undefined : targetingRowOf(row);
        },
        options,
      ),
    changes: (signal) => ({
      async *[Symbol.asyncIterator](): AsyncGenerator<unknown> {
        for await (const wake of adapter.feed.wake([namespace], signal)) yield wake;
      },
    }),
  };
}
