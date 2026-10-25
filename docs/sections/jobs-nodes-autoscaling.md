## Asynchronous work: jobs, timers and schedules

Asynchronous commands, async reactions, durable timers, schedules and external effects run on one
job queue (gap G3; ADR 0015, amended by [ADR 0025](adr/0025-nodes-capacity-and-autoscaling.md)). The
kernel queue stores jobs in the namespace through the data adapter's job store (section 14.3.9), so
a job is enqueued in the unit of the command that causes it on every adapter, carries the scope's
row-level security and needs no relay. Under decision 50a no worker runs code that performs effects:
an action job (an asynchronous command, reaction, timer, schedule or continuation) is invoked
through the invoker and returns events and effect descriptions; an external effect (an SMTP
dialogue, a Docker Engine request) becomes an effect job in the same unit, run by its declared
executor where the executor's capabilities are advertised. Section 21 places and scales the work
([research/jobs-nodes-autoscaling.md](research/jobs-nodes-autoscaling.md)).

### Jobs and the queue interface

```ts
interface JobSpec {
  readonly queue: string                                      // 'reactions', 'commands', 'timers', 'schedules', 'effects' or a module queue
  readonly run:
    | { readonly action: string; readonly input: unknown }    // through the invoker
    | { readonly executor: string; readonly effect: string }  // an external effect: its executor and effect record (decision 50a)
  readonly scope: Scope
  readonly principal: PrincipalRef                            // re-resolved when the job runs (section 7.4)
  readonly causation: { readonly eventId?: string; readonly commandId?: string; readonly actor?: ActorRef }
  readonly build: { readonly id: string; readonly revision: number }   // the enqueuer's build (section 19.2)
  readonly apiVersion?: string                                // external callers: the input as sent, at this API version
  readonly runAt?: Date
  readonly priority?: 'high' | 'normal' | 'low'               // set by module code, never by input
  readonly cost?: number                                      // fair-share units; default 1
  readonly key?: { readonly value: string; readonly onConflict: 'keep' | 'replace' | 'coalesce' }
  readonly ordering?: 'none' | 'fifo-per-key'
  readonly group?: { readonly id: string; readonly concurrency?: number; readonly rate?: string; readonly scope?: 'namespace' | 'deployment' }
  readonly capability?: readonly string[]                     // effect jobs: the executor's (section 21)
  readonly retry?: { readonly limit?: number; readonly delays: 'exponential' | readonly string[]; readonly maxDelay?: string; readonly giveUpAfter?: string }
  readonly heartbeatSeconds?: number                          // lease renewal, default 10; a lease lasts three
  readonly expireInSeconds?: number                           // the longest one attempt may run
  readonly deadLetter?: string
}
interface JobQueue {
  readonly capabilities: QueueCapabilities                    // keys, groups, fifoPerKey, heartbeat, schedules, fairLanes
  enqueue(job: JobSpec, unit: Unit): Promise<JobId>
  cancel(queue: string, key: string, unit: Unit): Promise<number>
  work(queue: string, handler: (job: Job) => Promise<void>, options: { readonly slots: number; readonly capabilitySets: readonly string[]; readonly revision: number }): Promise<{ drain(deadline: Date): Promise<number> }>
  schedule(id: string, expression: string, job: Omit<JobSpec, 'runAt' | 'scope' | 'principal'>, fanOut: 'backend' | 'each-tenant'): Promise<void>
  stats(selector: { readonly queue?: string; readonly backendId?: string }): Promise<readonly WorkClassStats[]>   // section 21
  explain(job: JobId): Promise<JobExplanation>                // why it waits: due time, cap, group, rate, key, capability, revision
}

// nodes.node.heartbeat (section 17.3.4), decision 50a: the timer's job row commits in this unit and fires under
// the module's service principal; cancelTimer(key) is the inverse.
return {
  events: [ctx.events.heartbeat({ active: input.active })],
  effects: [setTimer({ key: `node-offline:${input.id}`, after: '45s', invoke: markOffline, input: { id: input.id } })],
}
export const refreshPublicAddressSchedule = defineSchedule(dnsBase, { every: '5m', invoke: refreshPublicAddress, scope: 'each-tenant', jitter: '30s' })
// An effect executor's job options; the executor contract is decision 50a's and its name provisional:
export const smtpSend = defineEffectExecutor(mailDeliveryBase, {
  queue: 'mail-delivery',
  capability: ({ config }) => (config.relay ? [] : ['smtp-out']),
  group: ({ effect, config }) => ({ id: `mx:${effect.domain}`, concurrency: config.connectionsPerDomain, rate: '60/1m' }),
  retry: { delays: ['5m', '15m', '30m', '1h', '2h'], maxDelay: '4h', giveUpAfter: 'P5D' },   // section 17.4.7
  run,                                                        // imperative: the SMTP dialogue through the egress service
})
```

