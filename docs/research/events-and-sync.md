> Note (2026-10-28): the project was renamed from pennestack to **keelwerk** on 2026-10-28; this
> research note keeps the old name as written at the time.

# Events and sync: CQRS, append-only storage and multi-actor synchronisation

Date: 2026-10-08. Status: research input for the architecture and the ADRs; it decides nothing by
itself. Versions and licences were checked on 2026-10-08 with `npm view`, the GitHub API and each
project's documentation; links are in the last section.

## 1. What the brief asks for

The "Execution model" section of [the brief](../brief.md) requires four things at once: "something
like CQRS", with asynchronous handling and an application-chosen set of synchronous requests; live
updates on everything; data "structured the way a collaborative document stores its data: nothing is
truly deleted, everything is appended to a chain"; and "multiple actors can work on it online and
offline at the same time", handled gracefully. Two other sections constrain the design: a pluggable
data layer (PostgreSQL, MySQL, hosted services, Drizzle) and CASL-style authorization per action
with conditions.

As engineering properties: an append-only history per entity; current state derived from it; a
change feed clients follow with a cursor; offline authorship reconciled later; and, because the
author is in the EU, erasure of personal data that does not break the append-only promise. The last
two hold the hard problems.

## 2. Vocabulary

| Term | Meaning in this document |
|---|---|
| Event sourcing | An entity's history is a stream of immutable events; state is a fold over it. |
| CQRS | Writes and reads use different models; reads come from projections. |
| Projection | A rebuildable read model derived from events; inline (same transaction) or async (checkpointed). |
| Outbox / inbox | Outgoing messages committed with the business data and relayed later; incoming message ids recorded to drop duplicates. |
| Saga / process manager | Durable, event-driven coordination across entities that emits commands. |
| CRDT | A data type whose concurrent updates merge deterministically without a central decision. |
| OT | Operational transformation: a central server transforms concurrent operations into one order. |
| Tombstone | A kept marker of a deletion so concurrent references still resolve. |
| Crypto-shredding | Encrypting personal data with a per-subject key and destroying the key on erasure. |

## 3. Event stores and CQRS toolkits

| Project | Runtime, storage | Concurrency and reads | Projections and consumers | Processes | Erasure aids | Licence, version checked |
|---|---|---|---|---|---|---|
| Emmett | TypeScript; PostgreSQL, EventStoreDB/KurrentDB, MongoDB (beta), SQLite (beta), in-memory | `appendToStream(stream, events, { expectedStreamVersion })`, `ConcurrencyError`, `aggregateStream` | Inline projections in the append transaction (`projections.inline`, `pongoSingleStreamProjection`, `postgreSQLRawSQLProjection`); async projections thinly documented | `Workflow<Input, State, Output>` with `decide`/`evolve`/`initialState`; each instance's stream is inbox and outbox; `workflowProcessor` | None | No licence file; README says "probably AGPLv3 and/or SSPL", open-core. `@event-driven-io/emmett` 0.42.4 (2026-09-25) |
| KurrentDB (was EventStoreDB) | Dedicated server, .NET; gRPC clients | Expected revision on append; `$all` stream; catch-up and persistent subscriptions | Server-side JavaScript projections; connectors | None built in | Soft delete (`$tb`), hard delete (`$streamDeleted` tombstone), `$maxAge`/`$maxCount`, scavenge; licensed redaction tool overwrites data with `0xFF` and sets `IsRedacted` | Kurrent License v1 (not OSI); server v26.2.2 (2026-10-07); Node client `@kurrent/kurrentdb-client` 1.3.1, Apache-2.0 |
| Marten | .NET on PostgreSQL | `FetchForWriting` (recommended), `AppendOptimistic`, `AppendExclusive`; Quick vs Rich append modes | `Live`, `Inline`, `Async` lifecycles; async daemon; rebuild per projection with versioned tables for blue/green | Not in Marten itself (Wolverine) | `ArchiveStream` with optional partitioning; tombstone rows fill sequence gaps so the daemon knows a safe high-water mark | MIT; 9.47.0 (2026-10-07) |
| Rails Event Store | Ruby, ActiveRecord | Expected version per stream | Sync handlers; async handlers via ActiveJob with `AfterCommitDispatcher` | Not built in | `EncryptionMapper` with a key repository; after `forget(id)` attributes read back as a `ForgottenData` null object | MIT; gem 3.2.0 |
| NestJS CQRS | TypeScript, in-memory buses | n/a | `EventBus` is an RxJS observable; no store | `@Saga()` as RxJS stream of commands, in memory; durable variant in `@nestjs/workflows` (0.0.2) | None | MIT; 12.1.0 (2026-09-29) |

