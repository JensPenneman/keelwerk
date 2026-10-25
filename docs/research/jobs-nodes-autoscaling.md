# Jobs, nodes and autoscaling

Date: 2026-10-25. Status: research input for the sections "Asynchronous work: jobs, timers and
schedules" and "Nodes, capacity and autoscaling" (`docs/sections/jobs-nodes-autoscaling.md`, to
become architecture.md sections 9.5 and 21) and for ADRs 0015 and 0025; it decides nothing by
itself. Scope: decision point 6, re-examined for Jens's requirement of 2026-10-23 (an arbitrary
number of nodes that all scale automatically, with limits) and under decision 50a. Method: the
specification; versions with `npm view` on 2026-10-25; the type definitions and readmes of pg-boss
12.38.0, graphile-worker 0.18.0, DBOS 5.3.0, BullMQ 6.4.2, the Hatchet TypeScript SDK 1.43.0 and
Inngest 4.26.0, read from their npm tarballs; four web searches and three page fetches on
2026-10-25, which reached both caps. Table 2's entries for those six packages and Temporal's
fairness come from these checks; statements marked "(not re-checked)", and the other tools' rows in
Table 2, are prior knowledge not verified within the caps.

## 1. What the queue must provide

- Transactional enqueue: a job commits with the command, timer or dispatch that causes it, with no
  relay (ADR 0015).
- Every adapter: PostgreSQL and MySQL in production, SQLite for small installations, PGlite in
  `pennestack dev`, the in-memory adapter in tests and as the conformance oracle (the M7 promise).
- Tenant isolation: payloads under the scope's row-level security; one tenant's backlog or failing
  job never delays another tenant (M2 exit criterion 2).
- Semantics: keys (keep, replace, coalesce), FIFO per key, groups with concurrency and rate,
  priorities, fair shares, retries driven by the error taxonomy, leases, schedules once per tick and
  scope, dead letters.
- Placement: work that needs a resource (port 25 egress, a Docker engine) runs only where it is.
- Scaling signals: due work, the oldest wait, arrivals, run time and running work per class.
- Decision 50a: handlers never perform effects; the kernel executes and records every effect, so
  external effects become jobs of their own.

## 2. The four families

Table 1. Families against the criteria of the brief.

