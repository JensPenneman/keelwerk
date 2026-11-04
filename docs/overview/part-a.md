### 1. The big picture: one deployment, backends, tenants, apps from modules

**In one sentence.** One keelwerk deployment is one build running a compiled catalogue of apps, each a const tuple of modules with exact types; the operator creates backends and their tenants at runtime, without a redeploy.

**How it works.** Modules own entities and actions. An app, `defineApp({ id, modules })`, composes an `as const` tuple, and every derived type is computed from it; an app lists modules only, never a database. A deployment, `defineDeployment`, names the app catalogue and the shared infrastructure: data adapters, the HTTP host, blob stores, ledger sinks, the control store, placements, tenant resolvers, named processes; a required contract without a provider fails with `missingInfrastructure`. A backend is a control-store row: a name, the app it runs, configuration, secrets, domains, quotas. A tenant is the isolation unit inside it: its own data, authentication realm, configuration, secrets, domains and quotas. Every invocation runs in a scope: (backend, tenant), the backend level, or the deployment level, which only the operator reaches. Processes load the same build with the role `serve`, `work` or `all`, share no memory, coordinate through the control store and the job queue, serve every backend and follow the directory through a change feed, so a new backend or tenant restarts nothing. A selection no app has is one more `defineApp` and a deploy; runtime module selection was rejected because types cannot follow it. Since 2026-10-27 every app has its own repository on exact-pinned 0.x packages: Trail first (M3), Launchway second (M4). The mail server is designed and parked.

**Example.** Trail as its own deployment until Launchway's rebuild (decision 90c); names are illustrative; Trail's own design is made in its repository.

```ts
// apps/trail/src/modules.ts and app.ts: exact types for exactly this tuple
export const modules = [accounts, auth, apiKeys, live, rest, webhooks, tracking] as const
const trailDef = defineApp({ id: 'trail', modules })
export interface Trail extends AppType<typeof trailDef> {}
export const trail: Trail = trailDef

// .launchway/deployment.ts, run by the pre-keelwerk Launchway through .launchway/compose.yaml
export default defineDeployment({
  apps: [trail],
  infrastructure: [postgresAdapter(), httpHost({ listen: [{ port: 3000 }] }), ledgerFile({ path: '/var/lib/keelwerk-ledger/erasure.log' })],
  control: { adapter: 'postgres', url: env('KEELWERK_CONTROL_URL') },
  placements: { default: { adapter: 'postgres', url: env('KEELWERK_DATA_URL'), strategy: 'shared-tables' } },
  tenantResolution: [byHostname(), byScopeKey()],
  operator: { socket: '/run/keelwerk/operator.sock', bootstrapSecret: secret('KEELWERK_OPERATOR_SECRET') },
  keys: { masterKey: secret('KEELWERK_MASTER_KEY') },
  // processes and scaling: chapter 11
})

// at runtime, over the operator socket: control-store rows, no restart
const backend = await operator.invoke('core.backend.create', { name: 'trail', app: 'trail', placement: 'default' })
await operator.invoke('core.tenant.create', { backendId: backend.id, name: 'Jens', domains: ['trail.example'] })
```

**Diagram.**

```diagram
{"title":"One build, many backends",
"nodes":[
{"id":"mods","label":"Module packages","kind":"box"},
{"id":"app","label":"App const tuple","kind":"box"},
{"id":"infra","label":"Infrastructure entries","kind":"box"},
{"id":"dep","label":"Deployment definition","kind":"box"},
{"id":"op","label":"Operator","kind":"actor"},
{"id":"ctl","label":"Control store directory","kind":"store"},
{"id":"be","label":"Backend row","kind":"box"},
{"id":"tn","label":"Tenant row","kind":"box"},
{"id":"proc","label":"Processes: serve, work","kind":"box"},
{"id":"pl","label":"Placement namespace","kind":"store"},
{"id":"client","label":"Client request","kind":"actor"}],
"edges":[
{"from":"mods","to":"app","label":"selected in tuple"},
{"from":"app","to":"dep","label":"listed in catalogue"},
{"from":"infra","to":"dep","label":"fills deployment points"},
{"from":"dep","to":"proc","label":"same build everywhere"},
{"from":"op","to":"ctl","label":"creates at runtime"},
{"from":"ctl","to":"be","label":"holds"},
{"from":"be","to":"app","label":"runs one app"},
{"from":"be","to":"tn","label":"contains"},
{"from":"tn","to":"pl","label":"data placed in"},
{"from":"ctl","to":"proc","label":"directory change feed"},
{"from":"client","to":"proc","label":"carrier"},
{"from":"proc","to":"tn","label":"resolves scope"}],
"groups":[
{"label":"Compile time","nodes":["mods","app","infra","dep"]},
{"label":"Runtime","nodes":["op","ctl","be","tn","proc","pl","client"]}]}
```