Emmett is the closest TypeScript prior art and its shapes are worth copying: pure deciders, a
stream-per-instance process manager, inline projections that commit with the events. It cannot be a
dependency while its licence is undecided and its 0.x API moves. Marten is the best written
reference for an event store on PostgreSQL: three projection lifecycles, a checkpointed daemon,
versioned projection tables for zero-downtime rebuilds, tombstone rows for gaps in the global
sequence. KurrentDB shows what a purpose-built store offers (a global `$all` cursor, server-managed
subscriptions) and costs (a non-OSI licence, another server, erasure by rewrite-and-scavenge or a
licensed tool). Rails Event Store alone documents erasure. NestJS CQRS is dispatch, not persistence.

## 4. Transports and job queues from Node

| Project | Store | Delivery | Deduplication | Enqueue inside the business transaction | Licence, version checked |
|---|---|---|---|---|---|
| NATS JetStream | Own server (RAFT replication) | At-least-once; retention `Limits` (default), `Interest`, `WorkQueue` | `Nats-Msg-Id` header with a 2-minute default duplicate window, `PubAck.duplicate`; expected-sequence headers; atomic batch publish since server 2.12 | No (needs an outbox relay) | Apache-2.0; server 2.15.0 (2026-09-17), `@nats-io/jetstream` 3.4.0 |
| Redis Streams | Redis or Valkey | At-least-once via consumer groups (`XREADGROUP`, `XACK`, pending list, `XAUTOCLAIM`); `MAXLEN ~` trimming | Explicit ids only | No | Redis 8.10.2 is tri-licensed with AGPLv3 since 8.0 (2025-05-01); Valkey 9 is BSD-3 |
| pg-boss | PostgreSQL 13+, `SKIP LOCKED` | At-least-once; retries with backoff, `expireInSeconds`, dead-letter queues | `singletonKey`, `singletonSeconds` (throttle), `singletonNextSlot` (debounce); policies `standard`, `short`, `singleton`, `stately`, `exclusive`, `key_strict_fifo` | Yes: `send(..., { db })` joins your transaction; partitioned queues optional | MIT; 12.37.1 (2026-10-08) |
| graphile-worker | PostgreSQL, `LISTEN/NOTIFY` + `SKIP LOCKED` | At-least-once, 25 attempts by default, exponential backoff, cron | `job_key` with `replace`, `preserve_run_at`, `unsafe_dedupe` | Yes: `graphile_worker.add_job(...)` is a SQL function callable from triggers | MIT; 0.18.0 (2026-09-08) |
| BullMQ | Redis 6.2+ | At-least-once with Lua-script atomicity; flows, rate limits, repeatable jobs | `{ deduplication: { id, ttl } }` in simple, throttle or debounce mode | No | MIT (Pro tier is commercial); 6.3.11 (2026-10-01) |

The decisive column is the transactional one. A queue in the same PostgreSQL transaction as the
entity's events makes the outbox free: event row and job row commit together or not at all.
JetStream and Redis fan out better across nodes, but each needs a relay from the database, and Redis
adds a licensing decision the framework should not force on every platform.

## 5. Patterns that every option needs

Outbox. Publishing to a broker inside a database transaction is a dual write; the fix is an outbox
table in the same transaction, relayed afterwards by polling or by tailing the write-ahead log.
Delivery becomes at-least-once, so consumers must be idempotent. In an event-sourced system the
events table is the outbox: consumers read it by global position.

