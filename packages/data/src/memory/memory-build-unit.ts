import type { Unit } from '@keelwerk/core';
import { memoryApiUsageStore } from './memory-api-usage-store.ts';
import { memoryBucketStore } from './memory-bucket-store.ts';
import { memoryConsumerStore } from './memory-consumer-store.ts';
import { memoryControlLeases } from './memory-control-leases.ts';
import { memoryCounterStore } from './memory-counter-store.ts';
import { memoryEventStore } from './memory-event-store.ts';
import { memoryJobStore } from './memory-job-store.ts';
import { memoryKeyStore } from './memory-key-store.ts';
import { memoryLedgerStore } from './memory-ledger-store.ts';
import { memoryNamespaceIdentities } from './memory-namespace-identities.ts';
import { memoryNestedContext } from './memory-nested-context.ts';
import { memoryReceiptStore } from './memory-receipt-store.ts';
import { memoryRetentionRunStore } from './memory-retention-run-store.ts';
import { memoryRowStore } from './memory-row-store.ts';
import { memoryScopeKeyStore } from './memory-scope-key-store.ts';
import { memoryScopeMarks } from './memory-scope-marks.ts';
import { memorySerialStore } from './memory-serial-store.ts';
import { memoryStreamRecordStore } from './memory-stream-record-store.ts';
import type { MemoryUnitContext } from './memory-unit-context.ts';
import { memoryUsageStore } from './memory-usage-store.ts';

/**
 * The `Unit` over a context (14.3.2): every store is bound to the unit's scope, `nested` is a
 * savepoint (a snapshot of the unit's collections, buffered events and jobs included, that a
 * thrown error restores), and `afterCommit` hooks registered inside a rolled-back savepoint are
 * dropped with it.
 */
export function memoryBuildUnit(ctx: MemoryUnitContext, hooks: (() => void)[]): Unit {
  const unit: Unit = {
    namespace: ctx.namespace,
    scope: ctx.scope,
    readOnly: ctx.readOnly,
    rows: memoryRowStore(ctx),
    events: memoryEventStore(ctx),
    receipts: memoryReceiptStore(ctx),
    jobs: memoryJobStore(ctx),
    consumers: memoryConsumerStore(ctx),
    usage: memoryUsageStore(ctx),
    buckets: memoryBucketStore(ctx),
    keys: memoryKeyStore(ctx),
    serials: memorySerialStore(ctx),
    streams: memoryStreamRecordStore(ctx),
    ...(ctx.scope.level === 'deployment'
      ? {
          scopeKeys: memoryScopeKeyStore(ctx),
          apiUsage: memoryApiUsageStore(ctx),
          ledger: memoryLedgerStore(ctx),
          identities: memoryNamespaceIdentities(ctx),
          marks: memoryScopeMarks(ctx),
          retentionRuns: memoryRetentionRunStore(ctx),
          leases: memoryControlLeases(ctx),
        }
      : {}),
    ...(ctx.scope.level === 'namespace' ? { counters: memoryCounterStore(ctx) } : {}),
    nested: async (fn, options) => {
      const view = memoryNestedContext(ctx, options);
      const rollback = ctx.tx.savepoint();
      const registered = hooks.length;
      try {
        return await fn(view === ctx ? unit : memoryBuildUnit(view, hooks));
      } catch (error) {
        rollback();
        hooks.length = registered;
        throw error;
      }
    },
    afterCommit: (fn) => {
      hooks.push(fn);
    },
  };
  return unit;
}
