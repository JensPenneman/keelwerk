## Asynchronous work: jobs, timers and schedules

Asynchronous commands, async reactions, durable timers and schedules all run on one job queue (gap
G3; ADR 0015, amended by [ADR 0025](adr/0025-nodes-capacity-and-autoscaling.md)). The kernel queue
stores jobs in the namespace, through the data adapter's job store (section 14.3.9), so a job is
enqueued in the same unit as the command that causes it on every adapter, carries the scope's
row-level security, and needs no relay. Its take is fair across tenants; section 21 places and
scales the work ([research/jobs-nodes-autoscaling.md](research/jobs-nodes-autoscaling.md)).

### Jobs and the queue interface

```ts
interface JobSpec {
  readonly queue: string                                      // 'reactions', 'commands', 'timers', 'schedules', or a module queue
  readonly action: string                                     // the worker invokes this action, or runs this reaction
  readonly input: unknown
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
  readonly capability?: string | readonly string[]            // all required of the process (section 21)
  readonly retry?: { readonly limit?: number; readonly delays: 'exponential' | readonly string[]; readonly maxDelay?: string; readonly giveUpAfter?: string }
  readonly heartbeatSeconds?: number                          // lease renewal, default 10; a lease lasts three
  readonly expireInSeconds?: number                           // the longest one attempt may run
  readonly deadLetter?: string
}
interface JobQueue {
  readonly capabilities: { readonly keys: true; readonly groups: true; readonly fifoPerKey: true; readonly heartbeat: true; readonly schedules: true; readonly fairLanes: true }
  enqueue(job: JobSpec, unit: Unit): Promise<JobId>
  cancel(queue: string, key: string, unit: Unit): Promise<number>
  work(queue: string, handler: (job: Job) => Promise<void>, options: { readonly slots: number; readonly capabilities: readonly string[]; readonly revision: number }): Promise<{ drain(deadline: Date): Promise<number> }>
  schedule(id: string, expression: string, job: Omit<JobSpec, 'runAt' | 'scope' | 'principal'>, fanOut: 'backend' | 'each-tenant'): Promise<void>
  stats(selector: { readonly queue?: string; readonly backendId?: string }): Promise<readonly WorkClassStats[]>   // section 21
  explain(job: JobId): Promise<JobExplanation>                // why it waits: due time, cap, group, rate, key, capability, revision
}

// Durable, keyed timers inside handlers, set in the caller's unit; they fire under the module's service principal:
await ctx.timers.set({ key: `node-offline:${id}`, at, invoke: markOffline, input: { id } })   // an own action part, by value
await ctx.timers.cancel(`node-offline:${id}`)
// Schedules, one per file, contribute to the core's `schedules` extension point:
export const refreshPublicAddressSchedule = defineSchedule(dnsBase, { every: '5m', invoke: refreshPublicAddress, scope: 'each-tenant', jitter: '30s' })
// modules/dns/src/module.ts: schedules: { refreshPublicAddress: refreshPublicAddressSchedule }   (the key is the schedule id)
// An asynchronous action's job options (section 7.3):
async: {
  queue: 'mail-delivery',
  capability: (ctx) => (ctx.config.relay ? [] : ['smtp-out']),
  group: (input, ctx) => ({ id: `mx:${input.domain}`, concurrency: ctx.config.connectionsPerDomain, rate: '60/1m' }),
},
```

### Where jobs live

- Per namespace: `ps_jobs` (pending and running jobs only); `ps_job_lanes`, one row per queue,
  capability set and scope with work (pending and running counts, cap, weight, virtual time, head
  priority, ready time); `ps_job_groups` (concurrency, token bucket, blocked-until); `ps_job_history`
  (outcome, attempts, timings and error of finished jobs, without input, seven days). Dead letters
  keep their input until replayed or discarded.
- Enqueue inserts the job in the cause's unit and updates its lane at the commit tail beside the
  scope's position counter (section 15.1.4): only units of the same scope wait on a lane, for a
  tail's length. A lane that was empty starts at the queue's current virtual time, so idleness earns
  no credit. FIFO followers are `waiting`; `replace` and `coalesce` act on a pending job of the same
  key and lane.
- Completion is a statement of the handler's unit, conditional on the job's lease: success removes
  the row and writes history, a retryable failure sets the next run time, and the key's next
  `waiting` job becomes `available`. Database effects and completion commit together, effectively
  once; external effects are at least once, and the receipt answers a retry (section 7.5).
