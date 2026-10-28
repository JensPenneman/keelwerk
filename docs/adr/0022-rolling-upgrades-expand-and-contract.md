# 22. Rolling upgrades: build revisions, a process registry, the N-1 rule and gated contract steps

Date: 2026-10-24 (revised in place on 2026-10-28 for decisions 54a and 55b)

## Status

Proposed. Jens decided automatic finalization after the grace period (decision 54a, 2026-10-28)
and reversed the rename rule of item 4 (decision 55b, 2026-10-28): a rename renames the column
through expand, dual write, backfill and contract, and physical names always equal the derived
names. The mail listeners' own container (item 7, question 56) is parked with the mail server.

## Context

Addendum 3 of the brief (2026-10-23) requires that moving to a newer version never interrupts
running clients or running processes. The specification split migration steps into expand and
contract (architecture.md section 14.6.4) but deferred multi-process renames to M7 and said
nothing about events, jobs, receipts, configuration or consumers that one build writes and another
reads. Singleton leases are gap G9 (ADR 0018).

During a rolling deploy, two builds share the namespaces, the event log, the job queue, the control
store and client connections. The research note
([research/versioning-rollouts-flags.md](../research/versioning-rollouts-flags.md), sections 4 to
6) found expand and contract as the discipline, pgroll completing a migration "once no clients use
the old version" without checking it, and CockroachDB's finalization, which enables new formats,
cannot be rolled back and starts only when every live node runs the new version.

## Decision

1. **Build revisions.** `pennestack build` writes a manifest with the compatibility content
   (migration files, event shapes, configuration versions, job formats, protocol majors, version
   change ids, API versions with their surfaces). `core.rollout` records the finalized revision and
   its content. At `connect`, equal content joins the finalized revision; content that only adds
   runs at the target revision (finalized plus one); content lacking anything the finalized build
   has, retired versions and majors apart, refuses to start (`buildTooOld`), as does content
   differing from a current target's (`targetConflict`). One rollout runs at a time.
2. **The process registry.** `core.process` records each process's build, revision, roles,
   capabilities, protocols, API versions and state, with a heartbeat every 10 seconds; 30 seconds
   of silence presumes it gone. It has a change feed and records singleton lease holders. A
   process below the finalized revision stops.
3. **The N-1 rule.** While a target runs: expand steps only, none adding a constraint the older
   build's writes violate; the target writes the finalized track versions (renames under the old
   name, type changes through a `downcast` beside the migration's `upcast`); consumer leases move
   to the target and rebuilds wait; workers take jobs at or below their revision; receipts record
   the outcome's API version; configuration is written in the older version; an older process
   meeting what it does not know answers `unavailable`, `core.rollout_in_progress`, and clients
   retry under the same command id.
4. **Gated contract steps.** `db apply --contract` and rewrites of stored configuration refuse with
   `conflict`, `core.rollout_not_finalized`, unless the finalized revision covers them and no live
   process is below it. A field rename, a type change or a split is a new column written beside
   the old one (for a rename, the column of the new derived name, written through the migration
   file's `renames` entry), a backfill after finalization, reads moving per namespace once the
   backfill is recorded, and a contract drop, for one process or many (decision 55b). This item
   first kept a renamed field's physical column, recorded in the snapshot, so that renames never
   waited; Jens chose that physical names always equal the derived names, and the snapshot keeps no
   column aliases.
5. **Finalization and rollback.** `pennestack rollout finalize` raises the finalized revision when
   every live process runs at the target revision; with `finalize: 'auto'`, the default, a
   singleton finalizer does so once that has held for the grace period (600 seconds).
   Finalization switches writers to the new formats and starts backfills. Before it, rollback is a
   redeploy of the finalized build, then `pennestack rollout abort`, which moves the target's jobs
   the finalized build can run and parks the rest; after it, going back means a restore.
6. **Clients** resume by token at the same API version after `going_away`; `welcome` carries
   `apiVersion`, `surfaceHash` and the protocol major; a stream whose version is retired ends with
   `version_retired`.
7. **Strategies.** Rolling replacement is the default; blue-green and canary are edge routing under
   the same rule; release flags (ADR 0023) separate releasing from deploying. On the home server the
   mail listeners get their own container, because two containers cannot publish one host port
   (question 56, parked with the mail server).

## Consequences

- No deploy interrupts clients or queued work. A rename, like a type change, takes several steps,
  and the target writes some data twice until finalization; in return the database's column names
  always say what the fields are called.
- Rollback is cheap until finalization and a restore afterwards.
- An outdated build can neither start nor keep running.
- One rollout at a time serialises deploys; the registry is shared with the leases of ADR 0018.
- Multi-process renames and type changes arrive with the rollouts of Launchway's rebuild (M4 since
  the roadmap's reorder of 2026-10-28; M3 when this ADR was written, and M7 before it); the mail
  listeners drop connections for seconds per upgrade.
