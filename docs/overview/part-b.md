### 7. Transports and the CLI

**In one sentence.** Every interface to a backend (REST, GraphQL, tRPC, oRPC, the invocation protocol behind the CLI, and the SSE and WebSocket live carriers) projects one derived API surface onto the same invoker, so names, errors and semantics agree everywhere.

**How it works.** During `compose` the core derives one `ApiSurface` per app and API version: a deterministic, serialisable description of entities, actions (input, output, declared errors, execution mode, pagination) and events, hashed over its RFC 8785 form. A transport adapter reads only that surface: a pure `check` reports problems such as name collisions, which fail `generate` and boot, a pure `artifacts` emits the committed OpenAPI 3.1 document or SDL, and `mount` registers routes on the one HTTP host. Per request the host fills a carrier, `invoker.open` resolves scope, principal and API version once into a session, and the transport maps wire input onto `invoker.invoke` and the outcome back. Wire names are pure functions of the reference. REST has its own OpenAPI emitter and RFC 9457 problem details; GraphQL is graphql-js on Yoga with own operation limits, first the no-repeat rule: an entity type appears at most once on a selection path. tRPC and oRPC get router types by inference (`TrpcRouterOf<App>`, `OrpcRouterOf<App>`). The invocation protocol (`/_keelwerk/v1`, also on the operator Unix socket) is the invoker in JSON; the typed client and `keelwerk call <ref>` use it, reaching every app. Subscriptions run over SSE (one per stream, resumed by `Last-Event-ID`) or the `keelwerk.live.v1` WebSocket (up to 100 per connection, plus `invoke`). One table maps the ten error kinds onto every transport.

**Example.** Launchway's app declares `previews.preview.close` as `either` (the UI waits, the CLI may take a receipt). One action, every projection (ids illustrative):

```text
REST        POST /api/previews/previews/prv_01j9…/close    Prefer: respond-async  ->  202, Location of the receipt
GraphQL     previewsPreviewClose(input: { id, prefer: ASYNC })  ->  PreviewsPreviewCloseSuccess | CommandAccepted
tRPC        previews.preview.close  ->  output | CommandReceipt (tRPC cannot narrow by a call option)
oRPC        previews.preview.close, with the procedure's declared errors typed
protocol    POST /_keelwerk/v1/invoke {"action":"previews.preview.close","input":{"id":"prv_01j9…"},"prefer":"async"}
CLI         keelwerk call previews.preview.close prv_01j9… --async
live        GET /api/previews/previews/watch (SSE)   ·   keelwerk watch previews.preview.watch

unknown id   not_found: REST 404 · GraphQL NOT_FOUND · tRPC NOT_FOUND · CLI exit 6 · WebSocket close 4404
GraphQL      a path repeating an entity type (project -> deployments -> project): validation error naming the path and the limit
```

**Diagram.**

```diagram
{"title":"One request through the interface layer","nodes":[
{"id":"defs","label":"Module and app definitions","kind":"store"},
{"id":"surface","label":"ApiSurface per version","kind":"store"},
{"id":"docs","label":"OpenAPI, SDL, CLI manifest","kind":"store"},
{"id":"ui","label":"Launchway UI","kind":"actor"},
{"id":"cli","label":"keelwerk call","kind":"actor"},
{"id":"host","label":"HTTP host","kind":"box"},
{"id":"open","label":"invoker.open","kind":"box"},
{"id":"tx","label":"REST, GraphQL, tRPC, oRPC","kind":"box"},
{"id":"proto","label":"Invocation protocol","kind":"box"},
{"id":"invoke","label":"Invoker pipeline","kind":"box"},
{"id":"live","label":"SSE and WebSocket","kind":"box"},
{"id":"wire","label":"toWire: ten kinds","kind":"note"}],
"edges":[
{"from":"defs","to":"surface","label":"derived at compose"},
{"from":"surface","to":"tx","label":"check, names"},
{"from":"surface","to":"docs","label":"pure artifacts"},
{"from":"ui","to":"host","label":"HTTPS request"},
{"from":"cli","to":"host","label":"socket or HTTPS"},
{"from":"host","to":"open","label":"carrier"},
{"from":"open","to":"host","label":"session"},
{"from":"host","to":"tx","label":"longest prefix"},
{"from":"host","to":"proto","label":"/_keelwerk/v1"},
{"from":"tx","to":"invoke","label":"invoke with session"},
{"from":"proto","to":"invoke","label":"invoke, subscribe"},
{"from":"invoke","to":"live","label":"frames with tokens"},
{"from":"invoke","to":"wire","label":"outcome or error"},
{"from":"live","to":"ui","label":"resume from token"}],
"groups":[{"label":"Once per API version","nodes":["defs","surface","docs"]},{"label":"Per request","nodes":["host","open","tx","proto","invoke"]}]}
```

