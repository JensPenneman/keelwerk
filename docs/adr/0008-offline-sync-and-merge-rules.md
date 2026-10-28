# 8. Offline sync: rows down, commands up, merge rules per field, Loro for collaborative fields

Date: 2026-10-11 (revised after review the same day; amended 2026-10-25)

## Status

Proposed. Item 5 is amended by [ADR 0026](0026-pure-handlers-and-the-effect-interpreter.md)
(decision 50a): `handle` no longer exists, and offline commands may not use `prepare`, random values
or issued secrets.

## Context

The brief asks that "multiple actors can work on it online and offline at the same time" and that
"the framework handles this gracefully". The first draft of architecture.md section 15 fixed the frame: per-field merge
types (`lww`, `counter`, `set`, `sequence`, `richText`, `exclusive`) declared with `.merge()`;
`exclusive` and every unique field synchronous-only; `offline: true` commands touching mergeable
fields only; a push and pull protocol with a per-client sequence inbox built on the command
receipts; authorization of offline-authored events at ingest against committed state; Loro 1.16.4
as the research recommendation for collaborative fields. It left the protocol, the inbox, the
rejection channel and the CRDT library to the data designer.

The research (events-and-sync.md) found three families: CRDT libraries (Automerge, Yjs, Loro), which
converge without a server and know nothing of permissions; mutation-replay engines (Replicache, Zero,
Linear, Jazz 2.0), which re-run a change on an authoritative server and rebase what is pending; and
replication engines (Electric, PowerSync), which solve the read path. Zero now rejects offline writes
on purpose, because constraints, business rules and authorization fail when an offline user
reconnects; that lesson bounds what may run offline. Platforms.md expects no offline authorship in
Launchway and offline `set` merges for mail keywords, mailbox membership and drafts. The review of
2026-10-11 found that the first version let `sync.pull`, a query, acknowledge receipts and record
the last pull, although queries run in read-only units, and that `sync.push` ran each mutation in
its own unit although an invocation has exactly one.

## Decision

1. **Reads are row sync.** A client registers shapes (`entity`, condition, partition, fields); its view
   is the shape conjoined with the principal's read plan. A pull returns current, masked rows for
   streams changed after its cursor, and removals decided by the disclosure rule of ADR 0007; the
   first pull scans each shape after taking the head. Clients never receive events, so they need no
   `evolve`, see no history they may no longer read and never upcast.
2. **Writes are commands replayed at ingest.** A client pushes the commands it ran offline, each with
   a command id, a client sequence, the base versions it pulled and its authoring clock. The server
   runs each through the invoker in its own unit: validation, authorization against committed state,
   the command's `decide` against the current row, the merge rules, the item check and the entity
   invariant. A client proposes; it cannot forge events.
3. **Merge rules.** `lww` by hybrid logical clock against a per-field clock in the row's merge state;
   `counter` by summed increments; `set` as an observed-remove set, where a remove deletes the adds
   its author had observed (by base version and authorship); `sequence` and `richText` through the
   CRDT codec, with the result validated against the field; `exclusive` online only; the archive
   state as an `lww` field. Merge state is added to an entity when its first offline-capable command
   appears, by a migration step and a rebuild from the log, which every M1 event already supports.
4. **Clocks.** Clients author with hybrid logical clocks corrected by the server time of every
   response; a clock ahead of the server by more than the skew bound (default 5 minutes) is deferred
   and re-stamped; loading a row for a write advances the server clock past the row's clocks, so
   online writes always win against accepted offline writes.
5. **What runs offline.** The generated `set` when an entity opts in, and custom commands with
   `offline: true` whose `decide` returns only field operations on mergeable fields, `archived` or
   `restored`. Such commands use `decide`, synchronous execution and policy authorization, checked at
   compose. Everything else is online: `handle` commands (since ADR 0026: commands with `prepare`,
   random values or issued secrets), domain events with an author `evolve`,
   unique and `exclusive` fields, authentication and secrets, external side effects, invariants across
   entities, asynchronous and non-tenant actions.
6. **Protocol.** The `sync` module (in `@keelwerk/events`) provides `sync.register`, `sync.push`,
   `sync.pull`, `sync.poke` (built on the live module's pokes) and, in M7, `sync.crdt`; every
   transport can carry them. The per-client inbox is the client row's `lastClientSeq` plus the
   command receipts, kept until the client acknowledges them with `ackUpTo` on a later push;
   `sync.pull` is a query and writes nothing. `sync.push` is declared `transaction: 'per-item'`, a
   kernel-only option under which each mutation is an independent invocation in its own unit.
   Duplicates are recognised by sequence and command id; a gap defers the rest of a batch; a
   rejected mutation still advances the sequence. Client inactivity is measured from the last push
   or registration.
7. **Rejection channel.** Outcomes come back in the push response and in every pull until
   acknowledged. The reference client reverts a rejected mutation automatically, rebases the rest and
   keeps the rejected one in a local journal with its input and error. A lost `lww` comparison is a
   notice on an accepted mutation. The framework has no server-side merge tasks.
8. **Collaborative fields.** Loro (`loro-crdt` 1.16.4, MIT) is the first codec, behind a kernel
   extension point so the core carries no WebAssembly. Documents are stored in the row, each accepted
   update in its event. Online whole-value writes are turned into operations (a minimal text diff)
   from the first collaborative field, so the stored form never changes; incremental CRDT sync by version vector, real-time
   batching and ephemeral presence arrive in M7. Yjs can become a second codec per field.
9. **Reference client.** `@keelwerk/sync-client`: local storage behind an interface (memory,
   IndexedDB, SQLite), the clock, the pending queue, optimistic application of generated `set`
   operations, rebase, the rejected journal and typed local queries, over the app's typed client.
10. **Milestones** (numbered as the roadmap since 2026-10-28; M8 and M9 before). M6 delivers the
    protocol with `lww`, `counter` and `set`; M7 the collaborative fields and client-side prediction
    of custom offline commands (roadmap). The Loro codec ships earlier if an app declares a
    collaborative field before M7, so the stored form is final from the first such field.

## Consequences

- Online and offline writes share one pipeline, one authorization and one audit trail; offline clients
  cannot bypass business rules or forge history.
- Offline users cannot claim unique names, trigger external effects or touch cross-entity invariants;
  those commands wait for a connection, which the command's declaration makes explicit.
- Field-level merges can combine into a state no author produced; entity invariants and policies
  evaluated on the merged post-image reject such mutations instead of storing them.
- Nothing a user typed is lost silently: every mutation ends accepted, merged with a notice, or
  rejected into the client's journal.
- Revocation is forward-looking: a client keeps data it already holds until its next pull removes it.
- The Loro codec adds WebAssembly to processes of apps that declare collaborative fields, and its
  format becomes part of the stored data, guarded by a codec id on every payload.
- The core changes this decision required (the offline constraints, the codec extension point,
  sync metadata on the invocation, the entity invariant and the clock receive rule) are folded into
  architecture.md sections 4.2, 5.6, 7.3 and 9.2.