| Criterion | A. Kernel queue on the adapter job store | B. PostgreSQL queue libraries (`SKIP LOCKED`) | C. Broker-backed queues | D. Durable execution engines |
|---|---|---|---|---|
| Members | the section's design | pg-boss, graphile-worker, River, Oban, Solid Queue, Hatchet | BullMQ, Sidekiq, NATS JetStream, Redis Streams, RabbitMQ | Temporal, Inngest, Trigger.dev, Restate, DBOS |
| Distribution over nodes | any worker on any node takes with `SKIP LOCKED` (single writer on SQLite, PGlite, in memory); lanes spread the takers | the same; Hatchet adds an engine that assigns work | the broker hands messages to consumers | workers poll the engine (Temporal, Hatchet, DBOS) or the engine pushes to endpoints (Inngest, Restate) |
| Throughput ceiling | one placement's database; planned at 2,000 jobs per second per placement | graphile-worker: about 15,600 trivial jobs per second unbatched, 184,000 batched, on one machine; plain `SKIP LOCKED` gave out near 5,000 tasks per second at Hatchet | far higher per broker (not re-checked) | the engine's store and cluster |
| Keys, groups, FIFO, fairness, rate limits, priorities | all, with weighted fair shares across tenants that count running work | keys and FIFO common; groups in pg-boss, Hatchet and Solid Queue; rate limits in Hatchet and commercial add-ons; no weighted fair share | order per subject, stream or queue; per-key limits and fairness absent or in commercial add-ons | the richest flow control; fairness keys in Temporal, round robin over keys in Hatchet |
| Tenant isolation of payloads | in the tenant's namespace, under row-level security | the library's tables beside the app's, without a scope predicate | payloads leave the database; subjects, accounts or virtual hosts separate tenants | payloads in the engine's histories or journals |
| Transactional enqueue | on every adapter, in the cause's unit | on PostgreSQL, when the queue shares the app's database (Oban and Solid Queue also on MySQL and SQLite) | no: an outbox and a relay | no: a call to the engine, or DBOS's own system database |
| Operational cost | none beyond the placements | none beyond the database | a broker to run, secure, monitor and back up | a server or cluster with its own store; DBOS needs only PostgreSQL |
| Development and test | the same queue on PGlite and in memory, one conformance suite | a PostgreSQL (pg-boss also PGlite) | a broker in development and CI, or a fake with other semantics | a development server or test environment per engine |
| Autoscaling fit | exact due work, age, arrivals, run time and running work per class from the lane tables | backlog by an SQL query (KEDA's PostgreSQL scaler) | KEDA scalers on lag or length; running work hard to see | backlog metrics; KEDA's Temporal scaler sees backlog only |

## 3. Tools within the families

Table 2. Version and publication date from npm on 2026-10-25 where a Node package exists.

| Tool | Store, runtime | Keys, FIFO | Groups, fairness, rate limits | Priorities | Transactional enqueue | Notes |
|---|---|---|---|---|---|---|
| pg-boss 12.38.0 (2026-10-13) | PostgreSQL 13+ or PGlite; Node | `singletonKey`, throttle, debounce; policy `key_strict_fifo` | groups with concurrency per node or across nodes, with tiers; no fair share | integer; workers filter by minimum and maximum | yes, with Kysely, Drizzle, Knex and Prisma adapters | heartbeats, dead letters, partitioned queue tables; the readme says one person maintains it |
| graphile-worker 0.18.0 (2026-09-08) | PostgreSQL; Node | job keys (`replace`, `preserve_run_at`, `unsafe_dedupe`); named queues run serially | none | integer | yes, through its SQL function | benchmark in section 4 |
| River | PostgreSQL; Go | unique jobs | global limits in the commercial River Pro | 1 to 4 | yes | not usable from Node |
| Oban | PostgreSQL, SQLite, MySQL; Elixir | unique jobs | global limits, rate limits and partitions in the commercial Oban Pro | 0 to 9 | yes | not usable from Node |
| Solid Queue | PostgreSQL, MySQL, SQLite; Ruby | none; a limit of 1 per key serialises | concurrency limits per key through semaphores | integer | when it shares the app's database | ready, scheduled and claimed executions in separate tables |
| Hatchet (TypeScript SDK 1.43.0, 2026-10-23) | its engine on PostgreSQL | concurrency keys | `GROUP_ROUND_ROBIN` across keys; rate limits per step and key | yes | no: a call to its server | a queue and workflow engine to run |
| BullMQ 6.4.2 (2026-10-24) | Redis or Valkey; Node | job ids, deduplication | one rate limiter per queue; groups only in the commercial BullMQ Pro | integer | no | parent and child flows |
| Sidekiq | Redis; Ruby | unique jobs in Enterprise | limiters in Enterprise | queue weights | no | not usable from Node |
| NATS JetStream (`@nats-io/jetstream` 3.4.0, 2026-05-08) | file or memory streams | `Nats-Msg-Id` deduplication window; order per subject | `MaxAckPending` per consumer; no fair share | priority groups for pull consumers | no | work-queue retention, redelivery with backoff, accounts isolate tenants |
| Redis Streams (`redis` 6.3.0, `ioredis` 6.0.0) | Redis | order per stream | consumer groups; nothing per key | none | no | `XAUTOCLAIM` takes over stale entries; no delays |
| RabbitMQ (`amqplib` 2.2.0) | RabbitMQ | order per queue; single active consumer | prefetch per consumer | queue priorities | no | delivery limits on quorum queues; delays by plugin or expiry |
| Temporal (`@temporalio/client` 1.24.0, 2026-09-15) | its cluster on Cassandra, PostgreSQL or MySQL | workflow ids; FIFO within a fairness key | fairness keys with weights (weighted round robin); dispatch rates per queue and per key | 1 to 5 | no | deterministic workflows replay a history of recorded activities |
| Inngest 4.26.0 (2026-10-22) | its server, pushing to the app's endpoint | idempotency, singleton, debounce | concurrency keys on two levels, throttle, rate limit | an expression | no | event batching |
| Trigger.dev (`@trigger.dev/sdk` 4.8.1, 2026-10-23) | its platform, running tasks in containers | idempotency keys | queue concurrency, concurrency keys | yes | no | heavy to self-host |
| Restate (`@restatedev/restate-sdk` 1.17.4, 2026-10-20) | its server and log | idempotency keys; one handler at a time per virtual object key | one per key | not checked | no | journals the results of `ctx.run` |
| DBOS (`@dbos-inc/dbos-sdk` 5.3.0, 2026-10-15) | PostgreSQL, as a library; Node | deduplication ids | global, per-worker and per-partition concurrency; rate limits per queue and partition | integer | no: workflows live in its system database (not re-checked) | workflows checkpointed in PostgreSQL; queue settings versioned for rolling deploys |

## 4. Throughput evidence

- graphile-worker's performance page (fetched 2026-10-25): 15,607 jobs per second unbatched and
  183,895 batched (local queue of 500, no completion delay) for 200,000 trivial jobs, four Node
  processes with concurrency 24, database and workers on one i9-14900K; average latency about 4.3 to
  4.5 milliseconds. The page names no threshold for switching queues and says the library is not
  meant to replace dedicated high-performance queues.
- Hatchet v1 (Show HN, April 2025, found by search): each task costs at least five PostgreSQL
  transactions; bursts above 5,000 tasks per second, about 25,000 transactions, showed that "a
  simple Postgres queue utilizing FOR UPDATE SKIP LOCKED doesn't cut it at this scale". The
  remedies: range partitioning of time-series tables, hash partitioning of task events, monitoring
  tables apart from the queue, buffered reads and writes, identity columns and triggers.
- For pennestack: enqueue and completion ride on units that exist anyway, so a job costs one share
  of a batched take beyond them; `ps_jobs` holds open jobs only, history lives elsewhere;
  partitioning is on the upgrade path. 2,000 jobs per second per placement is a planning figure,
  handlers included, until the M0 and M2 measurements; the proof platforms need under 10.

## 5. Fairness, limits and recorded effects

- Temporal's task queues (documentation, found by search): fairness keys with weights dispatch by
  weighted round robin, FIFO within a key, with rate limits per queue and per key; fairness "applies
  only to Task dispatch. It does not account for Task duration or resource use", and is best-effort.
  The kernel queue orders by running work per weight before virtual time, so a tenant with long jobs
  holds no more than its share of slots.
- Hatchet's post on multi-tenant queues (search result) shows the `SKIP LOCKED` pop query and that
  `PARTITION BY` window functions cannot be combined with `FOR UPDATE`. A lane table with a virtual
  time avoids window functions in the take.
- Limits per partition are the common shape: DBOS's partitioned queues, pg-boss's groups, Inngest's
  and Hatchet's concurrency keys. Lanes and groups are the same idea; lanes add weights and a
  work-conserving order.
- Several ecosystems keep global limits, groups and rate limits in commercial add-ons: BullMQ's
  open-source types have one rate limiter per queue and no groups; River Pro, Oban Pro and Sidekiq
  Enterprise hold the rest (not re-checked). A self-hosted framework that promises limits has to own
  these semantics.
- Durable execution and decision 50a: Temporal separates deterministic workflow code from activities
  and replays a recorded history; Restate journals `ctx.run` results; DBOS checkpoints steps in
  PostgreSQL. Decision 50a gives pennestack that shape natively: pure handlers return events and
  effect descriptions, the kernel executes and records effects, and outcomes reach continuations. An
  engine would add a second history beside the event log and, DBOS apart, a second store. Worth
  borrowing: replay tests of handlers, effect ids as idempotency keys, and continuations as process
  managers.

## 6. Autoscaling prior art

Table 3. Autoscalers and techniques.

| Prior art | Signal | Behaviour | Scale to zero | Lesson |
|---|---|---|---|---|
| KEDA scalers | per scaler: a PostgreSQL query, a Metrics API value, Redis Streams pending entries or lag, NATS JetStream consumer lag, RabbitMQ length or rate, Temporal backlog | drives an HPA between 1 and N; polls every 30 seconds and waits 300 seconds before zero (not re-checked) | activation thresholds | the Temporal scaler counts backlog only: issue 7368 (scaled to zero while tasks ran) and 8249 (scaled in on busy workers); 7966 proposes backlog age |
| HPA, custom and external metrics | `desired = ceil(current × metric / target)`, every 15 seconds | up: no window, 100 percent or 4 pods per 15 seconds, whichever is more; down: 300-second window, 100 percent per 15 seconds; 10 percent tolerance, configurable per HPA (stable in v1.37) | `minReplicas: 0` for object and external metrics (beta, on by default in v1.37) | asymmetric stabilisation |
| Nomad Autoscaler | an APM query per policy; target-value (proactive) or threshold strategy | evaluation every 10 seconds, a 5-minute cooldown after an action (agent defaults); a shorter scale-up cooldown in recent versions | task groups to their `min` | a cooldown per policy |
| GitHub Actions runner scale sets | jobs assigned to the scale set, through a listener's long poll (not re-checked) | one ephemeral runner per job between `minRunners` and `maxRunners` | yes | demand is exact when the queue says what is assigned; runners are never interrupted |
| Backlog and age | backlog per worker against acceptable latency divided by processing time; the oldest job's age, as Sidekiq's queue latency (not re-checked) | target tracking | | count and age together (Little's law) |
| Cooldown and hysteresis | | stabilisation windows (HPA), cooldowns (Nomad, KEDA), tolerance bands | | no flapping; down slower than up |
| Scale to zero | activation (KEDA), HPA from v1.37 | Knative: a 60-second stable and a 6-second panic window, an activator buffering requests (not re-checked) | yes | work due soon needs a lead time |
| Graceful drain | `SIGTERM`, then a deadline | pg-boss `stop({ graceful, timeout })` (checked); Kubernetes' 30-second default grace period and Sidekiq's quiet-then-stop within 25 seconds (not re-checked) | | stop taking, then finish or release by a deadline |

Applied in the section: slots never below running jobs; the oldest wait as well as the count;
Kubernetes' scale-up defaults and window, with one drain per evaluation down; an activation lead for
scheduled work; drains that release unfinished jobs; a database guard (connection budget and take
latency), because workers added to a saturated database slow it; the plan as a pure function tested
with a fake provider; desired replicas published for KEDA's Metrics API scaler when Kubernetes owns
the lifecycle.

## 7. Recommendation and upgrade path

Recommendation: family A, the kernel queue, for the first release (decision point 6, option a), with
fair lanes and split counters, leases, groups with rates, priority classes and effect jobs under
decision 50a.

What each option means for many nodes that scale automatically, with limits:

- A, the kernel queue: placement by capability set per lane, fair shares and caps enforced in the
  take, exact statistics for the scaler, nothing new to operate; the ceiling is per placement.
- B, pg-boss: PostgreSQL only; groups, FIFO per key and transactional enqueue exist, but no weights
  or lanes, its tables sit outside row-level security, and MySQL, SQLite and in-memory tests lose
  the queue.
- C, a broker: high throughput and ready-made consumer scaling, but enqueue needs an outbox relay,
  payloads leave the database, fairness and per-key limits must be built anyway, and the home server
  runs one more stateful system.
- D, a durable execution engine: the strongest flow control and durable steps, but a second history
  beside the event log, a server or cluster (DBOS apart) and backlog-only scaling signals.

Upgrade path, with `JobQueue`, `JobStore`, `JobSpec` and the conformance suite unchanged, so no
module notices:

1. One placement until the take's p95 latency passes 250 milliseconds or measured load nears 2,000
   jobs per second.
2. More placements: per-tenant namespaces (M7) multiply the ceiling.
3. Partitioned `ps_jobs` (by queue, or by state as Hatchet did) and a transaction-mode pooler.
4. A dispatch tier: leased fetchers per namespace take fair batches and publish job ids on NATS
   JetStream work-queue subjects; workers claim them by id with the same conditional statements. The
   broker carries ids only, needs no backup and can be removed again.

## Sources

- worker.graphile.org/docs/performance (fetched 2026-10-25; the page shows no date).
- news.ycombinator.com/item?id=43572733, "Show HN: Hatchet v1" (April 2025);
  hatchet.run/blog/multi-tenant-queues (both found by search on 2026-10-25).
- kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/ (fetched twice on 2026-10-25:
  the page and its remainder).
- keda.sh/docs/2.21/scalers/temporal/; github.com/kedacore/keda/issues/7368, /8249 and /7966 (search
  on 2026-10-25).
- developer.hashicorp.com/nomad/tools/autoscaling/policy and /cli (search on 2026-10-25).
- docs.temporal.io/develop/task-queue-priority-fairness; docs.temporal.io/design-patterns/fairness;
  temporal.io/blog/task-queue-priority-and-fairness-your-task-queue-your-way (search on 2026-10-25).
- npm registry, 2026-10-25: pg-boss 12.38.0 (published 2026-10-13), graphile-worker 0.18.0
  (2026-09-08), bullmq 6.4.2 (2026-10-24), @temporalio/client 1.24.0 (2026-09-15), inngest 4.26.0
  (2026-10-22), @trigger.dev/sdk 4.8.1 (2026-10-23), @restatedev/restate-sdk 1.17.4 (2026-10-20),
  @dbos-inc/dbos-sdk 5.3.0 (2026-10-15), @hatchet-dev/typescript-sdk 1.43.0 (2026-10-23),
  @nats-io/jetstream 3.4.0 (2026-05-08), redis 6.3.0 (2026-09-30), ioredis 6.0.0 (2026-07-31),
  amqplib 2.2.0 (2026-09-28), @kubernetes/client-node 2.0.1 (2026-10-20); type definitions and
  readmes from the pg-boss, graphile-worker, DBOS, BullMQ, Hatchet and Inngest tarballs.
- C. A. Waldspurger and W. E. Weihl, "Stride Scheduling: Deterministic Proportional-Share Resource
  Management", MIT/LCS/TM-528, 1995 (not re-checked).
