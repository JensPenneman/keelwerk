# 7. One event log per namespace with commit-ordered positions per scope; entity state as inline projections; async reactions as keyed jobs

Date: 2026-10-11 (revised after review the same day; revised in place on 2026-10-28 for decision
35b)

## Status

Proposed. Item 13 follows decision 35b (2026-10-27): chain heads are anchored outside the
database from the start, instead of being left to a later audit module.

## Context

The brief wants live data structured like a collaborative document ("nothing is truly deleted,
everything is appended to a chain"), something like CQRS, and live updates on everything. The
first draft of architecture.md (sections 9.4 and 15) fixed one stream per entity instance,
expected-version appends, a cursor over the events of a placement, a hybrid logical clock, the
actor and command id in the envelope, an optional previous hash, and generated `changes` and
`queryChanges` actions whose tokens are positions of the chain; it left the global position scheme,
projection lifecycles and rebuilds to the data designer.

The requirements that decide the scheme:

- A consumer that has seen position `p` must never later see an event at or below `p`; otherwise it
  misses that event for good.
- Tokens must be cheap per scope, entity type and, for the mail server, per account (gap G7), and
  IMAP `MODSEQ` values are integers that must grow in commit order.
- A long-running transaction must not stall everyone's live updates.
- `history: 'state'` entities need live updates too, and read models must be rebuildable.

The research (events-and-sync.md) shows the known schemes: a sequence with gap timeouts (Marten),
which can skip a slow committed transaction; PostgreSQL transaction ids with snapshot-xmin
visibility (Emmett), which was checked on PostgreSQL 18.3 for this decision and works, but yields
pairs rather than integers, does not follow commit order, and lets one long transaction hold back
every reader; per-stream order with clocks, which has no total order; and a single serialised log
(KurrentDB's writer, Commanded's event store).

The review of 2026-10-11 found that the first version of this decision put every tenant of a
shared namespace on one counter row, so one tenant's write burst queued every other tenant's
commits and every token disclosed the namespace-wide commit count; that `pg_notify` inside the
commit tail serialises every notifying commit on the PostgreSQL instance (it takes a cluster-wide
lock in its pre-commit step); that async reactions were single-checkpoint consumers per namespace,
so one slow or failing tenant blocked all others, while the platforms expected keyed, retried jobs;
that one integer `schema_version` per event could not identify the fields of an entity whose shape
depends on which contributors are active; and that a receipt written at the end of a unit let
duplicates run concurrently. PGlite, used for the first checks, has a single connection and cannot
exercise lock waits.

## Decision

1. **One log per namespace.** `ps_events` holds every event of a namespace; a stream is an entity
   instance; a unit may append to several streams of its scope atomically, each with its expected
   version. There is no aggregate layer: invariants across entities are online commands over
   several streams, locking a parent row or running at `serializable` where a concurrent insert
   could break them.
2. **Commit-ordered positions per scope.** Each scope (a tenant, or a backend for backend-level
   entities) has a counter row in its namespace. A unit appends only in its own scope, buffers its
   appends and, at its commit tail, advances that scope's counter, inserts its events with
   consecutive positions and commits while holding the counter's row lock. Positions are 63-bit
   integers in commit order within the scope, without gaps at commit, the same on every adapter.
   Tenants never wait on each other's commit tails, and positions disclose nothing across tenants.
   An asynchronous sequencer per scope is the upgrade path for a tenant that outgrows this, with
   the same stored format. The ceiling and the absence of cross-tenant waiting are measured on a
   networked PostgreSQL before M1.
3. **Partitions and serials.** An entity may declare an immutable `partition` field; its events
   carry the value, and heads and tokens are per scope, type and partition. `field.serial({ per })`
   allocates per-partition sequences under a row lock held until commit.
4. **The envelope is final from M1.** Event id, position, scope, stream, version, partition, type,
   shape id (the active tracks and their versions), data with personal values encrypted and
   credential material sealed, before-images of changed fields (hidden, `stateOnly` and credential
   fields excluded), hybrid logical clock, recorded time, actor, command id, action, causation,
   correlation, client fields, merge report, transient flag, previous hash, hash and trace
   context.
5. **Proposals and deterministic evolve.** Events record what an actor proposed; the generic
   field-operation evolve applies merge rules against the merge state in the row; domain events use
   the author's `evolve`; the kernel computes before-images by diffing the row.
6. **Inline projections.** The state table of a chain entity is updated in the appending unit and is
   also the snapshot `decide` reads. Rows are locked for writes where the adapter allows it, so
   concurrent writers queue; `decide` commands retry on conflicts.
7. **History modes.** `chain` (the log is authoritative), `state` (the table is authoritative and
   every write appends a transient change record for the feed), `projection` (an asynchronous read
   model, written only by its projector, readable and governed like any entity) and `external`
   (tables the framework maps but does not own).
8. **Receipts live with their command.** `commandReceipt` is a `history: 'state'` core entity with
   tenancy `invocation` (a row carries its command's scope), stored in the command's namespace and
   inserted as `pending` by the first statement of the command's unit, so it commits with the
   effect and a concurrent duplicate is refused; its id derives from the scope and the command id.
   An asynchronous command's job is enqueued in the same unit as its `accepted` receipt (ADR 0015);
   no relay exists.
9. **Consumers are kernel-only and per scope.** Projections, the reaction dispatcher and the sync
   poke read the log with a checkpoint per consumer and scope, under one lease per consumer and
   namespace, handling each scope in its own tenant-scope unit, with per-stream parking after
   repeated failures. The reaction dispatcher does only short work: it enqueues a keyed job per
   matching event and reaction and advances the scope's checkpoint in the same unit. Handlers run
   in those jobs, with keys, FIFO order per key, coalescing, concurrency and retries, under the
   module's service principal; a failing handler never blocks a checkpoint. Handlers receive a
   decrypted, upcast `ReactionEvent` with the post-image (inline) or the current row (async). New
   reactions start at the head, projections at the beginning. Module code never receives a
   namespace-scope unit.
10. **Rebuilds.** Offline per entity in M1; blue/green with a short final lock in M5 (M7 before the
    roadmap's renumbering of 2026-10-28); triggered by
    migration steps, with a prompt when an `evolve` source changes. Rebuilds pass through the values
    of fields whose track is inactive.
11. **Feed.** Wake-ups only, never inside a writer's transaction: on PostgreSQL a notifier
    connection per process sends at most one `NOTIFY` per namespace every 50 milliseconds after
    commit, naming the scopes that committed; readers also poll heads every second; elsewhere,
    in-process wake-ups and polling. The live hub runs one reader per scope in every serving
    process, outside consumer leases, and fans out in memory, evaluating each distinct plan once
    per batch. Clients use poke-then-pull.
12. **Tokens and disclosure.** Tokens are `v1.<epoch>.<position>.<scope>.<check>`, issued at the
    head; the epoch belongs to the scope and changes only when its positions cannot continue (a
    restore, a destructive rebuild); the scope part hashes the backend and scope ids, so tokens
    survive a tenant move; the check covers the rules that govern reads of the token's entity type
    for that principal, the principal, roles, memberships and selector. A token of another scope is
    a `validation` error. A change report names an id only if the principal could read the row at
    the token's position (reconstructed from before-images) or can read it now; when that cannot be
    decided, the client is told to resynchronise.
13. **Hash chain and anchors.** Always on for chain events: SHA-256 over the previous hash and the
    RFC 8785 canonical form of the content, excluding the module id; compaction keeps an anchor;
    operator redaction keeps the stored hash and records why. From M1 the kernel also appends each
    scope's chain head to every ledger sink of the deployment, outside the placement and its
    backups (decision 35b): an anchor holds the scope id, the position and hash of the scope's
    latest event, the recorded time and the writer, at a cadence set in `defineDeployment`
    (`anchors.every`, by default every commit batch of the notifier and at most once per second per
    scope). `pennestack db verify` compares the chain with the anchors, `connect` treats a head
    below the newest anchor as a rewind, and `pennestack doctor` warns about missing anchors
    (architecture.md section 15.1.8).
14. **Upcasting.** Per track, using the shape each event records: renames and removals
    automatically, type changes through upcasters in migration files; stored events are never
    rewritten.

## Consequences

- Consumers never skip, tokens are exact, `MODSEQ` is a position, a long transaction delays only
  itself, tenants neither wait on nor observe each other, and all adapters share one scheme and one
  conformance test.
- A chain rewritten or rewound inside the placement, even with consistent links, is found against
  the anchors, at the cost of one ledger append per scope and cadence; an anchor pins the stream
  that held the scope's head, and whether anchors should also digest every stream head of a scope
  is an open question of architecture.md section 26.3.
- Appending units of one tenant serialise for the length of their commit tail, which caps a single
  tenant at roughly one appending transaction per write-ahead-log flush. High-volume records belong
  in streams; the sequencer remains available.
- Every entity has live updates and `changes`, read models are entities, and anything can be rebuilt
  from the log, including fields of contributors that are currently switched off.
- Reactions behave like the jobs the platforms need (lanes, debounced mirrors, retries for days)
  without letting one tenant's failure hold another's events.
- Storage grows with before-images, the log's indexes, transient records and checkpoints per scope;
  retention and later partitioning bound it.
- The disclosure rule costs reads per change report and forces resynchronisations under some
  relation-based plans; it never discloses an unreadable id and never silently keeps a lost row.
- The core changes this decision required (receipts in the namespace, two more history modes, the
  envelope fields, `eventStores` folded into `dataAdapters`, async reactions as keyed jobs) are
  folded into architecture.md sections 6.6, 7.7, 9.4, 9.5 and 15.