**Decisions behind it.**

- `Q1` The compiled catalogue (a): per-backend variation through configuration and flags; development always has the exact types of the app being built.
- `Q2` Hard dependencies stay (a): a module switches off together with the modules that require it.
- `Q48` Own repositories (c): apps use published 0.x packages pinned exactly; Trail first, Launchway second; beta until Jens declares them stable.
- `Q90` The `.launchway/` directory (c): `deployment.ts`, `launchway.ts`, an interim `compose.yaml`; in architecture.md sections 4.6, 16.9.1, 17.3.1 and 23.1 since 2026-11-04.

**Read more.** Sections 1, 2, 3.2, 4.5, 4.6, 12 and 17.5; ADRs 0003 and 0006.

### 2. Modules and composition

**In one sentence.** A module is a hand-written base plus one part per file typed against it, assembled by a generator; contributions, conditional parts and optional dependencies let modules influence each other while each stays selectable on its own.

**How it works.** `base.ts` holds `defineModuleBase({ id, version, requires, optional, provides, config, data, extensionPoints, principalRef, entities, streams, flags, contributions, conditions })`: everything a handler's types depend on, so no builder chain is needed. Each part is one literal per file, typed against the base: `defineCommand(base, entity, { ... })`, `defineQuery`, `defineRule`, `defineReaction`, `defineService`, `defineEffect` and the others. `keelwerk generate` and the dev server write the module literal, `module.generated.ts`, from the directories: `actions/<entity>/<action>.ts` mounts as `<module>.<entity>.<action>`; CI fails on drift. `requires` is hard: typed as present, checked at compile time and boot. `optional` is soft, reached through the Maybe accessor `yield* ctx.load.github.ifPresent((g) => ...)`, which answers `undefined` when the module is absent. Contracts (`live`, `blobs`, `httpHost`) name pluggable capabilities. A contribution adds fields, relations, actions, rules or extension-point values to another module, active only while that target and its `when` modules are selected and dropped silently otherwise; contributed fields must be optional or defaulted. A conditional part adds to the module itself while other modules are selected, which count as required inside it. The lower module publishes entities, events and extension points; the higher one imports, contributes and adapts. `defineApp` folds the tuple at the type level and repeats each check at boot; a failure reads as a missing property, `missingModules: 'projects'`.

**Example.** Launchway's `previews` (section 17.3.10): three hard dependencies, `github` optional, fields added to two modules, pull-request reactions only with `github`.