Inbox (idempotent consumer). A `processed_messages(consumer_id, message_id)` row is inserted in the
consumer's own transaction; a primary-key violation means "already done, roll back and ack".
PowerSync asks backends to do this with a per-client operation id; Replicache and Zero track the
last mutation id per client for the same reason.

Idempotency at the API edge. The IETF `Idempotency-Key` draft (draft-07, revised 2025-10-15,
currently expired; the pattern itself is common in payment APIs) prescribes 409 for a retry still in
flight, 422 for a reused key with a different payload, a fingerprint of the request, and a published
expiry policy.

Sagas and process managers. A saga (Garcia-Molina and Salem, 1987) is a sequence of local
transactions with compensations; a process manager (Hohpe and Woolf) is a stateful router from
events to commands. NestJS sagas are in-memory RxJS pipelines that die with the process. Emmett's
workflow is the durable form: inputs are recorded in the instance's stream before outputs are
dispatched, so redelivery is a detected duplicate and restart is replay.

Projections and rebuild. Inline projections give read-your-writes for the entity's own read model;
async projections are eventually consistent but survive write conflicts between streams. Rebuilding
is a versioned-table switch (Marten bumps the projection version; Emmett appends `version` to the
collection name), not an in-place truncate, and needs a gap-aware global position so checkpoints
mean something.

## 6. Sync engines, CRDTs and OT

