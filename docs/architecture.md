# pennestack architecture

Date: 2026-10-08. Status: specification, first version. Author: lead architect for the core
(working with the parallel designers for data, interfaces and platforms).

This document is the design contract of the framework. [brief.md](brief.md) is the requirements
source of truth; this document says how those requirements are met and must not drop or
reinterpret any of them. Where it chooses between alternatives, an Architecture Decision Record
in [adr/](adr/) records why. The parallel documents [data.md](data.md), [interfaces.md](interfaces.md)
and [platforms.md](platforms.md) fill in the parts this document only outlines; they may refine
the interfaces defined here but may not contradict them without an ADR.

The research notes under [research/](research/) are the evidence base. Every library named here
was checked against the npm registry on 2026-10-08, by the research notes or again while writing
this document; the version in parentheses is the one that was checked.

Contents:

1. Principles
2. Glossary
3. Kernel
4. Configuration DSL
5. Modules
6. Entities
7. Actions
8. Authorization
9. Execution
10. Errors
11. Observability
12. Multi-tenancy and one deployment
13. Types and toolchain
14. Data layer (summary, see data.md)
15. Events, sync and live updates (summary, see data.md and interfaces.md)
16. Transports and CLI (summary, see interfaces.md)
17. Platforms (summary, see platforms.md)
18. Repository layout and package plan
19. How a new requirement lands
20. Requirements traceability
21. Open questions

## 1. Principles

1. **Definitions are values; everything else is derived.** An application is a TypeScript value
   built from module values, which are built from entity, action and policy values. Types are
   inferred from those values; schemas, documents, migrations and transports are generated from
   them. There is no second schema language and no decorator metadata.
2. **Selection is a value, and types follow it.** Which modules are part of an application is a
   `const` tuple. Every derived type (entities, actions, context) is computed from that tuple, so
   adding or removing a module changes the types at the same moment it changes the runtime.
   Declaration merging (`declare module`, `declare global`) is never used for anything that
   depends on the selection, because an augmentation applies whenever a file is compiled, not when
   a module is selected (research: module-systems.md, section 3.4).
3. **Hard dependencies are checked; soft influence is dropped silently.** A module `requires`
   what it cannot work without (compile-time and boot-time error when missing) and `contributes`
   to modules it merely enhances (ignored when the target is absent). This is what keeps the
   accounts and authentication modules independently toggleable while they influence each other.
4. **Actions are the only unit of behaviour.** Every read, write and subscription in the system
   is an action with a declared input, output, error set, execution mode and policy. Transports
   (GraphQL, REST, tRPC, CLI, JMAP, ...) are projections of the action registry onto a wire
   format; they never contain behaviour, never evaluate policies and never touch the data layer.
5. **Every action runs under a principal and inside a scope.** There is no unauthenticated,
   unscoped code path. Internal calls use an explicit `system` principal that is logged. Tenant
   isolation is applied by the kernel and the data layer before any policy runs, so a policy
   mistake cannot cross a tenant boundary.
6. **Composition is order-independent.** Rules from several modules are a set: allow rules are
   OR-ed, deny rules override, the default is deny. Contributions are a set keyed by module id.
   Nothing depends on the position of a module in the tuple except deterministic tie-breaking of
   lifecycle order.
7. **Fail closed.** A condition an adapter cannot express, a missing requirement, a drifted
   schema, an action whose module is disabled for a backend: each is an error, never a wider
   filter, a loose type or a silent no-op.
8. **Nothing is deleted; everything is appended.** Live entities are an append-only event chain
   with a materialised current state. Deletion is an archive event that a restore event can
   undo. Erasure of personal data is crypto-shredding, which keeps the chain intact.
9. **The kernel stays small.** New requirements land as modules, adapters, policies or
   configuration. The kernel exposes extension points so that even transports and data adapters
   are modules. A kernel change requires an ADR.
10. **The compiler is the judge.** `tsc`, Biome and the test runner must see the same types the
    editor sees, with no language-service plugin and no generator in the type path. One
    generated file exists for convenience and is checked for drift in CI.

## 2. Glossary

| Term | Meaning |
|---|---|
| **Deployment** | One running installation of pennestack: one build, one or more processes, possibly on several nodes, sharing one control store. |
| **App** | A compile-time composition of modules: `defineApp({ id, modules: [...] })`. Its types are exact for that selection. The deployment platform and the mail server are two apps. |
| **Backend** | A runtime instance of an app inside a deployment, created at runtime without a redeploy: a name, the app it runs, its configuration, secrets, domains, quotas and tenants. Several backends may run the same app. |
| **Tenant** | An isolation unit inside a backend (a company, an organisation, an app, whatever the backend calls it). Data, authentication realm, configuration, secrets, domains and quotas are per tenant. |
| **Scope** | The pair (backend, tenant) an invocation runs in, or the backend level, or the deployment level. Every action declares the level it accepts. |
| **Operator** | The person administering the deployment (Jens). A principal kind with deployment scope. |
| **Principal** | Who is acting: anonymous, user, service, operator or system, with an id, the scope it belongs to, claims and memberships. |
| **Module** | A unit of composition with a string id. Owns entities, actions, policies, services, reactions and extension points; declares requirements, optional dependencies, contributions and conditional parts. |
| **Entity** | A data structure owned by a module: fields, relations, indexes, events and the actions mounted on it. |
| **Field** | A typed column declared with the `field.*` builders. Emits a validator, a JSON Schema, a GraphQL type and a column definition. |
| **Action** | A named unit of behaviour mounted on an entity, a module or the app: a `query`, a `command` or a `subscription`. |
| **Action reference** | The dotted path of an action: `accounts.profile.deactivate`, `auth.login`, `app.health`. |
| **Contribution** | Fields, relations, actions, policies or extension-point values a module adds to another module, active only when the target (and any extra `when` modules) are selected. |
| **Conditional part** | Fields, actions, reactions or policies a module adds to itself only when other modules are selected. |
| **Extension point** | A typed slot a module declares so that other modules can fill it without the owner importing them. The kernel's extension points are how transports, data adapters, listeners and resolvers plug in. |
| **Policy** | A set of rules for an entity's or a module's actions: allow or deny, with a condition and a field mask. |
| **Condition** | A serialisable, typed filter AST over an entity's fields and relations, shared by authorization, the data layer and the live feed. |
| **Registry** | The runtime index built by `defineApp`: modules, entities, actions, policies, extension points, keyed by ids and references. |
| **Invoker** | The one in-process entry point that runs an action through the pipeline. Transports call it; so do the CLI, tests and modules calling each other. |
| **Carrier** | The transport-neutral description of where a request came from (host, path, headers, token, connection), used for scope and principal resolution. |
| **Chain** | The append-only event log of an entity instance; "the chain" of the brief. |
| **Control store** | The deployment-level database that holds backends, tenants, domains, placements and migration history. |
| **Placement** | Where a tenant's data lives: an adapter binding plus a strategy (shared tables with a tenant key, a schema per tenant, a database per tenant, a different adapter). |

## 3. Kernel

### 3.1 What the runtime is

The kernel is the `@pennestack/core` package. It contains no transport, no database driver and
no business module. It provides:

- the configuration DSL (section 4) and the registry it builds;
- the invoker and the request pipeline (section 9);
- the authorization engine (section 8);
- the condition AST, the pagination model and the error taxonomy shared by every other package;
- the lifecycle, the scope and principal model, and the extension points through which
  transports, data adapters, listeners, queues, event stores and resolvers are plugged in;
- the implicit `core` module, which owns the control entities (backends, tenants, domains,
  placements, command receipts) and the operator actions.

Everything else is a module or an adapter in its own package. The two proof apps are compositions
of such packages (section 17).

### 3.2 Process model

- One deployment runs one build. Every process of the deployment loads the same deployment
  definition (`defineDeployment`, section 4.6), which lists the apps it can run.
- A process has a role: `serve` (runs listeners and transports), `work` (runs queues,
  projections and reactions marked asynchronous), or `all` (both; the development default).
  Roles are a start-up flag, not a different build.
- Processes share no memory. Coordination goes through the control store and the job queue, so
  any number of processes on any number of nodes can run the same role.
- A process serves every backend of the deployment. Which backends exist, which app each runs,
  and which tenants and domains they have, is read from the control store and cached with a
  change feed; creating a backend or a tenant does not restart anything.
- Listeners are not only HTTP. A listener is an extension point value (section 5.6) with its own
  carrier description; the SMTP listener of the mail app and the HTTP host are peers.

### 3.3 Lifecycle

The lifecycle is explicit and the same for every module. Phases run in this order:

| Phase | Who runs | What happens |
|---|---|---|
| `compose` | `defineApp`, pure | Validates the module tuple at the type level and again at runtime (missing requirements, duplicate ids, conflicting contributions, dangling references), orders modules topologically by `requires` with tuple order as tie-break, applies contributions and conditional parts, builds the registry. No I/O. |
| `setup` | Each module, in order | Receives the final registry and its own resolved definition; may register derived artefacts (projections, indexes, cron schedules). Runs before any adapter connects. |
| `connect` | Kernel | Opens the control store, then the placements the enabled backends need. Validates adapter capabilities against what the selected modules require (section 14). |
| `migrate` | Kernel | In development: plans and applies the schema diff per placement, confirming destructive steps. In production: verifies that the applied history matches the committed migration files and refuses to start on drift. |
| `start` | Each module, in order | Starts background work (queue consumers, projections, schedulers). Runs after data is available and before any listener accepts traffic. |
| `listen` | Kernel | Mounts transports on the hosts and opens listeners. The process reports ready. |
| `stop` | Reverse order | Listeners stop accepting, in-flight invocations drain within a deadline, modules stop in reverse order, adapters close. |

Two runtime hooks exist beside the process lifecycle, because backends and tenants are created
while the process runs: `onBackendCreated(backend)` and `onTenantCreated(tenant)` (and their
`...Retired` counterparts). A module uses them to provision per-tenant data (a mailbox root, a
default team), never to run migrations: tenant creation is a data operation, the schema is already
there.

### 3.4 Wiring: explicit, no container

There is no dependency-injection container, no decorators and no reflection. A module's code
reaches what it needs through the typed **context** (section 7.6):

- `ctx.data.<module>.<entity>`: repositories for its own entities, those of modules it
  `requires` (typed as present), and those of modules it lists as `optional` (typed as possibly
  undefined);
- `ctx.services.<module>.<name>`: service functions a module exposes to its dependants, same
  presence rules;
- `ctx.extensions.<name>`: the values other modules contributed to this module's extension
  points;
- `ctx.invoke(ref, input)`: any action of the app, through the invoker, under the current
  principal.

The presence rules are computed from the module's own `requires` and `optional` lists, so a
handler cannot reference a module it never declared. Decorators are also excluded by the
toolchain: sources run under Node's type stripping, which allows only erasable syntax
(section 13).

### 3.5 Multi-tenancy in the kernel

Every invocation carries a `Scope` resolved before anything else runs (section 9.2). The kernel
owns the control entities, the scope levels on actions, the tenant and principal resolver
extension points, and the admission stage that applies per-tenant quotas. The operator principal
is resolved by the kernel itself from a deployment secret or the local CLI socket, so the
deployment can be administered even when no authentication module is enabled. Section 12
collects what each layer does.

## 4. Configuration DSL

The DSL is a set of plain functions exported by `@pennestack/core`. Each returns the value it was
given, narrowed to literal types, so that later functions can compute over it. Nothing in the DSL
performs I/O; `defineApp` builds a registry, `defineDeployment` describes where it runs.

