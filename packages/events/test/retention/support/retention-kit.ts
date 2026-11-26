import type {
  DataAdapterFactory,
  EventWorker,
  Receipt,
  ReceiptOutcome,
  RetentionRun,
  RuntimeServiceContext,
  StorageScope,
  Unit,
} from '@keelwerk/core';
import { commandReceiptUuid } from '@keelwerk/core';
import type { LoggedLine, TestRuntime } from '@keelwerk/testing';
import { recordingLogger, startTestRuntime, testCarrier, testPrincipal } from '@keelwerk/testing';
import { createRetention } from '../../../src/retention/create-retention.ts';
import type { InsideUnit } from '../../../src/retention/inside-unit.ts';
import type { RetentionOptions } from '../../../src/retention/retention-options.ts';
import type { RetentionWorker } from '../../../src/retention/retention-worker.ts';
import { retentionProbeApp } from './retention-probe.ts';

type Kind = 'memory' | 'pglite';
type Tenant = 'acme' | 'globex';

const subject = '00000000-0000-4000-8000-000000000ada';
/** The stream type of receipt change records: the only transient records retention purges. */
const receiptChangeType = 'core.commandReceipt';

/** A receipt of the probe action as the kernel would have left it. */
function plantedReceipt(
  commandId: string,
  status: Receipt['status'],
  expiresAt: Temporal.Instant,
  outcome?: ReceiptOutcome,
  over: Partial<Receipt> = {},
): Receipt {
  return {
    commandId,
    action: 'retprobe.mint',
    fingerprint: 'planted',
    principal: null,
    principalResolver: null,
    principalId: null,
    status,
    outcome: outcome ?? null,
    apiVersion: '2026-11-04',
    request: { transport: 'test', remoteAddress: '203.0.113.9', userAgent: 'probe' },
    clientId: null,
    clientSeq: null,
    expiresAt,
    ...over,
  };
}

/** Far enough ahead that no test moves the clock past it. */
const liveUntil = Temporal.Instant.from('2099-01-01T00:00:00Z');

/** The public options of the worker and its test seam. */
export type KitOptions = RetentionOptions & { readonly insideUnit?: InsideUnit };

/** A running probe runtime with the retention worker, which a test steps by hand. */
export interface RetentionKit {
  readonly runtime: TestRuntime<typeof retentionProbeApp, Tenant>;
  readonly worker: RetentionWorker;
  /** The context the runtime gave the services. */
  readonly context: () => RuntimeServiceContext;
  /** Everything the runtime logged. */
  readonly lines: LoggedLine[];
  scope(tenant: Tenant): StorageScope;
  /** Calls a probe action as the signed-in subject; answers whether it succeeded. */
  call(
    tenant: Tenant,
    action: 'retprobe.mint' | 'retprobe.refuse' | 'retprobe.queued',
    commandId?: string,
    prefer?: 'async',
  ): Promise<{ readonly ok: boolean; readonly commandId: string }>;
  /** A unit of the tenant on the sealed placement (what the kernel sees). */
  inTenant<T>(tenant: Tenant, fn: (unit: Unit) => Promise<T>): Promise<T>;
  /** A unit of the deployment scope in the control store. */
  inDeployment<T>(fn: (unit: Unit) => Promise<T>): Promise<T>;
  /** Stores a receipt of the tenant as the kernel would have left it. */
  plantReceipt(
    tenant: Tenant | 'deployment',
    commandId: string,
    status: Receipt['status'],
    expiresAt: Temporal.Instant,
    outcome?: ReceiptOutcome,
    /** Members that replace the planted ones, a sync client's id and sequence number say. */
    over?: Partial<Receipt>,
  ): Promise<void>;
  /** The receipt of a command in the tenant, or undefined. */
  receiptOf(tenant: Tenant | 'deployment', commandId: string): Promise<Receipt | undefined>;
  /**
   * Appends transient and chained records to the change stream of the receipt of `commandId` in
   * the tenant, in version order, under the raw store, after storing the receipt as a live one
   * (completed, far from its expiry) unless `receipt` says it is `'gone'`: the stream of a live
   * receipt keeps its newest record, one without a receipt row loses it.
   */
  plantEvents(
    tenant: Tenant,
    commandId: string,
    records: readonly { readonly ageHours: number; readonly kind: 'transient' | 'chained' }[],
    receipt?: 'live' | 'gone',
  ): Promise<void>;
  /** The versions of the change stream of the receipt of `commandId`. */
  versionsOf(tenant: Tenant, commandId: string): Promise<readonly number[]>;
  /** Archives the tenant's `core.tenant` row in the control store. */
  archiveTenant(tenant: Tenant): Promise<void>;
  /** Archives the runtime's backend through the control action, which also drops the scope directory's cache. */
  archiveBackend(): Promise<void>;
  /** Moves the runtime's clock forward by `hours`. */
  advance(hours: number): Promise<void>;
  /** One pass of the worker; its runs. */
  pass(): Promise<readonly RetentionRun[]>;
}

