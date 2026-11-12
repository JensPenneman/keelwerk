import type {
  DataAdapterFactory,
  ErasureRecord,
  ErasureStep,
  EventWorker,
  LedgerSink,
  RuntimeServiceContext,
  Scope,
  StorageRow,
  Unit,
} from '@keelwerk/core';
import type { TestRuntime } from '@keelwerk/testing';
import { createLocalClient, startTestRuntime, testOperator } from '@keelwerk/testing';
import { erasure } from '../../../src/erasure/erasure.ts';
import type { ErasureWorker } from '../../../src/erasure/erasure-worker.ts';
import { erasureProbeApp } from './erasure-probe.ts';

type Kind = 'memory' | 'pglite';
type ProbeTenant = 'acme' | 'globex';

/** What one tenant of the probe runtime offers a test. */
interface TenantProbe {
  readonly invokeAs: ReturnType<typeof createLocalClient<typeof erasureProbeApp>>;
  inTenant<T>(fn: (unit: Unit) => Promise<T>): Promise<T>;
  /** The rows of an entity as the kernel reads them (sealed unit), archived ones included. */
  rowsOf(entity: 'probe.person' | 'probe.thread'): Promise<readonly StorageRow[]>;
  /** Asks the operator's erasure; a given `commandId` is the command id of the request. */
  eraseAsOperator(
    subjectId: string,
    options?: { readonly commandId?: string },
  ): Promise<{ readonly commandId: string }>;
}

/** A probe runtime with workers, an erasure worker the test steps by hand, and a crash it can arm. */
export interface Probe extends TenantProbe {
  readonly runtime: TestRuntime<typeof erasureProbeApp, ProbeTenant>;
  readonly worker: ErasureWorker;
  readonly crash: { at: ErasureStep | undefined; after: number };
  /** While set, the worker waits here after the named step; `release()` lets it go on. */
  readonly hold: { at: ErasureStep | undefined; reached: Promise<void>; release: () => void };
  /** While armed, the worker waits INSIDE the writing unit of the next step `step` (default `streams`); `release()` lets it go on. */
  readonly inside: {
    armed: boolean;
    step: ErasureStep;
    reached: Promise<void>;
    release: () => void;
  };
  readonly steps: ErasureStep[];
  /** The other tenant of the runtime, or the first one. */
  as(tenant: ProbeTenant): TenantProbe;
  /**
   * A second erasure worker started by hand on the context the runtime gave the first: a start pass
   * of another process. Its steps are collected in `steps` of the result.
   */
  startWorker(options?: {
    readonly epochOf?: (scope: Scope) => number;
    /** The worker's poll interval (default: an hour, so only the start pass runs). */
    readonly pollMs?: number;
    /** The worker's writing unit of this step fails once (a transient error), so the record goes into its retry. */
    readonly failOnce?: ErasureStep;
    /** Faults of the worker's view of the ledgers. */
    readonly ledger?: {
      /** The largest page of the control ledger the worker is given. */
      readonly limit?: number;
      /** The nth read of the control ledger (1 is the first) fails once. */
      readonly failRead?: number;
      /** Every sink fails when it is read. */
      readonly sinksUnreadable?: boolean;
    };
  }): Promise<{
    readonly worker: ErasureWorker;
    readonly steps: ErasureStep[];
    /** How many pages of the control ledger the worker has read through its context. */
    readonly ledgerReads: () => number;
    /** The `after` of every read of the control ledger, in order, and how many of them found nothing. */
    readonly reads: { readonly after: bigint[]; empty: number };
  }>;
}