**Decisions behind it.**

- Q15: oRPC ships in the first release beside tRPC, on the same conformance suite (15b).
- Q16: action commands sit under one verb, so no name is ever reserved for an integration, plugin or module (16b).
- Q81: that verb is `keelwerk call <module.entity.action>` (81a).
- Q36: operator work stays on the invocation protocol and the CLI, with no operator GraphQL schema (36a).
- Q37: own GraphQL operation limits instead of graphql-armor, the no-repeat rule first (37a).

**Read more.** Sections 10, 15.4, 16.1 to 16.9; ADRs 0010, 0011, 0012, 0013.

### 8. Versioning and compatibility

**In one sentence.** Every contract names its version: an app's API has dated versions served from one head implementation by translation in the invoker, pins decide which version a caller gets, and CI refuses any change that breaks a supported version.

**How it works.** Handlers implement only the head. A breaking change to a module's surface ships in a major of its package with a `defineVersionChange` file in `versions/`: what changed (`renamedFrom`, `addedRequired`, `removed`, action renames), custom transforms, error renames and fixtures. The app adopts changes in a dated entry of `defineApiVersions`; `keelwerk surface version new <date>` records module versions, adopted changes and surface hash in the committed ledger. For a request at version D, `locate` maps an older reference to the head, `validate` checks D's schema and `translate` applies input transforms oldest first; after `shape`, output and error transforms run newest first, per item for subscriptions. Handlers, rules and masks see head shapes only. The session's version is the first of: the request (`Keelwerk-Version`, `hello.apiVersion`, `--api-version`), the credential, the tenant's pin, the backend's default. A version is deprecated the day a newer one exists and retired at its sunset 12 months later, whatever its use: `Deprecation` and `Sunset` headers and live `notice` frames before, `core.api_version_retired` (410) after, with pins moved to the floor. `keelwerk surface diff --base origin/main` derives every version's surface on both sides and fails on a breaking change; each module package's diff must fit its semantic version bump. Wire protocols use integer majors instead, a new one beside the old.

**Example.** Trail's `tracking` 2.0.0 renames `device.name` to `displayName`, adopted on 2027-03-01 (illustrative; Trail's own design is made in its repository); a script whose key is pinned at 2026-11-02 works until the sunset.

```ts
// modules/tracking/src/versions/display-name.ts: the file name is the change id
export const displayName = defineVersionChange({
  since: '2.0.0',
  surface: [{ entity: device, field: 'displayName', renamedFrom: 'name' }],
  input: {}, output: {},                                  // a rename needs no custom transform
  fixtures: [{ ref: 'tracking.device.update', older: { id: 'dev_1', name: 'iPhone' }, newer: { id: 'dev_1', displayName: 'iPhone' } }],
})
// apps/trail/src/api-versions.ts
export const trailApi = defineApiVersions({
  '2026-11-02': { deprecated: { at: '2027-03-01', sunset: '2028-03-01' } },
  '2027-03-01': {},                                       // adopts tracking 2.0.0's change
})
// GET /api/tracking/devices/dev_01j9… with the key pinned at 2026-11-02:
//   handlers and rules see { displayName: "Jens's iPhone" }; the response carries { name: "Jens's iPhone" }
//   Keelwerk-Version: 2026-11-02 · Deprecation: @1803859200 · Sunset: Wed, 01 Mar 2028 00:00:00 GMT
// after retirement: 410 core.api_version_retired; pinned keys move to the floor
```

**Diagram.**

```diagram
{"title":"A request at an older API version","nodes":[
{"id":"client","label":"Script pinned 2026-11-02","kind":"actor"},
{"id":"pins","label":"Pins in order","kind":"store"},
{"id":"open","label":"resolveVersion in open","kind":"box"},
{"id":"locate","label":"locate and validate","kind":"box"},
{"id":"tin","label":"translate in, oldest first","kind":"box"},
{"id":"head","label":"Head handler and rules","kind":"box"},
{"id":"shape","label":"shape: masks","kind":"box"},
{"id":"tout","label":"translate out, newest first","kind":"box"},
{"id":"changes","label":"Version changes, ledger","kind":"store"},
{"id":"diff","label":"keelwerk surface diff","kind":"box"},
{"id":"ci","label":"Breaking change fails","kind":"note"},
{"id":"sunset","label":"Retired 12 months later","kind":"note"}],
"edges":[
{"from":"client","to":"open","label":"header or pin"},
{"from":"pins","to":"open","label":"first that exists"},
{"from":"open","to":"locate","label":"session version D"},
{"from":"locate","to":"tin","label":"D's schema"},
{"from":"tin","to":"head","label":"head shapes only"},
{"from":"head","to":"shape","label":"outcome"},
{"from":"shape","to":"tout","label":"masked output"},
{"from":"tout","to":"client","label":"D's shape"},
{"from":"changes","to":"tin","label":"input transforms"},
{"from":"changes","to":"tout","label":"output, error transforms"},
{"from":"diff","to":"changes","label":"both sides"},
{"from":"diff","to":"ci","label":"on a break"},
{"from":"sunset","to":"client","label":"410 after retirement"}],
"groups":[{"label":"Invoker pipeline","nodes":["open","locate","tin","head","shape","tout"]},{"label":"Build and CI","nodes":["changes","diff","ci"]}]}
```