### 4.1 `defineModule`

A module is built in steps. The first call fixes identity, dependencies and configuration; each
later call adds a part and returns a module value that already works as a module. The steps
after the first can be omitted or reordered, except that `entities` must precede the steps whose
callbacks are typed against entities.

```ts
import { defineModule, defineEntity, field, shape } from '@pennestack/core'
import { accounts } from '@pennestack/module-accounts'

export const auth = defineModule({
  id: 'auth',                       // literal; permanent; [a-z][a-z0-9-]*; `core` and `app` are reserved
  version: '0.1.0',                 // informational; the id is the identity
  requires: [],                     // hard dependencies: module values; compile-time and boot-time checked
  optional: [accounts],             // soft dependencies: typed as possibly undefined in the context
  config: shape({                   // per-backend configuration, validated when a backend is created
    sessionTtlSeconds: field.integer().default(86_400),
  }),
  extensionPoints: {                // typed slots other modules may fill (section 5.5)
    identityProviders: extensionPoint<IdentityProvider>({ mode: 'set' }),
  },
})
  .entities({ credential, session })                    // section 4.2
  .actions((b) => ({ login: b.command({ /* ... */ }) }))   // module-level actions, section 4.3
  .entityActions('credential', (e) => ({ revoke: e.command({ /* ... */ }) }))
  .policies((rule) => [ /* ... */ ])                    // section 4.4
  .reactions((r) => [ /* ... */ ])                      // event handlers, section 7.7
  .services((s) => ({ /* ... */ }))                     // typed functions for dependants
  .contributes((c) => [c.to(accounts, { /* ... */ })])  // section 5.3
  .conditional((w) => [w.when([accounts], { /* ... */ })]) // section 5.4
  .lifecycle({ setup, start, stop, onTenantCreated })   // section 3.3
```

Why a builder: the callbacks receive builders whose handler parameters are already typed with
the module's context (`ctx.data`, `ctx.services`, entity rows), which a single object literal
cannot do because TypeScript cannot type a property from its siblings. The builder's accumulated
state is a plain object with the normalised shape of section 4.7; `defineApp` only ever sees that
shape. The chain must be unbroken for the accumulated type to survive, as with Hono and Elysia
(research: module-systems.md, section 3.1).

### 4.2 `defineEntity` and the field model

```ts
export const credential = defineEntity({
  prefix: 'cred',                              // TypeID prefix at the API boundary: cred_01j...
  fields: {
    subject: field.string().index(),           // what the credential authenticates (an opaque subject id)
    kind: field.enum(['password', 'passkey', 'apiKey']),
    secretHash: field.string().hidden(),       // never readable through any transport
    email: field.string().unique().personal(), // crypto-shredded on erasure; unique implies merge 'exclusive'
    revokedAt: field.instant().optional(),
    label: field.string().optional().merge('lww'),
  },
  relations: {},                               // reverse relations are added by contributions, see 6.3
  indexes: [{ fields: ['subject', 'kind'] }],
  history: 'chain',                            // default: append-only events plus materialised state
  tenancy: 'tenant',                           // default; 'backend' or 'deployment' for control data
  events: {                                    // domain events beyond the generated changed/archived/restored
    revoked: shape({ at: field.instant(), reason: field.string().optional() }),
  },
  evolve: {                                    // how a domain event changes the state (pure)
    revoked: (state, e) => ({ ...state, revokedAt: e.at }),
  },
  generated: { set: true, get: true, query: true, changes: true, queryChanges: true }, // defaults
})
```

Every entity gets system fields the author never declares: `id` (UUIDv7, prefixed at the API),
`createdAt`, `updatedAt`, `archivedAt` (nullable; the tombstone), `version` (the chain position,
used for optimistic concurrency and JMAP state strings) and, when `tenancy` is `tenant`, a
`tenantId` that no transport exposes and the data layer always filters on.

The `field.*` builders are the single source for types, validation, JSON Schema, GraphQL types
and columns. The core defines the kinds and the modifiers; the data designer maps them to
dialects (section 14).

| Builder | TypeScript type | Notes |
|---|---|---|
| `field.string()`, `field.text()` | `string` | `maxLength`, `pattern`, `format` ('email', 'uri', 'hostname') |
| `field.integer()`, `field.decimal()` | `number` (`bigint` for `integer({ wide: true })`) | `min`, `max` |
| `field.boolean()` | `boolean` | |
| `field.instant()` | `Date` now; `Temporal.Instant` once Node 26 is the baseline | UTC only; ISO 8601 at the boundary |
| `field.date()` | `string` (ISO calendar date) | wall-clock meaning; pair with a `field.timeZone()` where needed |
| `field.enum([...])` | union of the literals | |
| `field.json(schema)` | the schema's output type | any Standard Schema; stored as JSON |
| `field.ref(module, entity)`, `field.ref.own(entity)` | `Id<'module.entity'>` | a typed reference; a foreign key only towards hard dependencies (6.3); `own` for an entity of the module being defined |
| `field.set(inner)` | `ReadonlySet<T>` | observed-remove set when merge is `set` |
| `field.list(inner)` | `readonly T[]` | merge `sequence` uses a CRDT list |
| `field.richText()` | an opaque document handle | merge `richText`; backing library decided in data.md |
| `field.binary()` | `Uint8Array` | blobs; large payloads go to a blob store module |
| `field.secret()` | `string` on write, never readable | resolved through the secrets extension point |

Modifiers, all chainable and all reflected in the type: `.optional()`, `.default(value)`,
`.unique()`, `.index()`, `.hidden()` (excluded from every read mask), `.personal()`
(crypto-shredded, section 15), `.merge(type)` (section 15; default `lww` for scalars, `exclusive`
for unique fields), `.tag(n)` (a stable protobuf-style field number; allocated deterministically
and recorded in the module snapshot when omitted), `.describe(text)`.

`shape({ ... })` builds an object schema from fields for action inputs and outputs. It is a
Standard Schema (section 6.5), so any library that accepts Standard Schema accepts it, and it is
walkable, so transports can project it exactly.

### 4.3 Actions

Actions are created by the builders handed to `.actions()` and `.entityActions()`. The same
builders exist as standalone functions (`defineAction`) for actions mounted on the app.

```ts
.entityActions('credential', (e) => ({
  revoke: e.command({
    input: shape({ reason: field.string().optional() }),
    errors: [alreadyRevoked],                              // closed set, section 10
    execution: 'sync',                                     // 'sync' | 'async' | 'either'
    idempotent: false,
    scope: 'tenant',                                       // default
    decide: (input, current, ctx) => {                     // pure: state in, events out
      if (current.revokedAt) throw alreadyRevoked({ id: current.id })
      return [e.events.revoked({ at: ctx.clock.now(), reason: input.reason })]
    },
    // output defaults to the entity row after the events are applied
  }),
  active: e.query({
    input: shape({ subject: field.string() }),
    output: e.page(),                                      // a page of rows, cursor pagination
    handle: (input, ctx) => ctx.data.auth.credential.query({
      where: { subject: input.subject, revokedAt: null },
      sort: [{ field: 'createdAt', direction: 'desc' }],
    }),
  }),
}))

.actions((b) => ({
  login: b.command({
    input: shape({ email: field.string({ format: 'email' }), password: field.string() }),
    output: shape({ sessionId: field.ref.own('session'), expiresAt: field.instant() }),
    errors: [invalidCredentials],
    auth: { public: true },                                // no principal required; still scoped to a tenant
    execution: 'sync',
    handle: async (input, ctx) => { /* ... */ },
  }),
  whoami: b.query({ output: principalShape, handle: (_, ctx) => ctx.principal }),
  sessionEvents: b.subscription({
    event: shape({ sessionId: field.string(), kind: field.enum(['created', 'revoked']) }),
    source: (_, ctx) => ctx.live.entity('auth', 'session', { where: { subject: ctx.principal.subjectId } }),
  }),
}))
```

`handle` is the imperative form (runs inside a transaction for commands; reads through `ctx.data`
for queries). `decide` is the pure form for commands on chain-backed entities: it receives the
current state, returns events, and the kernel appends them, evolves the state and returns it.
Section 7 defines the full option set.

### 4.4 Policies

```ts
.policies((rule) => [
  rule.allow('credential', ['get', 'query'], {
    id: 'self',                                             // becomes auth.credential.self
    where: (ctx) => ({ subject: ctx.principal.subjectId }), // typed Condition over credential
    fields: ['id', 'kind', 'email', 'label', 'revokedAt', 'createdAt'],
    reason: 'A user may see their own credentials.',
  }),
  rule.allow('credential', ['revoke'], { where: (ctx) => ({ subject: ctx.principal.subjectId }) }),
  rule.deny('credential', ['revoke'], { where: () => ({ revokedAt: { ne: null } }), reason: 'Already revoked.' }),
  rule.allow('login', { public: true }),                    // module-level action
  rule.allow('whoami', { when: (ctx) => ctx.principal.kind !== 'anonymous' }),
])
```

Entity rules carry a `where` condition compiled to the data layer and interpreted in memory;
module-level rules carry a `when` predicate over context and input. Semantics and composition are
in section 8. A contribution can add rules to another module's entities (section 5.3).

### 4.5 `defineApp`

```ts
import { defineApp } from '@pennestack/core'
import { accounts } from '@pennestack/module-accounts'
import { auth } from '@pennestack/module-auth'
import { graphql } from '@pennestack/transport-graphql'
import { rest } from '@pennestack/transport-rest'
import { postgres } from '@pennestack/adapter-postgres'

export const launchway = defineApp({
  id: 'launchway',
  modules: [accounts, auth, projects, deployments, postgres, graphql, rest],   // const tuple; order is a tie-break only
  actions: (b) => ({ health: b.query({ /* app-level, referenced as app.health */ }) }),
  execution: { 'deployments.deployment.run': 'async' },  // per-app override of an action's execution mode
  authorization: { mode: 'strict', decisionLog: 'denials' },
  policies: { disable: [], add: [] },                      // per-app rule overrides, section 8.7
})

export type Launchway = typeof launchway
export type Profile = AppEntities<Launchway>['accounts']['profile']   // exact for this selection
```

`defineApp` is uncallable when the tuple is inconsistent; the error names the problem
(`missingModules: 'accounts'`, `conflictingFields: 'accounts.profile.lastLoginAt'`, ...). The
checks are listed in section 4.7. At runtime it repeats the same checks (for dynamic callers and
JavaScript) and builds the registry.

### 4.6 `defineDeployment`

```ts
export default defineDeployment({
  apps: [launchway, mail],                                 // the catalogue a backend can be created from
  control: { adapter: 'postgres', url: env('PENNESTACK_CONTROL_URL') },
  placements: {                                            // where tenant data may live; chosen per tenant at creation
    default: { adapter: 'postgres', url: env('PENNESTACK_DATA_URL'), strategy: 'shared-tables' },
  },
  hosts: { http: { port: 3000 } },                         // listeners are opened by transports and listener modules
  tenantResolution: [byHostname(), byHeader('x-pennestack-tenant'), byToken()],
  operator: { secret: env('PENNESTACK_OPERATOR_SECRET') },
  telemetry: { otlp: env('OTEL_EXPORTER_OTLP_ENDPOINT') },
})
```

A deployment names the apps it can run; backends are rows in the control store that reference an
app id. Creating a backend with a module selection that no app in the catalogue has means adding a
`defineApp` line and deploying, which is a configuration change, not a kernel change. The
alternative, selecting modules at runtime, cannot have exact types and is rejected (ADR 0003).

### 4.7 The type-level model