Asynchronous actions and async reactions set the same job options, `capability` apart (section 7.3).

### Where jobs live

- Per namespace: `ps_jobs` (open jobs: `scheduled`, `available`, `waiting`, `running`);
  `ps_job_lanes`, one row per scope, queue, capability set and priority class (cap, weight, `taken`,
  virtual time); `ps_job_lane_counts`, an `enqueued` and a `done` counter per lane; `ps_job_groups`
  (concurrency, token bucket, blocked-until); `ps_job_history` (outcome, attempts, timings and
  error, without input, seven days). Dead letters keep their input until replayed or discarded.
- Lane state is split by writer: what makes a job available (an enqueue tail, a promotion, a FIFO
  release) moves `enqueued`, takes move `taken` and the virtual time, completions `done`; groups
  count the same way. Takes lock only lane rows, so an enqueue burst never makes takers skip a lane,
  and a stale `done` only lowers a lane's room.
- A job due now is `available` and counted at its cause's commit tail, beside the scope's position
  counter (section 15.1.4); a later `runAt` (timers, retries, delayed sends) stays `scheduled` until
  the queue's fetcher promotes it, so lanes count only due work. FIFO followers are `waiting`;
  `replace` and `coalesce` act on a pending job of the same key and lane.
- Completion is a statement of the job's unit, conditional on its lease: success removes the row and
  writes history, a retryable failure schedules the next attempt, and the key's next `waiting` job
  becomes `available`.
- A job's unit runs the kernel's loads, then writes events, effect records, receipt and completion
  at its tail (decision 50a). No handler waits on the network inside a unit, so no long write
  transaction pins PostgreSQL's MVCC horizon. Database effects commit with the completion,
  effectively once; effect jobs run after commit, at least once, passing the effect id as
  idempotency key where the destination accepts one. Each outcome is recorded on its effect record,
  linked to its cause, and passed to the continuation the description names.

### The fair take

```sql
-- PostgreSQL (MySQL: the same steps in two statements); a kernel namespace-scope unit only the queue tables'
-- policies admit. $sets: capability sets this process satisfies; $vmin: least virtual time of busy lanes.
with picked as (
  select l.id, l.cap - (l.taken - d.value) as room from ps_job_lanes l
  join ps_job_lane_counts e on e.lane_id = l.id and e.kind = 'enqueued'   -- read, never locked
  join ps_job_lane_counts d on d.lane_id = l.id and d.kind = 'done'
  where l.queue = $queue and l.capability_set = any($sets) and e.value > l.taken and l.taken - d.value < l.cap
  order by l.priority, (l.taken - d.value) / l.weight, greatest(l.vtime, $vmin)   -- class, load per share, round robin
  limit $lanes
  for update of l skip locked
), share as (select greatest(1, ceil($batch::numeric / nullif(count(*), 0))) as n from picked)
select j.* from picked p cross join share s cross join lateral (
  select * from ps_jobs j
  where j.lane_id = p.id and j.state = 'available' and j.revision <= $revision
    and not exists (select 1 from ps_job_groups g where g.id = j.group_id and g.blocked_until > now())
  order by j.run_at, j.id
  limit least(p.room, s.n)
  for update skip locked) j;
-- Same transaction: jobs become 'running' with (worker, attempt, lease); lanes add the jobs to `taken` and cost / weight
-- to `vtime` (lifted to $vmin first); group rows are locked in id order and checked; a job over its limit goes back.
```