| Project | Kind | Authority | Offline writes | Conflict rule | Permissions | History | Licence, version, status |
|---|---|---|---|---|---|---|---|
| Automerge | CRDT library (Rust core, WebAssembly) | None (peers converge) | Yes | Map keys: deterministic winner by operation id, losers in `getConflicts`; lists and text keep all inserts; counters; marks and cursors for rich text | None; `automerge-repo` has a `sharePolicy` hook | Full history; 3.0 (July 2025) cut memory more than 10x with an in-memory columnar format | MIT; 3.5.0 (2026-09-16) |
| Yjs | CRDT library (YATA) | None | Yes | Map keys last-writer-wins; sequences and text interleave-safe; `Y.XmlFragment` for editors | None in the library; providers decide | Tombstones; `gc` option discards deleted content (default on) | MIT; 13.6.33 (2026-09-23); `y-websocket` 3.1.0 |
| Loro | CRDT library (Rust, WebAssembly) | None | Yes | Fugue text, Peritext-style rich text, movable list and tree, LWW map, counter | None | Version vectors, `forkAt`, `checkout`; shallow snapshots truncate history; `redactJsonUpdates` blanks a version range | MIT; `loro-crdt` 1.16.4 (2026-09-30); format stable since 1.0 (2024-10-23) |
| Electric | Read-path replication of Postgres "shapes" (table, where, columns) over HTTP with offset and handle | Postgres | Not provided; its writes guide lists four patterns you build | Yours | Shape definitions on your server | None (`must-refetch` on invalidation) | Apache-2.0; `@electric-sql/client` 1.5.28 |
| PowerSync | Postgres/MongoDB/MySQL to client SQLite via sync rules; client upload queue of `PUT`/`PATCH`/`DELETE` | Your backend | Yes, persisted queue; no new checkpoint while uploads are pending (causal+ consistency) | Backend decides; suggested "deletes win, last write wins per field"; CRDT blobs in columns | Sync rules per user | None | SDKs Apache-2.0; service FSL-1.1 (Apache-2.0 after two years); `@powersync/node` 1.1.1 |
| Zero (Rocicorp) | `zero-cache` replicates Postgres into SQLite; clients run ZQL locally; mutators run on the client, then on your server (`ZERO_MUTATE_URL`) | Your server; client rebases pending mutations | No: writes are rejected after about 1 minute disconnected, by design | Server re-run of the mutator | Server query and mutator endpoints add filters from context | None | Apache-2.0; 1.9.0 (2026-10-08); GA since March 2026 |
| Replicache | Client cache plus server mutators, pull with cookie, push with per-client mutation ids, rebase, "poke" | Your server | Yes | Mutator re-run | Yours | None | Maintenance mode; users are told to migrate to Zero; 15.3.0 |
| Jazz | 0.20: CoValues (`CoMap`, `CoList`, `CoFeed`) on the cojson CRDT with end-to-end encrypted groups. 2.0 alpha: relational tables, per-row version DAG ordered by hybrid logical clock | 2.0: an authority accepts or rejects commit units, fail-closed | Yes | `MergeStrategy::Lww` per column by HLC, `Counter` sums deltas; set, map and rich text are future work | 2.0: row-level policies (`insert_check`, `update_using`, ...) on committed state; revocation forward-looking only | Full history | MIT; `jazz-tools` 0.20.19 stable, 2.0.0-alpha.59 |
| Triplit | Server plus client store, property-level merge | Server | Yes | Property level | Server-enforced | n/a | AGPL-3.0; `@triplit/client` 1.0.50 last published 2025-07-31; co-founder joined Supabase 2025-10-08; dormant |
| Convex | Reactive database: deterministic queries, mutations as serializable OCC transactions, WebSocket subscriptions | Server | No persisted offline queue | Transaction retry | Server functions | None | Backend FSL-1.1 with Apache-2.0 after two years; client 1.46.0 |
| Linear (published design) | Per-workspace immutable logs of "sync actions"; `lastSyncId` cursor; pending transactions in IndexedDB, rebased on conflicting deltas | Server | Yes | Last writer wins | Sync groups and subscriptions | Log kept (about 20 TB per Linear's post) | Design only |
| Figma multiplayer and LiveGraph (published design) | Per-property last-writer-wins in server order; no OT, no full CRDT. LiveGraph tails the Postgres WAL via Kafka into subquery trees per subscription | Server | Yes, reapplied on reconnect | Server order wins; cycles rejected | Server | Deleted objects removed from the server; only the deleter's undo buffer keeps them | Design only |
| ShareDB | OT over JSON documents (`json0` default, `rich-text`, `json1` via `ot-json1`); versions per document; middleware for access control | Server | Pending ops resubmitted on reconnect | Transform against committed ops | Middleware | Op log kept | MIT; 6.0.5 |

Three families appear. CRDT libraries (Automerge, Yjs, Loro) converge without a server, keep history
by construction and know nothing about permissions; they are the tool for text, sequences and trees
edited concurrently. Mutation-replay engines (Replicache, Zero, Linear, Jazz 2.0, Figma) run a
change optimistically on the client, re-run it on an authoritative server and rebase what is still
pending. Replication engines (Electric, PowerSync, LiveGraph) solve the read path and push writes
through an API. Operational transformation (Ellis and Gibbs 1989; the Jupiter model behind Google
Docs and ShareDB) works when a server is always reachable and fits days-long offline divergence
poorly, which is why the local-first projects chose CRDTs or replay.

Two published lessons stand out. Zero, whose authors built Replicache for offline, now rejects
offline writes on purpose: "constraints, business rules, authorization, and schema changes can all
fail when an offline user reconnects". Figma accepts that two users typing in one text property lose
one edit. The Peritext essay (Ink and Switch, 2021) shows why rich text is where naive approaches
corrupt data: formatting must be anchored to character ids with expand rules, not to indexes or
markup characters.

## 7. Clocks, tombstones, retention and erasure

Clocks. Lamport counters (1978) order events but cannot tell concurrent from sequential. Vector
clocks (Fidge and Mattern, 1988–1989) detect concurrency at a cost linear in the number of actors;
Yjs state vectors and Loro version vectors are this structure. Hybrid logical clocks (Kulkarni,
Demirbas, Madeppa, Avva and Leone, 2014) pack a physical millisecond, a logical counter and a node
id into 64 bits: close to wall time, never backwards, causal on receive. CockroachDB builds MVCC
timestamps on them and crashes a node whose clock is out of sync with at least half of the others by
80 percent of the maximum offset; Jazz 2.0 orders row versions by `(time, node)` and rejects a child
not strictly later than its parents. For last-writer-wins fields an HLC is the right timestamp; a
raw wall clock lets one client a day ahead own every field until the others catch up.

Tombstones and retention. Every CRDT keeps a tombstone per deleted element so concurrent insertions
next to it still resolve. Yjs garbage-collects tombstones whose order no longer matters and discards
deleted content unless `gc` is off; Automerge keeps everything and made that affordable in 3.0; Loro
keeps everything but can export a shallow snapshot, "like a Git shallow clone", without operations
before a chosen version. Event stores express retention as stream metadata (`$maxAge`, `$maxCount`,
truncate-before in KurrentDB) or archive partitions (Marten). Job queues delete: pg-boss keeps
completed jobs 7 days by default.

Erasure. Article 17 GDPR requires erasure "without undue delay" on six grounds, with exceptions
for legal obligations, legal claims and archiving in the public interest. Three techniques
reconcile this with an append-only log:

- Crypto-shredding: personal-data fields are encrypted with a key per data subject; erasure deletes
  the key; the events stay and read back as a null object (`ForgottenData` in Rails Event Store).
  Hash chains over the ciphertext stay valid. Projections, backups and search indexes must be
  rebuilt or also encrypted; key custody becomes security-critical.
- Redaction in place: KurrentDB's licensed tool overwrites event data with `0xFF` and flags
  `IsRedacted`; Loro's `redactJsonUpdates` blanks operations in a version range while keeping their
  ids so merges still converge. Both break hashes over the original bytes and require every replica
  to be rewritten.
- Redaction events: append a `PersonalDataErased` event that projections and exports honour. Cheap,
  but the data stays on disk and in every client that synced it; it only satisfies the regulation
  combined with one of the techniques above.

Jazz 2.0's spec is candid about replicas: revocation "removes rows from future settled subscription
result sets" and promises nothing about bytes already delivered. A framework that syncs history to
clients has the same limitation and must say so.

## 8. Meeting the brief in a general framework

### 8.1 Per-entity event logs with projections

Every entity instance owns a stream; a command is decided against the folded state and appended with
an expected version; the entity's own read model is an inline projection; cross-entity views are
async projections checkpointed on the global position. "Nothing truly deleted" becomes an `Archived`
event plus projections that hide archived rows, as Marten and Linear do. An optional hash of the
previous event in each event's metadata gives the brief's "chain" a tamper-evident meaning at no
design cost.

```ts
type EventEnvelope<T extends string = string, D = unknown> = {
  globalPosition: bigint;        // gapless or gap-aware, the cursor for consumers
  streamId: string;              // "<module>.<entity>:<id>"
  streamVersion: number;         // expected-version concurrency per stream
  type: T;
  data: D;                       // personal-data fields encrypted per subject
  meta: {
    hlc: string;                 // hybrid logical clock, sortable string
    actorId: string;             // authenticated principal at acceptance time
    clientId?: string;           // device/session that authored it
    clientSeq?: number;          // per-client mutation sequence (inbox key)
    causationId?: string;
    correlationId?: string;
    prevHash?: string;           // optional chain
  };
};
```

### 8.2 Field merge types for collaborative data

A field's merge type decides whether it may be written offline and how concurrent writes resolve.
Fields without one are server-only.

| Merge type | Rule on the server | Backing |
|---|---|---|
| `lww` | Highest HLC wins, node id breaks ties; losers kept in history | Scalar in the event |
| `counter` | Deltas from observed bases are summed (PN-counter) | Scalar delta in the event |
| `set` | Observed-remove set: add wins over a concurrent remove it did not see | Element adds and removes with ids |
| `sequence` | CRDT list (Loro movable list or `Y.Array`) merged by the library | Encoded update in the event, snapshot in the projection |
| `richText` | Loro text or `Y.XmlFragment` (Peritext-style) merged by the library | Same as `sequence` |
| `exclusive` | No merge; only synchronous commands may write | Scalar |

Row deletion follows the archive rule: a concurrent archive and edit both survive (the row is
archived with the edit applied) and a later `Restored` event wins. This differs from the "deletes
win" default of PowerSync and Figma and matches the brief.

```ts
const Task = entity('task', {
  title:    field.string({ merge: 'lww' }),
  done:     field.boolean({ merge: 'lww' }),
  estimate: field.integer({ merge: 'counter' }),
  tags:     field.set(field.string(), { merge: 'set' }),
  notes:    field.richText(),                       // merge: 'richText'
  slug:     field.string({ merge: 'exclusive', unique: true }),
});
```

### 8.3 Client sync protocol

The protocol is the Replicache/Linear shape adapted to events: the client pushes the events it
authored, the server accepts or rejects each, and the client pulls everything after its cursor,
filtered by what it may see.

```ts
type PushRequest = {
  clientId: string;
  mutations: Array<{
    clientSeq: number;           // strictly increasing per client
    streamId: string;
    baseVersion: number;         // stream version the client folded from
    hlc: string;
    type: string;
    data: unknown;
  }>;
};
type PushResponse = {
  results: Array<{ clientSeq: number; status: 'accepted' | 'rejected' | 'duplicate'; reason?: string; globalPosition?: bigint }>;
};
type PullRequest = { clientId: string; cursor: bigint; scopes: string[] };
type PullResponse = { events: EventEnvelope[]; cursor: bigint; lastAcceptedClientSeq: number };
```

The server keeps `(clientId, clientSeq)` as its inbox, so a retried push is answered with
`duplicate`. Mergeable-field events with a stale `baseVersion` are merged by field rule, not
rejected; `exclusive` fields and non-mergeable commands fail with `rejected` and a reason the client
shows. Live updates are a "poke" over WebSocket or SSE telling clients to pull, so live and catch-up
share one code path.

### 8.4 Authorization of offline-produced events

Offline events are proposals. They are authorized at acceptance against the actor's permissions and
the entity's committed state at that moment, never against what the client believed when authoring
them; Jazz 2.0 calls this fail-closed and Linear's server does it before broadcasting. The
CASL-style engine therefore needs one entry point, `can(actor, action, entityState, eventData)`,
that the ingest path calls per event on committed state. Revocation is forward-looking: a client
that already synced data has it. A client-side `can` is a prediction used to grey out UI.

### 8.5 What stays synchronous

Anything needing an answer the client cannot compute locally: uniqueness (usernames, e-mail
addresses, slugs, DNS names), payments and other external side effects, authentication and token
issuance, cross-entity invariants (quotas, stock), schema migrations, any `exclusive` field. The
command declares it:

```ts
const claimSlug = action('claimSlug', { execution: 'sync', unique: ['slug'] });
const renameTask = action('rename', { execution: 'offline' });   // only lww/counter/set/sequence/richText fields
const sendInvoice = action('sendInvoice', { execution: 'async' }); // queued, at-least-once, idempotent
```

## 9. Recommendation

Build the event-sourced core first and the sync protocol on top, in this order; each step is usable
alone and no later step changes the shape of an earlier one.

1. Foundation. PostgreSQL as the reference store behind a small `EventStore` interface
   (`readStream`, `appendToStream` with expected version, `readAll` from a global position,
   `subscribe`). One `events` table with a `bigserial` position, `UNIQUE (stream_id,
   stream_version)`, JSONB data and the envelope above. Inline projections for entity read models.
   `sync` commands run in-process; `async` commands are pg-boss jobs enqueued in the same
   transaction (`send(..., { db })`). `LISTEN/NOTIFY` on commit fans out pokes to connected clients.
   Crypto-shredding for personal fields from day one, because retrofitting it means rewriting
   history.
2. Consumers and processes. Async projections with checkpoints and Marten-style versioned
   tables for rebuilds; process managers in Emmett's workflow shape (instance stream as inbox and
   outbox); inbox table for every consumer.