- Units stay short. The take is its own transaction; a job's unit writes the receipt and the
  completion at its tail, since the lease fences a second attempt, so it takes a transaction id only
  at its first write. A handler that waits on the network after a write pins PostgreSQL's MVCC
  horizon and bloats these tables; `pennestack.jobs.egress_in_write_unit` reports it and `timeoutMs`
  bounds it. Effect descriptions (decision point 50, options a and c) would make this structural.

### The fair take

```sql
-- PostgreSQL; MySQL 8 runs the same shape. A kernel namespace-scope unit that only the queue tables' policies admit.
with lanes as (
  select id, room from (
    select l.id, l.cap - l.running as room from ps_job_lanes l
    where l.queue = $queue and l.capabilities <@ $advertised and l.pending > 0
      and l.ready_at <= now() and l.running < l.cap
    order by l.head_priority, l.running / l.weight, l.vtime     -- priority class, least load per share, round robin
    limit $lanes
    for update skip locked) picked
), share as (select greatest(1, ceil($batch::numeric / nullif(count(*), 0))) as n from lanes)
select j.* from lanes l cross join share s cross join lateral (
  select * from ps_jobs j
  where j.lane_id = l.id and j.state = 'available' and j.run_at <= now() and j.revision <= $revision
    and not exists (select 1 from ps_job_groups g where g.id = j.group_id and g.blocked_until > now())
  order by j.priority, j.run_at, j.id
  limit least(l.room, s.n)
  for update skip locked) j;
-- Then, in the same transaction: jobs become 'running' with (worker, attempt, lease); lanes update counts, vtime (+ cost / weight),
-- head priority and ready time; group rows are locked in id order and checked; a job over its group's limit goes back.
```