The derived types operate on the normalised module shape below, which is what the builder
accumulates. The listing is the complete model as checked on 2026-10-08 with TypeScript 5.9.3 and
7.0.2 (`--strict --exactOptionalPropertyTypes --noUncheckedIndexedAccess`), including nine
positive and negative cases; the whole file costs 18,656 type instantiations, against a checker
limit of 5,000,000 per statement. The spike must keep these properties:

- every lookup is a mapped type over the union of module ids plus `Extract` by id; there is no
  recursion over the tuple, so depth is constant in the number of modules;
- contributions are a union of objects filtered by `to` and `when`, not a tuple walk;
- a module literal without a key (`requires`, `contributes`) contributes nothing, which needs the
  distributive `infer` form (`Ms[number] extends infer M ? M extends { ... } ? ... : never : never`);
- every public derived type is named and wrapped in `Prettify`, so hovers show rows, not
  conditionals;
- a single `any` in a module definition would collapse `UnionToIntersection`; module packages
  compile with `noImplicitAny` and a type test asserts that `AnyModule` constraints never
  mention `any`.

```ts
// Helpers
type Prettify<T> = { [K in keyof T]: T[K] } & {}
type UnionToIntersection<U> = (U extends unknown ? (x: U) => void : never) extends (x: infer I) => void ? I : never
type IsUnion<T, U = T> = [T] extends [never] ? false : T extends unknown ? ([U] extends [T] ? false : true) : never
type AllKeys<U> = U extends unknown ? keyof U : never
type TypeAt<U, K extends PropertyKey> = U extends unknown ? (K extends keyof U ? U[K] : never) : never

// Field model (minimal form; the real FieldDef carries kind, modifiers and the projections)
declare const valueType: unique symbol
interface FieldDef<T, Opt extends boolean = false> {
  readonly kind: string
  readonly isOptional: Opt
  readonly [valueType]?: T
  readonly ref?: { readonly module: string; readonly entity: string }
  optional(): FieldDef<T, true>
}
type AnyField = FieldDef<unknown, boolean>
type FieldValue<F> = F extends FieldDef<infer T, infer O> ? (O extends true ? T | undefined : T) : never
type RequiredKeys<F> = { [K in keyof F]: F[K] extends FieldDef<unknown, true> ? never : K }[keyof F]
type OptionalKeys<F> = { [K in keyof F]: F[K] extends FieldDef<unknown, true> ? K : never }[keyof F]
type RowOf<F> = Prettify<{ [K in RequiredKeys<F>]: FieldValue<F[K]> } & { [K in OptionalKeys<F>]?: FieldValue<F[K]> }>

// Normalised definitions (what the builder accumulates and defineApp consumes)
interface AnyAction { readonly kind: 'query' | 'command' | 'subscription' }
interface AnyEntity { readonly fields: Record<string, AnyField>; readonly actions?: Record<string, AnyAction> }
interface AnyEntityPatch { readonly fields?: Record<string, AnyField>; readonly actions?: Record<string, AnyAction> }
interface AnyContribution {
  readonly to: AnyModule
  readonly when?: readonly AnyModule[]
  readonly entities?: Record<string, AnyEntityPatch>
  readonly actions?: Record<string, AnyAction>
}
interface AnyConditional {
  readonly when: readonly AnyModule[]
  readonly entities?: Record<string, AnyEntityPatch>
  readonly actions?: Record<string, AnyAction>
}
interface AnyModule {
  readonly id: string
  readonly requires?: readonly AnyModule[]
  readonly optional?: readonly AnyModule[]
  readonly entities?: Record<string, AnyEntity>
  readonly actions?: Record<string, AnyAction>
  readonly contributes?: readonly AnyContribution[]
  readonly conditional?: readonly AnyConditional[]
}

declare function defineModule<const M extends AnyModule>(m: M): M
declare function contribute<const To extends AnyModule, const Spec extends Omit<AnyContribution, 'to'>>(to: To, spec: Spec): Prettify<{ readonly to: To } & Spec>
declare function whenPresent<const When extends readonly AnyModule[], const Spec extends Omit<AnyConditional, 'when'>>(when: When, spec: Spec): Prettify<{ readonly when: When } & Spec>

// Lookups over the selection, without recursion
type Ids<Ms extends readonly AnyModule[]> = Ms[number]['id']
type ById<Ms extends readonly AnyModule[], Id extends string> = Extract<Ms[number], { readonly id: Id }>
type EntityNames<M extends AnyModule> = M extends { entities: infer E } ? keyof E & string : never

/** true when every module in `W` is selected; `W` may be `never` (no condition). */
type Satisfied<Ms extends readonly AnyModule[], W> =
  [W] extends [readonly AnyModule[]] ? ([Exclude<W[number]['id'], Ids<Ms>>] extends [never] ? true : false) : true

type AllContributions<Ms extends readonly AnyModule[]> =
  Ms[number] extends infer M ? (M extends { contributes: readonly (infer C)[] } ? C : never) : never

/** Contributions whose target is selected and whose `when` list is satisfied. */
type ActiveContributions<Ms extends readonly AnyModule[]> =
  AllContributions<Ms> extends infer C
    ? C extends { to: { id: infer T extends string } }
      ? T extends Ids<Ms>
        ? Satisfied<Ms, C extends { when: infer W } ? W : never> extends true ? C : never
        : never
      : never
    : never

type ActiveConditionals<Ms extends readonly AnyModule[], M extends AnyModule> =
  M extends { conditional: readonly (infer Cd)[] }
    ? Cd extends { when: infer W } ? (Satisfied<Ms, W> extends true ? Cd : never) : never
    : never

// Entities
type OwnFields<M extends AnyModule, E extends string> =
  M extends { entities: { [K in E]: { fields: infer F } } } ? F : {}
type ConditionalFields<Ms extends readonly AnyModule[], M extends AnyModule, E extends string> =
  ActiveConditionals<Ms, M> extends infer Cd ? Cd extends { entities: { [K in E]: { fields: infer F } } } ? F : never : never
type ContributedFields<Ms extends readonly AnyModule[], Id extends string, E extends string> =
  ActiveContributions<Ms> extends infer C ? C extends { to: { id: Id }; entities: { [K in E]: { fields: infer F } } } ? F : never : never

type FieldSources<Ms extends readonly AnyModule[], Id extends string, E extends string> =
  OwnFields<ById<Ms, Id>, E> | ConditionalFields<Ms, ById<Ms, Id>, E> | ContributedFields<Ms, Id, E>

type EntityFields<Ms extends readonly AnyModule[], Id extends string, E extends string> =
  OwnFields<ById<Ms, Id>, E>
  & UnionToIntersection<ConditionalFields<Ms, ById<Ms, Id>, E>>
  & UnionToIntersection<ContributedFields<Ms, Id, E>>

type AppEntities<Ms extends readonly AnyModule[]> = {
  [Id in Ids<Ms>]: { [E in EntityNames<ById<Ms, Id>>]: RowOf<EntityFields<Ms, Id, E>> }
}

// Actions, as the union of every reference in the app
type OwnEntityActions<M extends AnyModule, E extends string> =
  M extends { entities: { [K in E]: { actions: infer A } } } ? keyof A & string : never
type ContributedEntityActions<Ms extends readonly AnyModule[], Id extends string, E extends string> =
  ActiveContributions<Ms> extends infer C ? C extends { to: { id: Id }; entities: { [K in E]: { actions: infer A } } } ? keyof A & string : never : never
type ConditionalEntityActions<Ms extends readonly AnyModule[], M extends AnyModule, E extends string> =
  ActiveConditionals<Ms, M> extends infer Cd ? Cd extends { entities: { [K in E]: { actions: infer A } } } ? keyof A & string : never : never
type GeneratedEntityActions = 'get' | 'query' | 'changes' | 'queryChanges' | 'set'
type OwnModuleActions<M extends AnyModule> = M extends { actions: infer A } ? keyof A & string : never
type ContributedModuleActions<Ms extends readonly AnyModule[], Id extends string> =
  ActiveContributions<Ms> extends infer C ? C extends { to: { id: Id }; actions: infer A } ? keyof A & string : never : never

type ActionRefs<Ms extends readonly AnyModule[]> = {
  [Id in Ids<Ms>]:
    | { [E in EntityNames<ById<Ms, Id>>]:
        `${Id}.${E}.${GeneratedEntityActions | OwnEntityActions<ById<Ms, Id>, E> | ContributedEntityActions<Ms, Id, E> | ConditionalEntityActions<Ms, ById<Ms, Id>, E>}`
      }[EntityNames<ById<Ms, Id>>]
    | `${Id}.${OwnModuleActions<ById<Ms, Id>> | ContributedModuleActions<Ms, Id>}`
}[Ids<Ms>]

// Checks evaluated at defineApp
type RequiredIds<Ms extends readonly AnyModule[]> =
  Ms[number] extends infer M ? (M extends { requires: readonly (infer R extends AnyModule)[] } ? R['id'] : never) : never
type MissingRequirements<Ms extends readonly AnyModule[]> = Exclude<RequiredIds<Ms>, Ids<Ms>>

type DuplicateIds<Ms extends readonly AnyModule[]> = {
  [I in keyof Ms]: Ms[I] extends { id: infer A extends string }
    ? { [J in keyof Ms]: J extends I ? never : Ms[J] extends { id: A } ? A : never }[number]
    : never
}[number]

/** Fields given to one entity by several sources with different types: `module.entity.field`. */
type ConflictingFields<Ms extends readonly AnyModule[]> = {
  [Id in Ids<Ms>]: {
    [E in EntityNames<ById<Ms, Id>>]: {
      [K in AllKeys<FieldSources<Ms, Id, E>> & string]:
        IsUnion<TypeAt<FieldSources<Ms, Id, E>, K>> extends true ? `${Id}.${E}.${K}` : never
    }[AllKeys<FieldSources<Ms, Id, E>> & string]
  }[EntityNames<ById<Ms, Id>>]
}[Ids<Ms>]

/** Contributions naming an entity the selected target does not define (a typo, not a toggling effect). */
type UnknownContributionTargets<Ms extends readonly AnyModule[]> =
  Ms[number] extends infer M
    ? M extends { id: infer From extends string; contributes: readonly (infer C)[] }
      ? C extends { to: { id: infer To extends string }; entities: infer Es }
        ? To extends Ids<Ms>
          ? Exclude<keyof Es & string, EntityNames<ById<Ms, To>>> extends infer Bad extends string
            ? [Bad] extends [never] ? never : `${From} -> ${To}.${Bad}`
            : never
          : never
        : never
      : never
    : never

/** `field.ref` targets whose module or entity is not selected, over active fields only. */
type DanglingRefs<Ms extends readonly AnyModule[]> = {
  [Id in Ids<Ms>]: {
    [E in EntityNames<ById<Ms, Id>>]: {
      [K in keyof EntityFields<Ms, Id, E>]:
        EntityFields<Ms, Id, E>[K] extends { ref: { module: infer RM extends string; entity: infer RE extends string } }
          ? RM extends Ids<Ms>
            ? RE extends EntityNames<ById<Ms, RM>> ? never : `${Id}.${E}.${K & string} -> ${RM}.${RE}`
            : `${Id}.${E}.${K & string} -> ${RM}.${RE}`
          : never
    }[keyof EntityFields<Ms, Id, E>]
  }[EntityNames<ById<Ms, Id>>]
}[Ids<Ms>]

type Check<Problem, Key extends string> = [Problem] extends [never] ? {} : { [K in Key]: Problem }
type AppChecks<Ms extends readonly AnyModule[]> =
  Check<MissingRequirements<Ms>, 'missingModules'>
  & Check<DuplicateIds<Ms>, 'duplicateModuleIds'>
  & Check<ConflictingFields<Ms>, 'conflictingFields'>
  & Check<UnknownContributionTargets<Ms>, 'unknownContributionTargets'>
  & Check<DanglingRefs<Ms>, 'danglingReferences'>

interface App<Ms extends readonly AnyModule[]> {
  readonly id: string
  readonly modules: Ms
  readonly entities: AppEntities<Ms>   // type-only carriers; the runtime value holds the registry
  readonly actions: ActionRefs<Ms>
}
declare function defineApp<const Ms extends readonly AnyModule[]>(
  config: { readonly id: string; readonly modules: Ms } & AppChecks<Ms>,
): App<Ms>
```