3. Sync protocol. Push and pull as in 8.3, per-client sequence inbox, HLC in every event,
   `lww`, `counter` and `set` merge rules, archive and restore semantics, authorization at ingest,
   and a client reference implementation that stores pending events and rebases (IndexedDB in
   browsers, SQLite elsewhere).
4. Collaborative fields. `sequence` and `richText` backed by Loro (movable list and tree, shallow
   snapshots and redaction fit this brief), with Yjs where editor bindings matter; updates stored as
   events, snapshots in projections.
5. Optional transports. NATS JetStream as a fan-out module when one PostgreSQL `NOTIFY` is no
   longer enough across nodes. No Redis in the core.

Not recommended: Emmett as a dependency (licence undecided, 0.x), though its design should be
studied; KurrentDB as the default store (non-OSI licence, extra operations, erasure by rewrite),
though a store adapter is a reasonable later module; Zero, PowerSync or Electric as the sync layer
(each assumes its own server; Zero excludes offline writes), though their protocols are the
reference designs; Triplit (dormant).

## 10. Hard problems that remain

- Schema evolution of events and of CRDT field encodings: upcasters are well understood for
  events, not for a `richText` blob whose library format changes.
- Authorization drift: an offline edit authored under rights revoked before it arrived must be
  rejected and explained; the explanation's data is a framework concern even if its UI is not.