**Decisions behind it.**

- Q52: dated API versions with pins per request, credential, tenant and backend; integer majors only for wire protocols (52a).
- Q53: deprecated the day a newer version exists, retired at the sunset 12 months later regardless of use.
- Q59: a part's reference comes from its path, so moving an action file is a breaking change (59b).
- Q23: Launchway's agent protocol v1 is not served; majors start at `keelwerk.live.v1` (23c).

**Read more.** Sections 5.1, 13.8 (step 9), 18.1 to 18.9; ADR 0021.

### 9. Rollouts

**In one sentence.** A new build never interrupts running clients: two adjacent revisions run side by side under the N-1 rule, schema changes split into expand, backfill and contract steps, and destructive steps wait for a finalization that the process registry gates.

**How it works.** `keelwerk build` writes a build manifest: package versions plus the compatibility content (migrations per track, event shapes, configuration versions, job formats, protocol majors, version change ids, API surfaces). At `connect` a process registers in `core.process` and compares its content with the finalized revision in `core.rollout`: equal content joins it, content that only adds runs as the target (finalized plus one), and content that lacks something (`buildTooOld`) or differs from the current target (`targetConflict`) refuses to start. While both run, the N-1 rule holds: expand steps only, the target writes the finalized event track versions, a job runs only on workers at or above its enqueuer's revision, and an older process meeting an unknown API version, action or protocol answers 503, `core.rollout_in_progress`, `Retry-After: 2`. With `finalize: 'auto'` (the default) a singleton finalizer raises the finalized revision once every live process has run the target for 600 seconds, which starts the backfills. Contract steps stay manual and refuse with `core.rollout_not_finalized` until finalization covers them. Draining processes end streams with `going_away`, and clients resume from their token elsewhere; a changed `surfaceHash` in `welcome` makes them refetch the surface. Releases stay separate from deploys: a tenant-level release flag goes from canary tenants to a percentage to everyone.

**Example.** Launchway's M4 exit criterion 8 is an upgrade with a field rename while the agents and the UI stay connected. Suppose the new build renames `deployments.deployment.ref` to `gitRef` (its API side is a version change, chapter 8; revisions illustrative):

```text
phase      trigger                                  deployments__deployment   processes
expand     keelwerk db apply                        ref, git_ref              41 (finalized)
target     the new build starts as revision 42      ref, git_ref              41 and 42; 42 writes both, reads ref
finalize   automatic: all live on 42 for 600 s      ref, git_ref              42; the backfill starts
backfill   copyColumn, batched, idempotent          ref, git_ref              reads move to git_ref per namespace
contract   keelwerk db apply --contract (manual)    git_ref                   the old column is gone
meanwhile  a client at the new API version reaching 41: 503 core.rollout_in_progress, Retry-After: 2
rollback   before finalization: redeploy 41, keelwerk rollout abort; after it: a restore
home       new container, wait for /_keelwerk/ready, move the Caddy upstream, drain the old one
```

**Diagram.**

```diagram
{"title":"A rollout from revision N to N+1","nodes":[
{"id":"build","label":"Build manifest","kind":"box"},
{"id":"registry","label":"Process registry","kind":"store"},
{"id":"rollout","label":"core.rollout","kind":"store"},
{"id":"old","label":"Processes at N","kind":"box"},
{"id":"target","label":"Processes at N+1","kind":"box"},
{"id":"refuse","label":"Refused at connect","kind":"note"},
{"id":"expand","label":"Expand steps","kind":"box"},
{"id":"final","label":"Finalizer after 600 s","kind":"box"},
{"id":"backfill","label":"Backfill, reads move","kind":"box"},
{"id":"contract","label":"Contract steps, manual","kind":"box"},
{"id":"clients","label":"Agents, UI, CLI","kind":"actor"},
{"id":"flag","label":"Release flag","kind":"box"}],
"edges":[
{"from":"build","to":"registry","label":"compare at connect"},
{"from":"registry","to":"old","label":"equal: joins N"},
{"from":"registry","to":"target","label":"adds only: N+1"},
{"from":"registry","to":"refuse","label":"lacks or conflicts"},
{"from":"expand","to":"target","label":"before traffic"},
{"from":"target","to":"final","label":"all live on N+1"},
{"from":"final","to":"rollout","label":"raises finalized revision"},
{"from":"rollout","to":"backfill","label":"starts"},
{"from":"backfill","to":"contract","label":"then, explicitly"},
{"from":"rollout","to":"contract","label":"gates"},
{"from":"old","to":"clients","label":"going_away, resume"},
{"from":"target","to":"clients","label":"welcome, surfaceHash"},
{"from":"flag","to":"clients","label":"canary, percent, everyone"}],
"groups":[{"label":"N-1 window","nodes":["old","target"]},{"label":"Migration phases","nodes":["expand","backfill","contract"]}]}
```

