import type { ScheduleEntry } from '../../src/registry/schedule-entry.ts';
import type { RuntimeServiceContext } from '../../src/runtime/runtime-service-context.ts';
import type { ServedApp } from '../../src/runtime/served-app.ts';
import { defaultScheduleLimits } from '../../src/schedules/default-schedule-limits.ts';
import type { SchedulePassState } from '../../src/schedules/run-schedule-pass.ts';
import { runSchedulePass } from '../../src/schedules/run-schedule-pass.ts';
import type { ScheduleLimits } from '../../src/schedules/schedule-limits.ts';
import type { StorageScope } from '../../src/storage/storage-scope.ts';
import type { StoredJobSpec } from '../../src/storage/stored-job-spec.ts';
import type { QueueSource } from '../../src/worker/queue-source.ts';
import type { PassWorld } from './pass-world.ts';

const T0 = Temporal.Instant.from('2026-01-01T00:05:00Z');
const ref = 'ticker.everyTenant';
const byKey = (
  a: { nextTick: Temporal.Instant; scopeId: string; scheduleId: string },
  b: { nextTick: Temporal.Instant; scopeId: string; scheduleId: string },
): number =>
  Temporal.Instant.compare(a.nextTick, b.nextTick) ||
  (a.scopeId < b.scopeId ? -1 : a.scopeId > b.scopeId ? 1 : 0) ||
  (a.scheduleId < b.scheduleId ? -1 : a.scheduleId > b.scheduleId ? 1 : 0);
const namespace = { id: 'ns-app', placementId: 'p', appId: 'tickerapp', tenantId: null, root: 'r' };