The cases the checked file asserts, which the spike's type-test suite must keep:

1. With `[accounts, teams, auth]`: `accounts.profile` has `displayName`, `locale?`, the
   contributed `lastLoginAt?` and the `when: [teams]` contribution `defaultTeamName`;
   `auth.credential` has the conditional `profileId`; contributed action references such as
   `accounts.profile.resetPassword` and `accounts.whoami` exist beside generated ones.
2. Without `auth`: its contributions and its entities are gone, and `entities.auth` is an error.
3. Without `accounts`: `auth` stands alone, its contributions to accounts are dropped, its
   conditional `profileId` is absent.
4. Without `teams`: the `when: [teams]` contribution is dropped, the unconditional one stays.
5. `defineApp({ modules: [teams] })` fails with `missingModules: 'accounts'`.
6. Two modules contributing `lastLoginAt` with different types fail with
   `conflictingFields: 'accounts.profile.lastLoginAt'`; a single contributor is fine.
7. A contribution to `accounts.profiles` (typo) fails with `unknownContributionTargets`; the same
   contribution with `accounts` absent is ignored like any other.
8. Two modules with the same id fail with `duplicateModuleIds`.
9. A `field.ref(accounts, 'profile')` in a module selected without `accounts` fails with
   `danglingReferences`; inside `whenPresent([accounts], ...)` it is simply absent.

Runtime mirror: `defineApp` repeats every check with the same names, so a JavaScript caller or a
dynamically assembled tuple gets the same errors at boot.

Error quality: `Check` makes the failure a missing property with a literal type, so the compiler
message reads "Property 'missingModules' is missing ... required in type { missingModules:
'accounts' }". The spike may replace it with a rest-parameter form if that reads better in the
editor; the names must stay.

Budget: the app-level fold is paid once. Transports, the CLI and the generated file consume
`AppEntities<App>` and `AppActions<App>`; they never fold the tuple again. CI runs
`tsc --generateTrace` on both proof apps and fails when instantiations for the app files exceed a
budget set by the spike (section 13.4).

## 5. Modules

### 5.1 Identity

A module's identity is its `id`, a lowercase literal matching `[a-z][a-z0-9-]*`. The id keys the
type-level lookup, the runtime registry, the table namespace, the migration history, the policy
rule ids and the action references, so it is permanent: renaming a module is a data migration
with an explicit `pennestack module rename` command that rewrites the history table and the
namespace, never a silent change. `core` (the kernel's own module) and `app` (actions mounted on
the app) are reserved. `version` is informational; compatibility between modules is expressed
through the types, not through version ranges.

Splitting a module keeps the id on the part that keeps the tables; the new part gets a new id and
a migration that moves data. This is the answer to the research question on versioning ids.

### 5.2 Dependencies

- `requires: [m]`: a hard dependency. The dependant's context types `m` as present; `defineApp`
  rejects a tuple that lacks `m`; foreign keys towards `m`'s entities are allowed; lifecycle
  orders `m` first.
- `optional: [m]`: a soft dependency. The dependant's context types `m` as `| undefined`; a
  missing `m` is fine; no foreign key towards `m` (a typed id column with framework-enforced
  integrity instead); lifecycle orders `m` first when present.
- Both lists hold module values, not strings, so the dependant imports the dependency package.
  The import graph between module packages must be a directed acyclic graph (`tsc -b` project
  references forbid cycles), which gives the rule of section 5.4.

### 5.3 Contributions to other modules

A contribution is declared by the contributing module and targets another module's entities,
actions, policies or extension points. It is active only when the target and every module in its
`when` list are selected; otherwise it is dropped without error. It is checked, when active,
against the target's real definition: a contribution to an entity the target does not define is a
compile error, because the contributor imported the target and the mistake is a typo, not a
toggling effect.

```ts
.contributes((c) => [
  c.to(accounts, {
    entities: {
      profile: {
        fields: { lastLoginAt: field.instant().optional(), emailVerifiedAt: field.instant().optional() },
        relations: { credentials: relation.many.own('credential', { by: 'subject', to: 'id' }) },
      },
    },
    actions: (b) => ({ whoami: b.query({ /* mounted as accounts.whoami */ }) }),
    entityActions: { profile: (e) => ({ resetPassword: e.command({ /* accounts.profile.resetPassword */ }) }) },
    policies: (rule) => [
      rule.allow('profile', ['get', 'update'], { where: (ctx) => ({ id: ctx.principal.subjectId }), fields: ['displayName', 'locale'] }),
    ],
    extensionPoints: { profileCards: [{ id: 'auth.security', title: 'Security' }] },
  }),
  c.to(projects, { when: [teams], policies: (rule) => [ /* rules that reference projects.team.members */ ] }),
])
```

What a contribution can carry, and the composition rule for each:

| Part | Composition | Conflict rule |
|---|---|---|
| fields | union by name | same name from two sources with different types is a compile and boot error; same name twice is a boot error |
| relations | union by name | as fields |
| actions, entityActions | union by name | duplicate name is an error; a contribution cannot replace an existing action |
| policies | set union, order-independent (section 8) | never conflicts; deny overrides |
| reactions | not a contribution; the contributor declares its own reactions (5.4) | |
| extension-point values | `set`: union; `ordered`: by declared `order` then module order; `single`: exactly one filler or boot error | |

A module may contribute to any module it lists in `requires` or `optional`; anything else is a
boot error, so the dependency graph stays explicit.

### 5.4 Conditional parts, and how accounts and authentication influence each other

A module adds to **itself** on the condition that other modules are selected:

```ts
.conditional((w) => [
  w.when([accounts], {
    entities: { credential: { fields: { profileId: field.ref(accounts, 'profile').optional() } } },
    reactions: (r) => [
      r.inline(accounts, 'profile.archived', async (event, ctx) => {
        await ctx.invoke('auth.credential.revokeAll', { subject: event.state.id, reason: 'profile archived' })
      }),
    ],
  }),
])
```

With contributions (push: a module adds to another) and conditional parts (self-adaptation when
another is present), both directions of influence are expressible with a single direction of
import. The rule: **the lower module publishes contracts (entities, events, extension points);
the higher module imports it, contributes to it and adapts itself to it.**

For the accounts and authentication pair, accounts is lower (a directory of people needs no
login; a credential store needs no profiles):

| Influence | Mechanism | When accounts is off | When auth is off |
|---|---|---|---|
| Auth adds `lastLoginAt`, `emailVerifiedAt` to `accounts.profile` | contribution (fields) | dropped | absent |
| Auth adds the `credentials` relation and the `resetPassword` action to profiles | contribution (relations, entity actions) | dropped | absent |
| Auth adds "a user may read and update their own profile" | contribution (policy fragment) | dropped | accounts' own rules apply (an operator or an API-key principal can still act) |
| Auth links credentials to profiles | conditional field `profileId` | absent; credentials key on an opaque `subject` | n/a |
| Accounts tells auth when a profile is archived | accounts declares the `profile.archived` event; auth reacts (conditional reaction) | n/a | nobody listens |
| Accounts asks "who can log in as this profile?" for its profile card | accounts declares the extension point `identityProviders`; auth fills it | empty slot, typed as possibly empty | empty slot |
| Auth needs an e-mail to log in | auth owns `credential.email`; when accounts is present a conditional reaction keeps it in step with the profile e-mail | auth's own field | n/a |

Both modules compile and run alone; the app with both gets the richer types; nothing is typed by
declaration merging. [api-sketch.ts](api-sketch.ts) shows the pair in full.

### 5.5 Extension points

```ts
import { extensionPoint } from '@pennestack/core'

interface IdentityProvider { id: string; label: string; listFor(ctx: AccountsContext, profileId: ProfileId): Promise<IdentitySummary[]> }

// Declared by accounts:
extensionPoints: { identityProviders: extensionPoint<IdentityProvider>({ mode: 'set' }) }
// Read by accounts, typed as readonly IdentityProvider[]:
ctx.extensions.identityProviders
// Filled by auth, without accounts importing auth:
c.to(accounts, { extensionPoints: { identityProviders: [passwordProvider, passkeyProvider] } })
```

Modes: `set` (any number of values), `ordered` (values carry `order`), `single` (exactly one
filler across the app, else a boot error; the owner can declare a default). The contract type is
a TypeScript type; a value-level schema is optional and used when the filler is configuration
rather than code.

### 5.6 Transports and data adapters plug in through the same mechanism

The `core` module declares the kernel's extension points. A transport, a data adapter, a listener
or a resolver is a module that contributes to them. Sugar functions exist, but they expand to a
contribution:

| Kernel extension point | Contract (defined in core, implemented elsewhere) | Mode | Filled by |
|---|---|---|---|
| `transports` | `TransportAdapter` (section 16) | set | `transport-graphql`, `transport-rest`, `transport-trpc`, `transport-cli`, later JMAP and Connect |
| `hosts` | `TransportHost` (the HTTP host, WebSocket upgrade) | single | `transport-http` (Hono) |
| `listeners` | `Listener` (non-HTTP: SMTP, IMAP, a Unix socket for the CLI) | set | mail modules, `transport-cli` |
| `dataAdapters` | `DataAdapterFactory` (section 14) | set | `adapter-postgres`, `adapter-mysql`, `adapter-sqlite`, `adapter-supabase` |
| `eventStores` | `EventStore` (section 15) | set | the data adapters that implement it |
| `queues` | `JobQueue` (section 9.5) | single | `queue-pg` (pg-boss) first |
| `liveCarriers` | `LiveCarrier` (SSE, WebSocket) | set | `live` module |
| `tenantResolvers` | `TenantResolver` (section 12) | ordered | core (hostname, header, token, path), modules with their own carriers |
| `principalResolvers` | `PrincipalResolver` | ordered | core (operator), `auth` (sessions, passkeys), `api-keys` |
| `principalEnrichers` | `PrincipalEnricher` (roles, memberships) | set | `accounts`, `teams` |
| `invocationMiddleware` | `Middleware` around the pipeline stages | ordered | rate limiting, audit, request logging |
| `secretProviders` | `SecretProvider` | ordered | core (environment), later vault modules |
| `ruleSources` | `RuleSource` (runtime-defined policy rules) | set | a later tenant-admin module |

```ts
export const graphql = defineTransportModule({ id: 'graphql', transport: graphqlAdapter })
// expands to:
defineModule({ id: 'graphql', requires: [] }).contributes((c) => [c.to(core, { extensionPoints: { transports: [graphqlAdapter] } })])
```

Because `core` is implicitly part of every app, such contributions are always active. An app
selects its transports and adapters by listing those modules in its tuple, exactly like any other
module, and the registry's `artifacts` and `mount` phases iterate over `extensions.transports`.

### 5.7 Module configuration and secrets

