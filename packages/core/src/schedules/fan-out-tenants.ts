import { normalizeCondition } from '../conditions/normalize-condition.ts';
import type { ControlStore } from '../control/control-store.ts';
import type { BackendRecord } from '../invoker/backend-record.ts';
import type { ScopeLookup } from '../invoker/scope-lookup.ts';
import type { ScheduleEntry } from '../registry/schedule-entry.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import type { QueueSource } from '../worker/queue-source.ts';
import type { ScheduleScope } from './schedule-scope.ts';
import { scheduleScopeOf } from './schedule-scope-of.ts';
import { tenantScheduleScope } from './tenant-schedule-scope.ts';
import { withinSignal } from './within-signal.ts';

/** One page of a control entity in id order, in its own read unit, and the cursor of the next page. */
async function pageOf(
  control: ControlStore,
  ref: string,
  where: Readonly<Record<string, unknown>>,
  pageSize: number,
  after: string | undefined,
): Promise<{ readonly rows: readonly StorageRow[]; readonly next: string | undefined }> {
  const entity = control.entity(ref);
  const condition = normalizeCondition(where);
  const page = await control.read((unit) =>
    unit.rows.find(entity, {
      where: condition,
      sort: [{ field: 'id', direction: 'asc' }],
      page: { first: pageSize, ...(after === undefined ? {} : { after }) },
    }),
  );
  const next =
    page.pageInfo.hasNextPage && page.pageInfo.endCursor !== null
      ? page.pageInfo.endCursor
      : undefined;
  return { rows: page.rows, next };
}

/**
 * The scopes of one schedule in one namespace (9.5.6): every backend of `source.namespace.appId`
 * (`core.backend`, by `app`), and for 'each-tenant' each of its tenants (`core.tenant`, by
 * `backendId`), paged by id (`first: pageSize`, `after` the end cursor), each control read its own
 * read unit; only scopes whose data is in `source.namespace`. A tenant's scope is made of its page
 * row and its backend's record, which is read once per backend, so a tenant costs no read of its
 * own. The backends of one page of backends are interleaved a page of tenants at a time, so a
 * backend with thousands of tenants does not come before the others. Holds one page of rows and
 * one cursor per backend of the page. Directory reads stop waiting when `signal` aborts.
 */
export async function* fanOutTenants(
  control: ControlStore,
  directory: ScopeLookup,
  source: QueueSource,
  entry: ScheduleEntry,
  pageSize: number,
  signal: AbortSignal,
): AsyncGenerator<ScheduleScope> {
  let afterBackend: string | undefined;
  do {
    const backends = await pageOf(
      control,
      'core.backend',
      { app: source.namespace.appId },
      pageSize,
      afterBackend,
    );
    afterBackend = backends.next;
    const open: { readonly backendId: string; after: string | undefined }[] = [];
    for (const row of backends.rows) {
      const backendId = String(row.id);
      if (entry.scope === 'backend') {
        const found = await scheduleScopeOf(directory, source, entry, backendId, signal);
        if (typeof found === 'object') yield found;
      } else {
        open.push({ backendId, after: undefined });
      }
    }
    const records = new Map<string, BackendRecord | undefined>();
    while (open.length > 0) {
      for (const cursor of open.splice(0)) {
        if (!records.has(cursor.backendId)) {
          records.set(
            cursor.backendId,
            await withinSignal(directory.backend(cursor.backendId), signal),
          );
        }
        const record = records.get(cursor.backendId);
        if (record === undefined || record.app !== source.namespace.appId) continue;
        const tenants = await pageOf(
          control,
          'core.tenant',
          { backendId: cursor.backendId },
          pageSize,
          cursor.after,
        );
        for (const row of tenants.rows) {
          const found = tenantScheduleScope(source, record, row);
          if (found !== undefined) yield found;
        }
        if (tenants.next !== undefined) {
          cursor.after = tenants.next;
          open.push(cursor);
        }
      }
    }
  } while (afterBackend !== undefined);
}