- Erasure with replicated history: crypto-shredding handles the server; clients holding history must
  discard and re-sync, and CRDT documents need Loro-style redaction plus a snapshot cut for every
  peer. No clean answer exists for a peer that stays offline.
- Divergence no merge rule can settle: uniqueness, money, invariants spanning entities. Keeping
  those synchronous is the answer; the cost is that offline users cannot perform them.
- The global position: a single PostgreSQL sequence has gaps under rollback (Marten's tombstone
  rows are the known workaround) and is one writer; multi-region needs per-stream ordering plus HLC
  and gives up a total order.
- Growth: history never shrinks by default. Retention per module (shallow snapshots, archive
  partitions) must be a first-class setting, and "nothing deleted" must be defined as "nothing
  deleted without a retention rule the operator chose".
- Live-query cost: LiveGraph's failure modes (thundering-herd reconnects, paginating unbounded live
  views) are avoided by pokes plus cursor pulls, which instead push the cost into pull filtering,
  the part Linear had to rebuild with posting lists at scale.
- Determinism and tests: deciders, projections and merge rules must be pure so that convergence
  can be property-tested by replaying permutations of the same events.

## Sources

Checked on 2026-10-08.

- Emmett: [overview](https://event-driven-io.github.io/emmett/overview.html), [getting started](https://event-driven-io.github.io/emmett/getting-started.html), [workflows guide](https://github.com/event-driven-io/emmett/blob/main/src/docs/guides/workflows.md), [projections guide](https://github.com/event-driven-io/emmett/blob/main/src/docs/guides/projections.md), [README (licence note)](https://github.com/event-driven-io/emmett)
- KurrentDB: [streams](https://docs.kurrent.io/server/v26.0/features/streams.html), [redaction](https://docs.kurrent.io/server/v26.0/operations/redaction), [installation and licence keys](https://docs.kurrent.io/server/v26.0/quick-start/installation.html), [Kurrent License v1](https://github.com/kurrent-io/KurrentDB/blob/master/LICENSE.md)
- Marten: [projections](https://martendb.io/events/projections/), [rebuilding](https://martendb.io/events/projections/rebuilding.html), [archiving](https://martendb.io/events/archiving.html), [appending and tombstones](https://martendb.io/events/appending.html)
- Rails Event Store: [GDPR](https://railseventstore.org/docs/v2/gdpr/), [subscriptions](https://railseventstore.org/docs/v2/subscribe/)
- NestJS: [CQRS recipe](https://docs.nestjs.com/recipes/cqrs)
- NATS JetStream: [publishing and duplicate writes](https://docs.nats.io/learn/jetstream/publishing/), [retention policies](https://docs.nats.io/learn/jetstream/retention-policies/), [advanced publishing](https://docs.nats.io/learn/jetstream/advanced-publishing/)
- Redis Streams: [data type guide](https://redis.io/docs/latest/develop/data-types/streams/); Redis 8 licensing: [InfoQ, May 2025](https://www.infoq.com/news/2025/05/redis-agpl-license)
- pg-boss: [README](https://github.com/timgit/pg-boss), [queues](https://github.com/timgit/pg-boss/blob/master/docs/api/queues.md), [jobs](https://github.com/timgit/pg-boss/blob/master/docs/api/jobs.md)
- graphile-worker: [job keys](https://worker.graphile.org/docs/job-key), [SQL add_job](https://worker.graphile.org/docs/sql-add-job)
- BullMQ: [deduplication](https://docs.bullmq.io/guide/jobs/deduplication), [Redis compatibility](https://docs.bullmq.io/guide/redis-tm-compatibility)
- Patterns: [transactional outbox](https://microservices.io/patterns/data/transactional-outbox.html), [idempotent consumer](https://microservices.io/patterns/communication-style/idempotent-consumer.html), [Idempotency-Key draft-07](https://www.ietf.org/archive/id/draft-ietf-httpapi-idempotency-key-header-07.html)
- Automerge: [conflicts](https://automerge.org/docs/reference/documents/conflicts/), [Automerge 3 announcement](https://automerge.org/blog/automerge-3/), [repositories](https://automerge.org/docs/reference/repositories/); API names verified in `@automerge/automerge@3.5.0` type definitions
- Yjs: [README](https://github.com/yjs/yjs); Loro: [README](https://github.com/loro-dev/loro), [LoroDoc reference](https://docs.rs/loro/latest/loro/struct.LoroDoc.html); API names verified in `loro-crdt@1.16.4` type definitions
- Electric: [shapes](https://electric-sql.com/docs/guides/shapes), [writes](https://electric-sql.com/docs/guides/writes)
- PowerSync: [consistency](https://docs.powersync.com/architecture/consistency), [update conflicts](https://docs.powersync.com/usage/lifecycle-maintenance/handling-update-conflicts), [service licence](https://github.com/powersync-ja/powersync-service/blob/main/LICENSE)
- Zero: [mutators](https://zero.rocicorp.dev/docs/mutators), [queries](https://zero.rocicorp.dev/docs/synced-queries), [offline](https://zero.rocicorp.dev/docs/offline), [status](https://zero.rocicorp.dev/docs/status); Replicache: [how it works](https://doc.replicache.dev/concepts/how-it-works), [home page status notice](https://replicache.dev/)
- Jazz: [README](https://github.com/garden-co/jazz), [2.0 spec: history and merging](https://github.com/garden-co/jazz/blob/main/crates/jazz/SPEC/4_history_merging.md), [2.0 spec: authorization](https://github.com/garden-co/jazz/blob/main/crates/jazz/SPEC/7_authorization.md)
- Triplit: [README](https://github.com/aspen-cloud/triplit), [Supabase announcement, 2025-10-08](https://supabase.com/blog/triplit-joins-supabase); Convex: [understanding](https://docs.convex.dev/understanding/), [backend licence](https://github.com/get-convex/convex-backend/blob/main/LICENSE.md)
- Linear: [Rebuilding delta sync read path](https://linear.app/blog/rebuilding-delta-sync-read-path), [reverse-engineering study](https://github.com/wzhudev/reverse-linear-sync-engine)
- Figma: [How Figma's multiplayer technology works](https://www.figma.com/blog/how-figmas-multiplayer-technology-works/), [LiveGraph](https://www.figma.com/blog/livegraph-real-time-data-fetching-at-figma/)
- OT and rich text: [ShareDB](https://share.github.io/sharedb/), [Peritext](https://www.inkandswitch.com/peritext/)
- Clocks: [Hybrid Logical Clocks paper](https://cse.buffalo.edu/tech-reports/2014-04.pdf), [HLC explained](https://jaredforsyth.com/posts/hybrid-logical-clocks/), [CockroachDB transaction layer](https://docs.cockroachlabs.com/docs/stable/architecture/transaction-layer)
- Law: [Article 17 GDPR](https://gdpr-info.eu/art-17-gdpr/)