`config: shape({...})` declares what a backend must provide to run the module. Values are stored
in the control store per backend, optionally overridden per tenant, validated at creation and at
change, and exposed as `ctx.config` (typed). Fields declared with `field.secret()` are stored
through the secrets extension point and never returned by any action. The brief's "everything
configurable" is met by this plus the app-level overrides on `defineApp` (execution modes,
policy overrides, authorization options).

## 6. Entities

### 6.1 Ownership and namespace

An entity belongs to exactly one module and is referenced as `module.entity`. Its physical name
is derived by the data adapter from `(module, entity)` with a namespacing strategy (a schema per
module or a table prefix; section 14). Application code never sees physical names.

### 6.2 Fields

Fields are the `field.*` builders of section 4.2. Each builder result is a `FieldDef` that
carries, at the value level, everything a projection needs (kind, modifiers, constraints,
description, tag) and, at the type level, the TypeScript type and optionality. Projections:

| Consumer | Derived from the field model |
|---|---|
| TypeScript | row type, insert type, patch type, `Id<'module.entity'>` |
| Validation | a Standard Schema validator per entity (create, patch) and per action input |
| JSON Schema | draft 2020-12 and OpenAPI 3.1 dialects (through Standard JSON Schema) |
| GraphQL | object, input and enum types, Relay node ids |
| Columns | dialect column type, nullability, default, index, unique (data layer) |
| Protobuf | numbered fields through `.tag(n)` or deterministic allocation (interfaces, later) |
| CLI | flags and positional parameters |
| Merge | the merge type of section 15 |

### 6.3 Relations

- `field.ref(module, entity)` declares a to-one reference to another module's entity;
  `field.ref.own(entity)` references an entity of the module being defined, by name, because the
  module value does not exist until its builder chain completes (a module value referenced inside
  its own definition is a runtime temporal-dead-zone error and a type circularity). Towards a
  module in `requires` or the owner itself the reference becomes a foreign key. Towards a module
  in `optional`, or inside a conditional part, it is a typed id column whose integrity the kernel enforces at write time and whose
  dangling values are tolerated after the target is retired.
- `relation.many(module, entity, { by, to })` and `relation.many.own(entity, { by, to })` declare
  a to-many relation by naming the field on the other side. The side that may import declares
  it; the other side receives it as a contribution, which is how `accounts.profile.credentials` exists only when auth is selected.
- `relation.through(...)` declares many-to-many through a join entity the declaring module owns.
- Relations are what the condition AST quantifies over (`some`, `none`, `every`, `is`), so a
  policy can say "members of the team that owns the project" without SQL.

### 6.4 Identifiers and time

- Ids are UUIDv7 (RFC 9562) generated in the application with `uuid` 14.0.2 `v7()`, so every
  adapter behaves the same. At every API boundary an id is rendered in TypeID form
  (`prof_01j9...`, prefix from the entity's `prefix`, TypeID specification 0.3.0 as implemented
  by `typeid-js` 1.2.0, used as the reference, not a dependency) and parsed back; the type
  `Id<'accounts.profile'>` is branded so an id of one entity cannot be passed for another.
- Instants are UTC. `field.instant()` is a `Date` in process and an ISO 8601 string on the wire
  until Node 26 is the baseline, after which it becomes `Temporal.Instant` behind the same
  builder (decision point in section 21). `createdAt` and `updatedAt` are set by the kernel,
  never by database defaults.
- The system clock used for `createdAt`, hybrid logical clocks and tokens is `ctx.clock`, which
  tests can control.

### 6.5 Schema library choice and validation

The framework depends on exactly one schema interface: Standard Schema 1.1 (`@standard-schema/spec`
1.1.0, with Standard JSON Schema). The field model implements it, so entity validators and
`shape()` inputs are Standard Schemas with walkable structure. Action inputs and outputs may also
be free-form Standard Schemas from Zod 4.6.5 (the default in examples), Valibot 1.5.0 or ArkType
2.2.8; they are projected through Standard JSON Schema for OpenAPI and through a JSON Schema to
GraphQL converter, with a `JSON` scalar fallback for shapes GraphQL cannot express. Zod is a dev
dependency of examples, never a dependency of a framework package. ADR 0002 records this.

Validation runs once, in the pipeline (section 9.2), before authorization. Output is validated in
development and in tests, and only shaped (masked) in production, so a handler bug surfaces
early without paying twice in production.

### 6.6 History, archive and personal data

`history: 'chain'` (default) stores every change as an event in the entity's chain and
materialises the current state. `history: 'state'` is an explicit opt-out for data that is
derived or ephemeral (a cache, a queue row, a rate-limit counter) and must give a `reason`.
Deletion through any generated or custom action is an `archived` event; `restored` undoes it;
reads hide archived rows unless the query asks for them and the policy allows it. Fields marked
`.personal()` are encrypted per data subject so that erasure (section 15) is a key destruction.
`retire` of a module, run explicitly by the operator, is the only operation that drops tables.

### 6.7 Generated entity actions

Every entity receives five actions with JMAP (RFC 8620) semantics, which gives every transport
state-based incremental sync and optimistic concurrency without per-entity code:

| Action | Kind | Semantics |
|---|---|---|
| `get` | query | by ids, with a field selection; returns rows, `notFound` ids and the current `state` token |
| `query` | query | `filter` (condition AST), `sort`, cursor pagination (`first/after`, `last/before`), opt-in `total`; returns ids or rows plus `queryState` |
| `changes` | query | since a `state` token: created, updated, archived ids and the new token |
| `queryChanges` | query | since a `queryState`: added and removed ids for a filter |
| `set` | command | `create`, `update` (patch), `archive` with `ifInState`; per-item results and errors |

`generated` on the entity switches any of them off. Custom actions coexist. The tokens are
positions of the chain (section 15); the interfaces designer maps the actions to each transport
(section 16).

## 7. Actions

### 7.1 Kinds: commands, queries, subscriptions

| Kind | Side effects | Execution modes | Result | Transport shape |
|---|---|---|---|---|
| `query` | none; reads through `ctx.data` under the principal's plan | always sync | value | GET, GraphQL query, RPC query, CLI command |
| `command` | writes; runs in a transaction; appends events; may enqueue | `sync`, `async`, `either` | value (sync) or receipt (async) | POST/PUT/PATCH/DELETE, mutation, RPC mutation |
| `subscription` | none; observes the live feed | long-lived | async iterable of events with resume tokens | SSE, WebSocket, GraphQL subscription |

The query/command split is the CQRS the brief asks for: a query never writes and a command never
returns data it did not produce. Reads after writes are consistent for the entity's own state
(inline projection); cross-entity read models may lag (section 15).

### 7.2 Mounting

| Mount | Declared with | Reference | Context extras |
|---|---|---|---|
| entity | `.entityActions('profile', (e) => ({...}))` | `accounts.profile.deactivate` | `e.events`, `e.page()`, `decide(input, state, ctx)` |
| module | `.actions((b) => ({...}))` | `auth.login` | |
| app | `defineApp({ actions: (b) => ({...}) })` | `app.health` | the app's own registry |

A contribution mounts actions on the target module or its entities (section 5.3); a conditional
part mounts actions on the contributor itself.

### 7.3 Definition

```ts
interface ActionOptions<I, O> {
  input?: Shape<I>                              // Standard Schema (+ Standard JSON Schema); default: no input
  output?: Shape<O>                             // default: entity row for entity commands, void otherwise
  errors?: readonly ErrorSpec[]                 // declared domain errors, section 10
  auth?: 'policy' | { public: true }            // default 'policy': a rule must allow it
  scope?: 'tenant' | 'backend' | 'deployment'   // default 'tenant'
  execution?: 'sync' | 'async' | 'either'       // commands only; default 'sync'
  idempotent?: boolean                          // queries: always true; commands: default false
  offline?: boolean                             // commands only: may be authored offline (section 15); default false
  page?: PageSpec                               // queries returning pages: sortable fields, default size, max size
  timeoutMs?: number
  hints?: Partial<TransportHints>               // naming per transport; never behaviour
  description?: string
}
```

The handler is one of:

- `handle(input, ctx) => Promise<O>`: queries, module and app commands, commands on
  `history: 'state'` entities. Commands run inside a transaction that also records the
  field-level events of every `ctx.data` write.
- `decide(input, state, ctx) => Event[] | { events: Event[]; result?: O }`: commands on
  chain-backed entities. Pure apart from `ctx.clock`, `ctx.ids` and reads; the kernel loads the
  state with the expected version, appends the events, evolves the state, runs the post-image
  policy check and returns the state or `result`.
- `source(input, ctx) => AsyncIterable<E>`: subscriptions, usually built from `ctx.live`.

For entity-mounted commands the kernel adds `id: Id<entity>` to the input, loads the row under
the principal's plan (a row outside the plan is `not_found`) and passes it as `state` to
`decide` or as `ctx.target` to `handle`. Both forms therefore never see a row the principal may
not act on.

### 7.4 Execution mode and the asynchronous path

The brief requires choosing which requests are handled synchronously. The choice exists at three
levels, the most specific wins:

1. the action's `execution` (`sync`, `async`, `either`);
2. the app's `execution` map (`defineApp({ execution: { 'x.y.z': 'async' } })`);
3. for `either`, the caller's preference per invocation (`prefer: 'async'`, which transports map
   from `Prefer: respond-async`, a GraphQL directive, an RPC option or a CLI flag).

A synchronous command returns its result. An asynchronous command is validated and authorized
synchronously (gate stage), recorded as a command receipt in the same transaction as its enqueue,
and answered with `{ commandId, status: 'accepted' }`. Its progress is observable through the
generated `core.commands.get` query and `core.commands.watch` subscription, and its result is
delivered on the live feed. The worker runs the command under the original principal, recorded
in the job, and authorizes it again against the state at execution time (fail closed).

### 7.5 Idempotency

Every command invocation has a `commandId` (UUIDv7 generated by the client, or by the transport
when the client sent none). The kernel keeps a receipt per `(scope, commandId)` with a fingerprint
of the input and the outcome. A retry with the same id and fingerprint returns the recorded
outcome; the same id with a different fingerprint is a `conflict`. This serves HTTP
`Idempotency-Key`, at-least-once queues and the offline push protocol with one table. Receipts
expire after a configurable window (default 24 hours). Queries are idempotent by definition.

### 7.6 The context object

```ts
interface ActionContext<M extends AnyModule, App> {
  readonly scope: Scope                                  // { level: 'tenant', backendId, tenantId } | { level: 'backend', backendId } | { level: 'deployment' }
  readonly principal: Principal                          // never undefined; 'anonymous' kind for public actions
  readonly ability: Ability                              // can(), plan(), check() for this principal, section 8
  readonly data: DataOf<M, App>                          // tenant-scoped repositories: own, required (present), optional (| undefined)
  readonly services: ServicesOf<M, App>
  readonly extensions: ExtensionsOf<M>
  readonly config: ConfigOf<M>
  readonly events: EventEmitters<M>                      // typed emitters for own entity events
  readonly live: LiveQueries<M, App>                     // typed sources for subscriptions
  readonly clock: Clock                                  // now(), hlc()
  readonly ids: IdFactory                                // newId('auth.credential')
  readonly log: Logger
  readonly trace: Span
  readonly signal: AbortSignal
  readonly request: { id: string; transport: string; commandId?: string; prefer?: 'sync' | 'async'; carrier: Carrier }
  invoke<R extends ActionRefs<App>>(ref: R, input: InputOf<App, R>, options?: { prefer?: 'sync' | 'async' }): Promise<OutputOf<App, R>>
  asSystem(reason: string): ActionContext<M, App>        // explicit, logged escalation to the system principal
}
```

