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
  '<entity tables>':
    'shred + clear in the erased unit; owned rows tombstoned; ids: reference kept; probe__memo (a row of no data subject, written by a user command that read the request) is never walked and holds no value of a subject',
  kw_events:
    "sealed personal values (entity payloads, before-images, process members), actor ids: shred + erased event; ids: reference kept; the decision record's inputDigest is the decision base (`kwb1.`), an HMAC under the scope's fingerprint key over the input with every secret, verifier and personal member withheld: it holds no value a guess of a personal value could be tested against, whoever holds a key; when the decision sealed personal values it is keyed again under their data keys (`kwd1.`): shred; a member not marked personal stays inside the keyed digest for as long as the event lives; the decision of an inline reaction holds `kwr1.` and the SHA-256 of the causing event id, which holds no input value; a 0.1.0 event keeps the plain SHA-256 of its input as given: chain-hashed, not rewritten; the decision record's `request` member (the transport and the user agent a decision read, only the members it read; the address is never kept) is, under a user principal in a tenant, a `$kwe` envelope under that subject's data key bound to the command (field `decision.request`): shred; under any other principal that has a principal id (the id its receipts carry) it is a value sealed under that id's long-lived value key (kw_value_keys, key id `principal:<id>`, the command inside the sealed text), which the erasure destroys, tombstone first, in the unit that purges the receipts of every principal id it matches (the subject's spellings and the ids of the rows the subject owns, whoever ran the command and wherever it wrote: erasure-principal-request.test.ts); under a principal with no id it is sealed under a value key of its own, which the erasure destroys, tombstone first, for the commands that wrote in a row the subject owns (a sign-up, a login: erasure-decision-request.test.ts); outside a tenant a user's is sealed under its id's key too; a request record written outside the subject's tenant (a backend or deployment scope) stays under that scope's live key, which no subject erasure reaches: it is kept; the request of a command of a principal that is none of those is kept, as their receipts are, and a re-decide of a decision whose request no longer opens is refused with core.replay_key_destroyed; retention deletes from this table only the change records of receipts (the stream types of the kernel list transientPurgeTypes) older than the feed horizon (P7D), except the newest record of a stream whose receipt row still exists (the stream of a receipt that retention purged goes whole); no record of any other stream type is purged, the entities of the kernel and its modules included; chained events are never deleted",
  core__command_receipt:
    "principalId, principal document, remote address, user agent, outcome: purged for the subject principals (5a); a failed outcome is the closed projection; a receipt another principal made is kept, and its outcome keeps the ids it names: ids: reference kept (erasureKeptReferences); the fingerprint: `kwf1.`, an HMAC under the scope's fingerprint key over the input with every secret and verifier member withheld and the personal members INSIDE (so a retry with another personal value is core.idempotency_mismatch); no data key is read or created for it, so an erasure does not make it uncheckable; whoever holds the master key and the control store can test a guessed personal value against it while the receipt lives; the receipt of a command that wrote in a row the subject owns is purged when it has no principal of its own or one of the subject's (a sign-up, a login); the receipt of a command another principal ran, that wrote in a stream the erasure visited or requested an effect of the subject, gets `erased`; every other receipt keeps that keyed digest of personal members, a failed one always and one of a command that succeeded without writing in a stream of the subject (auth.requestPasswordReset: it sets a timer and writes no event, and its receipt holds the digest of the address) too: until the retention worker (events.retention) deletes it: it deletes every receipt whose status is completed or failed once its expiresAt has passed (24 hours by default, counted from the completion when that is later), failed ones included, selecting by status, expiry and the client's acknowledgement only, so the keyed fingerprint covers personal members no longer than that window, and it destroys the value keys of the outcome in the same unit; the receipt of a sync mutation (it names a client) is deleted only once its client has acknowledged it, so its keyed fingerprint lives until then (architecture 7.5, 15.3.6); receipts of the backend and deployment scopes, which no subject erasure purges, end the same way, with their remote address and user agent; a receipt that is still pending or accepted is deleted only after it finished and its window passed; retention reaches archived tenants and the scopes of an archived backend, which it finds through the archived reading of the scope directory; a 0.1.0 receipt holds the plain SHA-256 of its input as given until it is deleted",
  core__effect:
    "sealed input and error, closed attempt errors: shred; the value keys of the secret members of an output are not destroyed by an erasure: a KNOWN GAP (WP-138, the dump test pins it); the plain members of an effect input that name a row the subject owned are kept, and so is the submitter reference of the effect (principalResolver, principalId, and the same pair in the requested event): ids: reference kept (erasureKeptReferences); the deadline job of an outside performer's effect is in kw_jobs; the key a module chose: HMAC under the scope's job key secret, bound to the module, never the text; a 0.1.0 row and its requested event keep the text",
  kw_stream_records: 'personal elements sealed under the owner: purged for owned keys (4) + shred',
  kw_jobs:
    "sealed secret and personal members (personal ones under the data key of the subject they name: shred), principal reference: the subject principals are purged (5a); the process subject is sealed: shred; the deadline job of an outside performer's effect (queue timers, key core.deadline:<effect id>, input {effectDeadline}) holds an effect id only and no principal of the subject: never a value; a timer job seals its personal members like any command job: shred; a job another principal started about the subject keeps the subject id in its input as a reference, and its sealed members cannot be opened any more: ids: reference kept; the idle extension timer of a session (queue timers, set by a principal resolver of the module and run as the module's principal, so an erasure does not purge it) holds the session id, the instant of the request and, as the actor that caused it, the id of the user who made the request, which is the erased subject's id: ids: reference kept, no personal value, and the timer that runs after the erasure decides nothing; the key of a job: the part a module or a reaction chose (a timer or enqueue key, a reaction's key, an instance key of a process) is stored as an HMAC under the job key secret of the scope, bound to its module or reaction, so equal parts of two owners do not match; a holder of the master key and the control store can check a guessed part against a job that survives an erasure (pseudonymous), never the text; a row 0.1.0 wrote holds its input as given, secret members in clear, until it runs or is purged",
  kw_job_history:
    'closed projection, no input: never a value; deleted by retention seven days after the job finished',
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
  kw_rate_buckets:
    "hashes, levels and times: never a value; the buckets of an erased principal are deleted with it (5a), and the buckets of the tenant and of an action class name no subject and stay; open until the third landing: the buckets the auth module names by the subject (`subject:<id>`) and by the person's identifier (`identifier:<address>`) are not deleted, and a principal that can still authenticate gets a new bucket at its next request, even a refused one",
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
  kw_subject_keys:
    'subject id, wrapped keys: material shredded; ids: reference kept; a key is created only by sealing a value a decision, an effect or a job wrote; computing a command digest never creates or reads one',
  kw_subject_refs: 'subject id and stream refs: reference kept',
  kw_value_keys:
    "wrapped value keys: destroyed with their values; a principal id's key (`principal:<id>`, which seals its request records) is destroyed with the principal's receipts, so the table can hold a principal id in a key id and it is no subject id: no listing of subjects reads this table",
  kw_ledger: 'ids, reason token, requester ActorRef: reference kept; never a value',
  live__stream_ticket:
    'principalId, principal: purged (5a); rows one day past expiresAt are deleted by retention',
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
