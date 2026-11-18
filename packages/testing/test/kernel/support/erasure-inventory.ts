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
    'sealed personal values (entity payloads, before-images, process members), actor ids: shred + erased event; ids: reference kept; the decision record of an event is keyed under the data keys of the personal values of the decision (a digest under HKDF of those keys): shred',
  core__command_receipt:
    'principalId, principal document, remote address, user agent, outcome: purged for the subject principals (5a); a failed outcome is the closed projection; a receipt another principal made is kept, and its outcome keeps the ids it names: ids: reference kept (erasureKeptReferences); the fingerprint: personal members of the input are digested under the key of their subject (shred), and the receipt of a command that wrote in a stream the erasure visited, or that requested an effect of the subject, gets the fingerprint `erased` (a retry meets core.idempotency_mismatch); the receipt of a command that failed keeps its fingerprint until the receipt retention period ends (24 hours by default), because a failure writes no event in a stream of the subject and so no erasure visits it: the fingerprint of a failed command is the keyed outer digest under the key of the scope (personal members of module commands and of generated create, update and set are keyed, and digested under the key of the subject where the subject is in the input), pseudonymous for whoever holds the master key and the control store; a failed command is pinned only when the data key of the subject of each of its personal members exists: nothing on its path creates a key, so a failed command whose subject has none (it never had one, or it was destroyed) records no receipt, quietly, the client still gets the failure and a retry runs the command again',
  core__effect:
    "sealed input and error, closed attempt errors: shred; the value keys of the secret members of an output are not destroyed by an erasure: a KNOWN GAP (WP-138, the dump test pins it); the plain members of an effect input that name a row the subject owned are kept, and so is the submitter reference of the effect (principalResolver, principalId, and the same pair in the requested event): ids: reference kept (erasureKeptReferences); the deadline job of an outside performer's effect is in kw_jobs; the key a module chose: HMAC under the scope's job key secret, bound to the module, never the text; a 0.1.0 row and its requested event keep the text",
  kw_stream_records: 'personal elements sealed under the owner: purged for owned keys (4) + shred',
  kw_jobs:
    "sealed secret and personal members (personal ones under the data key of the subject they name: shred), principal reference: the subject principals are purged (5a); the process subject is sealed: shred; the deadline job of an outside performer's effect (queue timers, key core.deadline:<effect id>, input {effectDeadline}) holds an effect id only and no principal of the subject: never a value; a timer job seals its personal members like any command job: shred; a job another principal started about the subject keeps the subject id in its input as a reference, and its sealed members cannot be opened any more: ids: reference kept; the key of a job: the part a module or a reaction chose (a timer or enqueue key, a reaction's key, an instance key of a process) is stored as an HMAC under the job key secret of the scope, bound to its module or reaction, so equal parts of two owners do not match; a holder of the master key and the control store can check a guessed part against a job that survives an erasure (pseudonymous), never the text",
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
    'counters; the partition of a counter is the per value as written: a ref column value (the id of the row it names), the id of the row the counter belongs to, or the value of a plain field the module did not mark personal; the counter of a stream is keyed by the id of its owner. A row id a module names is a UUID of version 4 or 7 (checkModuleRowId; the generated actions mint version 7), but compose refuses a `per` that is personal, sealed, the data subject or unknown (serialPartition), while a plain field value is not checked for opaqueness: free text nobody marked personal is not protected (erasure-serial-partitions.test.ts plants a counter per a plain field and one per a reference and finds both values here); a work package of its own owns the stream record keys of append and the opaqueness of a per value: ids: reference kept',
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
  kw_scope_marks:
    'kw__control.kw_scope_marks: the serials of a mark are named by the canonical JSON of [entity, field, partition], and the partition is the per value as written, as for kw_serials (a ref column value, a row id that checkModuleRowId or the generated actions made, or a plain field value that compose let through: serialPartition refuses a personal, sealed or subject `per`, but the value is not checked for opaqueness, and no erasure walk reaches the table): ids: reference kept; positions and epochs: never a value',
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