**Decisions behind it.**

- Q54: finalization is automatic once every live process has run the target for 600 seconds, with a manual mode per deployment; contract steps stay manual (54a).
- Q55: a rename renames the column through expand, dual write, backfill and contract; physical names always equal derived names (55b).
- Q23: Launchway's cutover redeploys every agent with the new UI, the old installation kept as the rollback until the new one is verified (23c).
- Q51: flags live in the core, so a release can follow a deploy tenant by tenant (51a).

**Read more.** Sections 14.4.2, 14.6.4, 15.4.5, 19.1 to 19.8; ADR 0022 (with ADR 0018 on singleton leases, due before M4).

### 10. Feature flags and experiments

**In one sentence.** Flags are a small kernel concept that handlers, rules, gates, jobs and rollouts read from one recorded snapshot per invocation; experiments are an optional module that observes exposures and reports fixed-horizon statistics.

**How it works.** A flag is one file in `flags/` (`defineFlag`: a kind, a default that keeps established behaviour, the level whose key splits, a purpose, and `expires` for release and experiment flags), listed by the module base, so `ctx.flags` is typed like `ctx.config`. Handlers read flags as requests (`yield* ctx.flags.tracking.accuracyFilter`) answered from the invocation's snapshot, so one invocation sees one value per flag; rules read the same snapshot. Resolution walks the ordered `flagProviders`: `core.targeting` (per-backend targeting in the control store), an optional OpenFeature adapter, and `env` in development and tests; an error serves the default. Targeting holds ordered rules over tenants, principals and attribute conditions, then a fallthrough; a split hashes SHA-256 of a salt and the targeting key into [0, 1) and gives variants cumulative ranges, so raising a percentage never moves a key out. Every targeting change is an event with actor and reason. `gate` compiles to a deny rule (`forbidden`, `core.feature_disabled`), or for a kill switch to an `admit` check (`unavailable`, `core.feature_suspended`). Every event records the flags its command read (key, variant, reason, rule version) in `kw_events.meta`. `@keelwerk/module-experiments` (after M4) records first exposures through `flagObservers`, tallies events per variant and reports a two-proportion z-test or Welch's t-test with 95 % intervals; before the planned sample size it reads "inconclusive", and a sample ratio mismatch marks it invalid.