- Order: strict priority classes; then the least running work per unit of weight, which counts long
  jobs as load (SQS fair queues count in-flight messages likewise); then virtual time, which makes
  ties a weighted round robin (Temporal's stride scheduling). Within a lane: priority, run time, id.
- Takers lock different lanes, then different jobs, sharing a batch over the lanes picked. Group
  rows serialise only takes of one group; counting running jobs under that lock replaces the count
  inside the take statement, which raced at `READ COMMITTED`.
- One short transaction per batch; enqueue and completion ride on existing units, and lanes contend
  only within one scope. SQLite, PGlite and the in-memory adapter run the same steps under their
  single writer; the in-memory adapter is the conformance oracle.

### Retries, leases and failures

- Retries follow the error taxonomy: `unavailable`, `rate_limited` (honouring `retryAfter`) and
  `conflict` with `retryable` are retried by the job's policy, with full jitter; every other kind
  fails the job at once. `rate_limited` also blocks the job's group until `retryAfter`, so that
  destination's other jobs wait. Domain waits (an image that does not exist yet) are state machines
  with timers, not job retries.
- The worker renews its running jobs' leases every `heartbeatSeconds`, one statement per namespace;
  a lease lasts three heartbeats. The next take reclaims an expired one: the job returns to
  `available`, the attempt counted as `unavailable`, `core.job_lease_lost`. Renewal and completion
  are conditional on (worker, attempt), so a paused or partitioned attempt fails at its completion
  statement and rolls back its own unit.
- Three consecutive lost leases make a job a dead letter, so a poison job cannot take the fleet down
  one process at a time. `expireInSeconds` aborts an attempt through `ctx.signal` with
  `core.timeout` (retryable).
- Dead letters are a metric, an alert and a line in `pennestack doctor`, handled with `pennestack
  jobs replay|discard`. Takers skip a placement that answers `unavailable`, backing off.

### Limits, priorities and backpressure

The job side of the quota model (section 12.2):

| Limit | Configured | Enforced | When reached |
|---|---|---|---|
| running jobs per tenant and queue (the lane's cap) | `queues.<q>.running` (a number or a share of live slots); `core.quota.set` per backend, tenant overrides | the take | jobs wait |
| running jobs per backend and queue | `core.quota.set` per backend | an implicit group `backend:<id>` | jobs wait |
| queued jobs per tenant and queue | `queues.<q>.queued`, default 10,000; backend and tenant overrides | the enqueue's commit tail | commands: `rate_limited`, `core.queue_full`, with `retryAfter`; the reaction dispatcher pauses the scope, checkpoint unmoved, until the lane is below 90 percent; timers and schedules are bounded by keys |
| share | weight per backend and tenant, default 1, operator only | the take's order | |
| priority | module code: `high` for liveness timers, `low` for bulk work | the take's order | lower classes wait; their age drives the scaler |
| destination concurrency and rate | `group` options from module configuration | the take, under the group's row lock; `scope: 'deployment'` groups (M7) through control-store permits | jobs wait for a slot or a token |
| process slots | `processes.<name>.slots` (section 21) | the worker | |

Without a cap the take is work-conserving: one tenant may fill idle slots, and the fair order gives
the next free one to the least-served lane. Tenants cannot raise their own weight or caps; gap G10
configuration cannot reach them. `pennestack jobs lanes`, the metrics of section 21 and `pennestack
doctor` (queued caps above 80 percent, capped lanes, dead letters, unplaceable work) show them.

### Workers, scopes and schedules

- Workers run only in processes with the `work` role, for the queues their named process slots and
  the capabilities it advertises (section 21). One fetcher per queue takes batches for the slots,
  woken after commit by the notifier of section 14.3.7 (channel `ps_jobs`) and by a jittered poll
  every second. With per-tenant namespaces (M7), wake-ups pass through the control store, and each
  process sweeps the namespaces that rendezvous hashing over the live registry gives it.
- The worker sets the scope, resolves the principal from its reference, invokes the action through
  the invoker (so the gate and the item check run again against current state) and records the
  outcome on the receipt.
- `each-tenant` schedules enumerate the tenants of the backends whose app contains the module and
  enqueue one job per tenant, with group concurrency per backend and the schedule's jitter; at most
  one run per tick and scope exists, however many processes run. Schedules run under the module's
  service principal with the schedule id as the reason.

### Implementations and the upgrade path

Decision point 6 was re-examined for many nodes against four families (research note, section 2):
this kernel queue, pg-boss 12.38.0, a broker (NATS JetStream or Redis Streams) behind `JobQueue`, and
a durable execution engine. Only the kernel queue gives transactional enqueue without a relay,
row-level security on payloads and one semantics on every adapter and in tests; fairness and limits
must be built in every family except the engines, which bring a second source of truth and servers
of their own. It stays the first release's implementation.

- Ceiling: graphile-worker publishes about 15,600 jobs per second unbatched and 183,000 batched for
  trivial jobs, its maintainer suggesting another queue from about 5,000; Hatchet's bursts above
  5,000 tasks per second (about 25,000 transactions) outgrew a plain `SKIP LOCKED` queue. Jobs live
  in their namespace, so the ceiling is per placement: plan with 2,000 jobs per second per placement,
  handlers included, until the M0 and M2 measurements replace the number. The proof platforms need
  well under 10 per second.
- Upgrade path, keeping `JobQueue`, `JobStore`, `JobSpec` and the conformance suite, and so the
  semantics: first more placements, partitioned `ps_jobs` and a transaction-mode pooler; then a
  dispatch tier, where leased fetchers per namespace and queue take fair batches and publish job ids
  on NATS JetStream work-queue subjects, and workers claim them by id with the same conditional
  statements. The broker carries ids only: no tenant payload leaves the namespace, and the broker
  needs no backup.
- A `queue-pg` entry on pg-boss remains possible, not planned: PostgreSQL only, tables outside the
  scope predicate, no lanes.

## Nodes, capacity and autoscaling

Jens's requirement of 2026-10-23: "This job queue should be thought out REALLY WELL: I plan to work
with an arbitrary number of nodes in the future, and they should all scale automatically, with
limits." [ADR 0025](adr/0025-nodes-capacity-and-autoscaling.md) records the decisions, ADR 0018 the
singleton leases (gap G9).

### Nodes, processes and named processes

- A **node** is a host that runs pennestack processes (a machine, a virtual machine, a Docker
  engine); a **process** is one `pennestack start`; a **named process** is an entry of
  `defineDeployment({ processes })` with roles, declared capabilities, slots per queue, the
  placements it connects to, a provider and scaling limits, and the scaler counts its replicas. A
  process started without `--process` belongs to the built-in, static `default`.
- The registry extends section 19.1's: `core.process` gains the fields below and `core.node` is new.
  Lifecycle changes (registered, ready, draining, stopped, cordoned) write change records, so
  `pennestack nodes watch` is live; heartbeats, slot counts and renewals go to lease rows.

```ts
export interface ProcessRecord {                      // core.process (section 19.1), extended
  // id, name, node, roles, capabilities, build, protocols, apiVersions, state, heartbeatAt: as in section 19.1
  readonly provider: string                           // 'static', 'docker', ...
  readonly instance: string | null                    // the provider's handle: a container id, a pod name
  readonly slots: Readonly<Record<string, { readonly total: number; readonly busy: number }>>   // per queue
  readonly connections: Readonly<Record<string, number>>                                       // pool reserved per placement
  readonly drain: { readonly deadline: Date; readonly reason: string } | null
  readonly interruption: Date | null                  // a provider's termination notice (spot capacity)
}
export interface NodeRecord {                         // core.node, deployment scope
  readonly id: string                                 // --node, PENNESTACK_NODE, the provider's, else the machine id
  readonly provider: string
  readonly labels: Readonly<Record<string, string>>   // region, zone, arch
  readonly capabilities: readonly string[]            // probed on the host: 'docker', 'smtp-out', 'gpu'
  readonly maxProcesses: number
  readonly state: 'active' | 'cordoned' | 'draining' | 'gone'   // gone: no heartbeat for 5 minutes
  readonly seenAt: Date
}
```

### Capabilities and placement

- A process advertises a capability that its named process declares (or `--capability` names) when
  the capability's probe, if any, passes. Probes fill the deployment-level `capabilityProbes`
  extension point; the core ships `docker`, `smtp-out` (port 25 of an operator-chosen host is
  reachable), `gpu`, `arch` and `region`. They run at `connect`, every five minutes and on
  `pennestack nodes probe`; a failing probe withdraws the capability, and running jobs finish.
- Listeners, asynchronous actions, async reactions, timers and schedules may require capabilities;
  a job runs only on a process advertising all of its own, a listener only where its capability is
  advertised (`smtp-public` for port 25). Synchronous actions cannot require one: the invoker never
  forwards a request.
- Unplaceable work fails closed: a capability required statically that no named process declares
  is refused at boot (`unplaceableCapability`), a computed one at enqueue (`unsupported`,
  `core.capability_unplaceable`). Declared but not live: jobs wait in their lane, never elsewhere,
  while the scaler starts a process that declares it if a provider can; otherwise
  `pennestack.jobs.unplaceable` rises, `pennestack doctor` names it, and `giveUpAfter` applies.
- Singleton work (reconcilers, the finalizer of section 19.4, the scaler) holds leases with a
  fencing epoch in the control store (ADR 0018); a draining process hands them over.

### Capacity and the connection budget

- A named process gives queues slots (`slots: { reactions: 8, '*': 2 }`); a slot runs one job.
- Each placement has a connection budget, `placements.<name>.maxConnections` (default 80 percent of
  the server's `max_connections`). A starting process reserves its pool per placement when it
  registers; over budget, the start is refused (`connectionBudget`). The default pool is the
  queues' slots plus two plus the serve role's pool, since a job waiting on the network inside its
  unit keeps its connection. A named process connects only to the placements it lists (default
  all), so a regional process stays off distant databases.
- Workers added to a saturated database slow the queue (graphile-worker's observation): the scaler
  adds none while a placement's take latency (p95) exceeds 250 milliseconds or its budget is spent.

### The scaler

The scaler runs under a singleton lease every 15 seconds, in a work process of a named process
whose `min` is at least 1. Its computation is a pure function from inputs to a plan (brief addendum
4); the loop around it gathers inputs and performs the plan through node providers, and tests drive
it with the fake provider and clock of `@pennestack/testing`.

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
export interface DeploymentScaling { readonly maxProcesses?: number; readonly maxCostPerHour?: number; readonly providers?: Readonly<Record<string, { readonly max: number }>> }
export interface ScalerInputs {
  readonly classes: readonly WorkClassStats[]
  readonly processes: Readonly<Record<string, NamedProcessState>>   // replicas by state, slots, capabilities, provider, limits
  readonly providers: Readonly<Record<string, ProviderOffer>>
  readonly placements: Readonly<Record<string, { readonly budget: number; readonly reserved: number; readonly takeP95Ms: number }>>
  readonly recent: readonly ScaleDecision[]           // the stabilisation window
}
export declare function plan(inputs: ScalerInputs, scaling: DeploymentScaling, at: Date): ScalePlan
```

1. Slots needed per work class: `ceil(meanRunSeconds × (arrivalsPerSecond + due / sloSeconds))`
   (Little's law plus the backlog drained within one target wait), times the oldest age over the
   target, at most 2, while the target is missed; at least one when work is due within
   `activationLead`.
2. Static processes' slots are subtracted; the rest goes to the named processes that advertise the
   class's capabilities and slot its queue, cheapest provider first, then in declaration order, each
   needing the largest ceil(slots needed / slots per replica) over its classes.
3. Limits clamp the result, the binding one recorded as `limitedBy`: `min`, `max`, `maxPerNode`
   times the provider's nodes, provider maximums, `maxProcesses`, `maxCostPerHour`, each
   placement's connection budget, the database guard.
4. Stabilisation uses Kubernetes' defaults (checked on 2026-10-25): up at once by at most 100
   percent or 4; down to the highest value wanted in the last 5 minutes, one process per evaluation;
   changes within 10 percent ignored. Starting processes count as present and idle, so a backlog is
   answered once; failed starts retry with backoff.
5. Starts are spread, each new process waiting a random 0 to 2 seconds before its first take; stops
   are drains. Each acting evaluation writes a `core.scaleDecision` row (inputs, plan, bound,
   actions), kept for 30 days.

Named processes with `min: 0` reach zero after a down window without work and start again for work
due within the activation lead. With the static provider the plan is a recommendation in
`pennestack scale status`.

### Node providers

`nodeProviders` is a deployment-level extension point (set), filled by infrastructure entries.

```ts
export interface NodeProvider {
  readonly id: string                                 // 'static', 'docker'
  offer(): Promise<ProviderOffer>                     // canStart, named processes, capabilities, maxProcesses, maxPerNode, costPerProcessHour, startupSeconds
  list(signal: AbortSignal): Promise<readonly ProviderInstance[]>                // { instance, node, process, state }: reconciliation after failover
  start(request: { readonly requestId: string; readonly process: string; readonly build: { readonly id: string; readonly revision: number } }, signal: AbortSignal): Promise<ProviderInstance>   // idempotent by request id
  stop(instance: string, options: { readonly deadline: Date; readonly reason: string }, signal: AbortSignal): Promise<void>   // SIGTERM, removal after the deadline
}
```

- **static** (core): operator-run processes; the plan is a recommendation and scale-down a drain
  request the process obeys.
- **docker** (`@pennestack/provider-docker`): the Docker Engine API over its Unix socket through
  `node:http`, without a client library. It runs the running build's image (the
  target build during a rollout) as `pennestack start --role work --process <name>`, labelled,
  unprivileged, with only the named process's networks and volumes and restart policy `no`, and
  hands secrets over as the mounted files or references its own process uses, never as environment
  values visible to `docker inspect`. The socket is root on its host, so the provider is off by
  default, belongs only to the scaler's named process and goes through a socket proxy admitting
  container create, start, stop, inspect and list.
- **kubernetes** (later): a Deployment scaled through `@kubernetes/client-node` 2.0.1, or desired
  replicas published at `/_pennestack/scale` for KEDA's Metrics API scaler or an HPA external
  metric, letting the cluster own the lifecycle. **Cloud providers** (later): instance groups, a node
  added at `maxPerNode`, drains within spot termination notices.
- **Launchway as a provider** (named, not planned): workers as a project of an operator-owned
  Launchway tenant, only above a floor another provider supplies (Launchway's dispatch runs on these
  workers) and only where that tenant's administrators are operator-equivalent (the containers carry
  the master key).

### Scale-down is a drain

1. The scaler picks the replica with the fewest busy slots, preferring cordoned nodes and never the
   last process advertising a capability with due work; the scaler's own process hands its lease
   over first.
2. The record turns `draining` with a deadline: `processes.<name>.drainSeconds` (default 60), or a
   termination notice's if sooner.
3. The process stops taking, its listeners stop accepting, live streams end with `going_away`
   (section 15.4.5), consumer and singleton leases are released, and running jobs continue.
4. At the deadline, unfinished jobs are released: back to `available`, the attempt not counted,
   their handlers aborted through `ctx.signal`.
5. The process deregisters (reservations freed) and exits with code 0; the provider removes the
   instance. `SIGTERM` from any source runs the same sequence.

### Failure modes

| Failure | Handling |
|---|---|
| A process or node is lost | leases expire within 30 seconds and the next take requeues its jobs (`core.job_lease_lost`); the scaler replaces it within limits |
| Split brain | completion and renewal are conditional on (worker, attempt); singleton holders check their lease before each effect; providers count instances before a start, so two scalers overshoot a hard limit by one start at most |
| Thundering herd | coalesced wake-ups (50 milliseconds per namespace), jittered takes backing off when empty, jittered schedules, spread starts, full-jitter retries |
| The database as the bottleneck | batched takes, a small hot table, the connection budget and guard, more placements, then the dispatch tier |
| A hot tenant | the fair order, caps, weights, the queued cap with backpressure, `pennestack jobs lanes` |
| A poison job | a dead letter after its retries or three lost leases |
| A long job | lease renewal, `expireInSeconds`, release at a drain; domain waits stay state machines with timers |
| A provider or the scaler's process fails | starts retry with backoff (`limitedBy: 'provider'`); an expired scaler lease passes to another work process, which reconciles through `list` first |

### The Launchway agent in this model

- The agent is not a pennestack node. It stays the separate program of section 17.3.4 behind the
  agent-protocol compatibility transport (decision point 23): a client, resolved to a service
  principal of the `launchway` backend, with protocol versions of its own (section 19.7).
- A Launchway node is tenant data of one tenant (decision point 25) running tenant code; a
  pennestack node is deployment infrastructure holding database credentials and the master key of
  every tenant on its placements, so no tenant may run or host one. The agent needs Docker, git and
  an outbound WebSocket, not a database connection.
- The home server is both: process `home` is a pennestack node, its agent a Launchway node; a docker
  provider and the agent may share the engine, never an identity, and the edge is applied through
  the agent (decision point 24). Launchway's module id must not collide with the command `nodes`.

### Commands and observability

| Command | What it does |
|---|---|
| `pennestack nodes [list\|show\|watch]` | nodes and processes: named process, roles, capabilities, revision, state, slots, connections, heartbeat |
| `pennestack nodes cordon\|uncordon\|drain\|probe\|forget` | stop placing on a node, drain with `--deadline`, rerun probes, remove a gone node |
| `pennestack jobs stats\|lanes\|list\|explain\|replay\|discard\|pause\|resume` | statistics per queue and capability set, the busiest lanes, why a job waits, dead letters, pausing a queue |
| `pennestack scale status\|explain\|history\|set\|pause\|resume` | desired and current per named process, the last plan, decisions, runtime limits within the deployment's |

```
$ pennestack jobs explain job_01jb7...
waiting: lane launchway/home reactions is at its cap (4 of 4 running); 12 jobs ahead in the lane
$ pennestack scale explain worker
reactions []: due 840, oldest 41 s (target 30 s), 22/s, 0.18 s each -> 9 slots x 1.4 -> 13; 8 per replica -> 2; start 1 on docker
```

Metrics (section 11; `backend` as an attribute, `tenant` only where a backend opts in):

| Instrument | Kind | Attributes |
|---|---|---|
| `pennestack.jobs.due`, `.oldest_due`, `.lanes.capped`, `.unplaceable` | gauges | queue, capabilities, backend |
| `pennestack.jobs.wait` (due to start), `.run`, `.take.duration`, `.egress_in_write_unit` | histograms | queue, priority, action, outcome, placement |
| `pennestack.jobs.outcomes` | counter | queue, outcome (succeeded, retried, failed, dead, released, lease_lost) |
| `pennestack.slots`, `pennestack.processes`, `pennestack.connections.reserved` | gauges | named process, queue, provider, state, placement |
| `pennestack.scaler.desired`, `.limited` | gauge, counter | named process, limit |

`app.ready` also reports a process's capabilities and drain state.

### Backends and tenants

- Nodes, processes and the scaler are deployment-scope control data for the operator only; tenants
  never see nodes, other lanes or other tenants' depth.
- Lane rows carry their scope under row-level security, so enqueue and completion stay in tenant
  units; takes, renewals, reaping and statistics run in kernel namespace-scope units that only the
  queue tables' policies admit.
- Backends of one app share a namespace's lanes, with backend caps between them. A tenant move
  (section 14.4.5) copies its jobs and lanes.

### Traceability

| Jens's requirement (2026-10-23) | Subsections |
|---|---|
| "This job queue should be thought out REALLY WELL" | all of "Asynchronous work", above all The fair take; Retries, leases and failures; Implementations and the upgrade path |
| "an arbitrary number of nodes in the future" | Nodes, processes and named processes; Capabilities and placement; Capacity and the connection budget; Failure modes; the dispatch tier |
| "they should all scale automatically" | The scaler; Node providers; Scale-down is a drain |
| "with limits" | Limits, priorities and backpressure; `ScaleLimits` and `DeploymentScaling`; the connection budget |