`ctx.data` repositories apply the principal's authorization plan to every read and the item
check to every write, so a handler cannot forget to authorize. `asSystem(reason)` is the only
bypass; it is logged with the reason and the calling action, which replaces the silent
"override access" default of other frameworks.

### 7.7 Reactions

Reactions are a module's event handlers, declared in `.reactions()` or in a conditional part:

```ts
.reactions((r) => [
  r.inline(accounts, 'profile.created', handler),   // same transaction as the producing command
  r.async(accounts, 'profile.created', handler),    // durable job, at-least-once, idempotent by (reaction id, event position)
  r.own('session.created', { timing: 'async' }, handler),   // the module's own events, by name
  r.process('onboarding', { on: ['accounts.profile.created', 'auth.credential.created'], decide, evolve }), // stateful process manager
])
```

A reaction to another module's events is conditional on that module (it must be in `requires`
or appear in a `whenPresent` list). Inline reactions run after the owner's own `evolve` and in
module order; a failure rolls back the command. Async reactions and processes are checkpointed
consumers of the chain (section 15).

### 7.8 Errors in actions

An action declares the domain errors it may throw (`errors: [...]`); the pipeline maps undeclared
exceptions to `internal` with the message redacted. Section 10 defines the taxonomy.

## 8. Authorization

### 8.1 Model

The engine is typed-native and built in `@pennestack/core`; it borrows CASL's vocabulary (allow
and deny per action, conditions, fields, a reason) and none of its mechanics (ADR 0005). Entities
and actions come from the registry, so a rule's condition is typed against the real entity shape,
its field list against the real fields, and its action list against the actions that exist for
that entity; there is no subject tagging and no `fieldsFrom`.

```ts
interface Rule<E> {
  readonly id: string                          // stable, module-prefixed: 'auth.credential.self'
  readonly effect: 'allow' | 'deny'
  readonly subject: { module: string; entity?: string }
  readonly actions: readonly string[]          // action names on that subject; '*' for all
  readonly where?: (ctx: PrincipalContext) => Condition<E> | boolean   // entity rules; omitted = unconditional
  readonly when?: (ctx: PrincipalContext, input: unknown) => boolean  // module and app actions
  readonly fields?: FieldMask<E>               // readable or writable fields; omitted = all non-hidden fields
  readonly reason?: string
}
```

### 8.2 Decision algebra

`allowed = (some allow rule matches) and not (any deny rule matches)`, default deny. Rules from
every module are one set; position in the tuple does not matter; toggling a module adds or
removes its rules and changes nothing else. Deny rules exist for genuine overrides (suspended
accounts, archived records, tenant-wide freezes), must carry a `reason`, and should stay rare.

### 8.3 Conditions

The condition AST is owned by `@pennestack/core` and shared with the data layer, the live feed
and the sync protocol (one AST, two interpreters: compiled to each adapter's filter, interpreted
in memory for loaded rows, post-images, live events and offline operations).

```ts
type Condition<E> =
  | { op: 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte' | 'in' | 'nin' | 'contains' | 'startsWith' | 'isNull'; field: FieldPath<E>; value?: unknown }
  | { op: 'and' | 'or'; conditions: readonly Condition<E>[] }
  | { op: 'not'; condition: Condition<E> }
  | { op: 'some' | 'none' | 'every' | 'is'; relation: RelationPath<E>; where: Condition<Related<E, RelationPath<E>>> }
```

Authors write the object form (`{ ownerId: ctx.principal.subjectId }`,
`{ team: { members: { some: { userId: ctx.principal.subjectId } } } }`, `{ revokedAt: { ne: null } }`),
which normalises to the AST. The operator set is deliberately small; an adapter that cannot
express a shape fails the plan with `unsupported` instead of widening the filter. Reusable
relation conditions are declared once as named derived relations in the owning module
(`relations: { owner: relation.derived(...) }`) and referenced by name.

### 8.4 Three enforcement stages, inside the invoker

| Stage | Question | Result |
|---|---|---|
| gate | can this principal perform this action on this subject at all? | boolean; cheap; denial ends the pipeline with `forbidden` and the matched rule ids |
| plan | which rows, and which fields? | `always`, `never`, or `conditional { where, fields }`; applied to every `ctx.data` read, to the target selection of updates and archives, and to the live feed |
| item check | is this row allowed? | the condition interpreted against the loaded row for reads, and against the resulting row for creates and updates (the `WITH CHECK` idea); a failed post-image check rolls the command back |

Transports never evaluate policies. Field masks apply to reads, to writes (a forbidden field write
is `forbidden` by default; `authorization.mode: 'strip'` drops it instead), and to `filter` and
`sort` inputs, so a hidden field cannot leak through a query. Subscriptions re-run the plan per
emitted event, since a principal can lose access mid-stream.

### 8.5 Principals and their context

```ts
interface Principal {
  readonly kind: 'anonymous' | 'user' | 'service' | 'operator' | 'system'
  readonly id: string | null
  readonly subjectId: string | null      // the auth subject; the accounts profile id when accounts is on
  readonly scope: Scope
  readonly claims: Readonly<Record<string, unknown>>
  readonly roles: readonly string[]      // from principal enrichers; a convenience, never the whole model
  readonly memberships: readonly Membership[]
  readonly via: string                   // resolver id: 'auth.session', 'api-keys.key', 'core.operator'
}
```

Principal resolvers (an ordered extension point) turn the carrier into a principal; principal
enrichers (a set) add roles and memberships. Resolution happens once per invocation and is cached
for its duration; the plan is memoised per `(entity, action)` within the invocation. Nothing is
cached across invocations without an explicit, bounded cache that invalidates on the enricher's
source events.

### 8.6 Explainability, logging, tests

Every decision returns the matched rule ids and effects; `forbidden` errors carry the reason of
the deciding deny rule or the ids of the rules that would have had to allow. A decision-log hook
receives every decision (`authorization.decisionLog: 'denials' | 'all' | 'none'`), and the audit
module can write it to the chain. `ability.explain(plan)` renders the resolved condition for
support work. Tests are three suites: table-driven policy tests, type tests that a fragment cannot
reference a field or relation its `when` modules do not provide, and the dual-evaluation suite
(insert fixtures, run the compiled plan as a real query on every adapter, compare row by row with
the in-memory decision).

### 8.7 Configurability

- app level: `authorization.mode`, `decisionLog`, `policies.disable` (by rule id), `policies.add`
  (extra rules written in the app), `policies.replace` (a module's rule set, for a platform that
  wants a different model for one module);
- runtime: the `ruleSources` extension point lets a module load rules in CASL raw-rule shape
  (`{ action, subject, conditions, fields, inverted, reason }`) from the database, validated
  against the registry at load, so tenant administrators can define rules without a deploy;
- the engine's evaluator, compilers and interpreters are replaceable through the same extension
  mechanism, and the generated PostgreSQL row-level-security backstop is an adapter option.

### 8.8 Multi-tenancy in authorization

Tenant isolation is not a rule. The scope resolved in the pipeline is applied by the data layer
as an unconditional predicate before any plan, and an action's `scope` level is checked at the
gate. The operator principal has deployment scope and may invoke actions declared with
`scope: 'deployment'` (and, through an explicit `core.tenants.enter` action that is itself
logged, act within one tenant). No policy can widen a scope.

## 9. Execution

### 9.1 Overview

```
transport ──Carrier+input──▶ Invoker ──▶ pipeline ──▶ handler ──▶ data layer / event store / queue
   ▲                                                      │
   └──────────── Outcome | AsyncIterable ◀────────────────┘
                                  live feed ◀── change feed (event store / outbox) ◀── commit
```

The invoker is the single entry point. It is used by transports, the CLI, tests and
`ctx.invoke`. The data and interfaces designers fill in the implementations behind the
interfaces of this section; the interfaces themselves are fixed here.

### 9.2 The pipeline

| Stage | Input | Fail-closed outcome | Extension |
|---|---|---|---|
| `resolveScope` | carrier | `not_found` (unknown host or tenant), `unavailable` (backend suspended) | `tenantResolvers` |
| `resolvePrincipal` | carrier, scope | `unauthenticated` for a non-public action | `principalResolvers`, `principalEnrichers` |
| `locate` | action ref, scope | `not_implemented` when the backend's app lacks the module or the action; `forbidden` when the action's scope level does not match | registry |
| `admit` | tenant quotas, rate limits, maintenance flags | `rate_limited`, `unavailable` | `invocationMiddleware` |
| `validate` | input against the action's schema | `validation` with Standard Schema issues | |
| `authorize` | gate (section 8.4) | `forbidden` with rule ids | engine, `ruleSources` |
| `execute` | handler inside a transaction (commands) or a read context (queries); plan and item check inside | domain errors, `conflict` on version mismatch | data layer, event store, queue |
| `shape` | output mask, output validation in development | `internal` | |
| `complete` | telemetry, decision log, receipt | | `invocationMiddleware` |

Middleware wraps stages (an onion) and is contributed through `invocationMiddleware`; it can
observe and short-circuit, never skip `authorize`.

```ts
interface Invocation<I> {
  readonly action: string                 // 'accounts.profile.deactivate'
  readonly input: I
  readonly carrier: Carrier               // { transport, host?, path?, headers?, token?, connection?, local? }
  readonly requestId: string
  readonly commandId?: string
  readonly prefer?: 'sync' | 'async'
  readonly traceparent?: string
  readonly signal: AbortSignal
}
type Outcome<O> = { ok: true; value: O; receipt?: CommandReceipt } | { ok: false; error: PennestackError }

interface Invoker {
  invoke<I, O>(inv: Invocation<I>): Promise<Outcome<O>>
  subscribe<I, E>(inv: Invocation<I>, resume?: { after: StateToken }): AsyncIterable<Emitted<E>>
}
```

### 9.3 Buses

```ts
interface CommandBus {
  dispatch<R extends string>(ref: R, input: unknown, ctx: ActionContext, options?: { prefer?: 'sync' | 'async'; commandId?: string }): Promise<Outcome<unknown>>
}
interface QueryBus {
  ask<R extends string>(ref: R, input: unknown, ctx: ActionContext): Promise<Outcome<unknown>>
}
interface EventBus {
  /** Called inside the command's transaction; events are durable at commit. */
  publish(events: readonly EventEnvelope[], tx: Unit): Promise<void>
  /** Inline reactions run in the same transaction; async consumers read the chain from a checkpoint. */
  subscribe(selector: EventSelector, consumer: EventConsumer, options: { timing: 'inline' | 'async'; id: string }): void
}
```

The buses are internal to the invoker; a module never calls them directly, it uses `ctx.invoke`,
`e.events.*` and reactions.

### 9.4 Transactions and the event chain

A synchronous command runs in one transaction of the tenant's placement: load state with its
version, decide, append events (expected version), evolve and store the state, run inline
reactions, record the receipt, enqueue async work, commit. The events table is the outbox; nothing
is published to anything outside the transaction until commit. `EventStore`, `EventEnvelope`,
projections and checkpoints are specified in data.md within these constraints: one stream per
entity instance, expected-version appends, a cursor over all events of a placement, a hybrid
logical clock per event, the actor and command id in the envelope.

### 9.5 Asynchronous work

```ts
interface JobQueue {
  readonly capabilities: { delay: boolean; priority: boolean; singleton: boolean }
  enqueue(job: JobSpec, tx?: Unit): Promise<JobId>       // tx: join the business transaction (outbox for free)
  work(queue: string, handler: (job: Job) => Promise<void>, options: WorkOptions): Promise<Stop>
}
```