**Example.** Trail rolls out a stricter accuracy filter one tracking app at a time and keeps a kill switch over its Overpass queries (illustrative; Trail's own design is made in its repository):

```ts
// modules/tracking/src/flags/accuracy-filter.ts: one flag per file; base.ts lists it (key tracking.accuracyFilter)
export const accuracyFilter = defineFlag({
  kind: 'variant', variants: ['off', 'strict'], default: 'off',   // 'off' keeps the current ingest, also on any error
  level: 'principal',                                              // each tracking app's receiver grants one principal
  purpose: 'release', expires: '2027-01-31',                       // reported as stale after that date
})
// modules/tracking/src/flags/map-data.ts
export const mapData = defineFlag({ kind: 'boolean', default: true, level: 'tenant', purpose: 'kill-switch' })

// modules/tracking/src/actions/trip/match-roads.ts: requests the Overpass effect
export const matchRoads = defineCommand(trackingBase, trip, { gate: 'mapData' /* ... */ })   // false: 503, core.feature_suspended

// in tracking.ingestOverland's decide (chapter 13)
const filter = yield* ctx.flags.tracking.accuracyFilter          // 'off' | 'strict'

// core.flag targeting of backend trail, ruleVersion 2, written as an event with actor and reason:
//   rule 1: principals [tracking.overland] -> 'strict'; fallthrough: 'off'
// an Overland upload: meta.flags = [{ key: 'tracking.accuracyFilter', variant: 'strict', reason: 'TARGETING_MATCH', ruleVersion: 2 }]
```

**Diagram.**

```diagram
{"title":"How one invocation sees its flags","nodes":[
{"id":"def","label":"defineFlag in base","kind":"box"},
{"id":"op","label":"Operator: keelwerk flags","kind":"actor"},
{"id":"target","label":"core.flag targeting","kind":"store"},
{"id":"prov","label":"flagProviders chain","kind":"box"},
{"id":"snap","label":"Invocation flag snapshot","kind":"box"},
{"id":"gate","label":"Gate: deny or admit","kind":"box"},
{"id":"decide","label":"decide: yield* ctx.flags","kind":"box"},
{"id":"meta","label":"kw_events.meta flags","kind":"store"},
{"id":"obs","label":"flagObservers","kind":"box"},
{"id":"tally","label":"Exposures and tallies","kind":"store"},
{"id":"res","label":"Fixed-horizon results","kind":"box"},
{"id":"split","label":"SHA-256 split","kind":"note"}],
"edges":[
{"from":"op","to":"target","label":"rules, split, reason"},
{"from":"target","to":"prov","label":"core.targeting first"},
{"from":"def","to":"prov","label":"kind, default, level"},
{"from":"split","to":"prov","label":"salt, targeting key"},
{"from":"prov","to":"snap","label":"resolved once"},
{"from":"snap","to":"gate","label":"gate flag"},
{"from":"snap","to":"decide","label":"answers requests"},
{"from":"decide","to":"meta","label":"key, variant, reason"},
{"from":"snap","to":"obs","label":"first exposure"},
{"from":"obs","to":"tally","label":"drafts per phase"},
{"from":"tally","to":"res","label":"hourly counts"},
{"from":"res","to":"op","label":"95 % intervals"}],
"groups":[{"label":"Kernel","nodes":["def","target","prov","snap","gate","decide","meta"]},{"label":"experiments module","nodes":["obs","tally","res"]}]}
```

**Decisions behind it.**

- Q51: flags in the framework core (`defineFlag`, typed `ctx.flags`, gates, provenance), experiments as an optional module (51a).
- Q57: fixed-horizon frequentist tests first, with a planned-size gate and a sample-ratio check (57a).
- Q1: modules come from the compiled catalogue; runtime variation goes through configuration and flags, never runtime module selection (1a).

**Read more.** Sections 7.9.3, 15.1.2, 20.1 to 20.10; ADR 0023.

### 11. Jobs, nodes and autoscaling

**In one sentence.** All asynchronous work runs on one kernel queue in each adapter's job store, taken fairly per tenant lane and run by pure handlers or effect executors on a fleet that a pure scaler plan sizes.

**How it works.** Asynchronous commands, durable timers, continuations and effects with an executor are jobs enqueued in the unit that causes them, committing with its events on every adapter; the reaction dispatcher enqueues async reactions from the event log, schedules once per tick and scope. Each namespace holds `kw_jobs` and a lane per scope, queue, capability set and priority class. The take orders lanes by priority class, running work per unit of weight, then virtual time (a weighted round robin), with `SKIP LOCKED`; lane caps and destination groups (concurrency, rate) bound it, and a queued cap (10,000) answers `core.queue_full` at enqueue. Leases renew every 10 seconds and last three heartbeats; a lost lease requeues, three make a dead letter. Action jobs run through the invoker. An effect job runs its executor outside any unit, with the effect id as idempotency key, retrying mechanical failures only; answers with domain meaning go to the continuation. An effect with `performer: 'external'` is pulled and settled by an outside program. Every 15 seconds the scaler computes a pure plan from queue statistics (Little's law plus the backlog over the target wait), clamped by limits, connection budgets and a database guard; the kernel performs its provider calls as recorded effects. Scale-down is a drain. Providers: static (recommendations, M4), docker (opt-in, M5), Kubernetes later.

**Example.** Trail's home-server deployment and its Overpass executor (illustrative; Trail's own design is made in its repository):

```ts
// Trail's deployment file, excerpt of defineDeployment
processes: {
  home: { roles: ['serve', 'work'], slots: { '*': 4 } },                    // static, started by Launchway
  worker: { roles: ['work'], slots: { reactions: 8, '*': 2 }, provider: 'docker', scale: { min: 0, max: 4 } },   // opt-in, M5
},
scaling: { maxProcesses: 8 },
queues: { 'map-data': { slo: 'PT10M' } },                                   // target wait from due to start

// modules/tracking/src/executors/overpass-query.ts: no data access, egress only
export const overpassQueryExecutor = defineEffectExecutor(trackingBase, overpassQuery, {
  queue: 'map-data',
  group: () => ({ id: 'overpass', concurrency: 1, rate: '10/1m' }),
  retry: { delays: 'exponential', maxDelay: '30m', giveUpAfter: 'PT24H' },  // 429, 5xx, refused connections
  run: async (input, ctx) => runOverpassQuery(ctx.egress, input.bbox, ctx.signal),
})

// $ keelwerk fleet scale explain worker   (trips recomputed after an import)
// reactions []: due 840, oldest 41 s (target 30 s), 22/s, 0.18 s each -> 9 slots x 1.4 -> 13; 8 per replica -> 2; start 1 on docker
```

**Diagram.**

```diagram
{"title":"Jobs, workers and fleet size","nodes":[
{"id":"unit","label":"Command unit","kind":"box"},
{"id":"jobs","label":"kw_jobs and lanes","kind":"store"},
{"id":"take","label":"Fair take","kind":"box"},
{"id":"worker","label":"Worker slots","kind":"box"},
{"id":"inv","label":"Invoker","kind":"box"},
{"id":"exec","label":"Effect executor","kind":"box"},
{"id":"agent","label":"External performer","kind":"actor"},
{"id":"scaler","label":"Scaler: pure plan","kind":"box"},
{"id":"prov","label":"Node provider","kind":"box"},
{"id":"reg","label":"core.process, core.node","kind":"store"},
{"id":"drain","label":"Scale-down drain","kind":"note"}],
"edges":[
{"from":"unit","to":"jobs","label":"enqueue at commit"},
{"from":"jobs","to":"take","label":"due, per lane"},
{"from":"take","to":"worker","label":"lease"},
{"from":"worker","to":"inv","label":"action job"},
{"from":"worker","to":"exec","label":"effect job"},
{"from":"inv","to":"unit","label":"events, effects"},
{"from":"exec","to":"unit","label":"settled"},
{"from":"unit","to":"agent","label":"pending effects"},
{"from":"agent","to":"unit","label":"settle"},
{"from":"jobs","to":"scaler","label":"class statistics"},
{"from":"scaler","to":"prov","label":"start or drain"},
{"from":"prov","to":"reg","label":"process registers"},
{"from":"reg","to":"worker","label":"capabilities"},
{"from":"drain","to":"worker","label":"stop taking"}],
"groups":[{"label":"Queue per namespace","nodes":["jobs","take"]},{"label":"Fleet","nodes":["scaler","prov","reg","drain"]}]}
```

**Decisions behind it.**

- Q6: one kernel queue over every adapter's job store, not pg-boss (6a).
- Q75: executors retry mechanical failures; domain answers become state machines with timers (75a).
- Q62: the command group is `keelwerk fleet`, and Launchway's `nodes` keeps its id (62a).
- Q63: the scaler first with the static provider, docker one milestone later, Kubernetes named for later (63a).
- Q64: the docker provider is opt-in, scaler-only, behind a five-verb socket proxy (64a).

**Read more.** Sections 4.6, 7.9.5, 9.5.1 to 9.5.7, 14.3.9, 21.1 to 21.11; ADRs 0015, 0025, 0026.

### 12. Project layout and tooling

**In one sentence.** Every file defines one thing and is named after it, every module is a package whose parts a generator assembles into a checked module literal, and the toolchain enforces the layout.

**How it works.** An app repository holds `apps/<id>/` (the as-const tuple in `src/modules.ts`, `defineApp` in `src/app.ts`), a package per module under `modules/<id>/`, and `scripts/`. In a module, `src/base.ts` is hand-written (`defineModuleBase`: id, version, dependencies, config, entities, flags, contributions, conditions) and every part is a file typed against it: `actions/<action>.ts`, `actions/<entity>/<action>.ts`, `policies/<target>/<rule>.ts` (the path is the rule id), `reactions/`, `effects/`, `executors/` (the only imperative code); `entities/` and `lib/` hold one entity or pure function per file. `keelwerk generate`, and the dev server on every change, writes `src/module.generated.ts`, the module literal and package entry, from these paths; `generate --check` fails CI on drift, and a moved action file is a breaking change for `surface diff`. Names are `kebab()` of the export (`change-password.ts`); a file exports one value; barrels, `export *`, default exports and import effects are banned. The Biome 2.5.15 preset adds GritQL plugins such as `pure-parts` and `one-export`, knip finds forgotten files, and `keelwerk doctor --layout` checks placement, names and mounts. `keelwerk new` creates files and never edits a source. Sources run on Node 26 by type stripping, with `Temporal` built in, checked by TypeScript 7. Each app repository carries `.launchway/` with its deployment file. Packages stay 0.x beta until Jens declares them stable, under FSL-1.1-ALv2: each version becomes Apache-2.0 two years after its release.

**Example.** Trail's repository with its tracking module (illustrative; Trail's own design is made in its repository):

