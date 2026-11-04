import type { Unit } from '@keelwerk/core';
import { memoryBucketStore } from './memory-bucket-store.ts';
import { memoryEventStore } from './memory-event-store.ts';
import { memoryJobStore } from './memory-job-store.ts';
import { memoryKeyStore } from './memory-key-store.ts';
import { memoryNestedContext } from './memory-nested-context.ts';
import { memoryReceiptStore } from './memory-receipt-store.ts';
import { memoryRowStore } from './memory-row-store.ts';
import { memoryScopeKeyStore } from './memory-scope-key-store.ts';
import { memorySerialStore } from './memory-serial-store.ts';
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
    usage: memoryUsageStore(ctx),
    buckets: memoryBucketStore(ctx),
    keys: memoryKeyStore(ctx),
    serials: memorySerialStore(ctx),
    ...(ctx.scope.level === 'deployment' ? { scopeKeys: memoryScopeKeyStore(ctx) } : {}),
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