The first implementation is pg-boss 12.37.1 (MIT) on PostgreSQL, enqueued in the same transaction
as the command's events; other queues are modules behind the same interface. Jobs carry the
scope and the principal, so a worker runs the command exactly as the invoker would, including a
second authorization against current state. Consumers are idempotent by `(consumer id, position)`.

### 9.6 Live updates

```ts
interface ChangeFeed {
  /** Events after a position, filtered by scope; the data layer decides the mechanism (logical replication, outbox poll, notify as wake-up). */
  read(scope: Scope, after: StateToken, selector: EventSelector): AsyncIterable<EventEnvelope>
  wake(scope: Scope): AsyncIterable<void>
}
interface LiveHub {
  subscribe(scope: Scope, principal: Principal, selector: EventSelector, resume?: StateToken): AsyncIterable<Emitted<unknown>>
}
```

The live module subscribes to the change feed, re-evaluates the principal's plan per event
(section 8.4), masks fields and emits with a resume token. Carriers (SSE first, WebSocket second)
are transports and belong to interfaces.md; the poke-then-pull shape of the client protocol
belongs to data.md. "Live updates on everything" follows from every chain-backed entity producing
events and every entity having a generated `changes` action and subscription source.

### 9.7 Multi-tenancy in execution

Jobs, events, receipts and subscriptions carry the scope; a worker sets the scope and principal
from the job before any code runs; placements are resolved per scope, so two tenants on different
databases never share a transaction; quotas are enforced at `admit` and by queue concurrency per
tenant.

## 10. Errors

One closed taxonomy, defined in core and serialised by each transport (the mapping table is in
interfaces.md):

| Kind | Meaning | Retryable |
|---|---|---|
| `validation` | input or output does not match its schema; carries Standard Schema `issues` | no |
| `unauthenticated` | a principal is required and none was resolved | no |
| `forbidden` | the gate, plan or item check denied; carries rule ids and reason | no |
| `not_found` | scope, entity row or ids absent | no |
| `conflict` | version or state mismatch, uniqueness, idempotency fingerprint mismatch | sometimes (`retryable` set per case) |
| `rate_limited` | admission denied by quota | yes, with `retryAfter` |
| `not_implemented` | module or action not part of this backend's app | no |
| `unavailable` | backend suspended, placement unreachable, shutting down | yes |
| `unsupported` | an adapter cannot express a condition or capability (fail closed) | no |
| `internal` | anything undeclared; message redacted outside development | no |

```ts
class PennestackError extends Error {
  readonly kind: ErrorKind
  readonly code: string                  // stable, module-prefixed: 'accounts.email_taken'
  readonly issues?: readonly { path: readonly PropertyKey[]; message: string }[]
  readonly details?: unknown             // typed by the ErrorSpec's data schema
  readonly retryable: boolean
  readonly rules?: readonly { id: string; effect: 'allow' | 'deny' }[]
}
const emailTaken = defineError('accounts.email_taken', { kind: 'conflict', data: shape({ email: field.string() }), message: 'This e-mail address is already in use.' })
```

Declared errors become typed unions in GraphQL, typed errors in oRPC, documented responses in
OpenAPI and exit codes in the CLI. Error codes are part of the public contract and are never
reused.

## 11. Observability

- Tracing and metrics through OpenTelemetry (`@opentelemetry/api` 1.9.1; SDK 2.x in the
  deployment package). The invoker opens one span per invocation with attributes
  `pennestack.app`, `.backend`, `.tenant`, `.module`, `.entity`, `.action`, `.kind`,
  `.transport`, `.execution`, `.outcome` and the matched rule ids; transports, the data layer and
  the queue add child spans; W3C `traceparent` is propagated in and out.
- Metrics: invocations and durations by action and outcome, queue depth and age, chain append
  rate, projection and change-feed lag, live subscriptions, per-tenant quota usage.
- Logs are structured, carry the scope ids and request id, and go through `ctx.log`; no module
  writes to `console`.
- The decision log (section 8.6) and the command receipts give an audit trail of who did what;
  the chain itself is the audit trail of what changed. An `audit` module can persist both.
- Health: `app.health` (liveness) and `app.ready` (readiness: control store, placements, queue)
  are app-level actions every transport exposes; `pennestack doctor` runs them from the CLI.
- Development: the invoker can emit a per-invocation explanation (stages, timings, plan, matched
  rules) when `PENNESTACK_EXPLAIN=1`.

## 12. Multi-tenancy and one deployment

The brief makes this cross-cutting; this section collects the statements of each layer.

| Layer | How it handles backends and tenants |
|---|---|
| Kernel | Control entities `backend`, `tenant`, `domain`, `placement` and `commandReceipt` in the `core` module (tenancy `deployment`); operator actions `core.backends.*`, `core.tenants.*`, `core.domains.*` with `scope: 'deployment'`; runtime creation without restart; per-backend module configuration and per-tenant overrides; `onBackendCreated` and `onTenantCreated` hooks for provisioning; a change feed over the control store keeps every process's directory current. |
| Pipeline | `resolveScope` runs first on every invocation using the ordered `tenantResolvers` (hostname, path prefix, header, token claim, listener-specific such as SMTP recipient domain); the same resolvers serve every transport, the CLI and non-HTTP listeners; actions declare the scope level they accept and the gate rejects a mismatch. |
| Data layer | Placement per tenant (shared tables with `tenantId`, schema per tenant, database per tenant, or a different adapter), chosen at tenant creation and changeable by a migration command; the adapter injects the tenant predicate into every query and write; PostgreSQL row-level security as a backstop; migrations run per placement; application code never sees the strategy. Details in data.md. |
| Authorization | Scope is applied before and outside policies (section 8.8); the operator principal and explicit, logged tenant entry; no rule can widen a scope. |
| Execution | Jobs, events, receipts, subscriptions and checkpoints carry the scope; workers adopt it before running; quotas and concurrency per tenant at `admit` and in the queue (section 9.7). |
| Transports | Fill the carrier and never resolve tenants themselves; the HTTP host routes domains per tenant (TLS certificates per domain are a module); generated documents (OpenAPI, SDL) are per app, served per backend. Details in interfaces.md. |
| CLI | A profile names a deployment, a backend and a tenant (or the deployment level for operator work); the token in the profile is resolved like any other principal; every command accepts `--backend` and `--tenant` overrides; operator commands create backends and tenants at runtime. |
| Secrets and configuration | Per backend with per-tenant overrides, stored through the secrets extension point, never in the app code or the environment of a tenant. |
| Isolation guarantee | A tenant can observe another tenant's data only through an action declared with a wider scope level, which only operator principals can invoke; every such invocation is logged. |

## 13. Types and toolchain

### 13.1 Live types without a generator

The types of what is in the database are inferred from the entity definitions through
`AppEntities<App>`; the editor, `tsc`, Biome and Vitest see the same types with no generation step
in the path. A TypeScript language-service plugin is not used: plugins never run under `tsc`, and
TypeScript 7.0 ships no plugin API (research: data-layer.md section 6, interfaces-and-devx.md
section 5.4).

One generated file exists for convenience and for the things that must be files:
`pennestack.generated.ts` next to the app re-exports `AppEntities`, `Doc<'accounts.profile'>`,
`Id<...>`, `ActionRefs` and the typed client, so application code imports from one place and the
app-level fold is instantiated once. The dev server (`pennestack dev`) rewrites it on change;
`pennestack generate --check` fails CI when it, the migrations, the OpenAPI document, the SDL or
the CLI completions drift from the definitions. External tables a module maps onto get `.d.ts`
declarations from introspection, and `pennestack db check` fails on drift between the database
and the module snapshots (section 14).

### 13.2 Toolchain

| Tool | Version checked 2026-10-08 | Role |
|---|---|---|
| TypeScript | 7.0.2 (builds and checks); 6.0.3 pinned only for tools that need the compiler API | `tsc -b` with project references |
| Node.js | 24 (active LTS; 24.21.0 locally) | runs `.ts` sources directly through type stripping |
| pnpm | 11.21.0 locally | workspace |
| Biome | 2.5.15 | the only formatter and linter |
| Vitest | 5.0.3 with `--typecheck`; expect-type 1.4.0 | unit, integration and type tests |
| @ark/attest | 0.57.0 (alpha; needs TypeScript 6) | instantiation budgets on the composition types |
| OpenTelemetry | api 1.9.1, SDK 2.x | section 11 |

Compiler options in every package: `strict`, `exactOptionalPropertyTypes`,
`noUncheckedIndexedAccess`, `isolatedDeclarations`, `erasableSyntaxOnly`, `verbatimModuleSyntax`,
`rewriteRelativeImportExtensions`, `module: nodenext`, `composite`. Consequences the DSL already
respects: no enums, no namespaces, no parameter properties, no decorators; relative imports carry
`.ts`.

### 13.3 Type tests as a first-class suite