```text
trail/
  .launchway/deployment.ts          defineDeployment: app, placements, ports, providers, scaling (90c)
  .launchway/launchway.ts           Launchway only: domains, routes, previews, environment, node
  .launchway/compose.yaml           until M4: runs keelwerk start --config .launchway/deployment.ts
  apps/trail/src/modules.ts         [accounts, auth, apiKeys, live, rest, webhooks, tracking] as const
  modules/tracking/src/
    base.ts                         hand-written defineModuleBase
    module.generated.ts             written by keelwerk generate; the package entry
    entities/device.ts  location.ts  trip.ts  visit.ts
    actions/ingest-overland.ts      tracking.ingestOverland
    actions/device/rotate-token.ts  tracking.device.rotateToken
    policies/device/owner.ts        the rule tracking.device.owner
    flags/accuracy-filter.ts        tracking.accuracyFilter
    effects/overpass-query.ts       defineEffect
    executors/overpass-query.ts     defineEffectExecutor: node:* and HTTP clients only here
    lib/normalise-overland.ts       one pure function
$ keelwerk new action tracking.device.rotateToken --kind command   # creates the file and its test
$ keelwerk generate --check && keelwerk doctor --layout             # drift, placement, names, mounts
```

**Diagram.**

```diagram
{"title":"From part files to a checked module","nodes":[
{"id":"author","label":"Author or keelwerk new","kind":"actor"},
{"id":"base","label":"base.ts, hand-written","kind":"box"},
{"id":"parts","label":"Part files, one export","kind":"box"},
{"id":"gen","label":"keelwerk generate, dev","kind":"box"},
{"id":"manifest","label":"module.generated.ts","kind":"store"},
{"id":"tsc","label":"tsc -b, TypeScript 7","kind":"box"},
{"id":"biome","label":"Biome preset, GritQL","kind":"box"},
{"id":"doctor","label":"keelwerk doctor --layout","kind":"box"},
{"id":"ci","label":"generate --check, surface diff","kind":"box"},
{"id":"app","label":"apps/<id> modules.ts","kind":"box"},
{"id":"deploy","label":".launchway/deployment.ts","kind":"store"}],
"edges":[
{"from":"author","to":"parts","label":"creates files only"},
{"from":"author","to":"base","label":"lists declarations"},
{"from":"parts","to":"base","label":"typed against"},
{"from":"parts","to":"gen","label":"paths give references"},
{"from":"gen","to":"manifest","label":"writes the literal"},
{"from":"manifest","to":"tsc","label":"checked like source"},
{"from":"manifest","to":"app","label":"package entry"},
{"from":"app","to":"deploy","label":"selected by"},
{"from":"biome","to":"parts","label":"names, purity, one export"},
{"from":"doctor","to":"parts","label":"placement, mounts"},
{"from":"ci","to":"manifest","label":"fails on drift"},
{"from":"ci","to":"app","label":"moved file: breaking"}],
"groups":[{"label":"One module package","nodes":["base","parts","manifest"]},{"label":"Checks","nodes":["tsc","biome","doctor","ci"]}]}
```