/** A fake deployment for the schedule pass: backends with tenants in one namespace, an in-memory schedule table and job log. */
export function makePassWorld(
  tenants: Readonly<Record<string, readonly string[]>>,
  entryOver: Partial<ScheduleEntry> = {},
): PassWorld {
  const clock = { now: T0 };
  const rows: PassWorld['rows'] = new Map();
  const jobs: StoredJobSpec[] = [];
  const logs: PassWorld['logs'] = [];
  const failing = { backends: new Set<string>(), claims: false, afterEnqueue: false };
  const slow = { ms: 0 };
  const reads = { backend: 0, tenant: 0 };
  const suspended = new Set<string>();
  const counts = { claimUnits: 0 };
  const removed: string[] = [];
  const backends = new Map(
    Object.keys(tenants).map((id) => [
      id,
      { id, app: 'tickerapp', placementId: 'p', namespace, status: 'active' },
    ]),
  );
  const tenantRecords = new Map(
    Object.entries(tenants).flatMap(([backendId, ids]) =>
      ids.map((id) => [id, { id, backendId, namespace, status: 'active' }] as const),
    ),
  );
  const entry: ScheduleEntry = {
    ref,
    module: 'ticker',
    name: 'everyTenant',
    every: '5m',
    invoke: 'ticker.recordTick',
    scope: 'each-tenant',
    input: (tick) => ({ at: String((tick as { at: Temporal.Instant }).at) }),
    ...entryOver,
  };
  const action = {
    ref: 'ticker.recordTick',
    module: 'ticker',
    scope: 'tenant',
    kind: 'command',
    input: {
      '~standard': { version: 1, vendor: 'test', validate: (value: unknown) => ({ value }) },
    },
  };
  const unitOf = (scope: StorageScope, onClaim: () => void = () => undefined) => ({
    jobs: {
      provisionGroup: async () => undefined,
      enqueue: async (job: StoredJobSpec) => {
        // A pending job of the same key stays the only one (`onConflict: 'keep'`).
        const kept =
          job.key?.onConflict === 'keep' && jobs.some((j) => j.key?.value === job.key?.value);
        if (!kept) jobs.push(job);
        return String(jobs.length);
      },
      schedules: () => ({
        upsert: async (scheduleId: string, next: Temporal.Instant) => {
          const scopeId = scope.level === 'tenant' ? scope.tenantId : '';
          const key = `${scopeId}\u0000${scheduleId}`;
          if (!rows.has(key)) rows.set(key, { scopeId, scheduleId, nextTick: next });
        },
        due: async (
          now: Temporal.Instant,
          limit: number,
          after?: { nextTick: Temporal.Instant; scopeId: string; scheduleId: string },
        ) =>
          [...rows.values()]
            .filter((row) => Temporal.Instant.compare(row.nextTick, now) <= 0)
            .toSorted(byKey)
            .filter((row) => after === undefined || byKey(row, after) > 0)
            .slice(0, limit)
            .map((row) => ({ ...row, lastTick: null })),
        remove: async (scheduleId: string, scopeId: string) => {
          removed.push(`${scopeId}\u0000${scheduleId}`);
          return rows.delete(`${scopeId}\u0000${scheduleId}`);
        },
        claimTick: async (
          scheduleId: string,
          scopeId: string,
          expected: Temporal.Instant,
          next: Temporal.Instant,
        ) => {
          onClaim();
          const row = rows.get(`${scopeId}\u0000${scheduleId}`);
          if (row === undefined || Temporal.Instant.compare(row.nextTick, expected) !== 0) {
            return false;
          }
          row.nextTick = next;
          return true;
        },
      }),
    },
  });
  const adapter = {
    unit: async (
      _namespace: unknown,
      scope: StorageScope,
      run: (unit: unknown) => Promise<unknown>,
      options?: { readOnly?: boolean },
    ) => {
      if (scope.level === 'tenant' && failing.backends.has(scope.backendId)) {
        throw new Error('the unit failed');
      }
      if (scope.level === 'namespace' && failing.claims && options?.readOnly !== true) {
        throw new Error('the claim failed');
      }
      let claimed = false;
      if (slow.ms > 0 && scope.level === 'tenant') {
        await new Promise((resolve) => setTimeout(resolve, slow.ms));
      }
      // A unit that fails after its job was enqueued: the claim rolls back, the job stays (committed elsewhere).
      const before = failing.afterEnqueue
        ? [...rows].map(([key, value]) => [key, { ...value }] as const)
        : undefined;
      const result = await run(
        unitOf(scope, () => {
          claimed = true;
        }),
      );
      if (before !== undefined && scope.level === 'tenant') {
        rows.clear();
        for (const [key, value] of before) rows.set(key, value);
        throw new Error('the unit failed after its job was enqueued');
      }
      if (claimed && scope.level === 'namespace') counts.claimUnits += 1;
      return result;
    },
  };
  const source = {
    namespace,
    handle: { adapter },
    registry: { schedules: new Map([[ref, entry]]), actions: new Map([[action.ref, action]]) },
  } as unknown as QueueSource;
  const log = (level: string) => (message: string, fields?: unknown) => {
    logs.push({ level, message, fields });
  };
  const context = {
    clock: { now: () => clock.now },
    build: { id: 'build', revision: 1 },
    log: { info: log('info'), warn: log('warn'), error: log('error'), debug: log('debug') },
    directory: {
      backend: async (id: string) => {
        reads.backend += 1;
        return backends.get(id);
      },
      tenant: async (id: string) => {
        reads.tenant += 1;
        const tenant = tenantRecords.get(id);
        return tenant === undefined
          ? undefined
          : { ...tenant, status: suspended.has(id) ? 'suspended' : 'active' };
      },
    },
    control: {
      entity: (name: string) => name,
      read: async (run: (unit: unknown) => Promise<unknown>) =>
        run({
          rows: {
            find: async (
              name: string,
              query: { where: unknown; page: { first: number; after?: string } },
            ) => {
              const all =
                name === 'core.backend'
                  ? [...backends.keys()]
                  : [...tenantRecords.values()]
                      .filter((tenant) => JSON.stringify(query.where).includes(tenant.backendId))
                      .map((tenant) => tenant.id);
              const from = query.page.after === undefined ? 0 : Number(query.page.after);
              const page = all.slice(from, from + query.page.first);
              const end = from + page.length;
              return {
                rows: page.map((id) => ({
                  id,
                  ...(name === 'core.tenant'
                    ? {
                        backendId: tenantRecords.get(id)?.backendId,
                        status: suspended.has(id) ? 'suspended' : 'active',
                      }
                    : {}),
                })),
                pageInfo: { hasNextPage: end < all.length, endCursor: String(end) },
              };
            },
          },
        }),
    },
  } as unknown as RuntimeServiceContext;
  const served = { id: 'tickerapp', head: '2026-01-01', source: {} } as unknown as ServedApp;
  const state: SchedulePassState = {
    seeded: new Set(),
    held: new Map(),
    busy: new Set(),
    running: new Set(),
    fanOut: undefined,
    reseedAt: Temporal.Instant.from('2999-01-01T00:00:00Z'),
    cursor: undefined,
    offset: 0,
    remaining: false,
    stopping: false,
    abandon: new AbortController(),
  };
  const limits = (over: Partial<ScheduleLimits> = {}): ScheduleLimits => ({
    ...defaultScheduleLimits,
    ...over,
  });
  return {
    context,
    source,
    served,
    state,
    rows,
    jobs,
    logs,
    failing,
    suspended,
    backends,
    tenantRecords,
    removed,
    slow,
    reads,
    counts,
    clock,
    limits,
    pass: (over) => runSchedulePass({ context, source, served, limits: limits(over), state }),
    settle: async () => {
      await Promise.all([...state.running]);
    },
  };
}