- Order: strict priority classes; then the least running work per unit of weight, which counts long
  jobs as load (Temporal's task-queue fairness weighs dispatches only); then virtual time, a
  weighted round robin (stride scheduling). Lifting a lane to `$vmin` means idleness earns no
  credit.
- Takers lock different lanes, then different jobs, sharing a batch over the lanes picked. Group
  rows serialise only takes of one group; counting under that lock replaces the count inside the
  take statement, which raced at `READ COMMITTED`.
- SQLite, PGlite and the in-memory adapter (the conformance oracle) run the same steps under their
  single writer.

### Retries, leases and failures

- Retries follow the error taxonomy, in which executors report too: `unavailable`, `rate_limited`
  (honouring `retryAfter`, and blocking the job's group until then) and `conflict` with `retryable`
  are retried by the job's policy, with full jitter; every other kind fails the job at once. Domain
  waits (an image that does not exist yet) are state machines with timers, not job retries.
- The worker renews its running jobs' leases every `heartbeatSeconds`, one statement per namespace;
  a lease lasts three heartbeats. The next take reclaims an expired one: the job returns to
  `available`, the attempt counted as `unavailable`, `core.job_lease_lost`. Renewal and completion
  are conditional on (worker, attempt), so a paused or partitioned attempt fails at its completion
  statement and rolls back its own unit.
- Three consecutive lost leases make a job a dead letter, so a poison job cannot take the fleet down
  one process at a time. `expireInSeconds` aborts an attempt through its abort signal with
  `core.timeout` (retryable).
- Dead letters are a metric, an alert and a `pennestack doctor` line; `pennestack jobs
  replay|discard` handles them.

### Limits, priorities and backpressure

The job side of the quota model (section 12.2):

| Limit | Configured | Enforced | When reached |
|---|---|---|---|
| running jobs per tenant and queue (the lane's cap) | `queues.<q>.running` (a number or a share of live slots), per backend with tenant overrides | the take | jobs wait |
| running jobs per backend and queue | `core.quota.set` per backend | an implicit group `backend:<id>` | jobs wait |
| queued jobs per tenant and queue | `queues.<q>.queued`, default 10,000; backend and tenant overrides | the enqueue's commit tail | commands: `rate_limited` (`core.queue_full`, `retryAfter`); the reaction dispatcher pauses the scope until the lane is below 90 percent; timers and schedules are bounded by keys |
| share | weight per backend and tenant, default 1, operator only | the take's order | |
| priority | module code: `high` for liveness timers, `low` for bulk work | the take's order | lower classes wait; their age drives the scaler |
| destination concurrency and rate | `group` options of executors and actions, from module configuration | the take, under the group's row lock; `scope: 'deployment'` groups (M7) through control-store permits | jobs wait for a slot or a token |
| process slots | `processes.<name>.slots` (section 21) | the worker | |

Without a cap the take is work-conserving: one tenant may fill idle slots, and the fair order gives
the next free one to the least-served lane. Tenants cannot raise their own weight or caps (gap G10
configuration cannot reach them); `pennestack jobs lanes` and `pennestack doctor` show them.

### Workers, scopes and schedules

- Workers run only in processes with the `work` role, for the queues their named process slots, and
  take effect jobs only for executors whose capabilities the process advertises (section 21). One
  fetcher per queue promotes due jobs and takes batches for the slots, woken after commit by the
  notifier of section 14.3.7 (channel `ps_jobs`) and by a jittered poll every second. With
  per-tenant namespaces (M7), wake-ups pass through the control store, and each process sweeps the
  namespaces that rendezvous hashing over the live registry gives it.
- An action job runs through the invoker after the worker sets the scope and resolves the principal,
  so the gate and the item check run again against current state. An effect job runs its executor
  outside any unit; one short unit then records the outcome, enqueues the continuation (under the
  module's service principal) and completes the job.
- `each-tenant` schedules enumerate the tenants of the backends whose app contains the module and
  enqueue one job per tenant, with group concurrency per backend and the schedule's jitter; at most
  one run per tick and scope exists, however many processes run. Schedules run under the module's
  service principal with the schedule id as the reason.

### Implementations and the upgrade path

Decision point 6 was re-examined for many nodes against four families (research note): this kernel
queue; a PostgreSQL queue library (pg-boss 12.38.0); a broker (NATS JetStream or Redis Streams)
behind `JobQueue`; a durable execution engine. Only the kernel queue gives transactional enqueue on
every adapter, row-level security on payloads and one semantics in development, tests and
production. pg-boss now has groups, FIFO per key, heartbeats, Kysely enqueue and PGlite, but no
MySQL, SQLite or in-memory store, no scope predicate and no fair shares. Brokers need an outbox
relay and carry payloads out of the database; engines keep a second record of every step beside the
event log, which records every effect under decision 50a. The kernel queue stays.

- Ceiling: graphile-worker 0.18's benchmark reaches about 15,600 trivial jobs per second unbatched
  and 184,000 batched on one machine; Hatchet's maintainers reported that bursts above 5,000 tasks
  per second (about 25,000 transactions) outgrew a plain `SKIP LOCKED` queue. The ceiling is per
  placement: plan with 2,000 jobs per second, handlers included, until the M0 and M2 measurements
  replace the number. The proof platforms need well under 10.
- Upgrade path, keeping `JobQueue`, `JobStore`, `JobSpec` and the conformance suite: first more
  placements, partitioned `ps_jobs` and a transaction-mode pooler; then a dispatch tier, where
  leased fetchers per namespace and queue take fair batches and publish job ids on NATS JetStream
  work-queue subjects, and workers claim them by id with the same conditional statements. The broker
  carries ids only, so no tenant payload leaves the namespace and the broker needs no backup.
- A `queue-pg` entry on pg-boss remains possible for PostgreSQL-only deployments, not planned.

## Nodes, capacity and autoscaling

Jens's requirement of 2026-10-23: "This job queue should be thought out REALLY WELL: I plan to work
with an arbitrary number of nodes in the future, and they should all scale automatically, with
limits." [ADR 0025](adr/0025-nodes-capacity-and-autoscaling.md) records the decisions, ADR 0018 the
singleton leases (gap G9).

### Nodes, processes and named processes

- A **node** is a host that runs pennestack processes (a machine, a virtual machine, a Docker
  engine); a **process** is one `pennestack start`; a **named process** is an entry of
  `defineDeployment({ processes })` with roles, declared capabilities, slots per queue, placements,
  a provider and scaling limits, whose replicas the scaler counts. Without `--process` a process
  belongs to the built-in, static `default`.
- `core.process` (section 19.1) gains the fields below and `core.node` is new; lifecycle changes
  write change records (`pennestack fleet watch`), heartbeats and slot counts go to lease rows.

```ts
// pennestack.config.ts: workers started on demand, a relay host with a clean address
processes: {
  home: { roles: ['serve', 'work'], slots: { '*': 4 } },
  mail: { roles: ['serve'], capabilities: ['smtp-public'] },
  worker: { roles: ['work'], slots: { reactions: 8, '*': 2 }, provider: 'docker', scale: { min: 0, max: 4 } },
  relay: { roles: ['work'], capabilities: ['smtp-out'], slots: { 'mail-delivery': 8 } },   // static, run by the operator
},
scaling: { maxProcesses: 8 },

export interface ProcessRecord {                      // core.process: the fields of section 19.1, and
  readonly provider: string                           // 'static', 'docker', ...
  readonly instance: string | null                    // the provider's handle
  readonly slots: Readonly<Record<string, { readonly total: number; readonly busy: number }>>   // per queue
  readonly connections: Readonly<Record<string, number>>                                       // pool reserved per placement
  readonly drain: { readonly deadline: Date; readonly reason: string } | null
  readonly interruption: Date | null                  // a provider's termination notice
}
export interface NodeRecord {                         // core.node, deployment scope
  readonly id: string                                 // --node, PENNESTACK_NODE, the provider's, else the machine id
  readonly provider: string
  readonly labels: Readonly<Record<string, string>>   // region, zone, arch
  readonly capabilities: readonly string[]            // probed on the host
  readonly maxProcesses: number
  readonly state: 'active' | 'cordoned' | 'draining' | 'gone'   // gone: no heartbeat for 5 minutes
  readonly seenAt: Date
}
```

### Capabilities and placement

- A process advertises a capability its named process declares (or `--capability` names) once its
  probe, if any, passes. Probes fill the deployment-level `capabilityProbes` extension point; the
  core ships `docker`, `smtp-out` (port 25 of an operator-chosen host is reachable), `gpu`, `arch`
  and `region`. They run at `connect`, every five minutes and on `pennestack fleet probe`; a failing
  probe withdraws the capability, and running jobs finish.
- Only listeners and effect executors require capabilities (`smtp-public` for the port 25 listener,
  `smtp-out` for direct delivery). Every other job runs a pure handler (decision 50a) on any work
  process slotting its queue. A synchronous caller never waits for an effect job: the invoker never
  forwards a request.
- Unplaceable work fails closed: a static capability that no named process declares is refused at
  boot (`unplaceableCapability`), a computed one at enqueue (`unsupported`,
  `core.capability_unplaceable`). Declared but not live: jobs wait in their lane while the scaler
  starts a process that declares it, if a provider can; otherwise `pennestack doctor` names it and
  `giveUpAfter` applies.
- Singleton work (reconcilers, the finalizer of section 19.4, the scaler) holds leases with a
  fencing epoch in the control store (ADR 0018); a draining process hands them over.

### Capacity and the connection budget

- Each placement has a connection budget, `placements.<name>.maxConnections` (default 80 percent of
  the server's `max_connections`); a starting process reserves its pool per placement when it
  registers, and over budget the start is refused (`connectionBudget`). The default pool is the
  action queues' slots, plus three (notifier, listener, effect completions), plus the serve role's
  pool: under decision 50a no job holds a connection while it waits on the network. A named process
  connects only to the placements it lists (default all).
- Workers added to a saturated database slow the queue, so the scaler adds none while a placement's
  take latency (p95) exceeds 250 milliseconds or its budget is spent.

### The scaler

The scaler runs under a singleton lease every 15 seconds, in a work process of a named process whose
`min` is at least 1. Its plan is a pure function of its inputs (decision 50a); the kernel gathers
the inputs and executes the plan's provider calls as recorded effects; tests drive it with the fake
provider and clock of `@pennestack/testing`.

```ts
export interface WorkClassStats {                     // JobQueue.stats per queue and capability set, over every namespace
  readonly queue: string
  readonly capabilities: readonly string[]
  readonly due: number                                // available and due now
  readonly oldestDueSeconds: number
  readonly arrivalsPerSecond: number                  // smoothed over a minute
  readonly meanRunSeconds: number
  readonly running: number
  readonly nextDueAt: Date | null
  readonly sloSeconds: number                         // queues.<q>.slo, target wait from due to start; default 30
}
export interface ScaleLimits {                        // processes.<name>.scale
  readonly min: number                                // 0 allows scale-to-zero, except for the scaler's own process
  readonly max: number
  readonly maxPerNode?: number
  readonly up?: { readonly percent: number; readonly processes: number }   // per evaluation; default 100 percent or 4
  readonly down?: { readonly processes: number; readonly window: string }  // default 1, after a '5m' window
  readonly tolerance?: number                         // default 0.1
  readonly activationLead?: string                    // default '60s'
}
export declare function plan(inputs: ScalerInputs, scaling: DeploymentScaling, at: Date): ScalePlan   // scaling: maxProcesses, maxCostPerHour, per provider
// ScalerInputs: class stats, named processes, provider offers, placements, recent decisions
```

1. Slots needed per work class: `ceil(meanRunSeconds × (arrivalsPerSecond + due / sloSeconds))`
   (Little's law plus the backlog drained within one target wait), times the oldest age over the
   target, at most 2, while the target is missed; never fewer than the class's running jobs, because
   a plan from backlog alone scales in on top of busy workers (KEDA issues 7368 and 8249); at least
   one when work is due within `activationLead`.
2. Static processes' slots are subtracted; the rest goes to the named processes that advertise the
   class's capabilities and slot its queue, cheapest provider first, then in declaration order.
3. Limits clamp the result, the binding one recorded as `limitedBy`: `min`, `max`, `maxPerNode`
   times the provider's nodes, provider maximums, `maxProcesses`, `maxCostPerHour`, each placement's
   connection budget, the database guard.
4. Stabilisation, after Kubernetes' defaults (checked on 2026-10-25): up at once by at most 100
   percent or 4 processes, whichever is more; changes within 10 percent ignored; down to the highest
   value wanted in the last 5 minutes, but one process per evaluation (Kubernetes allows 100
   percent), because every stop is a drain. Starting processes count as present and idle, so a
   backlog is answered once.
5. Starts are spread (0 to 2 seconds of random delay); stops are drains. Each acting evaluation
   writes a `core.scaleDecision` row (inputs, plan, bound, actions, outcomes), kept for 30 days.

With `min: 0` a named process reaches zero after a down window without work and starts again for
work due within the activation lead. With the static provider the plan is a recommendation in
`pennestack fleet scale status`.

### Node providers

`nodeProviders` is a deployment-level extension point (set), filled by infrastructure entries that
are imperative like adapters and called only by the kernel.

```ts
export interface NodeProvider {
  readonly id: string                                 // 'static', 'docker'
  offer(): Promise<ProviderOffer>                     // what it can start, its maximums, cost per process hour, startup time
  list(signal: AbortSignal): Promise<readonly ProviderInstance[]>   // { instance, node, process, state }: reconciliation after failover
  start(request: { readonly requestId: string; readonly process: string; readonly build: { readonly id: string; readonly revision: number } }, signal: AbortSignal): Promise<ProviderInstance>   // idempotent by request id
  stop(instance: string, options: { readonly deadline: Date; readonly reason: string }, signal: AbortSignal): Promise<void>   // SIGTERM, removal after the deadline
}
```

- **static** (core): operator-run processes; the plan is a recommendation and scale-down a drain
  request the process obeys.
- **docker** (`@pennestack/provider-docker`): the Docker Engine API over its Unix socket through
  `node:http`. It runs the running build's image (the target during a rollout) as `pennestack start
  --role work --process <name>`, unprivileged, with only the named process's networks and volumes,
  restart policy `no` and secrets as mounted files. The socket is root on its host, so the provider
  is off by default, belongs only to the scaler's named process and goes through a socket proxy
  admitting container create, start, stop, inspect and list.
- **kubernetes** (later): a Deployment scaled through `@kubernetes/client-node` 2.0.1, or desired
  replicas published at `/_pennestack/scale` for KEDA's Metrics API scaler or an HPA external
  metric. **Cloud providers** (later): instance groups, drains within spot termination notices.
- **Launchway as a provider** (not planned): only above a floor another provider supplies, and only
  for an operator-owned tenant, because the containers carry the master key.

### Scale-down is a drain

1. The scaler picks the replica with the fewest busy slots, preferring cordoned nodes and never the
   last process advertising a capability with due work; the scaler's own process hands its lease
   over first.
2. The record turns `draining` with a deadline: `processes.<name>.drainSeconds` (default 60), or a
   termination notice's if sooner.
3. The process stops taking, its listeners stop accepting, live streams end with `going_away`
   (section 15.4.5), consumer and singleton leases are released, and running jobs continue.
4. At the deadline, unfinished jobs are released (back to `available`, the attempt not counted) and
   their executors aborted; an effect that already reached its destination may run again.
5. The process deregisters (reservations freed) and exits with code 0; the provider removes the
   instance. `SIGTERM` from any source runs the same sequence.

### Failure modes

| Failure | Handling |
|---|---|
| A process or node is lost | leases expire within 30 seconds and the next take requeues its jobs (`core.job_lease_lost`); the scaler replaces it within limits |
| Split brain | completion and renewal are conditional on (worker, attempt); singleton holders check their lease before each effect; providers count instances before a start, so two scalers overshoot a limit by one start at most |
| Thundering herd | coalesced wake-ups (50 milliseconds per namespace), jittered takes, schedules and retries, spread starts |
| The database as the bottleneck | batched takes, split lane counters, the connection budget and guard, more placements, then the dispatch tier |
| A hot tenant | the fair order, caps, weights, the queued cap with backpressure |
| A poison job | a dead letter after its retries or three lost leases |
| A long job | lease renewal, `expireInSeconds`, release at a drain; long waits are effect jobs or state machines with timers, never an open unit |
| A provider or the scaler's process fails | starts retry with backoff (`limitedBy: 'provider'`); an expired scaler lease passes to another work process, which reconciles through `list` first |

### The Launchway agent in this model

- The agent is not a pennestack node but the separate program of section 17.3.4, a client of the
  agent-protocol transport (decision point 23). It runs the builds; pennestack runs the dispatch
  reaction keyed by project and its timers (section 17.3.5).
- A Launchway node is tenant data running tenant code (decision point 25); a pennestack node holds
  database credentials and the master key of every tenant on its placements, so no tenant may run or
  host one. A docker provider and the agent may share an engine, never an identity. Launchway's
  `nodes` module keeps its id; the framework's command group is `fleet`.

### Commands and observability

| Command | What it does |
|---|---|
| `pennestack fleet [list\|show\|watch]` | nodes and processes with roles, capabilities, revision, state, slots and heartbeat |
| `pennestack fleet cordon\|uncordon\|drain\|probe\|forget` | stop placing on a node, drain with `--deadline`, rerun probes, remove a gone node |
| `pennestack fleet scale status\|explain\|history\|set\|pause\|resume` | desired and current per named process, the last plan, decisions, runtime limits within the deployment's |
| `pennestack jobs stats\|lanes\|list\|explain\|replay\|discard\|pause\|resume` | statistics per queue and capability set, the busiest lanes, why a job waits, dead letters, pausing a queue |

`fleet` joins the reserved names of section 16.9.3 (34 names); `jobs` is reserved already.

```
$ pennestack fleet scale explain worker
reactions []: due 840, oldest 41 s (target 30 s), 22/s, 0.18 s each -> 9 slots x 1.4 -> 13; 8 per replica -> 2; start 1 on docker
```

Metrics (section 11): the gauges `pennestack.jobs.due`, `.oldest_due`, `.lanes.capped` and
`.unplaceable` per queue and capability set; the histograms `.wait` (due to start), `.run` and
`.take.duration`; the counter `.outcomes` by kind (action, effect) and outcome; `pennestack.slots`,
`.processes`, `.connections.reserved` and `.scaler.desired` per named process; `backend` is an
attribute, `tenant` only where a backend opts in.

### Backends and tenants

- Nodes, processes and the scaler are deployment-scope control data for the operator only; tenants
  never see nodes, other lanes or other tenants' depth.
- Lane rows carry their scope under row-level security: enqueue and completion stay in tenant units,
  while takes, renewals, reaping and statistics run in kernel namespace-scope units.
- Backends of one app share a namespace's lanes, with backend caps between them; a tenant move
  (section 14.4.5) copies its jobs and lanes.

### Traceability

| Requirement | Subsections |
|---|---|
| Jens, 2026-10-23: "This job queue should be thought out REALLY WELL" | all of "Asynchronous work", above all The fair take; Retries, leases and failures; the upgrade path |
| "an arbitrary number of nodes in the future" | Nodes, processes and named processes; Capabilities and placement; Capacity and the connection budget; Failure modes |
| "they should all scale automatically" | The scaler; Node providers; Scale-down is a drain |
| "with limits" | Limits, priorities and backpressure; `ScaleLimits` and the deployment's `scaling`; the connection budget |
| Brief addendum 4 and decision 50a | Where jobs live; Workers, scopes and schedules; Capabilities and placement; The scaler |
