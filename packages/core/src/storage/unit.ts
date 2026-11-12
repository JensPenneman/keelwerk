import type { EventStore } from '../events/event-store.ts';
import type { ApiUsageStore } from './api-usage-store.ts';
import type { BucketStore } from './bucket-store.ts';
import type { ConsumerStore } from './consumer-store.ts';
import type { JobStore } from './job-store.ts';
import type { NamespaceRef } from './namespace-ref.ts';
import type { NestedUnitOptions } from './nested-unit-options.ts';
import type { ReceiptStore } from './receipt-store.ts';
import type { RowStore } from './row-store.ts';
import type { ScopeKeyStore } from './scope-key-store.ts';
import type { SerialStore } from './serial-store.ts';
import type { StorageScope } from './storage-scope.ts';
import type { StreamRecordStore } from './stream-record-store.ts';
import type { SubjectKeyStore } from './subject-key-store.ts';
import type { UsageStore } from './usage-store.ts';

/**
 * One transaction on one namespace for one scope. M1 freezes the stores it implements (S-03):
 * `tombstones`, `streams` and `sql` join with their users in M2 and M5; `consumers` joined in M2.
 */
export interface Unit {
  readonly namespace: NamespaceRef;
  readonly scope: StorageScope;
  readonly readOnly: boolean;
  readonly rows: RowStore;
  /** Section 15.1.11. */
  readonly events: EventStore;
  /** Section 15.1.7. */
  readonly receipts: ReceiptStore;
  /** Section 14.3.9. */
  readonly jobs: JobStore;
  /** Section 15.2.3. */
  readonly consumers: ConsumerStore;
  /** Per-scope quota counters (section 12.2). */
  readonly usage: UsageStore;
  /** Shared token buckets (S-36). */
  readonly buckets: BucketStore;
  /** Subject keys and per-value keys (section 14.7.4). */
  readonly keys: SubjectKeyStore;
  /** Section 15.1.4. */
  readonly serials: SerialStore;
  /** Section 15.1.12. */
  readonly streams: StreamRecordStore;
  /** Wrapped deployment, backend and tenant keys; present on deployment-scope units only (S-55). */
  readonly scopeKeys?: ScopeKeyStore;
  /** kw_api_usage; deployment-scope units only, S-144. */
  readonly apiUsage?: ApiUsageStore;
  /**
   * A savepoint: rolls back to it when `fn` throws, then rethrows. A tenant unit may pass
   * `{ as: <backend scope>, readOnly: true }` to read backend data; no other `as` is allowed.
   */
  nested<T>(fn: (u: Unit) => Promise<T>, options?: NestedUnitOptions): Promise<T>;
  /** In-process work after a successful commit, such as waking the local live hub. Never I/O that must be atomic. */
  afterCommit(fn: () => void): void;
}