export async function bootProbe(
  kind: Kind = 'pglite',
  extra: {
    readonly ledgers?: readonly LedgerSink[];
    /** Runs the probe on this adapter factory and database (a PostgreSQL the test started) instead of `kind`. */
    readonly external?: { readonly factory: DataAdapterFactory; readonly url: string };
  } = {},
): Promise<Probe> {
  const crash: Probe['crash'] = { at: undefined, after: 0 };
  const steps: ErasureStep[] = [];
  const reached = Promise.withResolvers<void>();
  const released = Promise.withResolvers<void>();
  const hold: Probe['hold'] = {
    at: undefined,
    reached: reached.promise,
    release: () => released.resolve(),
  };
  const insideReached = Promise.withResolvers<void>();
  const insideReleased = Promise.withResolvers<void>();
  const inside: Probe['inside'] = {
    armed: false,
    step: 'streams',
    reached: insideReached.promise,
    release: () => insideReleased.resolve(),
  };
  const worker = erasure({
    pollMs: 3_600_000,
    pageSize: 2,
    insideStep: async (step) => {
      if (!inside.armed || inside.step !== step) return;
      inside.armed = false;
      insideReached.resolve();
      await insideReleased.promise;
    },
    afterStep: async (step: ErasureStep, _record: ErasureRecord) => {
      steps.push(step);
      if (hold.at === step) {
        reached.resolve();
        await released.promise;
      }
      if (crash.at === step) {
        if (crash.after > 0) {
          crash.after -= 1;
          return;
        }
        crash.at = undefined;
        throw new Error(`crash after ${step}`);
      }
    },
  });
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
  const runtime = await startTestRuntime(erasureProbeApp, {
    ...(extra.external === undefined ? { adapter: kind } : { external: extra.external }),
    operators: true,
    workers: true,
    eventWorkers: [worker, spy],
    ...(extra.ledgers === undefined ? {} : { ledgers: extra.ledgers }),
  });
  const forTenant = (tenant: ProbeTenant): TenantProbe => {
    const invokeAs = createLocalClient(runtime, { principal: testOperator(), tenant });
    const scope = {
      level: 'tenant',
      backendId: runtime.backendId,
      tenantId: runtime.tenants[tenant].id,
    } as const;
    const inTenant = <T>(fn: (unit: Unit) => Promise<T>): Promise<T> =>
      runtime.sealed.unit(runtime.namespace, scope, fn);
    return {
      invokeAs,
      inTenant,
      rowsOf: (entity) =>
        inTenant(async (unit) => {
          const entry = runtime.app.registry.entities.get(entity);
          if (entry === undefined) throw new Error(`no entity ${entity}`);
          return (await unit.rows.find(entry.descriptor, { includeArchived: true })).rows;
        }),
      eraseAsOperator: async (subjectId, options = {}) => {
        const receipt = await invokeAs.invoke(
          'core.eraseSubject',
          { subjectId, reason: 'subjectRequest' } as never,
          {
            prefer: 'async',
            ...(options.commandId === undefined ? {} : { commandId: options.commandId }),
          },
        );
        return { commandId: String((receipt as { commandId: string }).commandId) };
      },
    };
  };
  return {
    runtime,
    worker,
    crash,
    hold,
    inside,
    steps,
    ...forTenant('acme'),
    as: forTenant,
    startWorker: async (options = {}) => {
      if (started === undefined) throw new Error('the runtime has not started its workers');
      const collected: ErasureStep[] = [];
      const faults = options.ledger ?? {};
      let reads = 0;
      const seen: Awaited<ReturnType<Probe['startWorker']>>['reads'] = { after: [], empty: 0 };
      const { ledger } = started.control;
      const counted: RuntimeServiceContext = {
        ...started,
        ledgers: faults.sinksUnreadable
          ? [
              ...started.ledgers,
              {
                id: 'unreadable',
                append: async () => undefined,
                // biome-ignore lint/correctness/useYield: the sink is unreadable
                read: async function* () {
                  throw new Error('the sink cannot be read');
                },
              },
            ]
          : started.ledgers,
        control: {
          ...started.control,
          ledger: {
            append: (record) => ledger.append(record),
            since: async (seq, limit) => {
              reads += 1;
              seen.after.push(seq);
              if (faults.failRead === reads) throw new Error('the control ledger cannot be read');
              const page = await ledger.since(seq, Math.min(limit, faults.limit ?? limit));
              if (page.length === 0) seen.empty += 1;
              return page;
            },
          },
        },
      };
      let failing = options.failOnce;
      const second = erasure({
        pollMs: options.pollMs ?? 3_600_000,
        pageSize: 2,
        insideStep: async (step) => {
          if (failing !== step) return;
          failing = undefined;
          throw new Error(`a transient error in ${step}`);
        },
        afterStep: async (step) => {
          collected.push(step);
        },
        ...(options.epochOf === undefined ? {} : { epochOf: options.epochOf }),
      });
      await second.start(counted);
      return { worker: second, steps: collected, ledgerReads: () => reads, reads: seen };
    },
  };
}