**Decisions behind it.**

- Q58: file names are kebab-case, derived from the export (58a).
- Q59: a generated module manifest over a hand-written `base.ts`, checked in CI (59b).
- Q60: one rule per file; the file name is the rule id (60b).
- Q28: TypeScript 7 and Node 26 with type stripping; the baseline follows each new major (28a).
- Q19: `Temporal` from the start, native in Node 26 (19b).
- Q20: FSL-1.1-ALv2, Licensor Jens Penneman, `LICENSE.md` from the first commit.
- Q48: every app in its own repository on exact-pinned 0.x pre-releases; beta until Jens declares it stable (48c).
- Q90: each app repository carries `.launchway/`; the edit that writes it into the specification is pending (90c).

**Read more.** Sections 13.1, 13.2, 13.8, 13.9, 13.12, 16.9.8, 22, 23.1 to 23.14; ADRs 0013, 0024; decision register section K2.

### 13. The platforms and the road ahead

**In one sentence.** Trail (M3) and Launchway (M4) are rebuilt in their own repositories, and each milestone ends in checks that prove part of the architecture; mail is parked.

**How it works.** Trail comes first, with shared modules such as `accounts`, `auth` (passkeys only, added in M3), `api-keys`, `live`, `rest` and `webhooks`; its module split is Trail's choice, so the names here are illustrative. Devices, locations, visits and trips are entities. Each tracking app's endpoint is a `transport-webhooks` receiver, because its path, body and answer follow the app's protocol rather than the JSON action form. Trail needs a keyed `setTimer` per device, async reactions that recompute trips and daily statistics, and external effects with executors for ntfy alerts and Overpass queries. How its 561,000 location points are stored and migrated is decided in the Trail repository (M3). Launchway follows in M4 with 22 modules, six of its own (`projects`, `nodes`, `deployments`, `domains`, `github`, `previews`). Every command to a node is an `agentCommand` effect that the agent, a typed client on the `keelwerk.live.v1` WebSocket, pulls from `nodes.channel` and settles through `nodes.ack`, so any process can hold its connection. The shared `edge` module keeps the desired sites, `edge-caddy` renders the Caddyfile and the edge node's agent performs `edge.apply`. `previews` contributes fields to projects and deployments and reacts to pull requests only when `github` is selected.

