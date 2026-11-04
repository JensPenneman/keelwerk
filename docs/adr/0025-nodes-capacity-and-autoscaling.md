# 25. Nodes, capacity and autoscaling over fair lanes of the kernel job queue

Date: 2026-10-25 (notes of 2026-10-28)

## Status

Accepted (2026-11-04). Amends ADR 0015 (decisions 3, 6 and 7). Jens decided for the kernel queue on 2026-10-26
(decision 6a), as this ADR assumes. Singleton leases stay with ADR 0018, the executor contract with
[ADR 0026](0026-pure-handlers-and-the-effect-interpreter.md) (decision 50a, architecture.md section
7.9.5). On 2026-10-28 Jens decided the command name `keelwerk fleet` (62a), the scaler with the
static provider first and the docker provider one milestone later, with a Kubernetes provider as a
named later milestone (63a), and the opt-in docker provider behind a verb-limited socket proxy
(64a); with the roadmap's reorder that is M4 for the scaler and M5 for the docker provider.
Architecture.md sections 9.5 and 21 specify the design.

## Context

Jens's requirement of 2026-10-23: "This job queue should be thought out REALLY WELL: I plan to work
with an arbitrary number of nodes in the future, and they should all scale automatically, with
limits." ADR 0015's queue had no fair take, no bound on queued work, no placement by resource and no
say over how many processes run; ADR 0022's registry knows processes, not capacity. Decision 50a
(2026-10-25) keeps effects out of handlers: the kernel executes and records them.

The research note ([research/jobs-nodes-autoscaling.md](../research/jobs-nodes-autoscaling.md))
compared four families (this kernel queue, PostgreSQL queue libraries, brokers, durable execution
engines) and autoscaling prior art; KEDA's backlog-only Temporal scaler scales in on busy workers.

## Decision

1. **The kernel queue stays.** A pg-boss entry stays possible, not planned; a broker appears only as
   a later dispatch tier carrying job ids; no durable execution engine, since decision 50a records
   every effect.
2. **Fair lanes.** One lane per scope, queue, capability set and priority class, with a cap (running
   jobs per tenant and queue), a weight and a virtual time. Takes lock lanes, then jobs, with `SKIP
   LOCKED`, ordered by priority class, running work per weight and virtual time; lane counters are
   split by writer, so enqueue bursts never block takers. A queued cap answers `rate_limited`
   (`core.queue_full`); groups carry concurrency and a rate. Lane caps replace per-tenant groups in
   the quota model.
3. **Leases.** Heartbeats every 10 seconds, leases of three; renewal and completion are conditional
   on (worker, attempt); three lost leases dead-letter a job.
4. **Jobs under decision 50a.** Action jobs run pure handlers through the invoker. External effects
   become effect jobs in the same unit, run by their executors outside any unit, at least once, with
   outcomes recorded and passed to continuations. Timers are effect descriptions (`setTimer`,
   `cancelTimer`), replacing ADR 0015's `ctx.timers` calls.
5. **Nodes and named processes.** `core.node` is new; `core.process` gains provider, instance,
   slots, reserved connections and drain state. Named processes declare roles, capabilities, slots
   per queue, placements, a provider and scale limits. Only listeners and effect executors require
   capabilities, which probes confirm; unplaceable work fails closed. Starting processes reserve
   connections from each placement's budget.
6. **The scaler.** A singleton every 15 seconds computes a pure plan per work class: Little's law
   plus the backlog within its target wait, an age factor of at most 2, never below the running
   jobs. Limits clamp it (min, max, per node, per provider, deployment processes and cost,
   connection budgets, take latency). Up by 100 percent or 4, whichever is more; down after 5
   minutes, one process per evaluation; 10 percent tolerance.
7. **Providers and drains.** `static` in the core, `docker` as an opt-in package behind a socket
   proxy, Kubernetes and cloud providers later. Scale-down is a drain with a deadline (60 seconds by
   default) that releases unfinished jobs.
8. **Commands.** `keelwerk fleet` (nodes, processes, scaling) is the framework's command group
   (decision 62a); since action commands sit under `keelwerk call` (decision 16b, ADR 0013) it
   reserves no module id, and Launchway's `nodes` module keeps its id. `keelwerk jobs` gains
   `stats`, `lanes` and `explain`.
9. **Upgrade path.** `JobQueue`, `JobStore`, `JobSpec` and the conformance suite stay fixed: more
   placements, partitioned `kw_jobs` and a pooler, then a dispatch tier on NATS JetStream.

## Consequences

- One tenant's burst cannot starve another, limits hold across any number of processes, payloads
  stay under row-level security, and the first releases need no new infrastructure.
- Work runs only where its resource is; no unit waits on the network. Scaling is explainable
  (`keelwerk fleet scale explain`) and testable as a pure function.
- The project owns more queue code (lanes, split counters, leases, the scaler) and conformance
  cases; the take is more involved than a plain `SKIP LOCKED` select; the docker provider needs a
  root-equivalent socket, so it is opt-in.
- Effects are at least once; executors pass idempotency keys where destinations accept one.
- Throughput is bounded per placement (planned at 2,000 jobs per second until M0 and M2 measure it),
  with the dispatch tier beyond.