/** Starts the probe runtime with a retention worker that no timer runs. */
export async function bootRetention(
  kind: Kind,
  options: KitOptions = {},
  tenants: readonly Tenant[] = ['acme', 'globex'],
  /** Runs the probe on this adapter factory and database (a PostgreSQL the test started) instead of `kind`. */
  external?: { readonly factory: DataAdapterFactory; readonly url: string },
): Promise<RetentionKit> {
  const lines: LoggedLine[] = [];
  const logger = recordingLogger(lines);
  const { insideUnit, ...publicOptions } = options;
  const worker = createRetention({ intervalMs: 3_600_000, ...publicOptions }, insideUnit);
  let started: RuntimeServiceContext | undefined;
  const spy: EventWorker = {
    id: 'test.contextSpy',
    roles: ['work'],
    kind: 'eventWorker',
    provides: [],
    runs: [],
    start: async (context) => {
      started = context;
    },
    stop: async () => undefined,
  };
  const runtime = await startTestRuntime(retentionProbeApp, {
    ...(external === undefined ? { adapter: kind } : { external }),
    workers: true,
    tenants,
    logger,
    eventWorkers: [worker, spy],
  });
  const context = (): RuntimeServiceContext => {
    if (started === undefined) throw new Error('the runtime has not started its workers');
    return started;
  };
  // The worker runs a pass at boot (no window is set); one more, queued behind it, makes sure that
  // pass is over before a test plants anything, so a test's own pass is the one that sees it.
  await worker.pass();
  const scope = (tenant: Tenant): StorageScope => {
    const found = runtime.tenants[tenant];
    return { level: 'tenant', backendId: runtime.backendId, tenantId: found.id };
  };
  const inTenant = <T>(tenant: Tenant, fn: (unit: Unit) => Promise<T>): Promise<T> =>
    runtime.sealed.unit(runtime.namespace, scope(tenant), fn);
  const inDeployment = <T>(fn: (unit: Unit) => Promise<T>): Promise<T> =>
    runtime.control.adapter.unit(runtime.control.namespace, { level: 'deployment' }, fn);
  /** The change stream of the receipt of a command in a tenant, as the kernel names it. */
  const streamOf = (tenant: Tenant, commandId: string) => ({
    type: receiptChangeType,
    id: commandReceiptUuid(runtime.tenants[tenant].id, commandId),
  });
  const inScope = <T>(tenant: Tenant | 'deployment', fn: (unit: Unit) => Promise<T>): Promise<T> =>
    tenant === 'deployment' ? inDeployment(fn) : inTenant(tenant, fn);
  return {
    runtime,
    worker,
    context,
    lines,
    scope,
    call: async (tenant, action, commandId = crypto.randomUUID(), prefer) => {
      const outcome = await runtime.invoker.invoke({
        action,
        input: { label: 'a secret only the receipt keeps' },
        carrier: testCarrier(runtime.tenants[tenant], testPrincipal(subject)),
        requestId: crypto.randomUUID(),
        commandId,
        ...(prefer === undefined ? {} : { prefer }),
        signal: new AbortController().signal,
      });
      return { ok: outcome.ok, commandId };
    },
    inTenant,
    inDeployment,
    plantReceipt: (tenant, commandId, status, expiresAt, outcome, over) =>
      inScope(tenant, (unit) =>
        unit.receipts.put(plantedReceipt(commandId, status, expiresAt, outcome, over)),
      ),
    receiptOf: (tenant, commandId) => inScope(tenant, (unit) => unit.receipts.get(commandId)),
    plantEvents: async (tenant, commandId, records, receipt = 'live') => {
      const stream = streamOf(tenant, commandId);
      if (receipt === 'live') {
        await inTenant(tenant, (unit) =>
          unit.receipts.put(plantedReceipt(commandId, 'completed', liveUntil)),
        );
      }
      await runtime.adapter.unit(runtime.namespace, scope(tenant), async (unit) => {
        let version = (await unit.events.readStream(stream)).length;
        for (const record of records) {
          const eventId = crypto.randomUUID();
          await unit.events.append([
            {
              stream,
              expectedVersion: version,
              partition: null,
              tenancy: 'tenant',
              events: [
                {
                  eventId,
                  name: 'changed',
                  schemaVersion: 1,
                  shape: `${'0'.repeat(63)}1`,
                  data: {},
                  before: null,
                  hlc: '00001' as never,
                  recordedAt: runtime.clock.now().subtract({ hours: record.ageHours }),
                  meta: {
                    actor: { kind: 'system', id: null, via: 'retention-test' },
                    commandId: null,
                    action: null,
                    causationId: null,
                    correlationId: eventId,
                    client: null,
                    merge: null,
                    traceparent: null,
                    writer: { build: 'b', revision: 1 },
                    flags: [],
                    decision: null,
                  },
                  transient: record.kind === 'transient',
                  prevHash: null,
                  hash: record.kind === 'chained' ? 'cd'.repeat(32) : null,
                },
              ],
            },
          ]);
          version += 1;
        }
      });
    },
    versionsOf: (tenant, commandId) =>
      runtime.adapter.unit(
        runtime.namespace,
        scope(tenant),
        async (unit) =>
          (await unit.events.readStream(streamOf(tenant, commandId))).map((event) => event.version),
        { readOnly: true },
      ),
    archiveTenant: async (tenant) => {
      const control = context().control;
      const entity = control.entity('core.tenant');
      await runtime.control.adapter.unit(
        runtime.control.namespace,
        { level: 'deployment' },
        async (unit) => {
          const page = await unit.rows.find(entity, {
            where: { op: 'eq', field: 'id', value: runtime.tenants[tenant].id },
            page: { first: 1 },
          });
          const row = page.rows[0];
          if (row === undefined) throw new Error('the tenant row is not in the control store');
          await unit.rows.update(entity, [
            {
              id: String(row.id),
              expectedVersion: Number(row.version),
              values: { ...row, version: Number(row.version) + 1, archivedAt: runtime.clock.now() },
            },
          ]);
        },
      );
    },
    archiveBackend: async () => {
      const archived = await runtime.invoker.invoke({
        action: 'core.backend.archive',
        input: { id: runtime.backendId },
        carrier: { transport: 'test', local: { inProcess: true } },
        requestId: crypto.randomUUID(),
        signal: new AbortController().signal,
      });
      if (!archived.ok) throw archived.error;
    },
    advance: async (hours) => {
      await runtime.advanceTo(runtime.clock.now().add({ hours }));
    },
    pass: () => worker.pass(),
  };
}
