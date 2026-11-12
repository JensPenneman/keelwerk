import type { Condition } from '../conditions/condition.ts';
import type { ControlStore } from '../control/control-store.ts';
import { findControlRows } from '../control/find-control-rows.ts';
import type { ControlProvenance } from '../control/run-control-command.ts';
import { runControlCommand } from '../control/run-control-command.ts';
import type { ApiVersions } from '../dsl/define-api-versions.ts';
import { KeelwerkError } from '../errors/keelwerk-error.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import { acceptsVersion } from './accepts-version.ts';
import { retiredPinTarget } from './retired-pin-target.ts';

/** Rows read at a time. */
const defaultPageSize = 500;

type Entity = 'backend' | 'tenant';

/** Where the pin of `row` moves: its target when `resolveVersion` refuses the pin as retired; undefined for a pin that is served, absent or not a declared date. */
function targetOf(row: StorageRow, api: ApiVersions, today: string): string | undefined {
  return typeof row.apiVersion === 'string'
    ? retiredPinTarget(api, row.apiVersion, today)
    : undefined;
}

/** The rows whose `apiVersion` can be retired: a declared date that is retired today, or any text below the oldest declared date. */
function retiredPin(api: ApiVersions, today: string): Condition {
  const retired = api.dates.filter((date) => !acceptsVersion(api, date, today));
  const below: Condition = { op: 'lt', field: 'apiVersion', value: api.dates[0] ?? '' };
  if (retired.length === 0) return below;
  return {
    op: 'or',
    conditions: [below, { op: 'in', field: 'apiVersion', value: retired }],
  };
}

interface Moving {
  readonly api: ApiVersions;
  readonly today: string;
  readonly provenance?: ControlProvenance | undefined;
  readonly signal?: AbortSignal | undefined;
}

async function repin(
  store: ControlStore,
  entity: Entity,
  row: StorageRow,
  moving: Moving,
): Promise<boolean> {
  let current: StorageRow | undefined = row;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const target: StorageRow = current;
    const to = targetOf(target, moving.api, moving.today);
    if (to === undefined) return false;
    try {
      await runControlCommand(
        store,
        `${entity}.repinApiVersion`,
        (ctx) => ({
          events: [ctx.write.core[entity].update(target as never, { apiVersion: to } as never)],
        }),
        moving.provenance,
      );
      return true;
    } catch (error) {
      if (!(error instanceof KeelwerkError) || error.code !== 'core.version_mismatch') throw error;
      [current] = await findControlRows(store, `core.${entity}`, { id: row.id });
      if (current === undefined) return false;
    }
  }
  return false;
}

/**
 * Reads the rows of `entity` that match `where` and carry a retired pin, one page by id at a
 * time, and hands each page to `visit` before the next is read. A row whose pin moves leaves the
 * filter, and the cursor is the id of the last row, so the walk never skips or repeats a row.
 */
async function eachPage(
  store: ControlStore,
  entity: Entity,
  where: Condition,
  pageSize: number,
  visit: (rows: readonly StorageRow[]) => Promise<void>,
): Promise<void> {
  const descriptor = store.entity(`core.${entity}`);
  let after: string | undefined;
  for (;;) {
    const cursor = after;
    const page = await store.read(async (unit) =>
      unit.rows.find(descriptor, {
        where,
        sort: [{ field: 'id', direction: 'asc' }],
        page: { first: pageSize, ...(cursor === undefined ? {} : { after: cursor }) },
      }),
    );
    if (page.rows.length > 0) await visit(page.rows);
    if (!page.pageInfo.hasNextPage || page.pageInfo.endCursor === null) return;
    after = page.pageInfo.endCursor;
  }
}

/** How many rows of each kind were re-pinned. */
export interface Repinned {
  readonly tenants: number;
  readonly backends: number;
}

/**
 * Every `core.backend` of `app` whose `apiVersion` `resolveVersion` refuses as retired today, and
 * every `core.tenant` of the backends of `app` likewise, gets one control command each:
 * `runControlCommand(store, 'backend.repinApiVersion' | 'tenant.repinApiVersion',
 * ctx => ({ events: [ctx.write.core.<entity>.update(row, { apiVersion: target })] }), provenance)`,
 * where `target` is `servedTargetOf` the row's own pin: the oldest served version newer than it.
 * Memory stays bounded: the backends of the app are read in pages by id, and for each page
 * the tenants whose `backendId` is among them and whose pin is retired are read in pages
 * (the store filters, so the tenants of other apps and every served pin are never read). Each pin is
 * judged by itself, so an older version whose sunset was extended keeps its pins and a newer one
 * that is retired loses them. `provenance` makes the events name the operator that retired the
 * version and the command and request of that call. `signal` is checked before every row: an abort
 * throws its reason, and a rerun finishes the rest. Idempotent; a row whose version moved meanwhile
 * (`core.version_mismatch`) is read once more, then skipped when it needs no move.
 */
export async function repinRetiredPins(
  store: ControlStore,
  app: string,
  api: ApiVersions,
  today: string,
  options: {
    readonly provenance?: ControlProvenance | undefined;
    readonly signal?: AbortSignal | undefined;
    /** Rows read at a time (default 500). */
    readonly pageSize?: number | undefined;
  } = {},
): Promise<Repinned> {
  const { pageSize = defaultPageSize, ...rest } = options;
  const moving: Moving = { api, today, ...rest };
  const retired = retiredPin(api, today);
  let tenants = 0;
  let backends = 0;
  await eachPage(
    store,
    'backend',
    { op: 'eq', field: 'app', value: app },
    pageSize,
    async (page) => {
      // Every backend of the page is read, not only those with a retired pin: its tenants may be.
      const ids = page.map((row) => String(row.id));
      for (const row of page) {
        moving.signal?.throwIfAborted();
        if (await repin(store, 'backend', row, moving)) backends += 1;
      }
      const where: Condition = {
        op: 'and',
        conditions: [{ op: 'in', field: 'backendId', value: ids }, retired],
      };
      await eachPage(store, 'tenant', where, pageSize, async (rows) => {
        for (const row of rows) {
          moving.signal?.throwIfAborted();
          if (await repin(store, 'tenant', row, moving)) tenants += 1;
        }
      });
    },
  );
  return { tenants, backends };
}