```ts
// contributions/to-deployments/contribution.ts
export const toDeployments = defineContribution(deployments, { entities: { deployment: { fields: { previewId: field.ref.own('preview').optional() } } } })
// conditional/when-github/condition.ts
export const whenGithub = defineCondition([github], {})
// base.ts
const previewsBaseDef = defineModuleBase({
  id: 'previews',
  version: '0.1.0',
  requires: [projects, deployments, domains],
  optional: [github],
  config,
  entities: { preview },
  contributions: { toProjects, toDeployments },   // toProjects adds previewsEnabled, previewHostTemplate, ...
  conditions: { whenGithub },
})
export interface PreviewsBase extends ModuleBaseType<typeof previewsBaseDef> {}
export const previewsBase: PreviewsBase = previewsBaseDef
// conditional/when-github/reactions/sync-preview.ts, mounted as conditional.whenGithub.reactions.syncPreview
export const syncPreview = defineReaction(within(previewsBase, whenGithub), {
  on: 'github.connection.pullRequestChanged',
  timing: 'async',
  key: (event) => `${event.data.repository}#${event.data.number}`,
  *react(event, ctx) { /* open, update or close the pull request's preview */ },
})
// without previews: no previewId in Row<Launchway, 'deployments.deployment'>; in an app without github: no syncPreview
```

**Diagram.**

```diagram
{"title":"From part files to exact app types",
"nodes":[
{"id":"base","label":"base.ts module base","kind":"box"},
{"id":"parts","label":"Part files","kind":"box"},
{"id":"gen","label":"keelwerk generate","kind":"actor"},
{"id":"lit","label":"module.generated.ts literal","kind":"box"},
{"id":"contrib","label":"Contributions to others","kind":"box"},
{"id":"cond","label":"Conditional parts","kind":"box"},
{"id":"tuple","label":"App const tuple","kind":"box"},
{"id":"sel","label":"Targets selected?","kind":"note"},
{"id":"fold","label":"Type-level fold","kind":"box"},
{"id":"boot","label":"Same checks at boot","kind":"box"},
{"id":"types","label":"Exact app types","kind":"store"},
{"id":"err","label":"Check error property","kind":"note"}],
"edges":[
{"from":"parts","to":"base","label":"typed against"},
{"from":"gen","to":"parts","label":"reads paths"},
{"from":"gen","to":"lit","label":"writes, CI checks"},
{"from":"lit","to":"tuple","label":"module value selected"},
{"from":"base","to":"contrib","label":"declares data"},
{"from":"base","to":"cond","label":"declares data"},
{"from":"contrib","to":"sel","label":"target and when"},
{"from":"cond","to":"sel","label":"when modules"},
{"from":"sel","to":"fold","label":"merged, else dropped"},
{"from":"tuple","to":"fold","label":"defineApp"},
{"from":"tuple","to":"boot","label":"runtime mirror"},
{"from":"fold","to":"types","label":"Row, AppActionTree"},
{"from":"fold","to":"err","label":"missing requirement"}],
"groups":[
{"label":"One module","nodes":["base","parts","gen","lit","contrib","cond"]},
{"label":"One app","nodes":["tuple","sel","fold","boot","types","err"]}]}
```

**Decisions behind it.**

- `Q3` Object literals (b): a base, parts typed against it and a module literal; no builder chain.
- `Q59` A generated manifest (b): a file's path is its reference; moving it is a breaking change.
- `Q2` Hard dependencies stay (a): switching a module off switches off its dependants.
- `Q32` The Maybe accessor (b): confirmed by the M0 spike on 2026-11-04 against `| undefined` (same cost); a short named type per module keeps its error messages short.
- `Q31` The `Check` property form (a): errors read as a missing property with a literal type; confirmed by the M0 spike.
- `Q58` Kebab-case file names from the export (a): `syncPreview` lives in `sync-preview.ts`.

**Read more.** Sections 4.1, 4.5, 4.7, 5.1 to 5.6 and 23.5; ADRs 0003 and 0024.

### 3. Entities and the chain

**In one sentence.** An entity is one module's field-model literal, stored by default as a hash-chained event stream per row: changes keep before-images, rows read as of any instant, and erasure destroys keys, not history.

**How it works.** `defineEntity({ prefix, dataSubject, fields, relations, indexes, history, tenancy, events, evolve, invariant, generated })`; the `field.*` builders yield the type, validator, JSON Schema, GraphQL types and columns. Every row gets `id` (UUIDv7), `createdAt`, `updatedAt`, `archivedAt`, `version` and a `tenantId` no transport exposes. `history: 'chain'` is the default; `state` (sessions, presence) is an opt-out with a reason that writes transient change records instead. Each change is an event in `kw_events`: `data`, `before` (previous values of the changed fields), the envelope (actor, command, decision record) and `hash = SHA-256(prevHash ‖ JCS(content))`. Deleting is an `archived` event that `restored` undoes. Generated `get` and the opt-in `history` take `asOf`, the fold of the stream up to that instant. Nothing is removed until the operator adopts a rule; `compactHistory` folds old events into a `snapshot`, and an earlier `asOf` answers `core.history_compacted`. Each scope's head (position, hash) is anchored to the ledger sinks, by default each notifier batch, at most once a second; `keelwerk db verify` checks against them. `.personal()` values are sealed with AES-256-GCM under the data subject's key, in events and state columns alike; queries reach them only through declared capabilities: an HMAC blind index for equality, prefix tags, trigram tags, order tokens from M5. Erasure writes the ledger, shreds the subject's keys and appends `erased` events; every hash still verifies.

**Example.** A Trail device and its stream (illustrative; Trail's own design is made in its repository):

```ts
export const device = defineEntity({
  prefix: 'dev',
  dataSubject: 'owner',
  fields: {
    owner: field.subject().index(),
    name: field.string({ maxLength: 80 }).personal({ queries: ['eq'] }), // sealed; NFC blind index
    ingestToken: field.verifier(),                                       // Overland's token, own value key
    lastSeenAt: field.instant().optional(),
  },
})                                                                       // history 'chain', tenancy 'tenant': defaults
// tracking.device/dev_01j…   version, position, event, data → before
// v1  1041  created  { values: { owner, name: { $kwe: 1, k, n, c }, ingestToken: sealed } } → null
// v2  2210  changed  { set: { name: $kwe… } } → { name: $kwe… }
// v3  3307  changed  { set: { ingestToken: sealed } } → none; old value key destroyed
// get { ids: ['dev_01j…'], asOf: '2026-09-01T12:00:00Z' } → the row folded to v1
// core.subjects.erase(owner) → v4 erased; history reads { redacted: true }; db verify passes
```

**Diagram.**

```diagram
{"title":"One change on a chain entity",
"nodes":[
{"id":"draft","label":"Draft from decide","kind":"box"},
{"id":"evolve","label":"Evolve and diff","kind":"box"},
{"id":"seal","label":"Seal personal values","kind":"box"},
{"id":"keys","label":"Subject key store","kind":"store"},
{"id":"hash","label":"Hash chain link","kind":"box"},
{"id":"events","label":"kw_events stream","kind":"store"},
{"id":"state","label":"State table row","kind":"store"},
{"id":"tags","label":"Index tags","kind":"store"},
{"id":"ledger","label":"Ledger sink anchors","kind":"store"},
{"id":"asof","label":"asOf read","kind":"box"},
{"id":"erase","label":"core.subjects.erase","kind":"actor"},
{"id":"compact","label":"compactHistory rule","kind":"note"}],
"edges":[
{"from":"draft","to":"evolve","label":"event proposal"},
{"from":"evolve","to":"seal","label":"data and before"},
{"from":"keys","to":"seal","label":"subject key"},
{"from":"seal","to":"hash","label":"ciphertext content"},
{"from":"hash","to":"events","label":"append, expected version"},
{"from":"events","to":"state","label":"inline projection"},
{"from":"seal","to":"tags","label":"declared capabilities"},
{"from":"events","to":"ledger","label":"scope head anchored"},
{"from":"events","to":"asof","label":"fold to instant"},
{"from":"erase","to":"keys","label":"shreds keys"},
{"from":"erase","to":"events","label":"appends erased"},
{"from":"compact","to":"events","label":"snapshot replaces prefix"}],
"groups":[
{"label":"One unit","nodes":["draft","evolve","seal","hash","events","state","tags"]}]}
```

**Decisions behind it.**

- `Q29` `chain` by default (a); `state` is an opt-out with a reason.
- `Q10` Before-images in every event from M1 (a).
- `Q8` `asOf` reads and buffer defaults (a); compaction needs an adopted rule.
- `Q47` Keep everything (c); only runtime artefacts are reclaimed.
- `Q35` Anchors from M1 (b), holding position and hash only (Q89a).
- `Q7` Personal fields encrypted in the state tables too (b).
- `Q71` Bounded scans in custom queries only (a); related: blind indexes only where declared (Q65a), NFC (Q66a), order tokens from M5 (Q69a), 12-bit trigrams (Q72a).

**Read more.** Sections 4.2, 6.2 to 6.7, 14.7, 14.7.9 and 15.1; ADRs 0002, 0007, 0009 and 0027.

### 4. Actions and pure handlers

**In one sentence.** Every behaviour is a query, command or subscription with a pure handler: it yields typed requests and returns events, effect descriptions and a result; the kernel performs and records every effect.

**How it works.** A query's `read` returns a query description or the output; a command's `decide` returns events or `{ events, effects, result }`; a subscription's `source` returns a live source description. On an entity, `decide(input, current, ctx)` gets the full current row. Generators yield requests with `yield*`: `ctx.load.<module>.<entity>.byId`, `ctx.newId`, `ctx.secrets.issue`, `ctx.compute.argon2idVerify`, `ctx.ask`, `ctx.all`; promises are type errors, and lint bans clocks, randomness and `fetch` in parts. `ctx.clock.now()` is fixed per invocation; ids and random values are recorded. A command runs in phases: admission; `prepare` (sync commands only, the one place for inline effects: at most 30 seconds, no retries); the unit with its pending receipt; target; decide; apply (evolve, seal, item check, chain, inline reactions, kernel effects: `invoke`, `enqueue`, `setTimer`); commit, repeated up to three times on conflicts; respond. After commit, each external effect, recorded `requested` in the unit, runs at least once in an effect executor (the only imperative module code: no data access, egress only, effect id as idempotency key) or at an external performer, is recorded `settled`, and its `continueWith` continuation receives `outcomeOf(effect)`. The logbook is the chain: decision records (part, input digest, load positions, answers, effect ids) plus `core.effect` streams; `keelwerk explain --trace` prints it, `--redecide` replays a decision. Tests answer requests as data, without mocks.

**Example.** Launchway hands a deployment to a node's agent, an external performer (decision 80a, section 7.9.8); logbook positions and ids are illustrative:

```ts
export const run = defineCommand(deploymentsBase, deployment, {
  *decide(_input, current, ctx) {
    const node = yield* ctx.load.nodes.node.byId(current.nodeId)
    if (current.status !== 'queued' || node?.status !== 'online') return []
    return {
      events: [ctx.events.dispatched({ at: ctx.clock.now() })],
      effects: [ctx.services.nodes.send(current.nodeId, { type: 'deploy', payload: { deploymentId: current.id } }, { continueWith: dispatchSettled, with: { id: current.id }, deadline: '60s' })],
    }
  },
})
export const dispatchSettled = defineCommand(deploymentsBase, deployment, {   // runs as deployments.system
  input: outcomeOf(agentCommand),
  decide: (input, current, ctx) =>
    input.outcome.ok && input.outcome.value.accepted ? []
      : current.retryCount < 3 ? [ctx.events.requeued({ reason: 'dispatch', at: ctx.clock.now() })]
      : [ctx.events.failed({ reason: 'lost', at: ctx.clock.now() })],
})
// logbook: dispatched + meta.decision { part, reads: [{ at: 8812 }], effects: [e1] }; core.effect/e1 requested
// agent: e1 arrives on nodes.channel; nodes.ack returns settle(e1); settled → dispatchSettled
```

**Diagram.**

```diagram
{"title":"The interpreter around a pure decide",
"nodes":[
{"id":"inv","label":"Invoker pipeline","kind":"box"},
{"id":"prep","label":"prepare, sync only","kind":"box"},
{"id":"dec","label":"decide generator","kind":"box"},
{"id":"interp","label":"Kernel interpreter","kind":"box"},
{"id":"data","label":"Unit on namespace","kind":"store"},
{"id":"apply","label":"Apply decision","kind":"box"},
{"id":"log","label":"Events with decision record","kind":"store"},
{"id":"eff","label":"core.effect stream","kind":"store"},
{"id":"exec","label":"Effect executor","kind":"box"},
{"id":"perf","label":"External performer","kind":"actor"},
{"id":"cont","label":"Continuation command","kind":"box"}],
"edges":[
{"from":"inv","to":"prep","label":"inline effects, recorded"},
{"from":"prep","to":"dec","label":"ctx.prepared"},
{"from":"dec","to":"interp","label":"yield* request"},
{"from":"interp","to":"dec","label":"typed answer"},
{"from":"interp","to":"data","label":"load at position"},
{"from":"dec","to":"apply","label":"events, effects, result"},
{"from":"apply","to":"log","label":"append, hash"},
{"from":"apply","to":"eff","label":"requested"},
{"from":"eff","to":"exec","label":"effect job"},
{"from":"eff","to":"perf","label":"pending effects subscription"},
{"from":"exec","to":"eff","label":"settled outcome"},
{"from":"perf","to":"eff","label":"settle via action"},
{"from":"eff","to":"cont","label":"continueWith: outcomeOf"},
{"from":"cont","to":"inv","label":"module service principal"}],
"groups":[
{"label":"Inside the unit","nodes":["dec","interp","data","apply","log"]},
{"label":"After commit","nodes":["exec","perf","cont"]}]}
```

**Decisions behind it.**

- `Q50` Fully strict (a), kept when reopened on 2026-10-28; fallback: the split model (c).
- `Q73` Generators with `yield*` (a); `ctx.all` batches parallel loads.
- `Q74` Inline effects only in `prepare` (a); M0 and Trail also test a variant without `prepare`.
- `Q75` Executors retry mechanical failures only (a); domain answers are state machines.
- `Q76` Write-only `ctx.log` and `ctx.trace` (a), outside the logbook.
- `Q77` Fixed clock per invocation (a); ids and random values recorded.
- `Q78` Effect records in the chain (a): hashed `core.effect` streams.
- `Q79` Inputs as a digest (b); sealed only with `trace: { input: 'sealed' }`.

**Read more.** Sections 4.3, 7.1 to 7.9 and 9.5; ADRs 0004, 0015 and 0026.

### 5. Authorization

**In one sentence.** Typed allow and deny rules, one per file, with a `where` over the row acted on and an optional `check` over the row produced, are evaluated only at the invoked action; tenant isolation sits below them all.

**How it works.** `defineRule(base, target, { effect, actions, principal, where, check, when, fields, reason })` lives in `policies/<target>/<rule>.ts`; the path gives its id (`deployments.deployment.assigned-node`). All selected modules' rules form one set: allows are OR-ed, denies override, the default is deny, and a deny needs a reason. A read needs an allow whose `where` matches the row and no matching deny; an update needs an allow whose `where` selects the pre-image and whose `check`, if present, holds on the post-image. Conditions are one AST, compiled to queries and interpreted in memory; a `null` operand never matches. `fields` reveals `.maskable()` fields on reads and bounds what a write may change. The invoker runs five stages: gate (principal kind, scope level, action rules), plan (`always`, `never` or `conditional { where, check, fields }`), target (`not_found` outside the plan), item check (post-image and invariant) and shape, which re-checks every entity row leaving the invoker against the caller's read plan: an error in development, a dropped, logged row in production. Inside the handler, `ctx.load` sees the truth with module authority; `.forCaller()` and `ctx.target` give the caller's view. Principals are anonymous, user, service, operator or system; reactions run as `<module>.system`. Tenant isolation is no rule: the data layer's scope predicate comes first, and the operator enters a tenant only through the logged `core.tenant.enter`.

**Example.** Launchway: an agent reports only on its own node's deployments; only admins archive projects (section 17.3.11; the scenario is illustrative).

```ts
// modules/deployments/src/policies/deployment/assigned-node.ts
export const assignedNode = defineRule(deploymentsBase, deployment, {
  effect: 'allow',
  actions: ['reportPhase', 'reportResult', 'reportRuntime', 'appendLog'],
  principal: 'service',
  where: (ctx) => (ctx.principal.via === 'nodes.credential' ? { nodeId: ctx.principal.idAs('nodes.node') } : false),
  reason: 'A node reports only on deployments assigned to it.',
})
// modules/projects/src/policies/project/archive.ts
export const archive = defineRule(projectsBase, project, {
  effect: 'allow',
  actions: ['archive', 'restore'],
  principal: 'user',
  where: (ctx) => hasRole(ctx, 'admin', 'owner'),
})
// node A's agent calls deployments.deployment.reportPhase for dep_B, which runs on node B:
//   gate: allowed (service principal, tenant scope); plan: conditional { where: { nodeId: <node A> } }
//   target: dep_B is outside the plan, so not_found, and its existence stays undisclosed
// a member archiving a project matches no allow rule: denied by default
```

**Diagram.**

```diagram
{"title":"Authorization stages in the invoker",
"nodes":[
{"id":"caller","label":"Caller principal","kind":"actor"},
{"id":"rules","label":"Rule files, one set","kind":"store"},
{"id":"gate","label":"Gate","kind":"box"},
{"id":"plan","label":"Plan: where, check, fields","kind":"box"},
{"id":"target","label":"Target selection","kind":"box"},
{"id":"dec","label":"decide, module authority","kind":"box"},
{"id":"scope","label":"Scope predicate","kind":"box"},
{"id":"rows","label":"Tenant rows","kind":"store"},
{"id":"item","label":"Item check","kind":"box"},
{"id":"shape","label":"Shape: recheck, mask","kind":"box"},
{"id":"out","label":"Masked output","kind":"note"}],
"edges":[
{"from":"caller","to":"gate","label":"invokes action"},
{"from":"rules","to":"gate","label":"principal kinds, actions"},
{"from":"rules","to":"plan","label":"conditions compiled"},
{"from":"gate","to":"plan","label":"allowed"},
{"from":"plan","to":"target","label":"where on pre-image"},
{"from":"target","to":"dec","label":"full current row"},
{"from":"dec","to":"rows","label":"ctx.load, own authority"},
{"from":"scope","to":"rows","label":"applied before rules"},
{"from":"dec","to":"item","label":"post-image"},
{"from":"plan","to":"item","label":"check"},
{"from":"item","to":"shape","label":"commit"},
{"from":"plan","to":"shape","label":"read plan, fields"},
{"from":"shape","to":"out","label":"rows inside plan"}],
"groups":[
{"label":"Invoker","nodes":["gate","plan","target","dec","item","shape"]},
{"label":"Data layer","nodes":["scope","rows"]}]}
```

**Decisions behind it.**

- `Q4` Module authority with an explicit `forCaller()` (a), plus the shape-stage row check: development error, production drop and log.
- `Q5` Allow and deny rules (a): a deny requires a reason; the default is deny.
- `Q60` One rule per file (b): the file name is the rule id; `keelwerk explain` prints the file of each matched rule.
- `Q17` `keelwerk explain --as <principal>` (a): evaluates everywhere, executes only in development.

**Read more.** Sections 4.4, 8.1 to 8.8 and 17.3.11; ADR 0005.

### 6. Execution and multi-tenancy

**In one sentence.** Every request enters one invoker that resolves the scope first, applies the tenant's quotas, authorizes, and runs one unit on the tenant's namespace, synchronously or as a job; every commit feeds live subscribers.

**How it works.** `Invoker.open(carrier)` runs `resolveScope`, `resolvePrincipal` and `resolveVersion` once per request or connection. Scope comes from ordered resolvers: host name, scope key (a token's public id, a webhook path), header or path; an unknown one is `not_found`. Then come `locate` (`not_implemented` when the backend's app lacks the action), `admit` (token buckets, concurrency, suspensions), `validate`, `translate`, `authorize`, `prepare`, `execute`, `shape`, `translate` and `complete`. A unit is one transaction on one namespace for one scope; the tenant's placement (shared tables keyed by `tenant_id`, a schema or database per tenant, another adapter) gives the namespace, and the adapter adds the scope predicate to every statement, backed by PostgreSQL row-level security. Positions count per scope, so tenants never queue behind each other; work for another scope runs after commit through `enqueue`. The mode is the action's `execution`, overridable by the app's map for external callers, and for `either` by the caller's `prefer`. An async command is authorized, stored as an `accepted` receipt plus job in one unit and answered with its command id; the worker re-resolves the principal and re-authorizes. Jobs live in the namespace, in fair lanes per tenant and queue. The `live` module adds `watch` to every non-external entity: after commit, a reader per scope and process evaluates each distinct plan once per batch, masks and sends resumable frames.

**Example.** One GitHub release delivery to Launchway (sections 16.5.8 and 17.3.9; ids illustrative):

| Stage | `POST /hooks/github/gh_01j…` |
|---|---|
| carrier enricher | the path becomes the scope key `webhook-endpoint:github:gh_01j…` |
| `resolveScope` | backend `launchway`, Jens's tenant |
| `resolvePrincipal` | `github.webhookSignature` checks `X-Hub-Signature-256`: service principal `github.webhook` |
| `locate`, `admit` | `github.ingest` exists in the app; the tenant's token bucket has room |
| `authorize` | a rule allows `github.webhook` |
| `execute` | tenant unit: pending receipt keyed by `X-GitHub-Delivery`, `releasePublished` appended, commit at the scope's next position |
| `complete` | answered; a repeated delivery returns the recorded outcome |
| after commit | the reaction dispatcher enqueues `deployOnRelease` in the tenant's lane; it invokes `deployments.createAutomatic` with command id `release:<tag>` |
| live | the UI's `deployments.deployment.watch` receives `created`, token `v1.<epoch>.<position>.<scope>.<check>` |

**Diagram.**

```diagram
{"title":"One request through the pipeline",
"nodes":[
{"id":"carrier","label":"Transport carrier","kind":"actor"},
{"id":"scope","label":"resolveScope","kind":"box"},
{"id":"dir","label":"Scope directory","kind":"store"},
{"id":"princ","label":"Principal and version","kind":"box"},
{"id":"locate","label":"locate in app","kind":"box"},
{"id":"admit","label":"admit: quotas","kind":"box"},
{"id":"auth","label":"validate, authorize","kind":"box"},
{"id":"exec","label":"execute in unit","kind":"box"},
{"id":"ns","label":"Tenant namespace","kind":"store"},
{"id":"jobs","label":"Job lanes","kind":"store"},
{"id":"hub","label":"Live hub","kind":"box"},
{"id":"sub","label":"Subscriber","kind":"actor"}],
"edges":[
{"from":"carrier","to":"scope","label":"host, path, token"},
{"from":"dir","to":"scope","label":"scope key lookup"},
{"from":"scope","to":"princ","label":"session, once"},
{"from":"princ","to":"locate","label":"action reference"},
{"from":"locate","to":"admit","label":"app has action"},
{"from":"admit","to":"auth","label":"within quota"},
{"from":"auth","to":"exec","label":"sync command"},
{"from":"auth","to":"jobs","label":"async: receipt, job"},
{"from":"jobs","to":"exec","label":"worker re-authorizes"},
{"from":"exec","to":"ns","label":"scope predicate"},
{"from":"exec","to":"jobs","label":"jobs commit with unit"},
{"from":"ns","to":"hub","label":"commit wakes reader"},
{"from":"hub","to":"sub","label":"plan, mask, token"}],
"groups":[
{"label":"Invoker.open, once","nodes":["scope","princ"]},
{"label":"Per invocation","nodes":["locate","admit","auth","exec"]}]}
```

**Decisions behind it.**

- `Q1` The compiled catalogue (a): a backend references an app id, and `locate` refuses actions its app lacks.
- `Q6` The kernel queue over every adapter's job store (a): enqueue commits with the unit; fair lanes per tenant.
- `Q12` Datastore agnosticism (a): a tenant can sit on any adapter; what an adapter lacks is a kernel fallback with a reported cost.
- `Q52` Dated API versions (a), pinned per request, credential, tenant and backend, resolved in `resolveVersion`.

**Read more.** Sections 3.5, 9.1 to 9.7, 12.1 to 12.3, 14.2, 14.3.6, 14.4, 15.4 and 16.3.4; ADRs 0006, 0007, 0012, 0015 and 0025.
