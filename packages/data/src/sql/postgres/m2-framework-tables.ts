import { assertNamespaceRoot } from './assert-namespace-root.ts';
import { kwApiUsage } from './kw-api-usage.ts';
import { kwConsumerLeases } from './kw-consumer-leases.ts';
import { kwConsumers } from './kw-consumers.ts';
import { kwLeases } from './kw-leases.ts';
import { kwLedger } from './kw-ledger.ts';
import { kwNamespaceIdentities } from './kw-namespace-identities.ts';
import { kwParked } from './kw-parked.ts';
import { kwQueuePauses } from './kw-queue-pauses.ts';
import { kwRetentionRuns } from './kw-retention-runs.ts';
import { kwSchedules } from './kw-schedules.ts';
import { kwScopeMarks } from './kw-scope-marks.ts';
import { kwStreamRecords } from './kw-stream-records.ts';

/**
 * The tables of framework step 0002 for one root, in this order: `kw_consumers`,
 * `kw_consumer_leases`, `kw_parked`, `kw_stream_records`, `kw_schedules`; with `control`, then
 * `kw_namespace_identities`, `kw_scope_marks`, `kw_leases`, `kw_queue_pauses`, `kw_ledger`,
 * `kw_api_usage` and `kw_retention_runs`. Stored format: final once released, changed only by a
 * later framework step (S-117).
 */
export function m2FrameworkTablesDdl(
  root: string,
  options: { readonly control?: boolean } = {},
): readonly string[] {
  const schema = assertNamespaceRoot(root);
  return [
    ...kwConsumers(schema),
    ...kwConsumerLeases(schema),
    ...kwParked(schema),
    ...kwStreamRecords(schema),
    ...kwSchedules(schema),
    ...(options.control === true
      ? [
          ...kwNamespaceIdentities(schema),
          ...kwScopeMarks(schema),
          ...kwLeases(schema),
          ...kwQueuePauses(schema),
          ...kwLedger(schema),
          ...kwApiUsage(schema),
          ...kwRetentionRuns(schema),
        ]
      : []),
  ];
}
