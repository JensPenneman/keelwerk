# 15. Jobs, durable timers and schedules on one kernel queue over the adapters' job store

Date: 2026-10-11 (revised 2026-10-24 and 2026-10-25)

## Status

Proposed. Amended by [ADR 0025](0025-nodes-capacity-and-autoscaling.md) (decisions 3, 6 and 7, on
2026-10-25); [ADR 0026](0026-pure-handlers-and-the-effect-interpreter.md) (decision 50a) gives
decision 6 its effect contract. Architecture.md sections 7.9, 9.5 and 21 specify the result.

## Context

Both proof platforms need queued work throughout: Launchway's per-project dispatch lanes, debounced
reconcilers for the edge, DNS and the GitHub mirror, durable timers keyed by business ids (a node
offline after 45 seconds, image retries after 1, 2, 4, 8 and 15 minutes), schedules per tenant
(public-address checks, release polling, certificate renewal, DKIM rotation, retention); and the mail
server's delivery with per-destination concurrency and retries for up to five days. The first draft
named one `JobQueue` with three capabilities and pg-boss 12.37.1 on PostgreSQL as its implementation
(gap G3).

The review of 2026-10-11 found four problems. pg-boss exists only on PostgreSQL, while the plan runs
the proof apps on MySQL and SQLite and `pennestack dev` on PGlite, which has a single connection.
Asynchronous reactions were checkpointed consumers per namespace, so one tenant's slow or failing
reaction blocked every tenant of a shared namespace (ADR 0007). Jobs carried a snapshot of the
principal, so a removed member or a revoked key kept acting through queued work for days. Timers
fired under whoever set them, so the node-offline timer ran under the node's own credential.

## Decision

1. **One kernel queue.** The core implements `JobQueue` once, over a `JobStore` that every data
   adapter provides in its unit (`ps_jobs` in the namespace, under the scope's row-level security).
   Workers take jobs with `FOR UPDATE SKIP LOCKED` on PostgreSQL and MySQL and through the single
   writer on SQLite, PGlite and the in-memory adapter. A different implementation (a pg-boss entry)
   can replace it as deployment infrastructure behind the same interface.
2. **Enqueued with the cause.** Asynchronous commands, timers, schedules and reaction jobs are
   inserted in the unit of the command, timer or dispatch that causes them, so they commit with it on
   every adapter and no relay exists.
3. **Capabilities.** Keys with `keep`, `replace` or `coalesce`; groups with concurrency and a rate
   (per destination); fair lanes per scope, queue, capability set and priority class, each with a
   cap (running jobs per tenant and queue) and a weight, and a queued cap with backpressure;
   priority classes; FIFO per key; retry schedules (exponential or explicit, with a maximum delay
   and a give-up horizon) driven by the error taxonomy's `retryable` flag; leases renewed by
   heartbeats and fenced by (worker, attempt); expiry; dead letters that an operator replays or
   discards; cancellation by key; schedules from cron or RRULE expressions, per backend or for each
   tenant, at most one run per tick and scope. Fair lanes, caps, group rates, priorities and leases
   were added by ADR 0025.
4. **Principals.** A job stores a principal reference (resolver id, principal id, credential id),
   never a snapshot. The worker resolves and enriches it again and fails the job with
   `unauthenticated` when the credential was revoked or expired, then invokes through the invoker so
   the gate and the item check run against current state. Timers, schedules and reaction jobs run
   under the module's service principal `<module>.system` with the triggering actor recorded as
   causation.
5. **Reactions.** The reaction dispatcher of ADR 0007 turns each matching event into one keyed job
   per reaction; reaction options (`key`, `ordering`, `coalesce`, `concurrency`, `retry`) are job
   options. A failing reaction is retried by the queue and parked as a dead letter, never holding a
   checkpoint.
6. **DSL.** Timers are effect descriptions that handlers return,
   `setTimer({ key, at or after, invoke, input })` and `cancelTimer(key)`, in place of the earlier
   `ctx.timers.set` and `ctx.timers.cancel` calls (amended by ADR 0025 and ADR 0026; architecture.md
   section 7.9.5 specifies the kernel effects, `enqueue` among them, and the executors of external
   effects);
   `defineSchedule(base, { every, invoke, scope })` parts, mounted under the module literal's
   `schedules` keyed by schedule id and contributing to the core's `schedules` extension point;
   `async: { queue, key, ordering, group, priority, cost, retry, onGiveUp }` on asynchronous
   actions. `invoke` and `onGiveUp` take an own action part by value (ADR 0003, revised 2026-10-24).
   Jobs record their enqueuer's build revision and, from external callers, the input as sent with
   its API version (ADR 0022).
7. **Tenancy.** Jobs carry their scope; lane caps bound a tenant's running jobs per queue and the
   queued cap its backlog, which is the job side of the quota model (ADR 0025, replacing per-tenant
   groups); finished jobs leave `ps_jobs` and keep their outcome, without input, in
   `ps_job_history` for seven days.

## Consequences

- The same queue works in development, in tests and on every production adapter, with one
  conformance suite; the M7 promise of the proof apps on MySQL and SQLite holds.
- Queued work stops at once when its principal loses its credential, and system work is attributable
  to a module.
- The project owns a queue (a few hundred lines plus tests) instead of depending on pg-boss's maturity;
  pg-boss remains a possible infrastructure entry, and the choice is a decision point for Jens.
- On SQLite and PGlite, one writer bounds queue throughput; those adapters serve development, tests
  and single-process deployments.