**Example.** Trail's Overland upload as a pure decide (illustrative; Trail's own design is made in its repository):

```ts
// modules/tracking/src/actions/ingest-overland.ts
export const ingestOverland = defineCommand(trackingBase, {
  input: overlandUpload,                                // receiver input: path's device id, token, points (G8)
  output: shape({ result: field.enum(['ok']) }),
  principal: 'service',                                 // tracking.overland, after the receiver's verify (16.5.8)
  execution: 'sync',                                    // the phone deletes its batch only after "ok"
  *decide(input, ctx) {
    const device = yield* ctx.load.tracking.device.byId(input.deviceId)
    if (!device || !(yield* ctx.secrets.verify(input.token, device.ingestToken))) throw errors.unauthenticated('Unknown device or token.')   // decide repeats the check
    const { points } = normaliseOverland(input, yield* ctx.flags.tracking.accuracyFilter)   // lib/
    const known = yield* ctx.load.tracking.location.many({ where: { deviceId: device.id, recordedAt: { in: points.map((p) => p.recordedAt) } }, limit: points.length })
    const drafts: Draft[] = []
    for (const p of points) {
      if (known.some((k) => k.recordedAt.equals(p.recordedAt))) continue   // a re-sent point
      drafts.push(ctx.write.tracking.location.create({ id: yield* ctx.newId(location), deviceId: device.id, ...p }))
    }
    const alert = device.silentSince ? [ntfyAlert({ url: ctx.config.ntfyUrl, message: `${device.name} is back` })] : []
    return {
      events: [...drafts, ctx.write.tracking.device.update(device, { lastSeenAt: ctx.clock.now(), silentSince: null })],
      effects: [setTimer({ key: `device-silent:${device.id}`, after: '6h', invoke: markSilent, input: { id: device.id } }), ...alert],
      result: { result: 'ok' },
    }
  },
})
```

**Diagram.**

```diagram
{"title":"What each milestone proves","nodes":[
{"id":"m0","label":"M0 toolchain, spikes","kind":"box"},
{"id":"gate","label":"Architecture approval","kind":"note"},
{"id":"m1","label":"M1 thin slice","kind":"box"},
{"id":"m2","label":"M2 execution, live","kind":"box"},
{"id":"m3","label":"M3 Trail rebuilt","kind":"box"},
{"id":"m4","label":"M4 Launchway rebuilt","kind":"box"},
{"id":"m5","label":"M5 data breadth","kind":"box"},
{"id":"m6","label":"M6 offline sync","kind":"box"},
{"id":"m7","label":"M7 collaborative fields","kind":"box"},
{"id":"mail","label":"Mail, parked","kind":"note"},
{"id":"later","label":"Experiments, Kubernetes","kind":"box"},
{"id":"jens","label":"Jens","kind":"actor"}],
"edges":[
{"from":"m0","to":"gate","label":"types, write path"},
{"from":"jens","to":"gate","label":"approves"},
{"from":"gate","to":"m1","label":"ADRs Accepted"},
{"from":"m1","to":"m2","label":"end-to-end slice"},
{"from":"m2","to":"m3","label":"fair across tenants"},
{"from":"m3","to":"m4","label":"published packages suffice"},
{"from":"m4","to":"m5","label":"replaces v0.3.0"},
{"from":"m5","to":"m6","label":"three databases pass"},
{"from":"m6","to":"m7","label":"offline mutations converge"},
{"from":"m7","to":"jens","label":"rich text converges"},
{"from":"m4","to":"later","label":"after M4"},
{"from":"m4","to":"mail","label":"blob store ready"},
{"from":"jens","to":"mail","label":"unparks later"}],
"groups":[{"label":"Apps, own repositories","nodes":["m3","m4"]},{"label":"Parked or later","nodes":["mail","later"]}]}
```

**Decisions behind it.**

- Q48: every app in its own repository on published packages, Trail first (48c).
- Q80: agent commands are effects with an external performer (80a).
- Q82: Caddy behind an `edgeProvider` contract (82a).
- Q88: the edge is the shared `@keelwerk/module-edge` (88a).
- Q9: offline sync after the platforms, now M6 (9a).
- Q11: collaborative fields as Loro documents from the first declaring app (11a).
- Q12: MySQL stays (M5); missing capabilities get kernel fallbacks (12a).

**Read more.** Sections 7.9.4, 7.9.5, 16.5.8, 17.1 to 17.3, 17.7, 24, 26.2; ADRs 0006, 0008, 0014, 0026; roadmap.md.