Every package has `*.test-d.ts` files. The core's suite contains the nine cases of section 4.7,
the context presence rules (`ctx.data.accounts` is `| undefined` under `optional`), the policy
typing (a condition cannot name a field or relation that the rule's modules do not provide), and
the generated file's exports.

### 13.4 Trace budget

CI runs `tsc --generateTrace` on `examples/launchway` and `examples/mail` and fails when the
instantiation count of the app definition files exceeds the budget the spike establishes (the
section 4.7 model costs about 2,000 instantiations per app of three modules). attest benchmarks
guard the composition types in `@pennestack/core`.

## 14. Data layer

Owned by the data designer in [data.md](data.md) (ADRs 0006 to 0009). Summary of what this
document fixes and what data.md fills in: the entity model of section 6 is the single,
dialect-neutral schema source; the adapter boundary has two layers, a mandatory
entity-operation contract (find, findOne, insert, update, archive, count with the condition AST,
keyset cursors, callback transactions whose nesting becomes savepoints, migration plan, apply and
introspect) plus declared optional capabilities (SQL escape hatch, full-text search, row locks,
change feed level, event store), validated at `connect` against what the selected modules
require; the first SQL family is built on Kysely 0.29.6 with PostgreSQL first and MySQL and
SQLite following, Supabase as the PostgreSQL adapter plus an optional Realtime consumer, and a
Drizzle-backed adapter permitted by the contract but not first; migrations are diff-generated per
module with per-module snapshots, one global history table keyed by module, topological order by
dependencies, foreign keys only towards hard dependencies, and disabling never drops data; tenant
placement strategies and the tenant predicate injection of section 12; identifiers, time and the
append-only shape of sections 6.4 and 6.6. data.md must confirm that its filter model hosts the
condition AST of section 8.3 unchanged and declare per adapter which operators are unsupported.

## 15. Events, sync and live updates

Owned by the data designer in [data.md](data.md) for storage and protocol, with the carrier side
in [interfaces.md](interfaces.md). Fixed here: one stream per entity instance with
expected-version appends and a cursor per placement; `archived` and `restored` events instead of
deletes; a hybrid logical clock, actor, command id and optional previous-hash in every envelope;
per-field merge types `lww`, `counter`, `set`, `sequence`, `richText`, `exclusive` declared with
`.merge()`, where `exclusive` (and every unique field) is synchronous-only and `offline: true`
commands may touch mergeable fields only; a push and pull protocol with a per-client sequence
inbox built on the command receipts of section 7.5; authorization of offline-authored events at
ingest against committed state (section 8.4); crypto-shredding of `.personal()` fields from the
first release; retention rules per module as an operator choice, so that "nothing deleted" means
"nothing deleted without a retention rule the operator chose". data.md decides the global
position scheme, the CRDT library for `sequence` and `richText` (Loro 1.16.4 is the research
recommendation), projection lifecycles and rebuilds, and the inbox and rejection channel of the
client protocol.

## 16. Transports and CLI

Owned by the interfaces designer in [interfaces.md](interfaces.md) (ADRs 0010 to 0013). Fixed
here: transports are modules contributing `TransportAdapter` values to the kernel's extension
point (section 5.6); an adapter has a name, capabilities, a pure `artifacts(registry)` for the
generator and a `mount({ registry, invoker, host, options, telemetry })`; adapters never import
handlers, never evaluate policies and never touch the data layer; every transport fills a carrier
and calls the invoker; the error taxonomy of section 10, the pagination model and condition AST,
and the generated entity actions of section 6.7 are projected, never reinterpreted. Research
recommendations the interfaces designer starts from: Hono 4.13.13 with `@hono/node-server` 2.1.4
as the shared HTTP host; Pothos 4.15.1 on GraphQL Yoga 5.24.4 with SSE subscriptions; an own REST
projection with an own OpenAPI 3.1 emitter and RFC 9457 problem details; tRPC 11.19.0 (required
by the brief) and oRPC 1.15.5 (whose typed client can serve the CLI and tests); Stricli 1.3.0 for
the CLI with a route map generated from the registry plus framework commands (`dev`, `generate`,
`db`, `backend`, `tenant`, `module`, `doctor`); Standard Webhooks for outbound webhooks; JMAP and
Connect later. The CLI lives in this repository as `@pennestack/cli` and is the first human
interface; a UI remains fully pluggable because it can only ever talk to actions.

## 17. Platforms

Owned by the platforms designer in [platforms.md](platforms.md). The two proof apps are
compositions of modules from this repository: `examples/launchway` (accounts, auth, api-keys,
teams, projects, nodes, deployments, domains, dns, audit, with GraphQL, REST, tRPC and the CLI)
and `examples/mail` (accounts, auth, domains, mailboxes, messages, smtp, imap, jmap, queues,
dkim, audit). platforms.md states which modules are shared, which are specific, which commands
must be synchronous (uniqueness of slugs, hostnames and mail addresses; deployment runs; sending
mail), which entities need offline authorship versus live updates only, and what the mail server
needs from the SQL escape hatch (mailbox search, queue locking). Both run in one deployment as two
backends, each with its own tenants, which is the first test of section 12.

## 18. Repository layout and package plan

```
pennestack/
  docs/                      brief, architecture, data, interfaces, platforms, adr/, research/
  packages/
    core/                    @pennestack/core: DSL, registry, invoker, authorization, condition AST, errors, field model, core module
    data/                    @pennestack/data: adapter contract, migration engine, in-memory and PGlite adapters for tests
    adapter-postgres/        @pennestack/adapter-postgres (Kysely)
    adapter-mysql/           @pennestack/adapter-mysql
    adapter-sqlite/          @pennestack/adapter-sqlite
    adapter-supabase/        @pennestack/adapter-supabase (PostgreSQL adapter plus Realtime consumer)
    events/                  @pennestack/events: event store contract, projections, process managers, sync protocol
    queue-pg/                @pennestack/queue-pg (pg-boss)
    live/                    @pennestack/live: live hub, SSE and WebSocket carriers
    transport-http/          @pennestack/transport-http: the Hono host
    transport-rest/          @pennestack/transport-rest: REST projection, OpenAPI emitter
    transport-graphql/       @pennestack/transport-graphql: Pothos and Yoga
    transport-trpc/          @pennestack/transport-trpc
    transport-orpc/          @pennestack/transport-orpc
    transport-cli/           @pennestack/transport-cli: Stricli route maps from the registry
    module-accounts/         @pennestack/module-accounts
    module-auth/             @pennestack/module-auth
    module-api-keys/         @pennestack/module-api-keys
    module-audit/            @pennestack/module-audit
    testing/                 @pennestack/testing: harness, policy matchers, dual-evaluation suite, fixtures
    cli/                     @pennestack/cli: the `pennestack` binary (dev, generate, db, backend, tenant, module, doctor)
  examples/
    launchway/               the deployment platform app
    mail/                    the mail server app
  spikes/                    throwaway verifications (the composition type spike, the Connect descriptor spike)
  biome.json  pnpm-workspace.yaml  tsconfig.base.json  package.json
```

Rules:

- pnpm workspace with TypeScript project references; `tsc -b` builds the graph; every package
  compiles alone with the options of section 13.2.
- The dependency graph between packages is a DAG: `core` depends on nothing in the workspace;
  `data`, `events` and `live` depend on `core`; adapters depend on `data` (and `events` where
  they implement the store); transports depend on `core` (and on `transport-http` for HTTP);
  modules depend on `core` and on the modules they require or optionally use; `cli` depends on
  `transport-cli`; examples depend on everything they select; `testing` depends on `core` and
  `data`.
- Published under the `@pennestack` scope; the repository is public on GitHub
  (JensPenneman/pennestack); every commit is signed with the author's personal identity; a
  `CONTRIBUTING.md` states both. Licence: a decision point for Jens (section 21).
- One `CHANGELOG.md` per package, kept by the release tooling; semantic versions; the `core`
  package's public types are a compatibility contract.
- Examples are the integration tests: CI boots both apps against PostgreSQL, MySQL and SQLite,
  runs the dual-evaluation authorization suite, `generate --check`, `db check` and the trace
  budget.

## 19. How a new requirement lands

Requirements arrive incrementally and the brief is appended. The decision procedure for each
addition, in order:

1. **Configuration**: can the requirement be met by a value in `defineApp`, `defineDeployment`,
   a module's `config` or a tenant setting? Then it is configuration.
2. **Policy**: is it about who may do what? Then it is a rule set or a `ruleSources` filler.
3. **Module**: does it own data or behaviour? Then it is a module, possibly contributing to
   others and adapting to them, with its own migrations, policies and actions.
4. **Adapter**: is it a new database, queue, carrier, listener, transport or secret store? Then
   it fills an existing kernel extension point.
5. **Extension point**: does a module need to let future modules influence it? Then it declares
   a typed extension point; the kernel is unchanged.
6. **Kernel**: only when the pipeline, the scope and principal model, the composition rules, the
   condition AST or the error taxonomy must change. Such a change needs an ADR and updates this
   document.

The proof of the procedure is that the two addenda of 2026-10-08 landed in this document as a
kernel concept (scope) plus configuration, extension points and adapters, not as a new
architecture.

## 20. Requirements traceability

| Brief requirement | Where it is met |
|---|---|
| Configuration system in TypeScript; app defined as a set of modules | 4.1, 4.5, 4.7 |
| A module owns entities | 5.1, 6.1 |
| Entities carry actions; actions on modules and the app | 6.7, 7.2 |
| Modules plug and play, independently toggleable | 4.7 (checks and tests), 5.2, 5.3 |
| Modules influence each other, explicit and typed, both still toggleable | 5.3, 5.4, 5.5, api-sketch.ts |
| Multiple platforms from different selections | 4.5, 4.6, 17 |
| CASL-style authorization per action with conditions; not plain RBAC; everything configurable | 8.1 to 8.7 |
| Transports as modules, several active, each derived from the same definitions | 5.6, 16 |
| GraphQL, REST, tRPC modules | 16, interfaces.md |
| Authentication module and separate accounts module, mutual influence | 5.4, api-sketch.ts |
| Pluggable data layer: PostgreSQL, MySQL, hosted services, Drizzle, anything fitting the abstraction | 5.6, 14, data.md |
| CQRS-like execution; choose which requests are synchronous | 7.1, 7.4, 9 |
| Live updates on everything | 6.7, 9.6, 15 |
| Append-only collaborative data, nothing deleted, online and offline actors | 6.6, 15 |
| Live, generated database types whatever the connection | 13.1 |
| Compiler, linter and toolchain always know what to do | 13.2, 13.3 |
| API and backend complete without a frontend; UI pluggable; CLI first, in this repository | 16, 18 |
| One deployment hosts multiple backends with their own module selection | 2, 3.2, 4.6, 12 |
| Multiple tenants per backend; runtime creation without redeploy | 3.3 (hooks), 12 |
| Tenant isolation: data, realm, configuration, secrets, domains, quotas; operator across all | 8.8, 12 |
| Tenant resolution in the pipeline for every transport, CLI and non-HTTP listeners | 9.2, 12 |
| Physical tenant data placement pluggable and invisible to application code | 12, 14 |
| Each layer states how it handles multi-tenancy | 3.5, 8.8, 9.7, 12 |
| Living brief: additions land as module, adapter, policy or configuration; kernel changes need an ADR | 19, adr/0001 |
| Public repository, signed commits | 18 |
| Best practice from first principles, no copied conventions | this document and the ADRs cite research, not older projects |
| Product name never references other companies' products | the working name and all package names are generic |

## 21. Open questions

Decision points for Jens (they change the work):

1. **Runtime module selection.** This document restricts a backend to the apps compiled into the
   deployment, so a new combination of modules is a one-line `defineApp` plus a deploy
   (section 4.6). The alternative, toggling modules per backend at runtime, cannot have exact
   types. Recommendation: keep the catalogue, and let modules expose per-backend feature flags in
   their `config` for behaviour that should vary at runtime.
2. **Licence** of the public repository (MIT or Apache-2.0 are the candidates; Apache-2.0 adds an
   explicit patent grant).
3. **Instants**: `Date` until Node 26 is LTS (scheduled for October 2026) and then
   `Temporal.Instant`, or `Temporal` from the start with a polyfill. Recommendation: `Date` now,
   behind `field.instant()`, so the switch touches no application code.
4. **Deny rules in the first release** or allow-only with `unless` conditions. Recommendation:
   include deny with a mandatory reason, because tenant freezes and suspended accounts need it.
5. **Protobuf tags from day one** (`.tag(n)` with deterministic allocation recorded in snapshots)
   or deferred until the Connect transport exists. Recommendation: allocate from day one; it is a
   number in a snapshot now and a migration of every entity later.
6. **oRPC beside tRPC.** The brief requires tRPC; oRPC adds a typed client for the CLI and tests
   and a native OpenAPI handler. Recommendation: include it; the maintenance cost is one adapter.

Open for the parallel designers:

7. data.md: global position scheme (sequence with gap handling versus per-stream order plus
   HLC), placement strategies on hosted PostgreSQL (schema per module versus prefix), and whether
   the mail server forces the SQL escape hatch.
8. data.md: the CRDT library for `sequence` and `richText`, retention rules, key custody for
   crypto-shredding, and who may trigger erasure (an action with its own rule).
9. data.md and interfaces.md: the rejection channel for offline events (client-side journal,
   automatic revert, or a merge task) and how `changes` and `queryChanges` tokens are derived from
   the chain.
10. interfaces.md: OpenAPI 3.1 or 3.2 as the committed default; the JSON scalar fallback for
    free-form inputs in GraphQL; the Connect runtime-descriptor spike.
11. platforms.md: which entities of each proof app need offline authorship, and the list of
    synchronous-only commands.

Open for the spike:

12. Whether the `Check` property form or a rest-parameter form gives the better editor message
    at `defineApp`.
13. The instantiation budget for the two example apps and the attest benchmarks for the core
    types.
14. Whether `ctx.data` for optional modules should be `| undefined` (this document) or a
    `Maybe` object with `.ifPresent()`, after writing the auth module against it.
