// biome-ignore-all lint/style/useNamingConvention: the keys are the names of database tables
const never = 'positions, counters, hashes, wrapped keys: never a value';

/**
 * Every table of M1 and M2 that can hold a personal value or a subject reference, by name without
 * its schema, and what erasure does to it (14.7.5). The dump test fails when a table of the
 * database is named neither here nor by an entity of the app, so a table that arrives later has to
 * say what erasure does to it. "reference kept" marks the tables that keep the subject's id.
 * Entity tables are named by the registry (`entity.table`); their treatment is the first row.
 */
export const erasureInventory: Readonly<Record<string, string>> = {
  // Entity tables: sealed columns, tag columns and index rows are cleared in the `erased` unit.
  '<entity tables>': 'shred + clear in the erased unit; owned rows tombstoned; ids: reference kept',
  kw_events:
    'sealed personal values (entity payloads, before-images, process members), actor ids: shred + erased event; ids: reference kept; the decision record of an event holds the unsalted digest of the command input, which an erasure does not reach: a KNOWN GAP (WP-130, the dump test pins it)',
  core__command_receipt:
    'principalId, principal document, remote address, user agent, outcome: purged for the subject principals (5a); a failed outcome is the closed projection; a receipt another principal made is kept, and its outcome keeps the ids it names: ids: reference kept (erasureKeptReferences); the fingerprint of a command whose input has a personal member, run by another principal, is the unsalted SHA-256 of the canonical input: a KNOWN GAP (WP-130, the dump test pins it)',
  core__effect:
    "sealed input and error, closed attempt errors: shred; the value keys of the secret members of an output are not destroyed by an erasure: a KNOWN GAP (WP-138, the dump test pins it); the plain members of an effect input that name a row the subject owned are kept, and so is the submitter reference of the effect (principalResolver, principalId, and the same pair in the requested event): ids: reference kept (erasureKeptReferences); the deadline job of an outside performer's effect is in kw_jobs",
  kw_stream_records: 'personal elements sealed under the owner: purged for owned keys (4) + shred',
  kw_jobs:
    "sealed secret and personal members (personal ones under the data key of the subject they name: shred), principal reference: the subject principals are purged (5a); the process subject is sealed: shred; the deadline job of an outside performer's effect (queue timers, key core:deadline:<effect id>, input {effectDeadline}) holds an effect id only and no principal of the subject: never a value; a timer job seals its personal members like any command job: shred; a job another principal started about the subject keeps the subject id in its input as a reference, and its sealed members cannot be opened any more: ids: reference kept; the key of a job is NOT free of personal values: a key a module chose for a timer or an enqueue is stored as written, and the key of a reaction is the unsalted SHA-256 of the part the reaction declared: KNOWN GAPS (WP-130, the dump test pins them)",
  kw_job_history: 'closed projection, no input: never a value',
  kw_parked:
    'kind and code only, never a message: never a value; the stream of the parked event is named by its type and id: ids: reference kept',
  kw_consumers: never,
  kw_consumer_leases: never,
  kw_schedules: 'schedule ids and ticks: never a value',
  kw_job_lanes: never,
  kw_job_lane_counts: never,
  kw_job_groups: never,
  kw_serials:
    'counters; the counter of a stream is keyed by the id of its owner: ids: reference kept, never a value',
  kw_usage: never,
  kw_rate_buckets: never,
  kw_positions: never,
  kw_shapes: never,
  kw_migrations: never,
  kw_index_keys: never,
  kw_scope_keys: never,
  kw_leases: never,
  kw_queue_pauses: never,
  kw_namespace_identities: never,
  kw_scope_marks: never,
  kw_api_usage:
    'request counts per day, scope, API version, transport and action name: no personal value',
  kw_retention_runs: never,
  kw_subject_keys: 'subject id, wrapped keys: material shredded; ids: reference kept',
  kw_subject_refs: 'subject id and stream refs: reference kept',
  kw_value_keys: 'wrapped value keys: destroyed with their values',
  kw_ledger: 'ids, reason token, requester ActorRef: reference kept; never a value',
  live__stream_ticket: 'principalId, principal: purged (5a)',
  api_keys__key:
    'owned by the subject (data subject subject), a table of module-api-keys: the personal label is shred and cleared, the value key of the verifier is destroyed and the row becomes an erased tombstone, so a key of an erased owner no longer resolves; ids: reference kept',
};

/**
 * Where an invocation table keeps the subject's id, or the id of a row the subject owns, after an
 * erasure, by column, and why. The dump test finds the ids in exactly these columns: a place that
 * is not named here fails the test, and a named place that holds no id any more fails it too.
 */
export const erasureKeptReferences: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  core__command_receipt: {
    outcome:
      'the answer of a command another principal ran names the row it made (the person that probe.enrol created, the thread that probe.open created): a reference, never a value, in a receipt that belongs to that principal and expires with receipt retention',
  },
  core__effect: {
    input:
      'the plain members of an effect input that name a row the subject owned (the thread of a notice or a delivery): a reference, never a value; the personal members are sealed under the key that is gone',
    principal_id:
      'the submitter reference of an effect a session of the subject requested (the requested event keeps it too, and the event is chain-hashed): the principal never resolves again once its subject is erased, so the id leads nowhere and names no value; the row is not purged because the effect belongs to the module that performs it',
  },
};
