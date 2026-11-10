/**
 * The collection names of the M2 framework tables in the in-memory adapter, in one place for the
 * stores that use them. Each comment names the entry key, the table's primary key joined with
 * U+0000. Collections are created on first write. A name that carries a scope is a function of the
 * scope id, as the M1 collections are (`usage/<scope>`); none repeats an M1 prefix.
 */
export const memoryM2Collections: {
  /** `kw_consumers`: key consumerId. */
  readonly consumers: (scopeId: string) => string;
  /** `kw_consumer_leases`: key consumerId. */
  readonly consumerLeases: string;
  /** `kw_parked`: key consumerId, streamType, streamId. */
  readonly parked: (scopeId: string) => string;
  /** `kw_stream_records`: key stream, key, seq (20 digits, zero-padded). */
  readonly streamRecords: (scopeId: string) => string;
  /** `kw_schedules`: key scheduleId. */
  readonly schedules: (scopeId: string) => string;
  /** `kw_namespace_identities`: key namespaceId. */
  readonly namespaceIdentities: string;
  /** `kw_scope_marks`: key scopeId, namespaceId. */
  readonly scopeMarks: string;
  /** `kw_leases`: key kind, key, holder. */
  readonly leases: string;
  /** `kw_queue_pauses`: key namespaceId (or '' for every namespace), queue, scopeId (or '' for every scope). */
  readonly queuePauses: string;
  /** `kw_ledger`: key seq (20 digits). */
  readonly ledger: string;
  /** `kw_api_usage`: key day, backendId, tenantId, apiVersion, transport, item. */
  readonly apiUsage: string;
  /** `kw_retention_runs`: key runId. */
  readonly retentionRuns: string;
} = {
  consumers: (scopeId) => `consumers/${scopeId}`,
  consumerLeases: 'consumerleases',
  parked: (scopeId) => `parked/${scopeId}`,
  streamRecords: (scopeId) => `streamrecords/${scopeId}`,
  schedules: (scopeId) => `schedules/${scopeId}`,
  namespaceIdentities: 'identities',
  scopeMarks: 'marks',
  leases: 'leases',
  queuePauses: 'pauses',
  ledger: 'ledger',
  apiUsage: 'apiusage',
  retentionRuns: 'retentionruns',
};
