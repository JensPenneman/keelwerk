# pennestack architecture

Date: 2026-10-11 (first version 2026-10-08). Status: specification, consolidated draft awaiting
Jens's approval. Authors: the core architect and the data, interfaces and platforms designers;
consolidated with the review findings of 2026-10-11 by the synthesis editor.

This document is the design contract of the framework. [brief.md](brief.md) is the requirements
source of truth; this document says how those requirements are met and must not drop or
reinterpret any of them. Where it chooses between alternatives, an Architecture Decision Record in
[adr/](adr/) records why, and [roadmap.md](roadmap.md) orders the work into milestones. The
research notes under [research/](research/) are the evidence base.

It is one specification. Sections 1 to 13 define the kernel, the configuration model, actions,
authorization, execution and the toolchain; sections 14 to 16 the data layer, events and sync,
live updates, and the transports and CLI; section 17 the shared accounts and authentication
modules and the two proof platforms; sections 18 to 21 the repository, the procedure for new
requirements, traceability and the open questions.

Every library named here was checked against the npm registry between 2026-10-08 and 2026-10-11;
the version in parentheses is the one checked, and Appendix A lists them. Type-level claims name
the compiler versions that checked them.

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
14. Data layer
15. Events, sync and live updates
16. Transports and CLI
17. Shared modules and platforms
18. Repository layout and package plan
19. How a new requirement lands
20. Requirements traceability
21. Open questions

Appendix A. Versions checked. Appendix B. Verified typing listing.

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
   unscoped code path. The invoked action is the unit of authorization (section 8.4); reactions,
   timers and schedules run under the module's own service principal, never under the user who
   triggered them, and every escalation to the `system` principal names a reason that is logged.
   Tenant isolation is applied by the kernel and the data layer before any policy runs, so a
   policy mistake cannot cross a tenant boundary.
6. **Composition is order-independent.** Rules from several modules are a set: allow rules are
   OR-ed, deny rules override, the default is deny. Contributions are a set keyed by module id.
   Nothing depends on the position of a module in the tuple except deterministic tie-breaking of
   lifecycle order.
7. **Fail closed.** A condition an adapter cannot express, a missing requirement, a drifted
   schema, an action whose module is disabled for a backend, a repository operation the module
   may not perform: each is an error, never a wider filter, a narrowed result, a loose type or a
   silent no-op.
8. **Nothing is deleted; everything is appended.** Live entities are an append-only event chain
   with a materialised current state. Deletion is an archive event that a restore event can
   undo. Erasure of personal data is crypto-shredding, which keeps the chain intact.
9. **The kernel stays small.** New requirements land as modules, adapters, policies or
   configuration. The kernel exposes extension points so that even transports and data adapters
   are modules. A kernel change requires an ADR.
10. **The compiler is the judge.** `tsc`, Biome and the test runner must see the same types the
    editor sees, with no language-service plugin and no generator in the type path. Module and
    app values carry named types, so declaration emit stays proportional to each package
    (section 13.11). One generated file exists for convenience and is checked for drift in CI.

## 2. Glossary

| Term | Meaning |
|---|---|
| **Deployment** | One running installation of pennestack: one build, one or more processes, possibly on several nodes, sharing one control store. |
| **Infrastructure** | What a deployment provides to every app it runs, listed in `defineDeployment`: data adapter factories, the job queue, blob stores, the HTTP host, secret providers, the erasure-ledger sink, tenant resolvers and listener port bindings (section 4.6). |
| **App** | A compile-time composition of modules: `defineApp({ id, modules: [...] })`. Its types are exact for that selection. The deployment platform and the mail server are two apps. |
| **Backend** | A runtime instance of an app inside a deployment, created at runtime without a redeploy: a name, the app it runs, its configuration, secrets, domains, quotas and tenants. Several backends may run the same app. |
| **Tenant** | An isolation unit inside a backend (a company, an organisation, an app, whatever the backend calls it). Data, authentication realm, configuration, secrets, domains and quotas are per tenant. |
| **Scope** | The pair (backend, tenant) an invocation runs in, or the backend level, or the deployment level. Every action declares the level it accepts. |
| **Scope key** | A deployment-wide unique key (a host name, a mail domain, a credential's public id, a webhook endpoint) that resolves to a scope before any tenant data is reachable (gap G2, section 17.7). |
| **Operator** | The person administering the deployment (Jens). A principal kind with deployment scope. |
| **Principal** | Who is acting: anonymous, user, service, operator or system, with the scope it belongs to, claims, roles and memberships (section 8.5). |
| **Module service principal** | The service principal `<module>.system` under which a module's reactions, timers and schedules run; governed by rules like any principal (section 8.4). |
| **Module** | A unit of composition with a string id. Owns entities, actions, policies, services, reactions and extension points; declares requirements, optional dependencies, contracts it provides, contributions and conditional parts. |
| **Contract** | A named capability with a typed interface (`live`, `blobs`, `httpHost`) that modules list in `requires` or `optional` instead of a concrete implementation; a module or an infrastructure entry declares that it `provides` it (section 5.2). |
| **Entity** | A data structure owned by a module: fields, relations, indexes, events and the actions mounted on it. |
| **Field** | A typed column declared with the `field.*` builders. Emits a validator, a JSON Schema, a GraphQL type and a column definition. |
| **Action** | A named unit of behaviour mounted on an entity, a module or the app: a `query`, a `command` or a `subscription`. |
| **Action reference** | The dotted path of an action: `accounts.profile.deactivate`, `auth.login`, `app.health`. |
| **Contribution** | Fields, relations, actions, policies or extension-point values a module adds to another module, active only when the target (and any extra `when` modules) are selected. |
| **Conditional part** | Fields, actions, reactions or policies a module adds to itself only when other modules are selected. |
| **Extension point** | A typed slot a module declares so that other modules can fill it without the owner importing them. The kernel's app-level extension points are how transports, resolvers and live carriers plug in; deployment-level points hold the infrastructure. |
| **Policy** | A set of rules for an entity's or a module's actions: allow or deny, with a `where` condition on the row acted on, an optional `check` on the row produced, a field list and a reason. |
| **Condition** | A serialisable, typed filter AST over an entity's fields and relations, shared by authorization, the data layer and the live feed. |
| **Registry** | The runtime index built by `defineApp`: modules, entities, actions, policies, extension points, keyed by ids and references. |
| **API surface** | The serialisable description of one app's public interface, derived by the core from the registry; every transport, the CLI and every generated document read it (section 16.2). |
| **Field node** | The serialisable form of a field-model node inside the surface: kind, modifiers, constraints and access. |
| **Invoker** | The one in-process entry point that runs an action through the pipeline. Transports call it; so do the CLI, tests and modules calling each other. |
| **Session** | The scope and principal the invoker resolved once for a transport request or a long-lived connection (`InvocationSession`, section 16.3.4). |
| **Carrier** | The transport-neutral description of where a request came from (host, path, headers, token, connection), used for scope and principal resolution. Handlers see a redacted form without credentials. |
| **Transport module** | A module that contributes a `TransportAdapter` to the kernel's `transports` extension point; a mount is one adapter attached to the HTTP host for one app. |
| **Invocation protocol** | The canonical JSON wire over HTTP and the operator Unix socket, served by the host for every app and used by the CLI, the typed client and tests (section 16.8). |
| **Artefact** | A file derived from the surface: the surface JSON, an OpenAPI document, a GraphQL SDL, the CLI manifest, a type fragment. |
| **Chain** | The append-only event log of an entity instance; "the chain" of the brief. |
| **Namespace** | One event log, one set of framework tables and one copy of one app's tables on a placement: one per app on a shared-tables placement, one per tenant otherwise (section 14.2). |
| **Unit** | One transaction on one namespace, opened for one storage scope (section 14.3.2). |
| **Position** | A commit-ordered integer that orders the events of one scope inside a namespace; stream tokens, JMAP states and IMAP `MODSEQ` are positions (section 15.1.4). |
| **Live source** | What a subscription reads: an entity's changes, pokes, command receipts, stream records, a topic or a custom iterable (section 15.4.2). |
| **Stream token** | The resume token every resumable emitted item carries: `v1.<epoch>.<position>.<scope>.<check>` (section 15.2.6). |
| **Control store** | The deployment-level database that holds backends, tenants, the scope directory, placements, namespaces, wrapped keys and migration history. |
| **Placement** | Where a tenant's data lives: an adapter binding plus a strategy (shared tables with a tenant key, a schema per tenant, a database per tenant, a different adapter). |
| **Operator endpoint** | The deployment-level entry (operator Unix socket and operator host names) where deployment-scope actions are served. |
| **Receiver** | A mapping from an inbound webhook request (path, raw body, headers) to an action, filled into `transport-webhooks` (section 16.5.8). |

## 3. Kernel

### 3.1 What the runtime is

The kernel is the `@pennestack/core` package. It contains no transport, no database driver and
no business module. It provides:

- the configuration DSL (section 4) and the registry it builds;
- the invoker, its sessions and the request pipeline (section 9);
- the authorization engine (section 8);
- the condition AST, the pagination model and the error taxonomy shared by every other package;
- the lifecycle, the scope and principal model, the key service (section 14.7.4), the job queue
  contract (section 9.5), the app-level extension points through which transports, resolvers and
  live carriers plug in, and the deployment-level extension points that hold the infrastructure
  (section 5.6);
- the kernel write path: repositories, `decide` and `evolve`, merge rules, receipts and tokens,
  written once against the data adapter contract (section 14.3);
- the implicit `core` module, which owns the control entities (`core.backend`, `core.tenant`,
  `core.domain`, `core.placement`, `core.namespace`, `core.operatorToken`), the command receipts
  (`core.commandReceipt`), and the operator and client actions (`core.introspect`, `core.me`,
  `core.subjects.erase`, `core.retention.*`, `core.tenant.enter`, `core.tenant.move`).

Everything else is a module or an infrastructure entry in its own package. The two proof apps are
compositions of such packages (section 17).

### 3.2 Process model

- One deployment runs one build. Every process of the deployment loads the same deployment
  definition (`defineDeployment`, section 4.6), which lists the apps it can run and the
  infrastructure they share.
- A process has a role: `serve` (runs listeners and transports), `work` (runs queue workers,
  projections and the reaction dispatcher), or `all` (both; the development default). Roles are a
  start-up flag, not a different build. Named processes with capability tags (a process that sees
  real client addresses on port 25, a process on the edge host) are gap G9 (section 17.7).
- Processes share no memory. Coordination goes through the control store and the job queue, so
  any number of processes on any number of nodes can run the same role.
- A process serves every backend of the deployment. Which backends exist, which app each runs,
  and which tenants, domains and scope keys they have, is read from the control store and cached
  with a change feed; creating a backend or a tenant does not restart anything.
- Listeners are not only HTTP. A listener module contributes a `Listener` value (section 5.6); the
  deployment binds its ports; the SMTP listener of the mail app and the HTTP host are peers.

### 3.3 Lifecycle

The lifecycle is explicit and the same for every module. Phases run in this order:

| Phase | Who runs | What happens |
|---|---|---|
| `compose` | `defineApp`, pure | Validates the module tuple at the type level and again at runtime (missing requirements and contracts, duplicate and reserved ids, conflicting fields, unknown contribution targets, dangling references, unknown execution overrides, identifier collisions), orders modules topologically by `requires` with tuple order as tie-break, applies contributions and conditional parts, builds the registry and derives the API surface. No I/O. |
| `setup` | Each module, in order | Receives the final registry and its own resolved definition; may register derived artefacts (projections, indexes, schedules). Transports run their `check` against the surface. Runs before any adapter connects. |
| `connect` | Kernel | Opens the infrastructure listed in `defineDeployment` (data adapters, the control store, blob stores, secret providers, the ledger sink), verifies that it provides every deployment-level contract the apps require, then opens the placements the enabled backends need and validates adapter capabilities against the modules' data needs (section 14.3.3). Replays the erasure ledger and checks namespace epochs (section 14.7.6). |
| `migrate` | Kernel | In development: plans and applies the schema diff per namespace, confirming destructive steps. In production: verifies that the applied history matches the committed migration files and refuses to start on drift. |
| `start` | Each module, in order | Starts background work (queue workers, the reaction dispatcher, projections, schedules). Runs after data is available and before any listener accepts traffic. |
| `listen` | Kernel | The HTTP host mounts each app's transports and the invocation protocol; listener modules start on the ports the deployment binds. The process reports ready. |
| `stop` | Reverse order | Listeners stop accepting, in-flight invocations drain within a deadline, modules stop in reverse order, infrastructure closes. |

Two runtime hooks exist beside the process lifecycle, because backends and tenants are created
while the process runs: `onBackendCreated(backend)` and `onTenantCreated(tenant)` (and their
`...Retired` counterparts). They run as reactions of the module's service principal. A module uses
them to provision per-tenant data (a mailbox root, a default team), never to run migrations:
tenant creation is a data operation, the schema is already there.

### 3.4 Wiring: explicit, no container

There is no dependency-injection container, no decorators and no reflection. A module's code
reaches what it needs through the typed **context** (section 7.6), and that context is computed
from the module alone: `ActionContext<M>` depends on the module's own definition, its `requires`
and `optional` lists and the contracts it declares, never on an app. Module packages are compiled
and type-checked once, before any app that selects them exists, and several apps share them; a
handler type that depended on the app would need an import of the app from the module package,
which is a cycle.

- `ctx.data.<module>.<entity>`: repositories for the module's own entities (full rows, with the
  module's own authority), and read access to the entities of modules it `requires` (typed as
  present) or lists as `optional` (typed as possibly undefined). Writes to another module's
  entity are limited to the fields this module contributed to it; anything else goes through that
  module's actions or services (section 8.4).
- `ctx.services.<module>.<name>`: service functions of the module itself and of its dependencies,
  bound by the kernel to the providing module's context (section 5.5); call sites pass no context.
- `ctx.extensions.<name>`: the values other modules contributed to this module's extension points,
  with behavioural values already bound to their contributor's context (section 5.5).
- `ctx.invoke(ref, input)`: actions of the module itself and of its required modules, run through
  the invoker under the current principal with their declared execution mode, joining the current
  unit when they share its scope; `ctx.enqueue(ref, input)` runs a command after commit and returns
  its receipt (section 7.6).
- `ctx.live`, `ctx.blobs`: present when the module requires the `live` or `blobs` contract,
  possibly undefined when it lists the contract as `optional`, absent otherwise (section 5.2).

Inside a conditional part, the `when` modules count as required, so a reaction declared under
`w.when([accounts], ...)` sees `ctx.data.accounts` as present. Module ids with hyphens appear in
lower camel case in the context (`ctx.data.mailStore`, `ctx.services.apiKeys`), while references
keep the id (`mail-store.email.get`); a camel-case collision between two selected modules is a
compose error (section 5.1).

App-level types (`AppEntities<App>`, `AppActionTree<App>`, `AppClient<App>`) exist for what is
genuinely per app: app actions, clients, transports and the generated file (section 13.1).
Decorators are also excluded by the toolchain: sources run under Node's type stripping, which
allows only erasable syntax (section 13.3).

### 3.5 Multi-tenancy in the kernel

Every invocation carries a `Scope` resolved before anything else runs (section 9.2). The kernel
owns the control entities, the scope directory, the scope levels on actions, the principal
resolver extension point, the deployment-ordered tenant resolvers, and the admission stage that
applies per-tenant quotas (section 12.2). The operator principal is resolved by the kernel itself,
so the deployment can be administered even when no authentication module is enabled:

- on the operator Unix socket, connecting is proof of operator access (file mode 0600 inside a
  0700 directory, section 16.8.3); the static deployment secret serves only to bootstrap over that
  socket;
- remote operator profiles use short-lived operator tokens (`core.operatorToken`): issued over the
  socket or after an operator passkey login, expiring after 12 hours by default, revocable one by
  one, and audited at issue and use. The static secret is never accepted over the network.

Section 12 collects what each layer does.

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
import { contracts, defineModule, extensionPoint, field, shape, type ModuleType } from '@pennestack/core'
import { accounts } from '@pennestack/module-accounts'

const authDef = defineModule({
  id: 'auth',                       // literal; permanent; grammar and reserved ids in section 5.1
  version: '0.1.0',                 // informational; the id is the identity
  requires: [],                     // hard dependencies: module values or contracts; compile-time and boot-time checked
  optional: [accounts, contracts.live], // soft dependencies: typed as possibly undefined in the context
  provides: [],                     // contracts this module implements (the live module provides contracts.live)
  config: shape({                   // per-backend configuration, validated when a backend is created
    sessionIdleMinutes: field.integer({ min: 5 }).default(720),
  }),
  data: { needs: [] },              // adapter capabilities: 'search', 'rowLocks', { sql: 'postgres' }, ... (section 14.3.3)
  extensionPoints: {                // typed slots other modules may fill (section 5.5)
    identityProviders: extensionPoint<IdentityProvider>({ mode: 'set' }),
  },
})
  .entities({ credential, session })                    // section 4.2
  .actions((b) => ({ login: b.command({ /* ... */ }) }))   // module-level actions, section 4.3
  .entityActions('credential', (e) => ({ revoke: e.command({ /* ... */ }) }))
  .policies((rule) => [ /* ... */ ])                    // section 4.4
  .reactions((r) => [ /* ... */ ])                      // event handlers, section 7.7
  .services((s) => ({ /* ... */ }))                     // typed functions for dependants, section 5.5
  .contributes((c) => [c.to(accounts, { /* ... */ })])  // section 5.3
  .conditional((w) => [w.when([accounts], { /* ... */ })]) // section 5.4
  .lifecycle({ setup, start, stop, onTenantCreated })   // section 3.3

// Every exported module value has a named type (section 13.11): dependants' declaration files
// then reference `Auth` instead of copying its structure.
export interface Auth extends ModuleType<typeof authDef> {}
export const auth: Auth = authDef
```

Why a builder: the callbacks receive builders whose handler parameters are already typed with
the module's context (`ctx.data`, `ctx.services`, entity rows), which a single object literal
cannot do because TypeScript cannot type a property from its siblings. The builder's accumulated
state is a plain object with the normalised shape of section 4.7; `defineApp` only ever sees that
shape. The chain must be unbroken for the accumulated type to survive, as with Hono and Elysia
(research: module-systems.md, section 3.1); a lint rule flags discarded steps (section 13.9).

Why the named type: a module value's type is inferred and anonymous, and `requires`, `optional`
and `contributes[].to` hold the full type of each dependency. Under `composite`, declaration emit
is mandatory and would copy every dependency's structure into each dependant's `.d.ts`,
recursively, until the compiler refuses with TS7056. `ModuleType<T>` is the identity; extending
it in an interface gives the value a name that emit references. `pennestack module new`
scaffolds the pattern, a GritQL rule flags an exported module or app value without a named type,
and CI measures declaration size (section 13.11).

### 4.2 `defineEntity` and the field model

```ts
export const credential = defineEntity({
  prefix: 'cred',                              // TypeID prefix at the API boundary: cred_01j...; unique per app
  dataSubject: 'subject',                      // whose personal data a row holds (section 14.7.4)
  fields: {
    subject: field.subject().index(),          // the auth subject, a SubjectId (section 8.5)
    kind: field.enum(['password', 'passkey']),
    identifier: field.string({ format: 'email' }).optional().personal(),  // login name of password credentials
    verifier: field.verifier(),                // password hash or passkey public key: hidden, sealed in events (section 6.6)
    label: field.string().optional().merge('lww'),
    lastUsedAt: field.instant().optional().maskable(),   // rules may hide it (section 8.1)
    revokedAt: field.instant().optional(),
  },
  relations: {},                               // reverse relations are added by contributions, see 6.3
  indexes: [{ fields: ['identifier'], unique: true, where: { kind: 'password', revokedAt: { isNull: true } } }],
  history: 'chain',                            // default; 'state', 'projection' or 'external' (section 6.6)
  tenancy: 'tenant',                           // default; 'backend' or 'deployment' for control data
  events: {                                    // domain events beyond the generated ones (section 15.1.5)
    revoked: shape({ at: field.instant(), reason: field.string().optional() }),
  },
  evolve: {                                    // how a domain event changes the state (pure)
    revoked: (state, e) => ({ ...state, revokedAt: e.at }),
  },
  invariant: (row) => row.kind !== 'password' || row.identifier !== undefined,   // checked on every post-image
  generated: { set: false },                   // credentials change only through auth's own commands
})
```

Every entity gets system fields the author never declares: `id` (UUIDv7, prefixed at the API),
`createdAt`, `updatedAt`, `archivedAt` (nullable; the tombstone), `version` (the stream version:
1 after creation, incremented by every event, used for optimistic concurrency) and, when
`tenancy` is `tenant`, a `tenantId` that no transport exposes and the data layer always filters
on. Positions, which order events across streams, are a separate concept (section 15.1.4).

The `field.*` builders are the single source for types, validation, JSON Schema, GraphQL types
and columns. The core defines the kinds and the modifiers; section 14.5.1 maps them to dialects.

| Builder | TypeScript type | Notes |
|---|---|---|
| `field.string()`, `field.text()` | `string` | `maxLength`, `pattern`, `format` ('email', 'uri', 'hostname') |
| `field.integer()` | `number` | stored in 64 bits, validated to the safe-integer range; `min`, `max` |
| `field.integer({ wide: true })` | `bigint` | decimal string on the wire |
| `field.decimal({ precision, scale })` | `string` | an exact canonical decimal; never a binary float |
| `field.float()` | `number` | IEEE 754 double, for measurements and introspected `real` columns |
| `field.boolean()` | `boolean` | |
| `field.instant()` | `Date` now; `Temporal.Instant` once Node 26 is the baseline | UTC only; RFC 3339 at the boundary |
| `field.date()`, `field.timeZone()` | `string` | ISO calendar date; IANA zone name |
| `field.enum([...])` | union of the literals | |
| `field.json(schema)` | the schema's output type | any Standard Schema; stored as JSON |
| `field.ref(module, entity)`, `field.ref.own(entity)` | `Id<'module.entity'>` | a typed reference; where it may point is section 6.3; `own` names an entity of the declaring or contributing module |
| `field.subject()` | `SubjectId` | an opaque principal or data-subject id |
| `field.serial({ per })` | `number` | allocated at insert, strictly ascending per partition, read-only (IMAP UIDs) |
| `field.set(inner)`, `field.list(inner)` | `ReadonlySet<T>`, `readonly T[]` | observed-remove set for merge `set`; CRDT list for merge `sequence` |
| `field.richText()` | `RichText` (an opaque document handle) | merge `richText`; an app needs a codec module (section 15.3.9) |
| `field.binary()` | `Uint8Array` | small payloads; large ones are blobs |
| `field.blob({ mediaType, maxBytes })` | `BlobRef` | a reference into a blob store; requires the `blobs` contract (gap G5) |
| `field.secret()` | entity fields: `SecretRef` in process; action inputs: `string`; write-only at the boundary | entity fields are sealed per value and read only through `ctx.secrets.reveal` (section 6.6); input values are redacted from logs, traces, receipts and errors |
| `field.verifier()` | `string`, hidden | a one-way verifier (password hash, token verifier); sealed per value in events (section 6.6) |

Modifiers, all chainable and all reflected in the type: `.optional()`, `.default(value)`,
`.unique()` (unique among non-archived rows; implies merge `exclusive`), `.index()`, `.hidden()`
(section 6.6), `.maskable()` (rules may hide the field from readers; section 8.1), `.personal()`
or `.personal({ subject })` (encrypted per data subject in the chain; section 14.7.4),
`.stateOnly()` (kept in the state table, never written to events; section 6.6),
`.merge(type)` (section 15.3.4; default `lww` for scalars, `exclusive` for unique fields),
`.tag(n)` (a stable protobuf-style field number; allocated deterministically and recorded in the
module snapshot when omitted), `.describe(text)` and `.deprecated(reason)`. Every modifier returns
a field that keeps every earlier flag and the reference (section 4.7).

Entity options beyond the example: `partition: '<field>'` (an immutable field that partitions
change tokens, section 15.1.4), `searchIndexes` (section 14.3.3), `projection` and `source` for
the `projection` and `external` history modes (sections 15.2.2 and 14.8.4), `rederive` (recomputes
`stateOnly` fields during rebuilds), and `retention: { suggest }` (section 14.7.1).

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
    scope: 'tenant',                                       // default
    decide: (input, current, ctx) => {                     // pure: the full current row in, events out
      if (current.revokedAt) throw alreadyRevoked({ id: current.id })
      return [e.events.revoked({ at: ctx.clock.now(), reason: input.reason })]
    },
    // output defaults to the entity row after the events are applied, masked for the caller
  }),
  active: e.query({
    input: shape({ subject: field.subject() }),
    output: e.page(),                                      // a page of rows, cursor pagination
    handle: (input, ctx) => ctx.target.query({             // the entity as the caller may read it under this action's rules
      where: { subject: input.subject, revokedAt: { isNull: true } },
      sort: [{ field: 'createdAt', direction: 'desc' }],
    }),
  }),
}))

.actions((b) => ({
  login: b.command({
    input: shape({ identifier: field.string({ format: 'email' }), password: field.secret() }),
    output: shape({ sessionToken: field.string(), sessionId: field.ref.own('session'), expiresAt: field.instant() }),
    errors: [invalidCredentials],
    auth: { public: true },                                // no principal required; still scoped to a tenant
    execution: 'sync',
    hints: { http: { cookie: { set: { name: '__Host-pennestack_session', from: 'sessionToken', expiresFrom: 'expiresAt' }, omitFromBody: ['sessionToken'] } } },
    handle: async (input, ctx) => { /* section 17.2 */ },
  }),
  // principalShape and summarise() are module-local helpers, not framework exports
  whoami: b.query({ output: principalShape, principal: 'user', handle: (_, ctx) => summarise(ctx.principal) }),
}))

.conditional((w) => [
  w.when([contracts.live], {                               // the subscription exists only when a live module is selected
    actions: (b) => ({
      sessionEvents: b.subscription({
        event: shape({ sessionId: field.ref.own('session'), kind: field.enum(['created', 'revoked']) }),
        principal: 'user',                                 // the gate admits user principals only; ctx.principal is narrowed
        source: (_input, ctx, resume) =>                   // resume: the stream token the client presented
          mapItems(
            ctx.live.entity('auth', 'session', { where: { subject: ctx.principal.subject }, after: resume }),
            (change) => ({ sessionId: change.id, kind: change.type === 'created' ? 'created' : 'revoked' }),
          ),
      }),
    }),
  }),
])
```

`handle` is the imperative form (runs inside a transaction for commands; reads through `ctx.data`
for queries). `decide` is the pure form for commands on chain-backed entities: it receives the
full current row, returns events, and the kernel appends them, evolves the state and returns it.
`source` builds a subscription's frames; `mapItems` changes items and keeps stream tokens and
control frames, so the subscription stays resumable. Section 7 defines the full option set.

### 4.4 Policies

```ts
.policies((rule) => [
  rule.allow('credential', ['read'], {                     // 'read' covers get, query, changes, queryChanges, watch, history
    id: 'self',                                            // becomes auth.credential.self
    principal: 'user',                                     // narrows ctx.principal: subject is a SubjectId, never null
    where: (ctx) => ({ subject: ctx.principal.subject }),  // typed condition over credential
    fields: ['lastUsedAt'],                                // the maskable fields this rule reveals
    reason: 'A user may see their own credentials.',
  }),
  rule.allow('credential', ['revoke'], { id: 'self-revoke', principal: 'user', where: (ctx) => ({ subject: ctx.principal.subject }) }),
  rule.deny('credential', ['revoke'], {                    // without `check`, a deny rule tests the row before the action
    id: 'already-revoked',
    where: () => ({ revokedAt: { isNull: false } }),
    reason: 'This credential is already revoked.',
  }),
  rule.allow('login', { public: true }),                   // module-level action
  rule.allow('whoami', { principal: 'user' }),
])

// A transition: members may move an invitation from pending to withdrawn, and to nothing else.
rule.allow('invitation', ['update'], {
  id: 'withdraw',
  principal: 'user',
  where: (ctx) => ({ status: 'pending', invitedBy: ctx.principal.subject }),   // the row acted on
  check: () => ({ status: 'withdrawn' }),                                      // the row produced
})
```

Entity rules carry a `where` condition over the row acted on (compiled to the data layer and
interpreted in memory) and an optional `check` over the row an action produces; module-level
rules carry a `when` predicate over context and input. An interpolated `null` or `undefined` never
matches; null tests use `isNull` (section 8.3). Semantics and composition are in section 8. A
contribution can add rules to another module's entities (section 5.3).

### 4.5 `defineApp`

```ts
import { defineApp, field, shape, type AppType, type Row } from '@pennestack/core'
import { accounts } from '@pennestack/module-accounts'
import { auth } from '@pennestack/module-auth'
import { live } from '@pennestack/live'
import { graphql } from '@pennestack/transport-graphql'
import { rest } from '@pennestack/transport-rest'

const launchwayDef = defineApp({
  id: 'launchway',
  modules: [accounts, auth, live, projects, deployments, graphql, rest],   // const tuple; order is a tie-break only
  actions: (b) => ({ health: b.query({ /* app-level, referenced as app.health */ }) }),
  execution: { 'deployments.deployment.redeploy': 'async' }, // how external callers are answered (section 7.4)
  authorization: { mode: 'strict', decisionLog: 'denials' },
  policies: { disable: [], add: [] },                      // per-app rule overrides, section 8.7
})
export interface Launchway extends AppType<typeof launchwayDef> {}
export const launchway: Launchway = launchwayDef

export type Profile = Row<Launchway, 'accounts.profile'>   // exact for this selection
```

Apps list only modules: data adapters, the HTTP host, blob stores and the queue are infrastructure
of the deployment (section 4.6), so an app never chooses a database. `defineApp` is uncallable
when the tuple is inconsistent; the error names the problem (`missingModules: 'accounts'`,
`conflictingFields: 'accounts.profile.lastLoginAt'`, ...). The checks are listed in section 4.7.
At runtime it repeats the same checks (for dynamic callers and JavaScript) and builds the
registry.

### 4.6 `defineDeployment`

```ts
// pennestack.config.ts
import { byHeader, byHostname, byScopeKey, defineDeployment, env, secret } from '@pennestack/core'
import { postgresAdapter } from '@pennestack/adapter-postgres'
import { httpHost } from '@pennestack/transport-http'
import { blobsFs } from '@pennestack/blobs-fs'
import { ledgerFile } from '@pennestack/core/ledger'

export default defineDeployment({
  apps: [launchway, mail],                                 // the catalogue a backend can be created from
  infrastructure: [                                        // fills the deployment-level extension points (section 5.6)
    postgresAdapter(),                                     // data adapter factory 'postgres' (section 14.3.7)
    httpHost({ listen: [{ port: 3000 }] }),                // provides contracts.httpHost; serves the invocation protocol for every app
    blobsFs({ root: '/var/lib/pennestack/blobs' }),        // provides contracts.blobs (gap G5)
    ledgerFile({ path: '/var/lib/pennestack-ledger/erasure.log' }),   // erasure-ledger sink outside placement backups (section 14.7.6)
  ],
  control: { adapter: 'postgres', url: env('PENNESTACK_CONTROL_URL') },
  placements: {                                            // where tenant data may live; chosen per tenant at creation
    default: { adapter: 'postgres', url: env('PENNESTACK_DATA_URL'), strategy: 'shared-tables' },
  },
  tenantResolution: [byHostname(), byScopeKey(), byHeader('x-pennestack-tenant')],   // deployment order
  ports: { 'smtp-in.mx': 25 },                             // listener ports belong to the deployment (gap G1)
  operator: { socket: '/run/pennestack/operator.sock', hosts: ['ops.example'], bootstrapSecret: secret('PENNESTACK_OPERATOR_SECRET') },
  keys: { masterKey: secret('PENNESTACK_MASTER_KEY') },    // root of the key service (section 14.7.4)
  telemetry: { otlp: env('OTEL_EXPORTER_OTLP_ENDPOINT') },
})
```

A deployment names the apps it can run; backends are rows in the control store that reference an
app id. Creating a backend with a module selection that no app in the catalogue has means adding a
`defineApp` line and deploying, which is a configuration change, not a kernel change. The
alternative, selecting modules at runtime, cannot have exact types and is rejected (ADR 0003).

`defineDeployment` checks, at the type level and again at boot, that its infrastructure provides
every deployment-level contract any app's modules require (`missingInfrastructure: 'blobs'`). The
kernel job queue is built on the data adapters' job store and needs no entry (section 9.5); a
different queue implementation can replace it as an infrastructure entry. Secret providers default
to the process environment. The conventional entry file is `pennestack.config.ts` with a default
export; `--config` and `PENNESTACK_CONFIG` name another (section 16.9.1).

### 4.7 The type-level model

The derived types operate on the normalised module shape below, which is what the builder
accumulates. The listing was checked on 2026-10-11 with TypeScript 7.0.2 and 5.9.3
(`--strict --exactOptionalPropertyTypes --noUncheckedIndexedAccess`) together with the fourteen
groups of positive and negative cases listed after it: every positive case holds, and every
negative case fails with the named check. The file with its cases costs 61,042 type
instantiations on TypeScript 7.0.2 (57,242 on 5.9.3).

The listing models the composition fold, not the whole DSL. The builder chain and its typed
callbacks, the module-local contexts of section 7.6, action input and output types derived from
the field model, `Insert` and `Patch`, and relations are the spike's work, against the checklist
at the end of this section. The spike must keep these properties:

- every lookup is a mapped type over the union of module ids plus `Extract` by id; there is no
  recursion over the tuple, so depth is constant in the number of modules;
- contributions are a union of objects filtered by `to` and `when` and tagged with their
  contributor, not a tuple walk;
- a module literal without a key (`requires`, `contributes`) contributes nothing, which needs the
  distributive `infer` form (`Ms[number] extends infer M ? M extends { ... } ? ... : never : never`);
- a field defined by more than one source (own, a conditional part, a contributor) is a conflict
  whatever its types, which mirrors the boot check; comparing types cannot detect conflicts
  between subtype-related types (an enum and a string, a branded id and a string);
- positions are compared on the author's tuple: a mapped type over a variadic tuple
  (`[Core, ...Ms]`) numbers the spread elements from zero again, which hid a duplicate of the core
  module until reserved ids got their own check (found while checking this listing);
- every public derived type is named and wrapped in `Prettify`, so hovers show rows, not
  conditionals;
- every type that can appear in a module value's type is exported by `@pennestack/core`;
  otherwise declaration emit fails with TS4023 or TS2742 (checked with this listing);
- a single `any` in a module definition would collapse `UnionToIntersection`; module packages
  compile with `noImplicitAny` and a type test asserts that `AnyModule` constraints never
  mention `any`.

```ts
// ---- Helpers
type Prettify<T> = { [K in keyof T]: T[K] } & {}
type UnionToIntersection<U> = (U extends unknown ? (x: U) => void : never) extends (x: infer I) => void ? I : never
type IsUnion<T, U = T> = [T] extends [never] ? false : T extends unknown ? ([U] extends [T] ? false : true) : never
type AllKeys<U> = U extends unknown ? keyof U : never
type TypeAt<U, K extends PropertyKey> = U extends unknown ? (K extends keyof U ? U[K] : never) : never
type Check<Problem, Key extends string> = [Problem] extends [never] ? {} : { readonly [K in Key]: Problem }

declare const entityBrand: unique symbol
export type Id<Ref extends string> = string & { readonly [entityBrand]: Ref }

// ---- Field model: every modifier returns a FieldDef that keeps all flags and the reference
type FieldKind = 'string' | 'integer' | 'instant' | 'enum' | 'ref'
interface FieldFlags { readonly optional: boolean; readonly defaulted: boolean; readonly hidden: boolean; readonly maskable: boolean }
interface NoFlags { readonly optional: false; readonly defaulted: false; readonly hidden: false; readonly maskable: false }
type Flag<F extends FieldFlags, K extends keyof FieldFlags> = { readonly [P in keyof FieldFlags]: P extends K ? true : F[P] }
interface AbsoluteRef { readonly module: string; readonly entity: string }
interface OwnRef { readonly own: true; readonly entity: string }

declare const valueType: unique symbol
export interface FieldDef<T, F extends FieldFlags = NoFlags, R extends AbsoluteRef | OwnRef | null = null> {
  readonly kind: FieldKind
  readonly flags: F
  readonly ref: R
  readonly [valueType]?: T
  optional(): FieldDef<T, Flag<F, 'optional'>, R>
  default(value: T): FieldDef<T, Flag<F, 'defaulted'>, R>
  hidden(): FieldDef<T, Flag<F, 'hidden'>, R>
  maskable(): FieldDef<T, Flag<F, 'maskable'>, R>
  unique(): FieldDef<T, F, R>
  index(): FieldDef<T, F, R>
}
type AnyField = FieldDef<unknown, FieldFlags, AbsoluteRef | OwnRef | null>

/** Own references name an entity of the declaring (or contributing) module; resolved per source. */
type ResolveFields<F, Owner extends string> = {
  readonly [K in keyof F]: F[K] extends FieldDef<infer _T, infer Fl, infer R>
    ? R extends { readonly own: true; readonly entity: infer E extends string }
      ? FieldDef<Id<`${Owner}.${E}`>, Fl, { readonly module: Owner; readonly entity: E }>
      : F[K]
    : never
}
type FieldValue<F> = F extends FieldDef<infer T, infer Fl, infer _R> ? (Fl extends { readonly optional: true } ? T | undefined : T) : never
type IsOptional<F> = F extends { readonly flags: { readonly optional: true } } ? true : false
type RowOf<F> = Prettify<
  { readonly [K in keyof F as IsOptional<F[K]> extends true ? never : K]: FieldValue<F[K]> } &
  { readonly [K in keyof F as IsOptional<F[K]> extends true ? K : never]?: FieldValue<F[K]> }
>

// ---- Actions carry kind, execution and phantom input and output types
type ActionKind = 'query' | 'command' | 'subscription'
type Execution = 'sync' | 'async' | 'either'
declare const ioTypes: unique symbol
export interface ActionDef<K extends ActionKind, I, O, X extends Execution> {
  readonly kind: K
  readonly execution: X
  readonly [ioTypes]?: { readonly input: I; readonly output: O }
}
type AnyAction = ActionDef<ActionKind, unknown, unknown, Execution>

// ---- Normalised definitions (what the builder accumulates and defineApp consumes)
type HistoryMode = 'chain' | 'state' | 'projection' | 'external'
type GeneratorTemplate = 'watch'                       // closed, core-known set filled by modules
interface AnyEntity {
  readonly fields: { readonly [name: string]: AnyField }
  readonly history?: HistoryMode
  readonly generated?: { readonly [K in 'get' | 'query' | 'changes' | 'queryChanges' | 'set' | 'history' | GeneratorTemplate]?: boolean }
  readonly actions?: { readonly [name: string]: AnyAction }
}
interface AnyEntityPatch { readonly fields?: { readonly [name: string]: AnyField }; readonly actions?: { readonly [name: string]: AnyAction } }
interface AnyContract { readonly contract: string; readonly level: 'app' | 'deployment' }
interface AnyContribution {
  readonly to: AnyModule
  readonly when?: readonly AnyModule[]
  readonly entities?: { readonly [entity: string]: AnyEntityPatch }
  readonly actions?: { readonly [name: string]: AnyAction }
}
interface AnyConditional {
  readonly when: readonly (AnyModule | AnyContract)[]
  readonly entities?: { readonly [entity: string]: AnyEntityPatch }
  readonly actions?: { readonly [name: string]: AnyAction }
}
export interface AnyModule {
  readonly id: string
  readonly requires?: readonly (AnyModule | AnyContract)[]
  readonly optional?: readonly (AnyModule | AnyContract)[]
  readonly provides?: readonly AnyContract[]
  readonly generates?: readonly GeneratorTemplate[]
  readonly entities?: { readonly [entity: string]: AnyEntity }
  readonly actions?: { readonly [name: string]: AnyAction }
  readonly contributes?: readonly AnyContribution[]
  readonly conditional?: readonly AnyConditional[]
}
/** Module values get a named type, so declaration emit references it instead of copying the structure. */
export type ModuleType<T extends AnyModule> = T

// ---- Module-level checks (defineModule)
type DepIds<L> = L extends readonly (infer R)[] ? (R extends { readonly id: infer I extends string } ? I : never) : never
type RequiresOf<M> = M extends { readonly requires: infer L } ? DepIds<L> : never
type RefsOf<Path extends string, F> = { [K in keyof F]: F[K] extends { readonly ref: { readonly module: infer RM extends string } } ? `${Path}.${K & string} -> ${RM}` : never }[keyof F]
type RefTarget<S extends string> = S extends `${string} -> ${infer T}` ? T : never
type BadRefs<Refs extends string, Allowed extends string> = Refs extends unknown ? (RefTarget<Refs> extends Allowed ? never : Refs) : never
type EntityRefs<Path extends string, Es> = { [E in keyof Es]: Es[E] extends { readonly fields: infer F } ? RefsOf<`${Path}.${E & string}`, F> : never }[keyof Es]
type UnguardedOf<Path extends string, Es> = {
  [E in keyof Es]: Es[E] extends { readonly fields: infer F }
    ? { [K in keyof F]: F[K] extends { readonly flags: { readonly optional: true } } | { readonly flags: { readonly defaulted: true } } ? never : `${Path}.${E & string}.${K & string}` }[keyof F]
    : never
}[keyof Es]
/** A reference may target the module itself (own), a hard requirement, or, inside a contribution or conditional part, its target and `when` modules. */
type RefsOutsideRequirements<M extends AnyModule> =
  | (M extends { readonly entities: infer Es } ? BadRefs<EntityRefs<M['id'], Es>, RequiresOf<M>> : never)
  | (M extends { readonly conditional: readonly (infer Cd)[] } ? (Cd extends { readonly when: infer W; readonly entities: infer Es } ? BadRefs<EntityRefs<`${M['id']}[when]`, Es>, RequiresOf<M> | DepIds<W>> : never) : never)
  | (M extends { readonly contributes: readonly (infer C)[] }
      ? (C extends { readonly to: { readonly id: infer T extends string }; readonly entities: infer Es }
          ? BadRefs<EntityRefs<`${M['id']}->${T}`, Es>, RequiresOf<M> | T | (C extends { readonly when: infer W } ? DepIds<W> : never)>
          : never)
      : never)
/** Contributed and conditional fields must be optional or defaulted: rows are inserted while those parts are inactive. */
type UnguardedFields<M extends AnyModule> =
  | (M extends { readonly conditional: readonly (infer Cd)[] } ? (Cd extends { readonly entities: infer Es } ? UnguardedOf<`${M['id']}[when]`, Es> : never) : never)
  | (M extends { readonly contributes: readonly (infer C)[] } ? (C extends { readonly to: { readonly id: infer T extends string }; readonly entities: infer Es } ? UnguardedOf<`${M['id']}->${T}`, Es> : never) : never)
type ModuleChecks<M extends AnyModule> = Check<RefsOutsideRequirements<M>, 'refsOutsideRequirements'> & Check<UnguardedFields<M>, 'contributedFieldsNeedDefault'>

export declare function defineModule<const M extends AnyModule>(m: M & ModuleChecks<M>): M
export declare function contribute<const To extends AnyModule, const Spec extends Omit<AnyContribution, 'to'>>(to: To, spec: Spec): Prettify<{ readonly to: To } & Spec>
export declare function whenPresent<const When extends readonly (AnyModule | AnyContract)[], const Spec extends Omit<AnyConditional, 'when'>>(when: When, spec: Spec): Prettify<{ readonly when: When } & Spec>
export declare function defineContract<const C extends string, const L extends 'app' | 'deployment'>(contract: C, level: L): { readonly contract: C; readonly level: L }
export declare function query<I, O>(): ActionDef<'query', I, O, 'sync'>
export declare function command<I, O, const X extends Execution = 'sync'>(execution?: X): ActionDef<'command', I, O, X>
export declare function subscription<I, E>(): ActionDef<'subscription', I, E, 'sync'>
export declare const field: {
  string(): FieldDef<string>
  integer(): FieldDef<number>
  instant(): FieldDef<Date>
  enum<const V extends readonly string[]>(values: V): FieldDef<V[number]>
  ref: {
    <M extends AnyModule, E extends EntityNames<M>>(module: M, entity: E): FieldDef<Id<`${M['id']}.${E}`>, NoFlags, { readonly module: M['id']; readonly entity: E }>
    own<const E extends string>(entity: E): FieldDef<never, NoFlags, { readonly own: true; readonly entity: E }>
  }
}

// ---- The implicit core module, always first in the selection
export declare const core: {
  readonly id: 'core'
  readonly entities: {
    readonly backend: { readonly fields: { readonly name: FieldDef<string>; readonly app: FieldDef<string> } }
    readonly tenant: { readonly fields: { readonly name: FieldDef<string> } }
    readonly commandReceipt: { readonly history: 'state'; readonly generated: { readonly set: false }; readonly fields: { readonly commandId: FieldDef<string> } }
  }
  readonly actions: { readonly introspect: ActionDef<'query', void, unknown, 'sync'>; readonly me: ActionDef<'query', void, unknown, 'sync'> }
}
type WithCore<Ms extends readonly AnyModule[]> = readonly [typeof core, ...Ms]

// ---- Lookups over the selection, without recursion
type Ids<Ms extends readonly AnyModule[]> = Ms[number]['id']
type ById<Ms extends readonly AnyModule[], I extends string> = Extract<Ms[number], { readonly id: I }>
type EntityNames<M> = M extends { readonly entities: infer E } ? keyof E & string : never
/** true when every module in `W` is selected and every app-level contract in `W` is provided; `W` may be `never` (no condition). */
type Satisfied<Ms extends readonly AnyModule[], W> =
  [W] extends [readonly unknown[]] ? ([Exclude<DepIds<W>, Ids<Ms>> | Exclude<ContractsIn<W, 'app'>, ProvidedContracts<Ms>>] extends [never] ? true : false) : true
/** Every contribution of the selection, tagged with its contributor. */
type AllContributions<Ms extends readonly AnyModule[]> =
  Ms[number] extends infer M
    ? (M extends { readonly id: infer From extends string; readonly contributes: readonly (infer C)[] } ? (C extends unknown ? C & { readonly from: From } : never) : never)
    : never
/** Contributions whose target is selected and whose `when` list is satisfied. */
type ActiveContributions<Ms extends readonly AnyModule[]> =
  AllContributions<Ms> extends infer C
    ? C extends { readonly to: { readonly id: infer T extends string } }
      ? T extends Ids<Ms> ? (Satisfied<Ms, C extends { readonly when: infer W } ? W : never> extends true ? C : never) : never
      : never
    : never
type ActiveConditionals<Ms extends readonly AnyModule[], M> =
  M extends { readonly conditional: readonly (infer Cd)[] } ? (Cd extends { readonly when: infer W } ? (Satisfied<Ms, W> extends true ? Cd : never) : never) : never

// ---- Entities: field sources tagged by origin, own references resolved per source
type OwnSource<Ms extends readonly AnyModule[], I extends string, E extends string> =
  ById<Ms, I> extends { readonly entities: { readonly [K in E]: { readonly fields: infer F } } } ? { readonly source: `own:${I}`; readonly fields: ResolveFields<F, I> } : never
type ConditionalSources<Ms extends readonly AnyModule[], I extends string, E extends string> =
  ActiveConditionals<Ms, ById<Ms, I>> extends infer Cd
    ? (Cd extends { readonly entities: { readonly [K in E]: { readonly fields: infer F } } } ? { readonly source: `conditional:${I}`; readonly fields: ResolveFields<F, I> } : never)
    : never
type ContributedSources<Ms extends readonly AnyModule[], I extends string, E extends string> =
  ActiveContributions<Ms> extends infer C
    ? (C extends { readonly to: { readonly id: I }; readonly from: infer From extends string; readonly entities: { readonly [K in E]: { readonly fields: infer F } } }
        ? { readonly source: `contribution:${From}`; readonly fields: ResolveFields<F, From> }
        : never)
    : never
type FieldSources<Ms extends readonly AnyModule[], I extends string, E extends string> = OwnSource<Ms, I, E> | ConditionalSources<Ms, I, E> | ContributedSources<Ms, I, E>
type EntityFields<Ms extends readonly AnyModule[], I extends string, E extends string> = UnionToIntersection<FieldSources<Ms, I, E>['fields']>

interface SystemFields<Ref extends string> {
  readonly id: Id<Ref>
  readonly createdAt: Date
  readonly updatedAt: Date
  readonly archivedAt?: Date | undefined
  readonly version: number                             // the stream version
}
type RowAt<Ms extends readonly AnyModule[], I extends string, E extends string> = Prettify<SystemFields<`${I}.${E}`> & RowOf<EntityFields<Ms, I, E>>>
type AppEntitiesOf<Ms extends readonly AnyModule[]> = { readonly [I in Ids<Ms>]: { readonly [E in EntityNames<ById<Ms, I>>]: RowAt<Ms, I, E> } }

// ---- Actions: own, contributed and conditional parts, generated actions, core and app actions
type ModuleActionDefs<Ms extends readonly AnyModule[], I extends string> =
  | (ById<Ms, I> extends { readonly actions: infer A } ? A : never)
  | (ActiveContributions<Ms> extends infer C ? (C extends { readonly to: { readonly id: I }; readonly actions: infer A } ? A : never) : never)
  | (ActiveConditionals<Ms, ById<Ms, I>> extends infer Cd ? (Cd extends { readonly actions: infer A } ? A : never) : never)
type EntityActionDefs<Ms extends readonly AnyModule[], I extends string, E extends string> =
  | (ById<Ms, I> extends { readonly entities: { readonly [K in E]: { readonly actions: infer A } } } ? A : never)
  | (ActiveContributions<Ms> extends infer C ? (C extends { readonly to: { readonly id: I }; readonly entities: { readonly [K in E]: { readonly actions: infer A } } } ? A : never) : never)
  | (ActiveConditionals<Ms, ById<Ms, I>> extends infer Cd ? (Cd extends { readonly entities: { readonly [K in E]: { readonly actions: infer A } } } ? A : never) : never)

type EntityDef<Ms extends readonly AnyModule[], I extends string, E extends string> = ById<Ms, I> extends { readonly entities: { readonly [K in E]: infer D } } ? D : never
type SetOperations = 'set' | 'create' | 'update' | 'archive' | 'restore'
type BaseGenerated<D> =
  D extends { readonly history: 'external' } ? 'get' | 'query'
  : D extends { readonly history: 'projection' } ? 'get' | 'query' | 'changes' | 'queryChanges'
  : 'get' | 'query' | 'changes' | 'queryChanges' | SetOperations
type OptInGenerated<D> = D extends { readonly generated: { readonly history: true } } ? 'history' : never
type SwitchedOff<D> = D extends { readonly generated: infer G } ? { [K in keyof G]: G[K] extends false ? (K extends 'set' ? SetOperations : K) : never }[keyof G] : never
type Generators<Ms extends readonly AnyModule[]> = Ms[number] extends infer M ? (M extends { readonly generates: readonly (infer G)[] } ? G : never) : never
type GeneratedNames<Ms extends readonly AnyModule[], I extends string, E extends string> =
  EntityDef<Ms, I, E> extends infer D
    ? Exclude<BaseGenerated<D> | OptInGenerated<D> | (D extends { readonly history: 'external' } ? never : Generators<Ms>), SwitchedOff<D>>
    : never

interface Page<R> { readonly items: readonly R[]; readonly pageInfo: { readonly hasNextPage: boolean; readonly endCursor: string | null }; readonly queryState: string }
type EntityChange<R> = { readonly type: 'created' | 'changed' | 'restored'; readonly row: R } | { readonly type: 'archived' | 'removed'; readonly id: string }
interface CommandReceipt { readonly commandId: string; readonly status: 'accepted' }
type GeneratedDef<N, R extends { readonly id: string }> =
  N extends 'get' ? ActionDef<'query', { readonly ids: readonly R['id'][] }, { readonly list: readonly R[]; readonly notFound: readonly string[]; readonly state: string }, 'sync'>
  : N extends 'query' ? ActionDef<'query', { readonly filter?: unknown; readonly first?: number; readonly after?: string }, Page<R>, 'sync'>
  : N extends 'changes' | 'queryChanges' ? ActionDef<'query', { readonly since: string }, { readonly newState: string }, 'sync'>
  : N extends 'create' ? ActionDef<'command', Partial<R>, R, 'sync'>
  : N extends 'update' ? ActionDef<'command', { readonly id: R['id']; readonly patch: Partial<R>; readonly ifVersion?: number }, R, 'sync'>
  : N extends 'archive' | 'restore' ? ActionDef<'command', { readonly id: R['id']; readonly ifVersion?: number }, R, 'sync'>
  : N extends 'set' ? ActionDef<'command', { readonly create?: unknown; readonly update?: unknown; readonly archive?: unknown; readonly restore?: unknown }, unknown, 'sync'>
  : N extends 'history' ? ActionDef<'query', { readonly id: R['id'] }, Page<unknown>, 'sync'>
  : N extends 'watch' ? ActionDef<'subscription', { readonly filter?: unknown; readonly after?: string }, EntityChange<R>, 'sync'>
  : never

type ModuleActionNames<Ms extends readonly AnyModule[], I extends string> = AllKeys<ModuleActionDefs<Ms, I>> & string
type EntityActionNames<Ms extends readonly AnyModule[], I extends string, E extends string> = GeneratedNames<Ms, I, E> | (AllKeys<EntityActionDefs<Ms, I, E>> & string)
type EntityActionDef<Ms extends readonly AnyModule[], I extends string, E extends string, N extends string> =
  N extends GeneratedNames<Ms, I, E> ? GeneratedDef<N, RowAt<Ms, I, E>> : TypeAt<EntityActionDefs<Ms, I, E>, N>

type ActionRefsOf<Ms extends readonly AnyModule[], A> =
  | {
      [I in Ids<Ms>]:
        | { [E in EntityNames<ById<Ms, I>>]: `${I}.${E}.${EntityActionNames<Ms, I, E>}` }[EntityNames<ById<Ms, I>>]
        | `${I}.${ModuleActionNames<Ms, I>}`
    }[Ids<Ms>]
  | `app.${keyof A & string}`
type CommandsIn<Defs> = { [N in AllKeys<Defs> & string]: TypeAt<Defs, N> extends { readonly kind: 'command' } ? N : never }[AllKeys<Defs> & string]
type CommandRefsOf<Ms extends readonly AnyModule[], A> =
  | {
      [I in Ids<Ms>]:
        | { [E in EntityNames<ById<Ms, I>>]: `${I}.${E}.${Extract<GeneratedNames<Ms, I, E>, SetOperations> | CommandsIn<EntityActionDefs<Ms, I, E>>}` }[EntityNames<ById<Ms, I>>]
        | `${I}.${CommandsIn<ModuleActionDefs<Ms, I>>}`
    }[Ids<Ms>]
  | `app.${CommandsIn<A>}`

/** Leaves of the action tree: kind, input, output and the execution mode after defineApp({ execution }). */
type Leaf<D, Ref extends string, X> =
  D extends ActionDef<infer K, infer In, infer Out, infer Xd>
    ? { readonly kind: K; readonly input: In; readonly output: Out; readonly execution: Ref extends keyof X ? X[Ref] : Xd }
    : never
type AppActionTreeOf<Ms extends readonly AnyModule[], A, X> = {
  readonly [I in Ids<Ms>]: {
    readonly actions: { readonly [N in ModuleActionNames<Ms, I>]: Leaf<TypeAt<ModuleActionDefs<Ms, I>, N>, `${I}.${N}`, X> }
    readonly entities: {
      readonly [E in EntityNames<ById<Ms, I>>]: { readonly [N in EntityActionNames<Ms, I, E>]: Leaf<EntityActionDef<Ms, I, E, N>, `${I}.${E}.${N}`, X> }
    }
  }
} & { readonly app: { readonly actions: { readonly [N in keyof A & string]: Leaf<A[N], `app.${N}`, X> }; readonly entities: {} } }

// ---- Checks evaluated at defineApp
type RequiredModuleIds<Ms extends readonly AnyModule[]> = Ms[number] extends infer M ? (M extends { readonly requires: infer L } ? DepIds<L> : never) : never
type ContractsIn<L, Level extends string> = L extends readonly (infer R)[] ? (R extends { readonly contract: infer C extends string; readonly level: Level } ? C : never) : never
type RequiredAppContracts<Ms extends readonly AnyModule[]> = Ms[number] extends infer M ? (M extends { readonly requires: infer L } ? ContractsIn<L, 'app'> : never) : never
type ProvidedContracts<Ms extends readonly AnyModule[]> = Ms[number] extends infer M ? (M extends { readonly provides: infer L } ? ContractsIn<L, string> : never) : never
type MissingRequirements<Ms extends readonly AnyModule[]> = Exclude<RequiredModuleIds<Ms>, Ids<Ms>> | Exclude<RequiredAppContracts<Ms>, ProvidedContracts<Ms>>
type DuplicateIds<Ms extends readonly AnyModule[]> = {
  [P in keyof Ms]: Ms[P] extends { readonly id: infer A extends string } ? { [Q in keyof Ms]: Q extends P ? never : Ms[Q] extends { readonly id: A } ? A : never }[number] : never
}[number]
/** A field defined by more than one source (own, a conditional part, a contributor), whatever the types: mirrors the boot check. */
type SourcesDefining<S, K extends PropertyKey> = S extends { readonly source: infer Tag; readonly fields: infer F } ? (K extends keyof F ? Tag : never) : never
type ConflictingFields<Ms extends readonly AnyModule[]> = {
  [I in Ids<Ms>]: {
    [E in EntityNames<ById<Ms, I>>]: {
      [K in AllKeys<FieldSources<Ms, I, E>['fields']> & string]: IsUnion<SourcesDefining<FieldSources<Ms, I, E>, K>> extends true ? `${I}.${E}.${K}` : never
    }[AllKeys<FieldSources<Ms, I, E>['fields']> & string]
  }[EntityNames<ById<Ms, I>>]
}[Ids<Ms>]
/** Contributions naming an entity the selected target does not define (a typo, not a toggling effect). */
type UnknownContributionTargets<Ms extends readonly AnyModule[]> =
  AllContributions<Ms> extends infer C
    ? C extends { readonly from: infer From extends string; readonly to: { readonly id: infer To extends string }; readonly entities: infer Es }
      ? To extends Ids<Ms> ? (Exclude<keyof Es & string, EntityNames<ById<Ms, To>>> extends infer Bad extends string ? ([Bad] extends [never] ? never : `${From} -> ${To}.${Bad}`) : never) : never
      : never
    : never
/** References whose target module or entity is not selected, over active fields only (a backstop for the module-level check). */
type DanglingRefs<Ms extends readonly AnyModule[]> = {
  [I in Ids<Ms>]: {
    [E in EntityNames<ById<Ms, I>>]: {
      [K in keyof EntityFields<Ms, I, E>]: EntityFields<Ms, I, E>[K] extends { readonly ref: { readonly module: infer RM extends string; readonly entity: infer RE extends string } }
        ? (RM extends Ids<Ms> ? (RE extends EntityNames<ById<Ms, RM>> ? never : `${I}.${E}.${K & string} -> ${RM}.${RE}`) : `${I}.${E}.${K & string} -> ${RM}.${RE}`)
        : never
    }[keyof EntityFields<Ms, I, E>]
  }[EntityNames<ById<Ms, I>>]
}[Ids<Ms>]
/** Checks over the author's tuple `Ms`; lookups add the core module. Positions are compared on `Ms` itself, because a
 *  mapped type over a variadic tuple (`[Core, ...Ms]`) numbers the spread elements from zero again. */
type AppChecks<Ms extends readonly AnyModule[], A, X> =
  & Check<MissingRequirements<WithCore<Ms>>, 'missingModules'>
  & Check<DuplicateIds<Ms>, 'duplicateModuleIds'>
  & Check<Extract<Ids<Ms>, 'core' | 'app'>, 'reservedModuleIds'>
  & Check<ConflictingFields<WithCore<Ms>>, 'conflictingFields'>
  & Check<UnknownContributionTargets<WithCore<Ms>>, 'unknownContributionTargets'>
  & Check<DanglingRefs<WithCore<Ms>>, 'danglingReferences'>
  & Check<Exclude<keyof X & string, CommandRefsOf<WithCore<Ms>, A>>, 'unknownExecutionOverrides'>

export interface App<Ms extends readonly AnyModule[], A, X> {
  readonly id: string
  readonly modules: Ms
  readonly entities: AppEntitiesOf<Ms>                 // type-only carriers; the runtime value holds the registry
  readonly actions: ActionRefsOf<Ms, A>
  readonly tree: AppActionTreeOf<Ms, A, X>
}
export declare function defineApp<
  const Ms extends readonly AnyModule[],
  const A extends { readonly [name: string]: AnyAction } = {},
  const X extends { readonly [ref: string]: Execution } = {},
>(
  config: {
    readonly id: string
    readonly modules: Ms
    readonly actions?: A
    readonly execution?: X
    readonly authorization?: { readonly mode?: 'strict' | 'strip'; readonly decisionLog?: 'denials' | 'all' | 'none' }
    readonly policies?: { readonly disable?: readonly string[] }
  } & AppChecks<Ms, A, X>,
): App<WithCore<Ms>, A, X>

// ---- Names consumed by the rest of the framework
export type AppEntities<P> = P extends { readonly entities: infer En } ? En : never
export type ActionRef<P> = P extends { readonly actions: infer R } ? R : never
export type AppActionTree<P> = P extends { readonly tree: infer T } ? T : never
export type Row<P, Ref extends string> =
  Ref extends `${infer M}.${infer E}` ? (AppEntities<P> extends infer En ? (M extends keyof En ? (E extends keyof En[M] ? En[M][E] : never) : never) : never) : never

// ---- Deployment-level contracts are checked where the infrastructure is known
type ModulesOf<Apps> = Apps extends readonly (infer P)[] ? (P extends { readonly modules: readonly (infer M)[] } ? M : never) : never
type RequiredDeploymentContracts<Apps> = ModulesOf<Apps> extends infer M ? (M extends { readonly requires: infer L } ? ContractsIn<L, 'deployment'> : never) : never
type ProvidedByInfrastructure<Infra> = Infra extends readonly (infer P)[] ? (P extends { readonly provides: readonly (infer C)[] } ? (C extends { readonly contract: infer N extends string } ? N : never) : never) : never
export declare function defineDeployment<const Apps extends readonly { readonly modules: readonly AnyModule[] }[], const Infra extends readonly { readonly provides: readonly AnyContract[] }[]>(
  config: { readonly apps: Apps; readonly infrastructure: Infra } & Check<Exclude<RequiredDeploymentContracts<Apps>, ProvidedByInfrastructure<Infra>>, 'missingInfrastructure'>,
): { readonly apps: Apps }
```

The cases the checked file asserts, which the spike's type-test suite must keep (module values use
the named-type pattern of section 4.1 throughout):

1. With `[accounts, teams, auth]`: `accounts.profile` has `displayName`, `locale?`, the
   contributed `lastLoginAt?`, the `when: [teams]` contribution `defaultTeamName?`, and
   `lastCredentialId?: Id<'auth.credential'>` (an own reference inside auth's contribution
   resolves to auth); `auth.credential` has the conditional `profileId?`. Action references
   include contributed ones (`accounts.profile.resetPassword`, `accounts.whoami`), the
   conditional module action `auth.linkProfile`, generated ones (`accounts.profile.get`,
   `accounts.profile.archive`), core actions (`core.tenant.create`, `core.introspect`) and app
   actions (`app.health`). `watch` is absent without a generator module, `core.commandReceipt`
   has no set operations, and `history` is opt-in. The action tree carries input and output types
   and the execution mode after `defineApp({ execution })`.
2. Without `auth`: its contributions and its entities are gone, and `entities.auth` is an error.
3. Without `accounts`: `auth` stands alone; its contributions to accounts, its conditional
   `profileId` and its conditional action `auth.linkProfile` are absent.
4. Without `teams`: the `when: [teams]` contribution is dropped, the unconditional one stays.
5. `defineApp({ modules: [teams] })` fails with `missingModules: 'accounts'`.
6. An own `status: enum` plus a contributed `status: string` fails with
   `conflictingFields: 'accounts.profile.status'`; two contributors of `lastLoginAt` with the same
   type fail the same way; a single contributor is fine.
7. A contribution to `accounts.profiles` (typo) fails with `unknownContributionTargets`; the same
   contribution with `accounts` absent is ignored like any other.
8. Two modules with the same id fail with `duplicateModuleIds`; a module with the id `core` fails
   with `reservedModuleIds`.
9. A `field.ref(accounts, 'profile')` in an entity of a module that lists `accounts` only as
   `optional` fails at `defineModule` with `refsOutsideRequirements`; with `accounts` in
   `requires` it is accepted, and `.optional().index()` keeps the reference.
10. A contributed field that is neither optional nor defaulted fails at `defineModule` with
    `contributedFieldsNeedDefault`; with `.default(...)` it is accepted.
11. A `projection` entity has `get`, `query`, `changes` and `queryChanges` but no set operations;
    `generated: { set: false, history: true }` removes `set`, `create`, `update`, `archive` and
    `restore` and adds `history`; selecting a module that `generates: ['watch']` adds `watch` to
    every entity that is not `external`; a module that requires the `live` contract without a
    selected provider fails with `missingModules: 'live'`.
12. An execution override for an unknown reference or for a query fails with
    `unknownExecutionOverrides`.
13. A conditional part keyed on the `live` contract is present when a module providing it is
    selected and absent otherwise.
14. `defineDeployment` fails with `missingInfrastructure: 'blobs'` when an app's module requires
    the `blobs` contract and no infrastructure entry provides it.

Runtime mirror: `defineModule`, `defineApp` and `defineDeployment` repeat every check with the same
names, so a JavaScript caller or a dynamically assembled tuple gets the same errors at boot.

Error quality: `Check` makes the failure a missing property with a literal type, so the compiler
message reads "Property 'missingModules' is missing ... required in type { missingModules:
'accounts' }"; messages name the module interfaces (`[Accounts, Auth, LastLogin]`), because module
values carry named types. TypeScript 7.0.2 widens literal types in some messages (it printed
`string` where 5.9.3 printed `'a'`); the property name stays exact. The spike may replace the
property form with a rest-parameter form if that reads better in the editor; the names must stay.

Names used by the rest of the framework, so that every section and every package says the same
thing:

| Name | Meaning |
|---|---|
| `AppEntities<App>` | the rows of an app, per module and entity, system fields included |
| `Row<App, 'module.entity'>` | one row type |
| `Insert<App, Ref>`, `Patch<App, Ref>`, `OfflinePatch<App, Ref>` | write shapes (section 14.8.1) |
| `Readable<R>` | a row as a transport or client receives it: maskable fields optional (section 8.1) |
| `AppActionTree<App>` | module, then entity, then action: kind, input, output, errors, events and effective execution |
| `ActionRef<App>` | the union of every action reference of an app |
| `ActionContext<M>`, `DataOf<M>`, `InvokableRefs<M>`, `LiveQueries<M>`, `SqlTables<M>` | module-local types, independent of any app (section 7.6) |
| generated event names | `created`, `changed`, `archived`, `restored`, `erased`; `snapshot` and `imported` are kernel-only |
| `version` | the stream version of a row |
| position | the commit order of events within one scope of a namespace (section 15.1.4) |

Spike checklist, to be run before any M1 code is written (roadmap M0):

1. The builder chain with typed callbacks (`entities` before `entityActions`, `actions`,
   `policies`, `reactions`, `services`, `contributes`, `conditional`), each typed with
   `ActionContext<M>`.
2. Module-local contexts: `DataOf<M>` (own rows with hidden fields and `SecretRef`, dependency rows
   without them, patches of contributed fields only), `InvokableRefs<M>`, `when` modules of a
   conditional part treated as required, `ctx.live` and `ctx.blobs` from contracts, and a type
   test that compiles each module with no app in scope.
3. Self-typed field modifiers that preserve every flag: optional, default, unique and `exclusive`,
   hidden, maskable, merge type, personal subject, `stateOnly`, tag.
4. Own references in entities and in contributions, as the listing resolves them.
5. The core module always prepended, with reserved ids.
6. Generated actions computed from `generated`, the history mode and the closed template set
   (`watch`, `history`), with `watch` typed as `EntityChange<Row>` per entity and gated on the
   filling module.
7. `defineApp` with app actions, a `const` execution map validated against command references,
   and the authorization and policy options.
8. `AppActionTree` with input, output, error and event types derived from field-model shapes;
   `Insert`, `Patch`, `OfflinePatch` and `PatchValue`.
9. Declaration emit of every example module and both proof apps under the pnpm layout:
   `.d.ts` size per module, and no TS7056, TS2742 or TS4023.
10. Instantiation budgets set on synthetic apps of 25 and 40 modules (the proof apps have 25 and
    26 modules), with the builder chain.

Budget: measured on 2026-10-11 with this listing on synthetic apps in which every module has two
entities of four fields, two entity actions, a module action, a contribution and a conditional
part, and requires its two predecessors: 20,279, 72,543, 195,783 and 408,543 instantiations for 3,
12, 25 and 40 modules on TypeScript 7.0.2 (16,714, 69,179, 192,809 and 406,019 on 5.9.3), with
check times below 0.25 seconds on 7.0.2. Growth is super-linear, roughly with the 1.4th to 1.6th
power of the module count. The checker's limit is 5,000,000 instantiations per statement, so the
fold leaves room, but the builder chain and field-model-derived action types add to it; the spike
sets the CI budget from the 25- and 40-module runs (section 13.11). The app-level fold is paid
once: transports, the CLI and the generated file consume `AppEntities<App>` and
`AppActionTree<App>` through `pennestack.generated.ts` and never fold the tuple again.

## 5. Modules

### 5.1 Identity

A module's identity is its `id`, a lowercase literal matching `[a-z][a-z0-9]*(-[a-z][a-z0-9]*)*`
(words separated by single hyphens; no leading, trailing or doubled hyphen). The id keys the
type-level lookup, the runtime registry, the table namespace, the migration history, the policy
rule ids and the action references, so it is permanent: renaming a module is a data migration
with an explicit `pennestack module rename` command that rewrites the history table and the
namespace, never a silent change. `version` is informational; compatibility between modules is
expressed through the types, not through version ranges.

In handler contexts and in wire names that are property names (tRPC paths, GraphQL fields), an id
appears in lower camel case: `mail-store` becomes `mailStore` (gap G15, section 17.7). Two ids that
camel-case to the same name (`mail-2fa` and `mail2fa`) cannot be selected together:
`defineApp` fails with `camelCaseCollisions`.

Reserved names, checked at `defineModule` and `defineApp`:

- module ids: `core` (the kernel's own module), `app` (actions mounted on the app), and the
  framework command names of the CLI (section 16.9.3), frozen per major version;
- entity, action, field, relation and event names match `[a-z][a-zA-Z0-9]*`; entity names and
  module-level action names share one namespace per module, contributed actions included;
- per entity, the generated action names `get`, `query`, `changes`, `queryChanges`, `set`,
  `create`, `update`, `archive`, `restore`, `watch` and `history`;
- the generated event names `created`, `changed`, `archived`, `restored`, `erased`, `snapshot`
  and `imported`, which share the reaction name space with domain events;
- `and`, `or` and `not` as field and relation names (they are filter operators);
- error codes match `<module>.<snake_case>` with the declaring module's id;
- TypeID prefixes are required and unique per app (`duplicatePrefixes`).

Splitting a module keeps the id on the part that keeps the tables; the new part gets a new id and
a migration that moves data. This is the answer to the research question on versioning ids.

### 5.2 Dependencies and contracts

- `requires: [m]`: a hard dependency. The dependant's context types `m` as present; `defineApp`
  rejects a tuple that lacks `m`; references and foreign keys towards `m`'s entities are allowed;
  lifecycle orders `m` first.
- `optional: [m]`: a soft dependency. The dependant's context types `m` as `| undefined`; a
  missing `m` is fine; references towards `m` are allowed only inside a conditional part or a
  contribution whose target or `when` list contains `m` (section 6.3); lifecycle orders `m` first
  when present.
- Both lists hold module values, not strings, so the dependant imports the dependency package.
  The import graph between module packages must be a directed acyclic graph (`tsc -b` project
  references forbid cycles), which gives the rule of section 5.4.

Some dependencies are capabilities with several implementations: a blob store on a file system
or on an S3-compatible service, a live hub. Requiring a concrete implementation would defeat the
plug-and-play requirement, and typing the capability as always present would type something that
may not exist. Such capabilities are **contracts**:

```ts
// Declared by the core: a name, a level and the interface the context exposes.
export const contracts = {
  live: defineContract<LiveQueries>('live', 'app'),            // provided by an app module (the live module)
  blobs: defineContract<Blobs>('blobs', 'deployment'),         // provided by an infrastructure entry (gap G5)
  httpHost: defineContract<TransportHost>('httpHost', 'deployment'),   // required by HTTP transport modules
}

defineModule({ id: 'mail-store', requires: [mailDomains, contracts.blobs], ... })   // ctx.blobs is present
defineModule({ id: 'live', provides: [contracts.live], ... })                       // the live module
```

- A module lists contracts in `requires` or `optional` like modules; the context types the
  matching member (`ctx.live`, `ctx.blobs`) as present, possibly undefined, or absent.
- App-level contracts are provided by a selected module that declares `provides`; `defineApp`
  reports an unprovided one as `missingModules`. Deployment-level contracts are provided by
  infrastructure entries; `defineDeployment` reports `missingInfrastructure` (section 4.7).
- A conditional part's `when` list may name app-level contracts (`w.when([contracts.live], ...)`).
- A contract provided by more than one selected module is a boot error unless the contract
  declares itself `set`-valued; this and empty required extension points are the cardinality
  checks of gap G14 (section 5.5).
- The kernel's own capabilities (the job queue and timers, secrets, the key service, the clock)
  are always present and need no contract.

Toggling: a module can be switched off on its own unless another selected module `requires` it;
then both go together. This is how "any module can be selected or toggled independently" is met
without typing absent things as present: soft influence uses `optional`, contributions and
conditional parts, and only genuine needs use `requires`. Section 21 lists this reading as a
decision point.

### 5.3 Contributions to other modules

A contribution is declared by the contributing module and targets another module's entities,
actions, policies or extension points. It is active only when the target and every module in its
`when` list are selected; otherwise it is dropped without error. It is checked, when active,
against the target's real definition: a contribution to an entity the target does not define is a
compile error, because the contributor imported the target and the mistake is a typo, not a
toggling effect. Contributed fields must be optional or have a default, because rows are inserted
while the contribution is inactive (`contributedFieldsNeedDefault`, section 4.7).

```ts
.contributes((c) => [
  c.to(accounts, {
    entities: {
      profile: {
        fields: { lastLoginAt: field.instant().optional().maskable(), emailVerifiedAt: field.instant().optional() },
        relations: { credentials: relation.many.own('credential', { by: 'subject', to: 'id' }) },
      },
    },
    actions: (b) => ({ whoami: b.query({ /* mounted as accounts.whoami */ }) }),
    entityActions: { profile: (e) => ({ changePassword: e.command({ /* accounts.profile.changePassword */ }) }) },
    policies: (rule) => [
      rule.allow('profile', ['read', 'update'], {
        id: 'self',
        principal: 'user',
        where: (ctx) => ({ id: ctx.principal.subjectAs('accounts.profile') }),
        fields: ['displayName', 'locale'],
      }),
    ],
    extensionPoints: { profileCards: [{ id: 'auth.security', title: 'Security' }] },
  }),
  c.to(projects, { when: [teams], policies: (rule) => [ /* rules that reference projects.team.members */ ] }),
])
```

What a contribution can carry, and the composition rule for each:

| Part | Composition | Conflict rule |
|---|---|---|
| fields | union by name | the same name from two sources is a compile and boot error, whatever the types (section 4.7) |
| relations | union by name | as fields |
| actions, entityActions | union by name | duplicate name is an error; a contribution cannot replace an existing action |
| policies | set union, order-independent (section 8) | never conflicts; deny overrides |
| reactions | not a contribution; the contributor declares its own reactions (5.4) | |
| services | not a contribution; a module's services are its own (5.5) | |
| extension-point values | `set`: union; `ordered`: by declared `order` then module order; `single`: exactly one filler or boot error | behavioural values are factories bound to the contributor (5.5) |

A module may contribute to any module it lists in `requires` or `optional`; anything else is a
boot error, so the dependency graph stays explicit. A contribution's code (its entity actions,
its policies' conditions) runs with the contributor's context, not the target's.

### 5.4 Conditional parts, and how accounts and authentication influence each other

A module adds to **itself** on the condition that other modules are selected:

```ts
.conditional((w) => [
  w.when([accounts], {
    entities: { credential: { fields: { profileId: field.ref(accounts, 'profile').optional() } } },
    reactions: (r) => [
      // runs in the producing transaction, under auth's service principal auth.system (section 7.7)
      r.inline(accounts, 'profile.deactivated', async (event, ctx) => {
        await ctx.invoke('auth.revokeSubject', { subject: event.state.id, reason: 'profile deactivated' })
      }),
    ],
  }),
])
```

With contributions (push: a module adds to another) and conditional parts (self-adaptation when
another is present), both directions of influence are expressible with a single direction of
import. The rule: **the lower module publishes contracts (entities, events, extension points);
the higher module imports it, contributes to it and adapts itself to it.** Inside a conditional
part the `when` modules count as required, so the reaction above may read `ctx.data.accounts`
and invoke accounts actions.

For the accounts and authentication pair, accounts is lower (a directory of people needs no
login; a credential store needs no profiles). Section 17.2 specifies both modules.

| Influence | Mechanism | When accounts is off | When auth is off |
|---|---|---|---|
| Auth adds `lastLoginAt`, `emailVerifiedAt` to `accounts.profile` | contribution (fields) | dropped | absent |
| Auth adds the `credentials` relation and the `changePassword` action to profiles | contribution (relations, entity actions) | dropped | absent |
| Auth adds "a user may read and update their own profile" | contribution (policy fragment) | dropped | accounts' own rules apply (an operator or an API-key principal can still act) |
| Auth links credentials to profiles | conditional field `profileId` | absent; credentials key on an opaque `subject` | n/a |
| Accounts tells auth when a profile is deactivated | accounts declares the `profile.deactivated` event; auth reacts (conditional reaction) | n/a | nobody listens |
| Accounts asks "who can log in as this profile?" for its profile card | accounts declares the extension point `identityProviders`; auth fills it with a value bound to auth's context | empty slot | empty slot |
| Auth needs a login identifier | auth owns `credential.identifier`; when accounts is present a conditional reaction keeps it in step with the profile e-mail | auth's own field | n/a |

Both modules compile and run alone; the app with both gets the richer types; nothing is typed by
declaration merging. [api-sketch.ts](api-sketch.ts) shows the pair in full.

### 5.5 Extension points and services

```ts
import { extensionPoint } from '@pennestack/core'

interface IdentityProvider { readonly id: string; readonly label: string; listFor(profileId: Id<'accounts.profile'>): Promise<readonly IdentitySummary[]> }

// Declared by accounts:
extensionPoints: { identityProviders: extensionPoint<IdentityProvider>({ mode: 'set' }) }
// Read by accounts, typed as readonly IdentityProvider[]:
ctx.extensions.identityProviders
// Filled by auth, without accounts importing auth. A value that carries behaviour is a factory of
// the contributor's own context, so listFor reads auth.credential with auth's authority:
c.to(accounts, { extensionPoints: { identityProviders: (own) => [passwordProvider(own), passkeyProvider(own)] } })
```

Modes: `set` (any number of values), `ordered` (values carry `order`), `single` (exactly one
filler across the app, else a boot error; the owner can declare a default). `min` makes an empty
slot a named boot error (`extensionPoint<GitProvider>({ mode: 'set', min: 1 })` fails with
`emptyExtensionPoints: 'projects.gitProviders'`), and the boot check also verifies that every
carrier a listener produces has a principal resolver that accepts it (gap G14). The contract type
is a TypeScript type; a value-level schema is optional and used when the filler is configuration
rather than code.

Binding (gap G16): a filler that carries behaviour is a factory `(own) => value`. The kernel
instantiates it per invocation with a context derived for the contributing module: the same
scope, principal, unit, trace and clock, with the contributor's data authority, services,
configuration and secrets. The declaring module sees ready instances. Plain data values (labels,
menu entries) stay plain values.

Services follow the same rule. `.services((s) => ({ ... }))` declares functions a module offers to
its dependants; the kernel binds each to the providing module's context, so a service reads the
provider's tables with the provider's authority and the provider's configuration, never the
caller's. Call sites pass no context:

```ts
.services((s) => ({
  verifyPassword: s.service(async (own, verifier: string, password: string) => argon2Verify(verifier, password)),
}))
// in a dependant:
const ok = await ctx.services.auth.verifyPassword(cred.verifier, input.password)
```

Binding never widens the principal: a bound service or filler runs under the caller's principal,
so actions it invokes are gated as the caller's, and the data authority it uses is the
provider's authority over the provider's own entities (section 8.4).

### 5.6 Kernel and deployment extension points

The `core` module declares the kernel's app-level extension points; a transport, a resolver or a
live carrier is a module that contributes to them. What one deployment shares across apps is not
an app's choice: it is listed in `defineDeployment({ infrastructure })` and fills the
deployment-level extension points, so the control store has an adapter before any app is loaded
and a placement serves every app it hosts.

| Level | Extension point | Contract | Mode | Filled by |
|---|---|---|---|---|
| deployment | `dataAdapters` | `DataAdapterFactory` with its event store, job store and schema operations (section 14.3) | set | `adapter-postgres`, PGlite and in-memory (in `@pennestack/data`), later `adapter-mysql`, `adapter-sqlite`, `adapter-supabase` |
| deployment | `queue` | `JobQueue` (section 9.5) | single | default: the kernel queue over the adapters' job stores |
| deployment | `blobStores` | `BlobStore` (gap G5); provides `contracts.blobs` | set | `blobs-fs`, later `blobs-s3` |
| deployment | `httpHost` | `TransportHost` with the invocation protocol (section 16.3.3); provides `contracts.httpHost` | single | `transport-http` (Hono) |
| deployment | `secretProviders` | `SecretProvider` | ordered | core (environment), later vault modules |
| deployment | `ledgerSinks` | `LedgerSink`: append-only erasure and key-tombstone log (section 14.7.6) | set | `core/ledger` (file), later object storage |
| deployment | `tenantResolution` | `TenantResolver`, in deployment order (section 12) | ordered | core (`byHostname`, `byScopeKey`, `byHeader`, `byPath`) |
| deployment | `carrierEnrichers` | `CarrierEnricher`: sets `carrier.scopeKey` before scope resolution | ordered | `transport-webhooks` receiver paths (section 16.5.8) |
| deployment | `ports` | listener port bindings (gap G1) | map | `defineDeployment({ ports })` |
| app | `transports` | `TransportAdapter` (section 16.3) | set | `transport-rest`, `transport-graphql`, `transport-trpc`, `transport-webhooks`, later JMAP and Connect |
| app | `listeners` | `Listener` (non-HTTP: SMTP, IMAP) | set | mail listener modules |
| app | `liveHub` | `LiveHub` (section 15.4.11); provides `contracts.live` | single | `live` |
| app | `liveCarriers` | `LiveCarrier` (SSE, WebSocket) | set | `live` |
| app | `entityActionGenerators` | a template from the core's closed set (`watch`) added to every entity | set | `live` |
| app | `principalResolvers` | `PrincipalResolver` | ordered | core (operator, receivers), `auth` (sessions, passkeys), `api-keys` |
| app | `principalEnrichers` | `PrincipalEnricher` (roles, memberships) | set | `accounts`, `members` |
| app | `invocationMiddleware` | `Middleware` around the pipeline stages | ordered | rate limiting, audit, request logging |
| app | `ruleSources` | `RuleSource` (runtime-defined policy rules) | set | a later tenant-admin module |
| app | `crdtCodecs` | `CrdtCodec` (section 15.3.9) | set | `crdt-loro` |
| app | `schedules` | `Schedule` (section 9.5) | set | modules through `.schedules()` |

```ts
export const graphql = defineTransportModule({ id: 'graphql', requires: [contracts.httpHost], transport: graphqlAdapter })
// expands to:
defineModule({ id: 'graphql', requires: [contracts.httpHost] }).contributes((c) => [c.to(core, { extensionPoints: { transports: [graphqlAdapter] } })])
```

Because `core` is implicitly part of every app, such contributions are always active. An app
selects its transports by listing those modules in its tuple, exactly like any other module; the
event store is part of the data adapter's unit, so there is no separate event-store extension
point (section 14.3.1).

### 5.7 Module configuration and secrets

`config: shape({...})` declares what a backend must provide to run the module. Values are stored
in the control store per backend, optionally overridden per tenant, validated at creation and at
change, and exposed as `ctx.config` (typed). Fields declared with `field.secret()` are sealed by the
key service under the backend's key (or the tenant's, for tenant overrides) and are readable only
through `ctx.secrets.reveal` (section 6.6); no action returns them.

A module may declare `configAccess: { level: 'tenant', edit: 'policy' }` (gap G10): the core then
generates `<module>.config.get` and `<module>.config.set` actions governed by ordinary rules, and
emits a typed `config.changed` event that reactions consume (Launchway's settings re-render the
edge when they change). Without it, configuration changes only through operator actions.

The brief's "everything configurable" is met by this plus the app-level overrides on `defineApp`
(execution modes, policy overrides, authorization options) and the deployment's infrastructure.

## 6. Entities

### 6.1 Ownership and namespace

An entity belongs to exactly one module and is referenced as `module.entity`. Its physical name
is derived by the data adapter from `(module, entity)` inside the app's namespace (section
14.4.2). Application code never sees physical names.

### 6.2 Fields

Fields are the `field.*` builders of section 4.2. Each builder result is a `FieldDef` that
carries, at the value level, everything a projection needs (kind, modifiers, constraints,
description, tag) and, at the type level, the TypeScript type and every flag that changes a
derived type (optionality, default, hidden, maskable, merge type, personal subject, reference).
Projections:

| Consumer | Derived from the field model |
|---|---|
| TypeScript | row type, insert type, patch type, `Readable<R>`, `Id<'module.entity'>` (section 14.8.1) |
| Validation | a Standard Schema validator per entity (create, patch) and per action input |
| JSON Schema | draft 2020-12 and OpenAPI 3.1 dialects (through Standard JSON Schema) |
| GraphQL | object, input and enum types, Relay node ids |
| Columns | dialect column type, nullability, default, index, unique (section 14.5.1) |
| Protobuf | numbered fields through `.tag(n)` or deterministic allocation (section 16.13) |
| CLI | flags and positional parameters (section 16.9.4) |
| Merge | the merge type of section 15.3.4 |
| Surface | a field node with kind, constraints and access (section 16.2.3) |

### 6.3 Relations

- `field.ref(module, entity)` declares a to-one reference to another module's entity;
  `field.ref.own(entity)` references an entity of the module being defined, by name, because the
  module value does not exist until its builder chain completes (a module value referenced inside
  its own definition is a runtime temporal-dead-zone error and a type circularity). Inside a
  contribution, `own` names an entity of the contributor, not of the target: github's
  `field.ref.own('connection')` on `projects.project` points at `github.connection`.
- Where a reference may point, checked at `defineModule` (`refsOutsideRequirements`, section
  4.7): the module itself, a module in `requires`, and, inside a contribution or a conditional
  part, the contribution's target and the `when` modules. A reference towards a module that is
  only `optional` must therefore sit in a conditional part or a contribution whose condition
  names it, so the field exists exactly when the target does.
- Towards the module itself or a module in `requires`, a reference becomes a foreign key
  (composite with the scope, section 14.4.3). Inside a conditional part or a contribution, it is a
  typed id column whose integrity the kernel enforces at write time and whose dangling values are
  tolerated after the target is retired.
- `relation.many(module, entity, { by, to })` and `relation.many.own(entity, { by, to })` declare
  a to-many relation by naming the field on the other side. The side that may import declares
  it; the other side receives it as a contribution, which is how `accounts.profile.credentials`
  exists only when auth is selected.
- `relation.through(...)` declares many-to-many through a join entity the declaring module owns.
- Relations are what the condition AST quantifies over (`some`, `none`, `every`, `is`), so a
  policy can say "members of the team that owns the project" without SQL.

### 6.4 Identifiers and time

- Ids are UUIDv7 (RFC 9562) generated in the application with `uuid` 14.0.3 `v7()` (published
  2026-10-10; 14.0.2 has the same API), so every adapter behaves the same. At every API boundary an
  id is rendered in TypeID form (`prof_01j9...`, prefix from the entity's `prefix`, TypeID
  specification 0.3.0 as implemented by `typeid-js` 1.2.0, used as the reference, not a
  dependency) and parsed back; the type `Id<'accounts.profile'>` is branded so an id of one entity
  cannot be passed for another.
- Instants are UTC. `field.instant()` is a `Date` in process and an RFC 3339 string on the wire
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

Validation runs once, in the pipeline (section 9.2), before authorization. The `validate` stage
accepts a value in wire form or in in-process form (an RFC 3339 string or a `Date` for an
instant; a decimal string or a `bigint` for a wide integer) and produces the in-process form, so
transports pass decoded JSON straight to the invoker; `toWire` and `fromWire` per field node live
in the dependency-free subpath `@pennestack/core/wire` that clients share (section 16.4.2).
Output is validated in development and in tests, and only shaped (masked) in production, so a
handler bug surfaces early without paying twice in production.

### 6.6 History, archive, hidden data and personal data

History modes:

| Mode | The source of truth | Writes | Live updates and `changes` |
|---|---|---|---|
| `chain` (default) | the entity's event chain; the state table is an inline projection | events through commands | chain events |
| `state` | the table; an explicit opt-out for derived or ephemeral data (sessions, presence, outbox rows), with a `reason` | rows are updated in place and may be purged by retention | transient change records (section 15.1.10) |
| `projection` | the event log of other entities; an asynchronous read model written only by its projector | none through actions | transient change records |
| `external` | a table the framework maps but does not own (section 14.8.4) | direct writes through `ctx.data` | transient records for framework writes only |

Deletion through any generated or custom action is an `archived` event; `restored` undoes it;
reads hide archived rows unless the query asks for them and the policy allows it. `retire` of a
module, run explicitly by the operator, is the only operation that drops tables. Entities in the
`state` mode, transient records and receipts are not history: retention purges them under the
rules of section 14.7.1, which the decision points of section 21 make explicit.

Hidden, secret and credential data:

- `.hidden()`: absent from the API surface, from every transport, from other modules' rows and
  from rule field lists. The owning module's repositories (and `ctx.asSystem`) return the field.
  Hidden fields are left out of the before-images of events unless the field opts in with
  `.hidden({ history: true, reason })`.
- `field.secret()`: in process the value reads as an opaque `SecretRef`; the only way to the
  plaintext is `ctx.secrets.reveal(ref, reason)`, available to the owning module's code (which
  includes its bound services and extension values), logged with the reason (gap G4).
- `field.verifier()`: a one-way verifier (an Argon2id password hash, the verifier of a token
  issued once) that only the owning module reads.
- Credential material (secret and verifier values) never appears in plaintext in event payloads
  or before-images: each value is sealed with its own data key from the key service, and the
  kernel destroys that key when the value is replaced, when the row is archived and when it is
  purged (crypto-shredding on overwrite). The chain therefore keeps the current value
  rebuildable and makes every former value unreadable (section 14.7.4).
- `.stateOnly()`: the value is written to the state table only, never to events or
  before-images. It suits derived index inputs (the extracted text of a message); rebuilds and
  tenant moves recompute it with the entity's `rederive` hook, or leave it absent until
  reindexed.

Fields marked `.personal()` are encrypted per data subject in the chain, so that erasure is a key
destruction (section 14.7.4).

### 6.7 Generated entity actions

Every entity receives generated actions with JMAP (RFC 8620) semantics, which gives every
transport state-based incremental sync and optimistic concurrency without per-entity code:

| Action | Kind | Semantics |
|---|---|---|
| `get` | query | by ids, with a field selection; returns rows, `notFound` ids and the current `state` token |
| `query` | query | `filter` (condition AST), `sort`, cursor pagination (`first/after`, `last/before`), opt-in `total`; returns ids or rows plus `queryState` |
| `changes` | query | since a `state` token: created, changed, archived ids and the new token |
| `queryChanges` | query | since a `queryState`: added and removed ids for a filter |
| `create`, `update`, `archive`, `restore` | command | one item each; instance operations take `id` and an optional `ifVersion`; authorized under their own names |
| `set` | command | the batch form: `create`, `update` (patch), `archive`, `restore` with per-item `ifVersion` and collection-level `ifInState`; per-item results and errors; each item is authorized against its own operation |
| `watch` | subscription | added by the live module's generator (section 15.4.1) |
| `history` | query | the versions of one row (section 14.8.1); off unless `generated: { history: true }` |

Rules name the operations (`create`, `update`, `archive`, `restore`); `write` is an alias for all
four and `set`, and `read` an alias for `get`, `query`, `changes`, `queryChanges`, `watch` and
`history`, so a rule written today does not silently miss tomorrow's generated read (section 8.1).
`archivedAt` is a system field that field masks do not cover, which is why archive and restore are
operations of their own: "members may edit projects, only admins may archive them" is two rules.

`generated` on the entity switches any of them off (`set: false` removes the set operations);
`projection` entities have no set operations and `external` entities only `get` and `query`.
Custom actions coexist. The generated `query` sorts by `id`, `createdAt`, `updatedAt` and indexed
or unique fields, with a default page size of 50 and a maximum of 500 unless the entity's `page`
option says otherwise. A transport that needs positional paging (JMAP's `position` and `anchor`)
requests it in its surface options; the generated `query` then also accepts `position` and
`anchor` with `anchorOffset`, up to the adapter's declared maximum offset (section 14.3.5). The
tokens are positions of the event log (section 15.2.6); section 16.4.1 maps the actions to each
transport.

## 7. Actions

### 7.1 Kinds: commands, queries, subscriptions

| Kind | Side effects | Execution modes | Result | Transport shape |
|---|---|---|---|---|
| `query` | none; runs in a read-only unit | always sync | value | GET, GraphQL query, RPC query, CLI command |
| `command` | writes; runs in a transaction; appends events; may enqueue jobs | `sync`, `async`, `either` | value (sync) or receipt (async) | POST/PUT/PATCH/DELETE, mutation, RPC mutation |
| `subscription` | none; observes the live feed | long-lived | frames: items with stream tokens, and control frames | SSE, WebSocket, GraphQL subscription |

The query/command split is the CQRS the brief asks for: a query never writes and a command never
returns data it did not produce. Reads after writes are consistent for the entity's own state
(inline projection); cross-entity read models may lag (section 15.2).

### 7.2 Mounting

| Mount | Declared with | Reference | Context extras |
|---|---|---|---|
| entity | `.entityActions('profile', (e) => ({...}))` | `accounts.profile.deactivate` | `e.events`, `e.page()`, `e.row()`, `ctx.target`, `decide(input, current, ctx)` |
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
  principal?: PrincipalKind | readonly PrincipalKind[]   // the gate admits only these kinds; narrows ctx.principal
  scope?: 'tenant' | 'backend' | 'deployment'   // default 'tenant'
  execution?: 'sync' | 'async' | 'either'       // commands only; default 'sync'
  async?: AsyncJobOptions                       // commands that run asynchronously: group, retry, onGiveUp (section 9.5)
  isolation?: 'read-committed' | 'serializable' // commands only; default 'read-committed' (section 14.3.6)
  idempotent?: boolean                          // queries: always true; commands: default false
  idempotency?: { window: string }              // receipt retention as an ISO 8601 duration; default 'PT24H'
  offline?: boolean                             // commands only: may be authored offline (section 15.3.5); default false
  page?: PageSpec                               // queries returning pages: sortable fields, default size, max size
  timeoutMs?: number
  hints?: Partial<TransportHints>               // naming and carriage per transport; never behaviour
  description?: string
  deprecated?: { reason: string }
}
```

The handler is one of:

- `handle(input, ctx) => Promise<O>`: queries, module and app commands, commands on
  `history: 'state'` entities. Commands run inside a transaction that also records the
  field-level events of every `ctx.data` write.
- `decide(input, current, ctx) => Event[] | { events: Event[]; result?: O }`: commands on
  chain-backed entities. Pure apart from `ctx.clock`, `ctx.ids` and reads; the kernel loads the
  target with its expected version, appends the events, evolves the state, runs the item check
  and the entity invariant on the post-image and returns the row (masked for the caller) or
  `result`.
- `source(input, ctx, resume?: StateToken) => AsyncIterable<LiveFrame<E>>`: subscriptions. A
  source built on `ctx.live` passes `resume` as `after` and yields frames that carry stream
  tokens, so the subscription is resumable; `mapItems(frames, fn)` maps items and keeps tokens and
  control frames. A source that wraps a plain iterable with `unresumable(iterable)` declares that
  it cannot resume. The surface's `resumable` flag is derived from that type, not declared.

For entity-mounted instance commands the kernel adds `id: Id<entity>` and an optional
`ifVersion` to the input and loads the target with the action's plan (section 8.4): a row the
plan's `where` does not select is `not_found`. `decide` (as `current`) and `handle` (as
`ctx.target`) always receive the full row, typed with the module's row type; field masks never
apply to the write path, because a decision made on a masked row would depend on the caller's
mask and replay would stop being deterministic. Entity-mounted queries receive `ctx.target` as
the entity read through the action's own plan (the caller's view).

`offline: true` requires `decide`, `execution: 'sync'` and `auth: 'policy'`, checked at
`defineApp`, and types the `decide` result as `OfflineEvents<E>` (section 15.3.5). The kernel's
`sync.push` action is declared with `transaction: 'per-item'`, an option reserved for kernel
actions: each item runs as an independent invocation in its own unit, as the invocation
protocol's batch does.

### 7.4 Execution mode and the asynchronous path

The brief requires choosing which requests are handled synchronously. The choice exists at three
levels, the most specific wins:

1. the action's `execution` (`sync`, `async`, `either`);
2. the app's `execution` map (`defineApp({ execution: { 'x.y.z': 'async' } })`), validated
   against the app's command references (section 4.7);
3. for `either`, the caller's preference per invocation (`prefer: 'async'`, which transports map
   from `Prefer: respond-async`, a GraphQL argument, an RPC option or a CLI flag).

The app's map decides how external callers (transports, the CLI, clients, listeners) are
answered. Module code that calls `ctx.invoke` gets the action's declared mode, because the
calling module was compiled without knowing any app: a `sync` action returns its output, an
`async` action returns a receipt, and an `either` action runs synchronously unless the caller
passes `prefer: 'async'`. The types of `ctx.invoke` are therefore exact without an app in scope.

A synchronous command returns its result. An asynchronous command is validated and authorized
synchronously (gate stage), recorded as an `accepted` receipt in the same unit as its job, and
answered with `{ commandId, status: 'accepted' }`. Its progress is observable through
`core.commandReceipt.get` and `core.commandReceipt.watch`, and its result through the receipt.
The job stores a principal reference (resolver id, principal id, credential id), not a snapshot
of roles and claims. When the job runs, the kernel resolves and enriches the principal again,
fails the command with `unauthenticated` if the credential was revoked or expired, and
authorizes the command again against the state at execution time (fail closed). A removed member
or a revoked API key therefore stops acting through queued work at once.

### 7.5 Idempotency

Every command invocation has a command id: a UUIDv7 generated by the client, a client-chosen
opaque key of 1 to 128 characters of `[A-Za-z0-9._:-]` (so HTTP `Idempotency-Key` values pass
through), or one generated by the transport when the client sent none. The kernel keeps a
receipt per `(scope, commandId)` with a fingerprint of the input and the outcome:

- The receipt is inserted as `pending` by the first statement of the command's unit, which holds
  its row lock until commit. A concurrent duplicate waits on that lock briefly and then answers
  `conflict` with code `core.command_in_progress` (retryable), so the handler and its external
  calls never run twice concurrently. The receipt is completed at commit.
- A retry with the same id and fingerprint returns the recorded outcome; the same id with a
  different fingerprint is `conflict` with code `core.idempotency_mismatch`.
- Receipts expire after the action's window (`idempotency: { window }`, default 24 hours, at most
  what the operator's receipt retention allows). Deduplication that must outlive any window (an
  SMTP sender retrying for days) uses a durable business key instead, such as a unique content hash
  per mail account (section 17.4.6).

This serves HTTP `Idempotency-Key`, at-least-once queues and the offline push protocol with one
table. Queries are idempotent by definition.

### 7.6 The context object

`ActionContext<M>` is computed from the module alone (section 3.4). In a conditional part it is
`ActionContext<M, W>`, where the `when` modules `W` count as required.

```ts
interface ActionContext<M extends AnyModule, W extends readonly AnyModule[] = []> {
  readonly scope: Scope                                  // { level: 'tenant', backendId, tenantId } | { level: 'backend', backendId } | { level: 'deployment' }
  readonly principal: Principal                          // never undefined; narrowed by the action's `principal` option
  readonly ability: Ability                              // can(), plan(), explain() for this principal, section 8
  readonly data: DataOf<M, W>                            // own entities with the module's authority; dependencies read-only (section 8.4)
  readonly services: ServicesOf<M, W>                    // bound to their providing modules (section 5.5)
  readonly extensions: ExtensionsOf<M>                   // behavioural values bound to their contributors
  readonly config: ConfigOf<M>
  readonly events: EventEmitters<M>                      // typed constructors for own domain events
  readonly secrets: Secrets                              // reveal, seal, issue (section 6.6, gap G4)
  readonly timers: Timers                                // keyed durable timers, set in this unit (section 9.5)
  readonly scopeKeys: ScopeKeys                          // claim and release deployment-wide scope keys (gap G2)
  readonly egress: Egress                                // outbound fetch and connect with private ranges denied (section 12.3)
  readonly clock: Clock                                  // now(), hlc()
  readonly ids: IdFactory                                // newId('auth.credential')
  readonly log: Logger
  readonly trace: Span
  readonly signal: AbortSignal
  readonly request: RequestInfo                          // id, transport, command id, preference, connection metadata, user agent; never credentials
  invoke<R extends InvokableRefs<M, W>>(ref: R, input: InputOf<M, R>, options?: { prefer?: 'sync' | 'async' }): Promise<ResultOf<M, R>>
  enqueue<R extends CommandRefsOf<M, W>>(ref: R, input: InputOf<M, R>, options?: { commandId?: string; runAt?: Date }): Promise<CommandReceipt>
  asSystem(reason: string): SystemContext<M, W>          // invokes actions as the system principal; logged with the reason
}
// Present only when the module declares them: ctx.live (contracts.live), ctx.blobs (contracts.blobs),
// ctx.sql (data need { sql: dialect }, section 14.3.8). Optional contracts type them as possibly undefined.
```

- `ctx.data` runs with the module's own authority (section 8.4): reads of its own entities and of
  its dependencies are never narrowed by the caller's plan, so uniqueness checks, quotas and
  existence checks see the truth. The caller's view is explicit: `ctx.data.<m>.<e>.forCaller()`
  returns a read-only repository narrowed by the caller's read plan, and entity-mounted queries
  get it as `ctx.target`.
- Writes go to the module's own entities, and to another module's entity only for the fields this
  module contributed to it; the type of the patch says so, and a denied write throws `forbidden`.
  Everything else goes through the owning module's actions or services.
- `ctx.invoke` accepts the module's own actions, the actions its contributions and conditional
  parts mount, and the actions of required modules (and of `W`). A command of the same scope joins
  the current unit as a savepoint; a query of the same or a wider scope reads in its own read-only
  unit when the scope differs. Commands of another scope are not invokable inline: `ctx.enqueue`
  runs them after commit and returns their receipt, so atomicity never depends on whether two
  scopes happen to share a database (section 12.3).
- `ctx.request` exposes request metadata only; credentials (the `Authorization` and `Cookie`
  headers, SASL secrets, tokens) stay inside the principal resolvers.
- `asSystem(reason)` invokes actions under the system principal, for work the caller may not do
  itself; every call is logged with the reason and the calling action, which replaces the silent
  "override access" default of other frameworks. A GritQL rule rejects an empty reason.

### 7.7 Reactions

Reactions are a module's event handlers, declared in `.reactions()` or in a conditional part:

```ts
.reactions((r) => [
  r.inline(accounts, 'profile.deactivated', handler),        // in the producing unit, before commit
  r.async(deployments, 'deployment.changed', handler, {      // a keyed job per matching event, in its own unit
    key: (event) => event.current?.projectId ?? event.stream.id,
    ordering: 'fifo-per-key',                                // or 'none' (default)
    coalesce: false,                                         // true: a newer event for the same key replaces a pending job
    concurrency: 4,                                          // jobs of this reaction running at once per scope
    retry: { delays: ['30s', '2m', '10m'], giveUpAfter: 'PT6H' },
  }),
  r.own('session.created', { timing: 'async' }, handler),    // the module's own events, by name
  r.process('onboarding', { on: ['accounts.profile.created', 'auth.credential.created'], decide, evolve }), // stateful process manager
])
```

A reaction to another module's events is conditional on that module (it must be in `requires`
or the reaction sits in a conditional part). Reactions run under the module's service principal
`<module>.system`, never under the principal that caused the event; the causing event's actor and
command id are recorded as the causation of whatever the reaction does. The core ships one
default rule: a module's service principal may invoke the actions of its own module; anything
else needs a rule like any other principal.

- **Inline** reactions run in the producing command's unit after the owner's own `evolve`, in
  module order; a failure rolls the command back.
- **Async** reactions have two tiers. The kernel's reaction dispatcher is a consumer of the event
  log (section 15.2.3) that does only short work: for each matching event it enqueues one keyed job
  per reaction in a tenant-scope unit and advances its checkpoint for that scope in the same unit.
  The job runs the handler in its own tenant-scope unit with the reaction's key, ordering,
  coalescing, concurrency and retry options (section 9.5). A failing handler is retried by the
  queue and never blocks the checkpoint; a job that exhausts its retries is parked as a dead
  letter, which is a metric, an alert and a line in `pennestack doctor`. Delivery is at least once;
  a handler is idempotent by `(reaction id, event id)`. Module code never receives a
  namespace-scope unit.
- **Processes** are async reactions with their own state stream per instance, keyed and ordered
  FIFO per instance.

Handlers receive a `ReactionEvent`: decrypted, upcast to the current schema, with typed data.

```ts
interface ReactionEventBase<Name extends string, Data, R> {
  readonly id: string                                    // event id
  readonly type: Name                                    // 'accounts.profile.deactivated'
  readonly stream: { readonly type: string; readonly id: string }
  readonly version: number                               // stream version after this event
  readonly position: Position
  readonly data: Data
  readonly before: Partial<R> | null                     // previous values of the changed fields (hidden fields excluded)
  readonly actor: ActorRef                               // who caused it
  readonly commandId: string | null
  readonly at: Date                                      // acceptance time
}
interface InlineReactionEvent<Name extends string, Data, R> extends ReactionEventBase<Name, Data, R> {
  readonly state: R                                      // the row right after this event
}
interface AsyncReactionEvent<Name extends string, Data, R> extends ReactionEventBase<Name, Data, R> {
  readonly current: R | undefined                        // the row when the job runs; undefined once purged or erased
}
```

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
type RuleSubject =
  | { readonly module: string; readonly entity?: string }          // entity rules and module-level rules
  | { readonly kinds?: readonly ActionKind[]; readonly transports?: readonly string[] }   // rules across modules (gap G13)

interface Rule<E> {
  readonly id: string                          // stable, module-prefixed: 'auth.credential.self'
  readonly effect: 'allow' | 'deny'
  readonly subject: RuleSubject
  readonly actions: readonly string[]          // action names, set operations, the aliases 'read' and 'write', or '*'
  readonly principal?: PrincipalKind | readonly PrincipalKind[]   // the rule applies only to these kinds; narrows ctx.principal
  readonly where?: (ctx: PrincipalContext) => Condition<E> | boolean   // the row acted on (the pre-image), the rows read
  readonly check?: (ctx: PrincipalContext) => Condition<E> | boolean   // the row produced (the post-image of creates and updates)
  readonly when?: (ctx: PrincipalContext, input: unknown) => boolean  // module-level, app and cross-module rules
  readonly fields?: readonly FieldName<E>[]    // reads: the maskable fields this rule reveals; writes: the fields that may change
  readonly reason?: string                     // required for deny rules
}
```

Action names: a rule names custom actions, the set operations `create`, `update`, `archive` and
`restore`, the batch `set`, or the aliases `read` (`get`, `query`, `changes`, `queryChanges`, and
generator-contributed reads such as `watch`, plus `history`) and `write` (the four operations and
`set`). A batch `set` is authorized item by item, each against its own operation.

Fields and maskability:

- A field is readable whenever its row is, unless the field is declared `.maskable()`. Only
  maskable fields may appear in the field list of a rule that names read actions, and in the
  field lists of runtime rule sources; `defineApp` and the rule-source loader reject anything
  else. A maskable field is shown when an allow rule that selected the row lists it (or lists no
  fields at all) and no deny rule that matches the row lists it.
- For write actions, `fields` lists the fields the write may change; for `decide` commands, the
  fields the resulting events change. A write that changes another field is `forbidden`
  (`authorization.mode: 'strip'` drops it instead).
- `Readable<R>`, the type of rows that transports and clients receive, makes exactly the maskable
  fields optional; every other field keeps its declared type. Inside the invoker, the write path
  always works with full rows (section 7.3).
- Hidden fields (section 6.6) are outside the rule model: they never leave their module.

### 8.2 Decision algebra

Rules from every module are one set; position in the tuple does not matter; toggling a module adds
or removes its rules and changes nothing else. The default is deny. A rule's `where` describes the
row an action may act on; its optional `check` describes the row the action may produce, as
PostgreSQL's row-level security separates `USING` from `WITH CHECK`. One condition cannot describe
both: a deny rule "already revoked" written against the row produced would deny every successful
revocation, and an allow rule "drafts may be edited" would forbid publishing.

| Operation | Allowed when |
|---|---|
| read (`get`, `query`, `changes`, `queryChanges`, `watch`, `history`, custom queries over the entity) | some allow rule's `where` matches the row and no deny rule's `where` matches it |
| `create` | some allow rule's `check ?? where` matches the new row and no deny rule's `check ?? where` matches it |
| `update`, `archive`, `restore` and custom instance commands | the target is selected: some allow rule's `where` matches the pre-image and no deny rule without `check` matches it; and the post-image passes: at least one allow rule whose `where` selected the target either has no `check` or its `check` matches the post-image, and no deny rule with a `check` matches (a deny rule with both denies when its `where` matches the pre-image and its `check` the post-image) |
| module-level and app actions | some allow rule's `when` holds and no deny rule's `when` holds |

Consequences, which the table-driven suite tests as transition cases:

- `rule.deny('credential', ['revoke'], { where: () => ({ revokedAt: { isNull: false } }) })`
  denies revoking an already revoked credential and never the revocation itself.
- `rule.allow('post', ['update'], { where: ..., check: () => ({ status: { in: ['draft', 'published'] } }) })`
  lets an editor publish a draft but not move it anywhere else.
- `rule.deny('profile', ['deactivate', 'update'], { where: () => ({ deactivatedAt: { isNull: false } }) })`
  freezes deactivated profiles and still lets an active profile be deactivated.

Deny rules exist for genuine overrides (suspended accounts, archived records, tenant-wide
freezes), must carry a `reason`, and should stay rare.

### 8.3 Conditions

The condition AST is owned by `@pennestack/core` and shared with the data layer, the live feed
and the sync protocol (one AST, two interpreters: compiled to each adapter's filter, interpreted
in memory for loaded rows, post-images, live events and offline operations).

```ts
type Condition<E> =
  | { op: 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte' | 'in' | 'nin' | 'contains' | 'startsWith'; field: FieldPath<E>; value: unknown }
  | { op: 'isNull'; field: FieldPath<E>; value: boolean }
  | { op: 'and' | 'or'; conditions: readonly Condition<E>[] }
  | { op: 'not'; condition: Condition<E> }
  | { op: 'some' | 'none' | 'every' | 'is'; relation: RelationPath<E>; where: Condition<Related<E, RelationPath<E>>> }
  | { op: 'never' }                            // what an interpolated null or undefined comparison normalises to
```

Authors write the object form (`{ ownerId: ctx.principal.subject }`,
`{ team: { members: { some: { userId: ctx.principal.subject } } } }`,
`{ revokedAt: { isNull: false } }`), which normalises to the AST. Semantics, identical in both
interpreters, are fixed in section 14.3.4: two-valued logic, null-safe `ne` and `nin`, code-point
string comparison, membership for `contains` on sets and lists.

Null in conditions written in code (rules, repository queries, live options): a comparison whose
value is `null` or `undefined` is false, and testing for absence needs `{ isNull: true }`. An
anonymous or service principal whose subject is absent therefore never matches a rule written as
`{ ownerId: ctx.principal.subject }`, even on rows whose owner is unset; rules fail closed on
optional owner fields. The client filter format on the wire keeps a shorthand: a bare `null`
means `isNull: true`, normalised in the `validate` stage before the AST exists (section 16.4.4). A
lint rule flags literal `null` in condition positions of rules (section 13.9).

The operator set is deliberately small; an adapter that cannot express a shape fails the plan with
`unsupported` instead of widening the filter. Reusable relation conditions are declared once as
named derived relations in the owning module (`relations: { owner: relation.derived(...) }`) and
referenced by name.

### 8.4 The invoked action is the unit of authorization

Authorization happens where a request enters behaviour: at the action the caller invoked. Inside
the invoker:

| Stage | Question | Result |
|---|---|---|
| gate | may this principal perform this action here at all (action rules, principal kinds, scope level)? | boolean; cheap; denial ends the pipeline with `forbidden` and the matched rule ids |
| plan | which rows may the action select, which rows may it produce, which maskable fields may the caller see? | `always`, `never`, or `conditional { where, check, fields }`, memoised per invocation |
| target | for instance commands: does the plan's `where` select the target? | outside it, `not_found`; the handler then receives the full row |
| item check | does the post-image (for creates, the new row) pass the rules of section 8.2 and the entity invariant? | failure rolls the unit back with `forbidden` |
| shape | which fields leave the invoker? | entity rows in the output are masked by the plan's fields |

Inside a handler, data access follows the module boundary, not the caller's rules:

- Repository calls run with the module's own authority over its own entities, and read access to
  the entities of its declared dependencies. The action was authorized as a whole; the module is
  trusted code that implements it. Reads are never narrowed silently by the caller's plan, so a
  uniqueness check, a quota count or an existence test never gives a wrong answer.
- Reads on behalf of the caller are explicit: `ctx.data.<m>.<e>.forCaller()` (and `ctx.target`
  in entity-mounted queries) return what the caller's read plan selects, masked by its fields.
  List and search actions use them.
- Writes reach the module's own entities, and another module's entity only for the fields this
  module contributed to it. A write outside that boundary is a type error and, at runtime,
  `forbidden`; it is never ignored. Other modules' data changes through their actions and
  services.
- Services and behavioural extension values run with their providing module's authority over the
  provider's own entities, under the caller's principal (section 5.5).
- Reactions, timers and schedules run under the module service principal `<module>.system`, never
  under the principal that triggered them, with the triggering actor recorded as causation. A
  deactivation by an operator therefore still revokes the subject's credentials, because
  `auth.system` may invoke auth's own actions.
- `ctx.asSystem(reason)` invokes actions as the system principal and is logged with the reason.

Transports never evaluate policies. Field masks apply to values leaving the invoker (the shape
stage, entity outputs, live events, sync pulls), to `filter` and `sort` inputs (a filter or sort on
a field the caller cannot see is `forbidden`, so a masked field cannot leak through a query), and
to the fields a write changes. Custom outputs carry maskable entity fields only inside entity row
nodes (`e.row()`, `e.page()`, `EntityChange`), which the shape stage masks; an output shape that
reuses a maskable field definition outside them is a compose error. Subscriptions re-run the plan
per emitted event, since a principal can lose access mid-stream.

### 8.5 Principals and their context

```ts
type PrincipalKind = 'anonymous' | 'user' | 'service' | 'operator' | 'system'
interface PrincipalBase {
  readonly scope: Scope
  readonly claims: Readonly<Record<string, unknown>>
  readonly roles: readonly string[]                       // from principal enrichers; a convenience, never the whole model
  readonly memberships: readonly Membership[]
  readonly via: string                                    // resolver id: 'auth.session', 'api-keys.key', 'core.operator', 'core.module'
  readonly ref: PrincipalRef | null                       // what jobs and receipts store: resolver id, principal id, credential id
  readonly expiresAt?: Date                               // when the presented credential stops being valid
}
interface UserPrincipal extends PrincipalBase {
  readonly kind: 'user'
  readonly subject: SubjectId                             // never null for a user
  readonly subjectRef: string | null                      // the entity subjects refer to: 'accounts.profile' when accounts is selected
  subjectAs<R extends string>(ref: R): Id<R> | null       // null when the subject is not a row of R; null never matches
}
interface ServicePrincipal extends PrincipalBase {
  readonly kind: 'service'
  readonly id: string                                     // 'auth.system', a node id for 'nodes.credential', 'github.webhook'
  idAs<R extends string>(ref: R): Id<R> | null            // the id as a branded row id when the principal stands for a row of R
}
interface OperatorPrincipal extends PrincipalBase { readonly kind: 'operator'; readonly id: string }
interface AnonymousPrincipal extends PrincipalBase { readonly kind: 'anonymous' }
interface SystemPrincipal extends PrincipalBase { readonly kind: 'system'; readonly reason: string }
type Principal = AnonymousPrincipal | UserPrincipal | ServicePrincipal | OperatorPrincipal | SystemPrincipal
```

A rule or an action that declares `principal: 'user'` sees `ctx.principal` narrowed to
`UserPrincipal`, so `ctx.principal.subject` is a non-null `SubjectId`, and
`ctx.principal.subjectAs('accounts.profile')` converts it to a branded profile id when the
subject is a profile. Branded ids therefore never accept a raw string.

Principal resolvers (an ordered extension point) turn the carrier into a principal and describe
themselves (`describe(): { scheme: 'bearer' | 'cookie' | 'apiKey'; name?; description? }`) for the
OpenAPI security schemes of section 16.5.5; principal enrichers (a set) add roles and memberships. Resolution happens once per session (section
16.3.4); the plan is memoised per `(entity, action)` within an invocation. Nothing is cached
across invocations without an explicit, bounded cache that invalidates on the enricher's source
events. Jobs and receipts store the principal's `ref`, and the kernel resolves it again when the
job runs (section 7.4).

### 8.6 Explainability, logging, tests

Every decision returns the matched rule ids and effects; `forbidden` errors carry the reason of
the deciding deny rule or the ids of the rules that would have had to allow. A decision-log hook
receives every decision (`authorization.decisionLog: 'denials' | 'all' | 'none'`), and the audit
module can write it to the chain. `ability.explain(plan)` renders the resolved condition for
support work, and `pennestack explain` evaluates a decision without executing (section 16.9.7).
Tests are three suites: table-driven policy tests, including transition cases (pre-image,
post-image and both, for every rule shape of section 8.2); type tests that a fragment cannot
reference a field or relation its `when` modules do not provide, and that read rules list only
maskable fields; and the dual-evaluation suite (insert fixtures, run the compiled plan as a real
query on every adapter, compare row by row with the in-memory decision, for `where` and `check`).

### 8.7 Configurability

- app level: `authorization.mode`, `decisionLog`, `policies.disable` (by rule id), `policies.add`
  (extra rules written in the app), `policies.replace` (a module's rule set, for a platform that
  wants a different model for one module);
- runtime: the `ruleSources` extension point lets a module load rules in CASL raw-rule shape
  (`{ action, subject, conditions, fields, inverted, reason }`, with `conditions` as `where` and an
  optional `check`) from the database, validated against the registry at load (field lists only
  over maskable fields), so tenant administrators can define rules without a deploy;
- the engine's evaluator, compilers and interpreters are replaceable through the same extension
  mechanism, and the generated PostgreSQL row-level-security backstop is an adapter option;
- clients: `core.me` returns the principal's effective rules in CASL raw-rule shape so a user
  interface can hide what the user cannot do. Rules with relation quantifiers cannot be evaluated
  by CASL's client packages without the related data, so they are exported with each relation
  resolved to the set of ids the principal reaches, or marked `serverOnly` when that set is
  unbounded. Enforcement stays on the server.

### 8.8 Multi-tenancy in authorization

Tenant isolation is not a rule. The scope resolved in the pipeline is applied by the data layer
as an unconditional predicate before any plan, and an action's `scope` level is checked at the
gate:

- tenant-scope actions run in the scope of the request;
- a tenant principal may invoke backend-scope actions of its own backend, which read and write
  backend-level entities only: a backend-scope or deployment-scope unit refuses tenant-tenancy
  entities (section 12.3);
- deployment-scope actions are reachable only at the operator endpoint, by operator principals;
- the operator acts inside one tenant only after the explicit `core.tenant.enter` action, which is
  itself logged.

No policy can widen a scope. Cross-tenant work happens only in kernel fan-out, one tenant-scope
unit per tenant.

## 9. Execution

### 9.1 Overview

```
transport ──Carrier──▶ Invoker.open ──▶ session ──Invocation──▶ pipeline ──▶ handler ──▶ unit (rows, events, jobs)
   ▲                                                                            │
   └──────────── Outcome | AsyncIterable<LiveFrame> ◀───────────────────────────┘
                     live hub ◀── change feed (event log, wake-ups after commit) ◀── commit
```

The invoker is the single entry point. It is used by transports, listeners, the CLI, tests and
`ctx.invoke`. Sections 14 to 16 specify the implementations behind the interfaces of this section;
the interfaces themselves are fixed here.

### 9.2 The pipeline

| Stage | Input | Fail-closed outcome | Extension |
|---|---|---|---|
| `resolveScope` | carrier, after the deployment's carrier enrichers | `not_found` (unknown host, scope key or tenant), `unavailable` (backend suspended) | `tenantResolution`, `carrierEnrichers` |
| `resolvePrincipal` | carrier, scope | `unauthenticated` for invalid bearer tokens and API keys; an invalid cookie session counts as absent (section 16.4.10) | `principalResolvers`, `principalEnrichers` |
| `locate` | action ref, scope | `not_implemented` when the backend's app lacks the module or the action; `forbidden` when the action's scope level does not match | registry |
| `admit` | tenant quotas, rate limits, maintenance flags (section 12.2) | `rate_limited`, `unavailable` | `invocationMiddleware` |
| `validate` | input against the action's schema, in wire or in-process form | `validation` with Standard Schema issues | |
| `authorize` | gate (section 8.4) | `forbidden` with rule ids | engine, `ruleSources` |
| `execute` | handler inside a unit (read-write for commands, read-only for queries); target selection and item check inside | domain errors, `conflict` on version mismatch | data layer, job queue |
| `shape` | output masks, output validation in development | `internal` | |
| `complete` | telemetry, decision log, receipt | | `invocationMiddleware` |

`resolveScope` and `resolvePrincipal` run once per transport request or connection, in
`Invoker.open`, which returns an `InvocationSession` (section 16.3.4); invocations reuse it.
Middleware wraps stages (an onion) and is contributed through `invocationMiddleware`; it can
observe and short-circuit, never skip `authorize`.

```ts
interface Invocation<I> {
  readonly action: string                 // 'accounts.profile.deactivate'
  readonly input: I
  readonly carrier: Carrier               // { transport, host?, path?, headers?, token?, connection?, sasl?, scopeKey?, receiver?, local? }
  readonly session?: InvocationSession    // when present, scope and principal resolution reuse it
  readonly requestId: string
  readonly commandId?: string
  readonly prefer?: 'sync' | 'async'
  readonly sync?: { readonly clientId: string; readonly clientSeq: number; readonly baseVersions: Readonly<Record<string, number>>; readonly hlc: string }
  readonly traceparent?: string
  readonly signal: AbortSignal
}
type Outcome<O> = { ok: true; value: O; receipt?: CommandReceipt } | { ok: false; error: PennestackError }

interface Invoker {
  open(carrier: Carrier, options?: { readonly signal?: AbortSignal }): Promise<Outcome<InvocationSession>>
  invoke<I, O>(inv: Invocation<I>): Promise<Outcome<O>>
  subscribe<I, E>(inv: Invocation<I>, resume?: { after: StateToken }): AsyncIterable<LiveFrame<E>>   // items and control frames
}
```

### 9.3 Buses

```ts
interface CommandBus {
  dispatch<R extends string>(ref: R, input: unknown, ctx: ActionContext<AnyModule>, options?: { prefer?: 'sync' | 'async'; commandId?: string }): Promise<Outcome<unknown>>
}
interface QueryBus {
  ask<R extends string>(ref: R, input: unknown, ctx: ActionContext<AnyModule>): Promise<Outcome<unknown>>
}
interface EventBus {
  /** Called inside the command's unit; events are durable at commit. */
  publish(events: readonly EventEnvelope[], unit: Unit): Promise<void>
  /** Inline reactions run in the same unit; async reactions become jobs through the reaction dispatcher. */
  subscribe(selector: EventSelector, consumer: EventConsumer, options: { timing: 'inline' | 'async'; id: string }): void
}
```

The buses are internal to the invoker; a module never calls them directly, it uses `ctx.invoke`,
`ctx.enqueue`, `e.events.*` and reactions.

### 9.4 Transactions and the event chain

A synchronous command runs in one unit on the namespace of its scope (section 14.2): insert the
pending receipt, load the target with its version, decide, buffer the events (expected version),
evolve and store the state, run inline reactions, enqueue jobs and timers in the same unit,
complete the receipt, assign positions at the commit tail, commit. The events table is the
outbox: nothing outside the unit observes anything before commit, and wake-ups are sent after
commit (section 15.2.5). Section 15.1 specifies the event store within these constraints: one
stream per entity instance, expected-version appends, commit-ordered positions per scope, a hybrid
logical clock per event, the actor and command id in the envelope.

### 9.5 Asynchronous work: jobs, timers and schedules

Asynchronous commands, async reactions, durable timers and schedules all run on one job queue
(gap G3; ADR 0015). The kernel queue stores jobs in the namespace, through the data adapter's job
store (section 14.3.2), so a job is enqueued in the same unit as the command that causes it on
every adapter, carries the scope's row-level security, and needs no relay.

```ts
interface JobSpec {
  readonly queue: string                                      // 'reactions', 'commands', 'timers', 'schedules', or a module queue
  readonly action: string                                     // the worker invokes this action, or runs this reaction
  readonly input: unknown
  readonly scope: Scope
  readonly principal: PrincipalRef                            // re-resolved when the job runs (section 7.4); module service principals for reactions, timers and schedules
  readonly causation: { readonly eventId?: string; readonly commandId?: string; readonly actor?: ActorRef }
  readonly runAt?: Date
  readonly key?: { readonly value: string; readonly onConflict: 'keep' | 'replace' | 'coalesce' }
  readonly group?: { readonly id: string; readonly concurrency: number }    // per-destination or per-tenant concurrency
  readonly ordering?: 'none' | 'fifo-per-key'
  readonly retry?: { readonly limit?: number; readonly delays: 'exponential' | readonly string[]; readonly maxDelay?: string; readonly giveUpAfter?: string }
  readonly heartbeatSeconds?: number
  readonly expireInSeconds?: number
  readonly deadLetter?: string
  readonly capability?: string                                // gap G9
}
interface JobQueue {
  readonly capabilities: { readonly keys: true; readonly groups: true; readonly fifoPerKey: true; readonly heartbeat: true; readonly schedules: true }
  enqueue(job: JobSpec, unit: Unit): Promise<JobId>
  cancel(queue: string, key: string, unit: Unit): Promise<number>
  work(queue: string, handler: (job: Job) => Promise<void>, options: WorkOptions): Promise<Stop>
  schedule(id: string, expression: string, job: Omit<JobSpec, 'runAt' | 'scope' | 'principal'>, fanOut: 'backend' | 'each-tenant'): Promise<void>
}

// Durable, keyed timers inside handlers, set in the caller's unit; they fire under the module's service principal:
await ctx.timers.set({ key: `node-offline:${id}`, at, invoke: 'nodes.node.markOffline', input: { id } })
await ctx.timers.cancel(`node-offline:${id}`)
// Schedules, a contribution to the core's `schedules` extension point:
.schedules((s) => [s.every('5m', 'dns.refreshPublicAddress', { scope: 'each-tenant', jitter: '30s' })])
```

- Workers run only in processes with the `work` role. They take jobs with row locks
  (`FOR UPDATE SKIP LOCKED` on PostgreSQL and MySQL; the single writer on SQLite, PGlite and the
  in-memory adapter), respect keys, groups and FIFO order, renew heartbeats and park exhausted jobs
  as dead letters.
- Retries follow the error taxonomy: `unavailable`, `rate_limited` (honouring `retryAfter`) and
  `conflict` with `retryable` are retried by the job's policy; every other kind fails the job at
  once. Domain waits (an image that does not exist yet) are state machines with timers, not job
  retries.
- The worker sets the scope, resolves the principal from its reference, invokes the action through
  the invoker (so the gate and the item check run again against current state) and records the
  outcome on the receipt.
- `each-tenant` schedules enumerate the tenants of the backends whose app contains the module and
  enqueue one job per tenant, with group concurrency per backend; at most one run per tick and
  scope exists, however many processes run. Schedules run under the module's service principal
  with the schedule id as the reason.
- Per-tenant job concurrency (a group per tenant and queue) is the job side of the quota model
  (section 12.2).
- pg-boss 12.37.1 has nearly all of these primitives on PostgreSQL alone. The kernel queue is
  preferred because the same queue then works on every adapter, in `pennestack dev` on PGlite and
  in tests on the in-memory adapter, and because job payloads stay under tenant row-level
  security. A `queue-pg` infrastructure entry built on pg-boss remains possible behind the same
  interface; section 21 lists the choice as a decision point.

### 9.6 Live updates

```ts
interface ChangeFeed {
  /** Events after a position for one scope; reads committed events through read-only units. */
  read(scope: Scope, after: StateToken | null, selector: EventSelector): AsyncIterable<EventEnvelope>
  /** Wake-ups, never data: something may have been committed in this scope (section 15.2.5). */
  wake(scope: Scope): AsyncIterable<void>
}
interface LiveHub {
  entity<Row>(session: InvocationSession, entity: string, input: WatchInput<unknown>, resume?: StateToken): AsyncIterable<LiveFrame<EntityChange<Row>>>
  // pokes, stream records and topics: section 15.4.11
}
```

The live module subscribes to the change feed, re-evaluates the principal's plan per event
(section 8.4), masks fields and emits frames with stream tokens (section 15.4). Carriers (SSE
first, WebSocket second) are transports (sections 15.4.6 and 15.4.7); the poke-then-pull shape of
the client protocol is section 15.2.5. "Live updates on everything" follows from every entity
producing events or transient change records and from the generated `watch` on every entity.

### 9.7 Multi-tenancy in execution

Jobs, events, receipts and subscriptions carry the scope; a worker sets the scope and resolves the
principal from the job before any code runs; placements are resolved per scope, so two tenants on
different databases never share a transaction; positions are counted per scope, so one tenant's
writes never queue behind another's (section 15.1.4); quotas are enforced at `admit` and by job
concurrency per tenant (section 12.2).

## 10. Errors

One closed taxonomy, defined in core and serialised by each transport (the mapping table is in
section 16.4.6):

| Kind | Meaning | Retryable |
|---|---|---|
| `validation` | input or output does not match its schema; carries Standard Schema `issues` | no |
| `unauthenticated` | a principal is required and none was resolved, or presented credentials are invalid | no |
| `forbidden` | the gate, the item check or a write outside the module boundary was denied; carries rule ids and reason | no |
| `not_found` | scope, entity row or ids absent, or a target outside the plan | no |
| `conflict` | version or state mismatch, uniqueness, idempotency fingerprint mismatch, command in progress | sometimes (`retryable` set per case) |
| `rate_limited` | admission or a write denied by a rate or a quota (section 12.2) | yes for rates, with `retryAfter`; no for an exhausted quota (code `core.quota_exceeded`) |
| `not_implemented` | module or action not part of this backend's app | no |
| `unavailable` | backend suspended, placement unreachable, shutting down, timeout | yes |
| `unsupported` | an adapter cannot express a condition or capability (fail closed) | no |
| `internal` | anything undeclared; message redacted outside development | no |

```ts
class PennestackError extends Error {
  readonly kind: ErrorKind
  readonly code: string                  // stable, module-prefixed: 'accounts.email_taken'
  readonly issues?: readonly { path: readonly PropertyKey[]; message: string }[]
  readonly details?: unknown             // typed by the ErrorSpec's data schema
  readonly retryable: boolean
  readonly retryAfter?: number           // seconds
  readonly rules?: readonly { id: string; effect: 'allow' | 'deny' }[]
}
const emailTaken = defineError('accounts.email_taken', { kind: 'conflict', data: shape({ email: field.string() }), message: 'This e-mail address is already in use.' })

/** The one serialised form, used by every transport, the sync protocol and receipts. */
declare function toWire(error: PennestackError, audience: 'public' | 'operator' | 'development'): WireError
```

`toWire` decides once what an audience sees: operator principals and development get rule ids and
unredacted `internal` messages; everyone else gets the code, the kind, the message and the deny
reason (`WireError`, section 16.4.6). The core registers its own codes: `core.forbidden`,
`core.version_mismatch`, `core.state_mismatch`, `core.idempotency_mismatch`,
`core.command_in_progress`, `core.cursor_mismatch`, `core.malformed_request`,
`core.payload_too_large`, `core.csrf`, `core.token_scope_mismatch`, `core.live_unavailable`,
`core.quota_exceeded` and `core.timeout`. A command that exceeds its timeout is rolled back and reported as `unavailable`
with code `core.timeout`, retryable under the same command id.

Declared errors become typed unions in GraphQL, typed results of `attempt` in the typed client,
documented responses in OpenAPI and exit codes in the CLI. Error codes are part of the public
contract and are never reused.

## 11. Observability

- Tracing and metrics through OpenTelemetry (`@opentelemetry/api` 1.9.1; SDK 2.x in the
  deployment package). The invoker opens one span per invocation with attributes
  `pennestack.app`, `.backend`, `.tenant`, `.module`, `.entity`, `.action`, `.kind`,
  `.transport`, `.execution`, `.outcome` and the matched rule ids; transports, the data layer and
  the queue add child spans; W3C `traceparent` is propagated in and out and stored in every event
  envelope, so live deliveries, async reactions and webhooks link back to the command that caused
  them. Section 16.11 adds the interface layer's spans and metrics.
- Metrics: invocations and durations by action and outcome, job queue depth, age and dead letters,
  event append rate per namespace, projection and change-feed lag, live subscriptions, per-tenant
  quota usage (section 12.2).
- Logs are structured, carry the scope ids and request id, and go through `ctx.log`; no module
  writes to `console`. The default `Logger` implementation in the deployment package is pino
  10.4.0 writing JSON lines to standard output; the core depends only on the `Logger` interface.
  `.personal()`, secret, verifier and hidden values are redacted in logs, traces and decision logs.
- The decision log (section 8.6) and the command receipts give an audit trail of who did what;
  receipts record the transport, the remote address after trusted-proxy rules and the user agent
  (gap G12); the chain itself is the audit trail of what changed. An `audit` module can persist
  them.
- Health: `app.health` (liveness) and `app.ready` (readiness: control store, placements, queue)
  are app-level actions every transport exposes; `pennestack doctor` runs them from the CLI.
- Development: the invoker can emit a per-invocation explanation (stages, timings, plan, matched
  rules) when `PENNESTACK_EXPLAIN=1`.

## 12. Multi-tenancy and one deployment

### 12.1 What each layer does

The brief makes this cross-cutting; this section collects the statements of each layer.

| Layer | How it handles backends and tenants |
|---|---|
| Kernel | Control entities `core.backend`, `core.tenant`, `core.domain`, `core.placement` and `core.namespace` (tenancy `deployment`) and the scope directory; `core.commandReceipt` with tenancy `invocation` (rows carry their command's scope); operator actions with `scope: 'deployment'`; runtime creation without restart; per-backend module configuration and per-tenant overrides; `onBackendCreated` and `onTenantCreated` hooks for provisioning; a change feed over the control store keeps every process's directory current. |
| Pipeline | `resolveScope` runs first on every request or connection, using the deployment-ordered tenant resolvers (host name, path prefix, header, scope key from tokens, receivers and listeners such as the SMTP recipient domain); the same resolvers serve every transport, the CLI and non-HTTP listeners; actions declare the scope level they accept and the gate rejects a mismatch. |
| Data layer | Placement per tenant (shared tables with a tenant key, schema per tenant, database per tenant, or a different adapter), chosen at tenant creation and changeable by a move; the adapter injects the scope predicate into every statement; PostgreSQL row-level security as a backstop; positions, consumer checkpoints and usage counters per scope; migrations per namespace; application code never sees the strategy (section 14.9). |
| Authorization | Scope is applied before and outside policies (section 8.8); the operator principal and explicit, logged tenant entry; no rule can widen a scope. |
| Execution | Jobs, events, receipts, subscriptions and checkpoints carry the scope; workers adopt it and resolve the principal again before running; quotas and job concurrency per tenant (sections 9.7 and 12.2). |
| Transports | Fill the carrier and never resolve tenants themselves; the HTTP host routes by the resolved app; cookies, CORS and CSRF checks follow the tenant's origins; generated documents are per app, served per backend (section 16.12). |
| CLI | A profile names a deployment, a backend and a tenant (or the deployment level for operator work); the token in the profile is resolved like any other principal; every command accepts `--backend` and `--tenant` overrides; operator commands create backends and tenants at runtime. |
| Secrets and configuration | Per backend with per-tenant overrides, sealed by the key service under backend and tenant keys, never in the app code or the environment of a tenant (section 5.7). |
| Isolation guarantee | A tenant principal reaches only its own tenant's data and the backend-level data of its own backend, through backend-scope actions that cannot touch tenant entities; deployment-scope actions exist only at the operator endpoint; every operator entry into a tenant is logged (sections 8.8 and 12.3). |

### 12.2 Quotas

The brief lists quotas among the dimensions in which tenants are isolated. The model:

| Dimension | Configured | Counted | Enforced |
|---|---|---|---|
| request rate (per tenant, per principal, per action class) | `core` quota configuration per backend, with tenant overrides | token buckets in the tenant's namespace, refilled by time; each process takes a small allowance at a time so the shared row is touched rarely | `admit`: `rate_limited` with `retryAfter` |
| concurrent invocations per tenant | as above | per process, reconciled through leases in the control store | `admit` |
| storage: rows, event bytes and blob bytes per tenant | as above; modules may declare finer dimensions (`mail-store`'s bytes per mail account) | usage counters per scope, updated in the commit tail of the unit that changes them (blob bytes when a blob is adopted or purged) | the commit tail: `rate_limited` with code `core.quota_exceeded`, not retryable |
| jobs per tenant | as above | queue groups per tenant and queue | the job queue: excess jobs wait |
| live subscriptions and connections per tenant | as above | deployment-wide, through leases in the control store; per-process counters for the fast path | `admit` at subscribe time |

- Quota dimensions are declared like configuration (`quotas: { storageBytes: quota.bytes().default('10GiB') }`
  on a module or on the core) and changed through operator actions (`core.quota.set`), or through
  tenant-editable configuration where a backend allows it.
- Usage counters are maintained per scope inside the namespace, so they commit with the data they
  count; the counters of one tenant never contend with another tenant's, because positions and
  counters are both per scope (section 15.1.4).
- Usage is a metric per tenant and dimension; `pennestack doctor` lists tenants above 80 percent
  of a limit.

### 12.3 Scope boundaries, cross-scope work and outbound connections

- A unit is opened for one scope. A backend-scope or deployment-scope unit refuses tenant-tenancy
  entities: plan compilation fails with `unsupported`, and PostgreSQL row-level security denies
  the statement as well. Cross-tenant work happens only in kernel fan-out, one tenant-scope unit
  per tenant (schedules with `each-tenant`, retention, migrations of data). The adversarial
  isolation suite covers these cases (section 14.10).
- A tenant command reads backend-level entities in a separate read-only snapshot, never inside its
  own transaction, whether or not the backend's home namespace is co-located with the tenant's.
  A command of another scope runs only after commit through `ctx.enqueue`, returning a receipt.
  Snapshot and atomicity semantics are therefore the same on every placement.
- Modules that connect to hosts named by tenants or by DNS (MX targets, MTA-STS policy hosts,
  outbound webhooks) use the core's egress service (`ctx.egress.fetch`, `ctx.egress.connect`). It
  resolves the name, refuses loopback, private (RFC 1918 and RFC 4193), link-local and other
  special-purpose addresses unless the deployment allowlists them, pins the checked address for the
  connection, and records the destination on the span. A home installation that hosts PostgreSQL,
  Caddy's admin API and other services on its LAN is otherwise one tenant-supplied host name away
  from them.

## 13. Types and toolchain

### 13.1 Live types without a generator

The types of what is in the database are inferred from the entity definitions through
`AppEntities<App>` and the module-local types of section 7.6; the editor, `tsc`, Biome and Vitest
see the same types with no generation step in the path. A TypeScript language-service plugin is
not used: plugins never run under `tsc`, and TypeScript 7.0 ships no plugin API (research:
data-layer.md section 6, interfaces-and-devx.md section 5.4).

One generated file exists for convenience and for the things that must be files:
`pennestack.generated.ts` next to the app re-exports `AppEntities`, `Row`, `ActionRef`,
`AppActionTree` and the typed client for that app, so application code imports from one place and
the app-level fold is instantiated once (section 13.7). Module packages never import it: their
handler types are module-local. The dev server (`pennestack dev`) rewrites it on change;
`pennestack generate --check` fails CI when it, the migrations, the OpenAPI document, the SDL or
the CLI manifest drift from the definitions. Tables the framework does not own are described by
entity definitions that `pennestack db introspect` writes (section 14.8.4), so there is one type
mechanism; their drift against the live catalogue is checked at `connect`, in `pennestack dev` and
by `pennestack db introspect --check`.

### 13.2 Toolchain

| Tool | Version checked (2026-10-08 to 2026-10-11) | Role |
|---|---|---|
| TypeScript | 7.0.2 (builds and checks); 6.0.3 pinned only for tools that need the compiler API; 5.9.3 used for cross-checks | `tsc -b` with project references |
| Node.js | 24 (active LTS; 24.21.0 locally) | runs `.ts` sources directly through type stripping; `node:crypto` provides Argon2id and AES-256-GCM |
| pnpm | 11.21.0 locally | workspace |
| Biome | 2.5.15 | the only formatter and linter |
| Vitest | 5.0.3 with `--typecheck`; expect-type 1.4.0 | unit, integration and type tests |
| @ark/attest | 0.57.0 (alpha; needs TypeScript 6) | instantiation budgets on the composition types |
| OpenTelemetry | api 1.9.1, SDK 2.x | section 11 |

Compiler options are in section 13.3. Consequences the DSL respects: no enums, no namespaces, no
parameter properties, no decorators; relative imports carry `.ts`.

### 13.3 TypeScript configuration and project references

`tsconfig.base.json`, shared by every package:

```json
{
  "compilerOptions": {
    "target": "es2024",
    "lib": ["es2024"],
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "types": ["node"],
    "strict": true,
    "exactOptionalPropertyTypes": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "erasableSyntaxOnly": true,
    "verbatimModuleSyntax": true,
    "rewriteRelativeImportExtensions": true,
    "resolveJsonModule": true,
    "customConditions": ["@pennestack/source"],
    "composite": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "skipLibCheck": true
  }
}
```

- Every package's `tsconfig.json` extends it and sets `rootDir: "src"` and `outDir: "dist"`
  explicitly (TypeScript 6 and 7 require an explicit `rootDir` when the common source directory
  differs, error TS5011), lists its `references`, and excludes tests.
- `isolatedDeclarations` is enabled only in packages whose exports are explicitly typed (core
  internals, adapters, the client, the CLI). It cannot be enabled in packages that export DSL values
  (modules, apps, transport modules, examples): TypeScript 7.0.2 rejects `export const accounts =
  defineModule(...)` with TS9010 and TS9013, because the type comes from inference (Appendix B).
  The named-type pattern of section 4.1 keeps the inference and still needs the full checker for
  declaration emit.
- The root `tsconfig.json` is a solution file (`"files": []` and the references of every package);
  `tsc -b` builds the graph with TypeScript 7.0.2.
- Tests live next to sources (`*.test.ts`, `*.test-d.ts`). Each package has a `tsconfig.test.json`
  (no emit, includes the tests, references the package), which Vitest's type checker uses.

### 13.4 Workspace packages from source

Workspace packages are consumed as TypeScript source in development and as JavaScript when
published, through one export condition:

```json
{
  "name": "@pennestack/core",
  "type": "module",
  "exports": {
    ".": { "@pennestack/source": "./src/index.ts", "types": "./dist/index.d.ts", "default": "./dist/index.js" },
    "./wire": { "@pennestack/source": "./src/wire/index.ts", "types": "./dist/wire/index.d.ts", "default": "./dist/wire/index.js" }
  },
  "publishConfig": {
    "exports": {
      ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
      "./wire": { "types": "./dist/wire/index.d.ts", "default": "./dist/wire/index.js" }
    }
  },
  "files": ["dist"]
}
```

- `pennestack dev` runs Node with `--conditions=@pennestack/source`, and TypeScript resolves the same
  condition through `customConditions`, so an edit in any workspace package is live in the running
  app without a build step.
- This works because pnpm links workspace packages: Node resolves the link to the real path outside
  `node_modules`, where type stripping is allowed. Node refuses type stripping for files under
  `node_modules` (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`), so the published manifest must not
  carry the source condition; pnpm's `publishConfig.exports` replaces `exports` at pack time. Both
  behaviours were checked with Node 24.21.0 (Appendix B).
- Production runs the JavaScript that `tsc -b` emits (`pennestack start` runs `dist`), so production
  does not depend on type stripping at all.

### 13.5 Project layout

The framework repository follows section 18; `examples/launchway` and
`examples/mail` are apps. An application repository built on pennestack looks the same at a smaller
scale:

```
my-platform/
  pennestack.config.ts            export default defineDeployment({ apps: [...] })
  apps/portal/
    package.json  tsconfig.json
    src/app.ts                    const portalDef = defineApp({ ... }); export interface Portal extends AppType<typeof portalDef> {}; export const portal: Portal = portalDef
    src/pennestack.generated.ts   generated, committed
    generated/                    api-surface/, openapi/, graphql/, cli/: generated, committed
  modules/<id>/                   one package per module (section 16.9.8)
  .pennestack/                    dev socket and caches; ignored by git
  biome.json  package.json  pnpm-workspace.yaml  tsconfig.base.json  tsconfig.json
```

### 13.6 `pennestack dev`

`pennestack dev` is a supervisor with three kinds of children:

1. **The type checker**: `tsc -b --watch --preserveWatchOutput` with TypeScript 7.0.2. Diagnostics
   stay visible in the status line; they do not stop the app, because type stripping does not need
   types, but `pennestack build` refuses them.
2. **The probe**: a short-lived Node process that imports `pennestack.config.ts`, composes every
   app, derives the surfaces and asks every producer for its artefacts. A fresh process runs after
   each change, because an ECMAScript module graph cannot be unloaded. It writes only the artefacts
   whose content changed (atomic rename), so the type checker and the editor see new types within
   one cycle and no watch loop starts. Module definition files must be free of I/O at import time;
   the probe has a 10-second limit and names the import that hung.
3. **The app**: one process with role `all`, the dev operator socket `.pennestack/dev.sock`,
   `PENNESTACK_EXPLAIN=1` and the source condition. Before it starts, the data layer synchronises
   the development database (expand steps at once, contract and rebuild steps after a confirmation
   in the terminal, section 14.6.4).

The supervisor watches the workspace with recursive `fs.watch` (ignoring `node_modules`, `dist`,
`generated`, `.pennestack` and `pennestack.generated.ts`), debounces changes for 100 milliseconds,
then runs the probe, the database synchronisation and a restart of the app (stop phase with a
2-second deadline). The target is a restart under one second for the proof apps, to be measured.
It prints one line per invocation from the explain stream, for example
`POST /api/accounts/register → accounts.register 201 12 ms allow accounts.register.public`. Only in
development do transports serve GraphiQL, the API reference page and verbose problem details.

### 13.7 Generated artefacts

| Artefact | Producer | Written by | Committed | Checked by | At runtime |
|---|---|---|---|---|---|
| `src/pennestack.generated.ts` | core, plus type fragments from transports | `dev` on change, `generate` | yes | `generate --check` | not loaded (types only) |
| `generated/api-surface/<app>.json` | core | `dev`, `generate` | yes | `generate --check`, `introspect diff` | recomputed in memory; the hash is compared at boot (warning in development, configurable in production) |
| `generated/openapi/<app>.json` | `transport-rest` | `dev`, `generate` | yes | `generate --check`, OpenAPI schema validation | recomputed by the same function and served with per-backend `servers` |
| `generated/graphql/<app>.graphql` | `transport-graphql` | `dev`, `generate` | yes | `generate --check` | the schema object is built from the surface; its printed form equals the file |
| `generated/cli/<app>.json` | `@pennestack/cli` | `dev`, `generate` | yes | `generate --check` | not used; the CLI builds from the surface |
| `TrpcRouter` type alias | `transport-trpc` | type fragment in the generated file | yes | `generate --check` | the router value is built from the surface |
| migrations and module snapshots | data layer | `db generate` (explicit, never by the watch loop) | yes | `generate --check` (definitions against snapshots), `db check` | production verifies the applied history |
| entity definitions for external tables | data layer | `db introspect` (section 14.8.4) | yes | `db introspect --check` | no |

The generated TypeScript file re-exports what application code needs, so the app-level type fold is
instantiated once:

```ts
// Generated by pennestack from src/app.ts. Do not edit. Surface sha256-3q2F...
import type { ActionRef as ActionRefOf, AppActionTree, AppEntities, Row } from '@pennestack/core'
import type { AppClient } from '@pennestack/client'
import type { TrpcRouterOf } from '@pennestack/transport-trpc'
import type { Portal } from './app.ts'

export type App = Portal
export type Entities = AppEntities<App>
export type Actions = AppActionTree<App>
export type ActionRef = ActionRefOf<App>
export type Client = AppClient<App>
export type RowOf<R extends string> = Row<App, R>
export type TrpcRouter = TrpcRouterOf<App>               // type fragment of transport-trpc
```

Rules for every artefact: LF line endings, a trailing newline, sorted keys, two-space JSON
indentation, no timestamps, a header naming the producer and the surface hash. Biome excludes
generated paths from linting and formatting (`"!**/generated"`, `"!**/pennestack.generated.ts"`)
but keeps them indexed for type-aware rules.

### 13.8 `pennestack build` and CI

CI runs, in order:

1. `pnpm install --frozen-lockfile`;
2. `biome ci` (formatting and linting, no writes);
3. `tsc -b` with TypeScript 7.0.2 (checks every project and emits `dist`);
4. `vitest run` with type checking (unit, integration and type tests);
5. `pennestack generate --check`;
6. `pennestack db check` (section 14.8.5);
7. the transport conformance suite of section 16.3.8, the adapter conformance suite of section
   14.10 and the dual-evaluation suite of section 8.6 on every adapter the milestone ships
   (PostgreSQL, PGlite and in-memory from M1; MySQL and SQLite from M7, roadmap.md);
8. the type budgets of section 13.11: instantiation counts per app with
   `tsc -p <app> --extendedDiagnostics` (and `--generateTrace` for diagnosis; both work on
   TypeScript 7.0.2, Appendix B), declaration size per module package, and no TS7056, TS2742 or
   TS4023; attest benchmarks for the core's composition types run on TypeScript 6.0.3, which
   attest still needs;
9. `pennestack introspect diff --base origin/main`: compares each app's committed surface with the
   base and classifies every change as breaking (an action or an output field removed; an output
   field made optional; a new required input field; an input type narrowed or an input enum value
   removed; an execution mode changed away from `sync`; an error code given another kind),
   dangerous (an output enum value or a union member added, which exhaustive clients must handle),
   additive or neutral. A breaking change fails unless the change set acknowledges it in the app's
   changelog.

`pennestack build` runs steps 2 to 6 and 9 locally, then emits JavaScript for production.

### 13.9 Biome preset and framework lint rules

`@pennestack/biome-config` publishes a Biome 2.5.15 configuration that projects extend with
`"extends": ["@pennestack/biome-config/biome"]`. Biome stays the only formatter and linter, with
its formatter defaults. The preset enables these rules as errors:

| Rule (group) | Why |
|---|---|
| `noExplicitAny` (suspicious) | one `any` in a module definition collapses the composition types (section 4.7) |
| `noConsole` (suspicious) | logs go through `ctx.log` (section 11) |
| `noImportCycles` (suspicious) | the package graph is a DAG (section 18) |
| `noTsIgnore` (suspicious) | `@ts-expect-error` makes a negative type test fail when the error disappears |
| `noEnum`, `noNamespace`, `noParameterProperties` (style) | erasable syntax only, for Node's type stripping |
| `useImportType`, `useExportType` (style) | `verbatimModuleSyntax` |
| `useNodejsImportProtocol` (style) | `node:` specifiers for built-ins |
| `noProcessEnv` (style) | configuration comes from `ctx.config`, secrets from `field.secret()`, deployment values from `env()` |
| `noNonNullAssertion` (style) | `noUncheckedIndexedAccess` results are meant to be handled |
| `noDefaultExport` (style) | named exports everywhere except `pennestack.config.ts` (an override) |
| `useImportExtensions` (correctness) | relative imports carry `.ts`, as Node and `rewriteRelativeImportExtensions` need |
| `noUnusedImports`, `noPrivateImports` (correctness) | hygiene; `@private` internals stay private |
| `noFloatingPromises`, `noMisusedPromises` (nursery) | unawaited work escapes the transaction and the span; the exact Biome version is pinned, so nursery behaviour does not drift |
| `noRestrictedImports` (style) | the package-kind boundaries below |

Package-kind boundaries, as `overrides` with `includes`:

- module packages may not import adapters, transports, database drivers (`pg`, `mysql2`,
  `better-sqlite3`), `kysely` or `drizzle-orm`: handlers reach data through `ctx.data`, and the SQL
  escape hatch comes from an adapter capability, not from an import;
- transport packages may not import module packages, adapters or the data package: transports see
  only the surface and the invoker;
- the core imports nothing from the workspace.

GritQL plugins shipped in the same package, each with tests:

| Plugin | Flags |
|---|---|
| `no-selection-augmentation.grit` | `declare module '@pennestack/...'` and `declare global` in module and app packages (principle 2) |
| `named-module-types.grit` | an exported `defineModule(...)` or `defineApp(...)` value without a named type annotation (section 4.1) |
| `no-null-in-conditions.grit` | a literal `null` as a comparison value in a rule's `where` or `check` (section 8.3) |
| `as-system-reason.grit` | `ctx.asSystem()` without a reason or with an empty string |
| `pure-deciders.grit` | `Date.now()`, `new Date()` without arguments, `Math.random()`, `crypto.randomUUID()` and `performance.now()` inside `decide` and `evolve` (use `ctx.clock` and `ctx.ids`) |
| `unbroken-builder.grit` | an expression statement that discards the result of a builder step (`entities`, `actions`, `entityActions`, `policies`, `reactions`, `services`, `contributes`, `conditional`, `lifecycle`): every step returns a new module value |
| `error-code-format.grit` | `defineError` codes that do not match `<module>.<snake_case>` |

```grit
or {
  `$ctx.asSystem()`,
  `$ctx.asSystem($reason)` where { $reason <: or { `""`, `''` } }
} as $call where {
  register_diagnostic(span = $call, message = "asSystem() needs a reason: it is written to the audit log.", severity = "error")
}
```

The patterns above are sketches; the package finalises them against fixtures. Checks that need
the registry rather than syntax (module ids against the reserved list, camel-case collisions,
error-code prefixes against the declaring module, unique TypeID prefixes) run at `defineModule`,
`defineApp` and boot.

### 13.10 Type tests

- Every package has `*.test-d.ts` files checked by Vitest 5.0.3 with `--typecheck`, using
  `expectTypeOf`; a check on 2026-10-10 confirmed that Vitest's type checker runs on TypeScript
  7.0.2 and reports failing assertions (Appendix B).
- The core's suite contains the fourteen cases of section 4.7, the context rules of section 7.6
  (each module compiles with no app in scope; `ctx.data.accounts` is `| undefined` under
  `optional` and present inside a `w.when([accounts])` part; `ctx.live` follows the contract),
  the policy typing (a condition cannot name a field or relation that the rule's modules do not
  provide; read rules list only maskable fields; `principal: 'user'` narrows the subject), and the
  generated file's exports.
- `@pennestack/testing/types` exports assertion helpers for application authors:
  `ExpectValidApp<A>` (no `defineApp` check properties), `HasEntity<App, 'accounts.profile'>`,
  `HasAction<App, 'accounts.profile.changePassword'>`, and the client types `InputOf`, `ResultOf`
  and `EventOf` for asserting what a transport will accept and return.
- `pennestack module new` scaffolds the toggle cases: the module alone, the module with each module
  in its `optional` list, and the conditional parts present only in the latter.
- Transport packages carry type tests of their derived types (the cases of Appendix B for tRPC,
  the result types per execution mode for the typed client, `Readable<Row>` for masks) and an
  instantiation budget on their fixture app.

### 13.11 Type budgets and declaration emit

Two costs grow with the number of modules and are guarded in CI for both proof apps.

**Declaration emit.** Every package is `composite`, so `tsc -b` must write a `.d.ts` for every
exported value. Module values have inferred types, and `requires`, `optional` and
`contributes[].to` hold each dependency's full type; without a name, the emitter copies every
dependency's structure into each dependant, recursively. Checked on 2026-10-11 with TypeScript
7.0.2 and the section 4.7 listing (types exported): in a chain of ten modules, each requiring its
two predecessors and holding two entities of four fields, the inferred pattern emitted 1.1, 2.2,
4.6, 8.4, 15, 26, 45, 76, 130 and 219 KB; with the named-type pattern of section 4.1 every module
emitted about 1.3 KB. The review measured the same growth on TypeScript 5.9.3 and 6.0.3, up to
TS7056 ("inferred type of this node exceeds the maximum length the compiler will serialize") at
the tenth module of a larger chain. Both proof apps are that deep (`previews` requires
`deployments`, which requires `projects` and `nodes`; `smtp-submission` requires `mail-delivery`,
which requires `mail-store`, which requires `mail-domains`). Rules:

- every exported module and app value has a named type (`ModuleType`, `AppType`), scaffolded by
  `pennestack module new` and enforced by `named-module-types.grit`;
- every type that can appear in a DSL value's type is exported by `@pennestack/core`, or emit fails
  with TS4023 or TS2742;
- CI builds both proof apps under the pnpm layout and fails on TS7056, TS2742 or TS4023, and when a
  module's `.d.ts` exceeds the budget the spike sets (a few kilobytes per module).

**Instantiations.** CI runs `tsc -p <app> --extendedDiagnostics` on `examples/launchway` and
`examples/mail` and fails when the instantiation count exceeds the budget the spike establishes on
synthetic apps of 25 and 40 modules with the builder chain (section 4.7 gives the fold's own
figures: 195,783 and 408,543 on TypeScript 7.0.2). attest benchmarks guard the composition types in
`@pennestack/core`.

### 13.12 `pennestack doctor`

Checks the environment and the project, then the running backends:

- Node 24 or later; TypeScript 7.0 for builds (and 6.0 only where attest runs); the pnpm version;
  the Biome version the preset expects;
- every `tsconfig.json`: the options of section 13.3, an explicit `rootDir`, `customConditions`
  with the source condition, `isolatedDeclarations` only where it can work;
- project references complete: every workspace dependency of a package is referenced (computed
  from `package.json`);
- package manifests: the source condition in `exports`, absent from `publishConfig.exports`;
- artefacts fresh (`generate --check`);
- named types on exported module and app values, and declaration sizes within budget;
- the deployment: operator socket permissions, master key present, control store reachable, the
  control store on a different database cluster than the placements or an erasure-ledger sink
  configured (section 14.7.6), external-table drift, dead letters and parked streams; then
  `app.health` and `app.ready` per backend.

## 14. Data layer

This section specifies the data adapter boundary, placements and namespaces, the column mapping of
the field model, migrations per module, retention and erasure, the live types of stored data, and
how the data layer handles tenancy. Section 15 continues with the event log, consumers, offline
sync and live updates. ADRs [0006](adr/0006-data-adapter-boundary-namespaces-and-migrations.md),
[0007](adr/0007-event-log-positions-and-projections.md),
[0008](adr/0008-offline-sync-and-merge-rules.md) and
[0009](adr/0009-personal-data-retention-and-erasure.md) record the decisions. The PostgreSQL
statements this section relies on (the commit-tail counter, including the reuse of a rolled-back
allocation, and the unique-violation code of expected-version conflicts) and the `xid8` visibility
scheme it rejects were run on PostgreSQL 18.3 through PGlite 0.5.8 on 2026-10-11; PGlite has a
single connection and cannot exercise lock waits, so concurrent multi-tenant writers are measured
on a networked PostgreSQL before M1 (roadmap M0).

### 14.1 Principles

1. **The entity model is the only schema.** Columns, indexes, migrations, event payloads, merge
   metadata and the types of everything stored derive from the field model of section 6. No
   adapter has a second schema language; tables the framework does not own are
   described by entity definitions as well (section 14.8.4).
2. **The chain is the source of truth; tables are projections.** For `history: 'chain'` entities
   the event log is authoritative and the state table is an inline projection that can be rebuilt
   from it. Every other table is either a projection of the log or explicitly declared as not
   being history (`state`, `external`).
3. **Tenancy is applied below everything.** A unit of work is opened for one scope; the adapter
   adds the scope predicate to every statement and every event read, and PostgreSQL row-level
   security repeats it. No caller can pass another tenant.
4. **Fail closed.** An operator an adapter cannot express, a capability a module needs but the
   placement lacks, a drifted schema, a client clock too far ahead, a change report the server
   cannot compute exactly: each is an error or a forced resynchronisation, never a wider filter or
   a silent gap.
5. **Never disclose, never silently miss.** A change report (`changes`, `queryChanges`, live
   events, sync pulls) contains an id only if the principal could read the row at the client's
   position or can read it now. When the server cannot decide, it tells the client to
   resynchronise.
6. **Stored formats are final from the first milestone.** Later milestones add tables, columns and
   protocols; they never reinterpret an event, a position or a token written earlier. Every event
   carries its hybrid logical clock, actor, command id, client fields, before-images and hash from
   day one, even while nothing reads some of them.
7. **Deterministic replay.** Author `evolve` functions, the generic field-operation evolve and
   every merge rule are pure functions of the stream in version order, so a table rebuilt from the
   log equals the table maintained inline, and convergence can be property-tested.

### 14.2 Storage model at a glance

```
deployment
├── control store                         namespace "control", deployment scope
│     core entities: backends, tenants, domains, placements, namespaces, wrapped tenant keys,
│     erasure ledger, retention rules; their own event log (the directory change feed)
└── placement "default"                   adapter postgres, strategy shared-tables
      ├── namespace "launchway"           root: PostgreSQL schema launchway
      │     framework tables  ps_events  ps_positions  ps_shapes  ps_consumers  ps_parked
      │                       ps_jobs  ps_serials  ps_usage  ps_subject_keys  ps_value_keys
      │                       ps_subject_refs  ps_tombstones  ps_stream_records  ps_migrations
      │     module tables     core__command_receipt  accounts__profile  auth__credential  auth__session ...
      └── namespace "mail"                root: PostgreSQL schema mail
            framework tables  ps_events ...
            module tables     accounts__profile  mail_store__email  mail_store__mailbox ...
```

- A **namespace** owns one event log, one set of framework tables and one copy of the tables of
  one app. A `shared-tables` placement holds one namespace per app of the deployment's catalogue
  (optionally restricted per placement); `schema-per-tenant` and `database-per-tenant` placements
  hold one namespace per tenant. Inside a namespace, positions, consumer checkpoints, serials and
  usage counters are kept per scope (a tenant, or a backend for backend-level entities), so
  tenants that share a namespace never share a position space (section 15.1.4).
- A **unit** is one transaction on one namespace, opened for one storage scope. All data access of
  one invocation runs in one unit (section 14.3.6).
- The namespaces of every app on every placement are provisioned and migrated in the `migrate`
  lifecycle phase, so creating a backend or a tenant on a shared placement is a data operation.

### 14.3 The adapter boundary

#### 14.3.1 Layers

| Layer | Package | Responsibility |
|---|---|---|
| Kernel repositories and write path | `@pennestack/core` | `ctx.data.<module>.<entity>`: typed reads with the module's authority or the caller's view (section 8.4), writes as events, `decide` and `evolve`, merge rules, item checks, receipts, sealing of credential material and encryption of personal fields, the kernel job queue. Written once, against the contract. |
| Contract | `@pennestack/core` (types only) | `DataAdapterFactory`, `DataAdapter`, `Unit`, `RowStore`, `EventStore`, `ReceiptStore`, `JobStore`, `ConsumerStore`, `TombstoneStore`, `StreamRecordStore`, `UsageStore`, `SubjectKeyStore`, `SchemaOperations`, `ChangeFeedSource`, descriptors, positions. The core declares them because its extension points are typed by them. |
| SQL family | `@pennestack/data` | The Kysely-based implementation shared by SQL adapters: descriptor-to-table mapping, condition and cursor compilers, value codecs, the scoping plugin, DDL rendering through Kysely's schema builder, catalogue introspection, the migration planner, the in-memory adapter and the conformance kit. |
| Dialect adapters | `@pennestack/adapter-*` | Driver, dialect codecs and quirks, change-feed wake-ups, row-level security, capability declaration. |

The event store must share the transaction that updates the state tables, so it is part of the
unit (`unit.events`), an adapter declares `capabilities.eventStore`, and there is no separate
event-store extension point. A store that cannot join that transaction (a separate event-store
server) cannot hold chain entities; it could only be an export target. The same holds for the job
store: jobs are enqueued in the unit of the command that causes them.

#### 14.3.2 The contract

```ts
// Declared in @pennestack/core (types only). Implemented by adapters. Used by the kernel write path.

/** Where a unit runs. `namespace` is kernel-internal (migrations, provisioning, maintenance that touches no
 *  tenant rows): it never appends events and is never handed to module code. */
export type StorageScope =
  | { readonly level: 'tenant'; readonly backendId: string; readonly tenantId: string }
  | { readonly level: 'backend'; readonly backendId: string }
  | { readonly level: 'deployment' }
  | { readonly level: 'namespace'; readonly reason: string }

export interface NamespaceRef {
  readonly id: string                      // stable id, recorded in the control store
  readonly placementId: string
  readonly appId: string
  readonly tenantId: string | null         // set for schema-per-tenant and database-per-tenant
  readonly root: string                    // PostgreSQL schema, MySQL database or name prefix, SQLite file or prefix
}

/** Commit-ordered within one scope of a namespace (section 15.1.4); serialised as a decimal string at boundaries. */
export type Position = bigint

/** Changes only when a scope's positions cannot continue (a restore, a destructive rebuild); part of every token. */
export interface ScopeEpoch { readonly scopeId: string; readonly epoch: number }

/** The walkable entity model as an adapter sees it; built by the registry, physical names from the snapshot. */
export interface EntityDescriptor {
  readonly ref: string                     // 'accounts.profile'
  readonly module: string
  readonly name: string
  readonly history: 'chain' | 'state' | 'projection' | 'external'
  readonly tenancy: 'tenant' | 'backend' | 'deployment' | 'invocation'   // 'invocation': core receipts only
  readonly shape: ShapeRef                 // the active tracks and their versions; events record its id (section 15.1.9)
  readonly dataSubject: string | null      // 'id', a field, or a path through an immutable reference ('accountId.ownerSubject')
  readonly table: string                   // physical name inside the namespace root
  readonly fields: Readonly<Record<string, FieldDescriptor>>
  readonly relations: Readonly<Record<string, RelationDescriptor>>
  readonly indexes: readonly IndexDescriptor[]          // including partial unique indexes
  readonly partition: string | null        // field whose value partitions change tokens (section 15.1.4)
  readonly mergeState: boolean             // an offline-capable command can write this entity (M8)
  readonly searchIndexes: readonly SearchIndexDescriptor[]   // capability `search` (M4)
  readonly external: ExternalMapping | null                 // history 'external' only (M7)
}

export interface FieldDescriptor {
  readonly kind: 'string' | 'text' | 'integer' | 'decimal' | 'float' | 'boolean' | 'instant' | 'date' | 'timeZone'
    | 'enum' | 'json' | 'ref' | 'subject' | 'set' | 'list' | 'richText' | 'binary' | 'blob' | 'secret' | 'verifier' | 'serial'
  readonly column: string
  readonly optional: boolean
  readonly unique: boolean
  readonly indexed: boolean
  readonly hidden: false | { readonly history: boolean }   // history: kept in before-images (opt-in with a reason)
  readonly maskable: boolean
  readonly stateOnly: boolean              // never written to events or before-images (section 6.6)
  readonly sealed: boolean                 // credential material: secret and verifier kinds, sealed per value (section 14.7.4)
  readonly merge: 'lww' | 'counter' | 'set' | 'sequence' | 'richText' | 'exclusive'
  readonly personal: false | { readonly subject: string }   // the entity's dataSubject, or another field of the row
  readonly constraints: FieldConstraints   // maxLength, pattern, format, min, max, wide, precision, scale, values, per
  readonly ref: { readonly entity: string; readonly foreignKey: boolean } | null
  readonly inner: FieldDescriptor | null   // element of set and list
  readonly codec: string | null            // CRDT codec of sequence and richText fields, for example 'loro/1'
  readonly tag: number
}

export interface DataAdapterFactory {
  readonly id: string                      // matches `adapter` of a placement in defineDeployment
  readonly dialect: 'postgres' | 'mysql' | 'sqlite' | 'memory' | (string & {})
  readonly options: StandardSchemaV1       // adapter-specific placement options, validated at boot
  create(placement: PlacementConfig, env: AdapterEnvironment): DataAdapter
}

export interface PlacementConfig {
  readonly id: string
  readonly url?: string                    // resolved through the secrets extension point
  readonly strategy: 'shared-tables' | 'schema-per-tenant' | 'database-per-tenant'
  readonly apps?: readonly string[]        // apps whose namespaces this placement hosts; default: all
  readonly naming?: { readonly root?: string; readonly style?: 'prefix' | 'schema' }
  readonly pool?: { readonly max?: number; readonly idleTimeoutMs?: number }
  readonly options?: Readonly<Record<string, unknown>>
}

export interface AdapterEnvironment {
  readonly log: Logger
  readonly tracer: Tracer                  // OpenTelemetry; adapters open child spans per statement batch
  readonly secrets: SecretResolver
  readonly signal: AbortSignal
}

export interface DataAdapter {
  readonly placementId: string
  /** Opens pools; returns capabilities narrowed by the server version and settings. */
  connect(): Promise<AdapterCapabilities>
  close(deadlineMs: number): Promise<void>
  health(): Promise<{ readonly ok: boolean; readonly detail?: string }>
  /** One transaction on one namespace for one scope. Nesting goes through `Unit.nested`. */
  unit<T>(namespace: NamespaceRef, scope: StorageScope, fn: (u: Unit) => Promise<T>, options?: UnitOptions): Promise<T>
  readonly schema: SchemaOperations        // section 14.6.7
  readonly feed: ChangeFeedSource          // section 15.2.5
  /** Capability `broadcast`: small payloads to every process of the deployment, for topics and presence (section 15.4.7). */
  readonly broadcast?: { publish(channel: string, payload: Uint8Array): Promise<void>; subscribe(channel: string, signal: AbortSignal): AsyncIterable<Uint8Array> }
  /** The database cluster's identity, compared at connect to detect restores (section 14.7.6). */
  identity(): Promise<{ readonly systemId: string; readonly timeline: string }>
}

export interface UnitOptions {
  readonly readOnly?: boolean              // queries
  readonly isolation?: 'read-committed' | 'repeatable-read' | 'serializable'
  readonly timeoutMs?: number
  readonly signal?: AbortSignal
}

export interface Unit {
  readonly namespace: NamespaceRef
  readonly scope: StorageScope
  readonly readOnly: boolean
  readonly rows: RowStore
  readonly events: EventStore              // section 15.1.11
  readonly receipts: ReceiptStore          // section 15.1.7
  readonly jobs: JobStore                  // section 14.3.9
  readonly consumers: ConsumerStore        // checkpoints per consumer and scope, leases, parking (section 15.2.3)
  readonly tombstones: TombstoneStore      // purge tombstones (section 14.7.2)
  readonly streams: StreamRecordStore      // stream records (section 15.1.12)
  readonly usage: UsageStore               // per-scope quota counters (section 12.2)
  readonly keys: SubjectKeyStore           // subject keys and per-value keys (section 14.7.4)
  readonly serials: SerialStore            // section 15.1.4
  readonly sql?: SqlHatch                  // capability `sql`, section 14.3.8
  /** A savepoint: rolls back to it when `fn` throws, then rethrows. */
  nested<T>(fn: (u: Unit) => Promise<T>): Promise<T>
  /** In-process work after a successful commit, such as waking the local live hub. Never I/O that must be atomic. */
  afterCommit(fn: () => void): void
}

/** Keyed by field name; domain values (Date, bigint, Uint8Array, ReadonlySet); system fields included. */
export type StorageRow = Readonly<Record<string, unknown>>

export interface RowStore {
  find(entity: EntityDescriptor, query: RowQuery): Promise<RowPage>
  findOne(entity: EntityDescriptor, query: Omit<RowQuery, 'page' | 'total'>): Promise<StorageRow | undefined>
  count(entity: EntityDescriptor, where?: Condition): Promise<number>
  exists(entity: EntityDescriptor, ids: readonly string[]): Promise<ReadonlySet<string>>
  /** Evaluates a condition for given rows inside the unit; used for relation quantifiers (section 14.3.4). */
  matching(entity: EntityDescriptor, ids: readonly string[], where: Condition): Promise<ReadonlySet<string>>
  insert(entity: EntityDescriptor, rows: readonly StorageRow[]): Promise<void>
  /** Each update must match exactly one row with `expectedVersion`; otherwise the call fails with `conflict`. */
  update(entity: EntityDescriptor, updates: readonly KeyedUpdate[]): Promise<void>
  /** Hard delete: the retention worker, tenant retirement and `history: 'state'` entities only. */
  purge(entity: EntityDescriptor, ids: readonly string[]): Promise<number>
  lock?(entity: EntityDescriptor, query: RowQuery, options: { readonly mode: 'update' | 'share'; readonly skipLocked?: boolean; readonly noWait?: boolean }): Promise<readonly StorageRow[]>
  search?(entity: EntityDescriptor, request: SearchRequest): Promise<RowPage>
  /** Capability `positionPaging`: the number of rows before `id` in the query's order (JMAP `anchor`). */
  countBefore?(entity: EntityDescriptor, query: Omit<RowQuery, 'page'>, id: string): Promise<number>
}

export interface RowQuery {
  readonly where?: Condition               // the authorization plan is already conjoined; the scope predicate is added by the adapter
  readonly sort?: readonly { readonly field: string; readonly direction: 'asc' | 'desc' }[]
  readonly page?:
    | { readonly first?: number; readonly after?: string; readonly last?: number; readonly before?: string }
    | { readonly position: number; readonly limit: number }   // capability `positionPaging`, bounded by `maxOffset`
  readonly select?: readonly string[]      // field mask; system fields are always returned
  readonly includeArchived?: boolean       // default false: `archivedAt` must be absent
  readonly total?: boolean
  readonly forUpdate?: boolean             // lock the rows for the unit where supported; versions guard everywhere
}

export interface RowPage {
  readonly rows: readonly StorageRow[]
  readonly pageInfo: { readonly hasNextPage: boolean; readonly hasPreviousPage: boolean; readonly startCursor: string | null; readonly endCursor: string | null }
  readonly total?: number
}

export interface KeyedUpdate {
  readonly id: string
  readonly expectedVersion: number
  readonly values: StorageRow              // the complete new state row, including version and framework columns
}
```

Archiving is a versioned `update` of `archivedAt` issued by the kernel after the `archived` event
(the adapter needs no separate operation), and planning migrations is done by the framework's
planner on neutral snapshots, so adapters `render` and `apply` but do not plan (section 14.6).
Every store of the unit runs inside its transaction and under its scope predicate, and the
conformance suite tests each one (section 14.10).

```ts
export interface ConsumerStore {
  checkpoint(consumer: string, scopeId: string): Promise<Position | null>
  advance(consumer: string, scopeId: string, to: Position): Promise<void>       // in the unit of the effects
  acquireLease(consumer: string, owner: string, ttlMs: number): Promise<boolean>
  renewLease(consumer: string, owner: string, ttlMs: number): Promise<boolean>
  park(consumer: string, stream: StreamRef, from: Position, error: WireError): Promise<void>
  unpark(consumer: string, stream: StreamRef): Promise<Position | null>
}
export interface TombstoneStore {
  add(stream: StreamRef, position: Position): Promise<void>
  since(type: string, after: Position, limit: number): Promise<readonly { readonly stream: StreamRef; readonly position: Position }[]>
  expire(type: string, before: Date, limit: number): Promise<number>
}
export interface StreamRecordStore {
  append(stream: string, key: string, records: readonly unknown[]): Promise<{ readonly firstSeq: bigint }>
  read(stream: string, key: string, afterSeq: bigint | null, limit: number): Promise<readonly { readonly seq: bigint; readonly at: Date; readonly data: unknown }[]>
  expire(stream: string, policy: { readonly maxAge?: string; readonly maxPerKey?: number }, limit: number): Promise<number>
  purgeKeys(stream: string, keys: readonly string[]): Promise<number>          // erasure and retention
}
export interface UsageStore {
  add(dimension: string, delta: bigint): Promise<bigint>                      // returns the new value for the unit's scope
  get(dimension: string): Promise<bigint>
}
```

#### 14.3.3 Capabilities

```ts
export interface AdapterCapabilities {
  readonly dialect: string
  readonly eventStore: boolean
  readonly transactions: {
    readonly savepoints: boolean
    readonly transactionalDdl: boolean
    readonly isolation: readonly ('read-committed' | 'repeatable-read' | 'serializable')[]
  }
  readonly placements: readonly ('shared-tables' | 'schema-per-tenant' | 'database-per-tenant')[]
  readonly naming: readonly ('prefix' | 'schema')[]
  readonly maxIdentifierLength: number
  readonly unsupportedConditions: readonly { readonly op: ConditionOp; readonly kinds?: readonly FieldKind[]; readonly reason: string }[]
  readonly partialIndexes: 'native' | 'generated-column' | false
  readonly changeFeed: 'poll' | 'notify' | 'stream'
  readonly rowLevelSecurity: boolean
  readonly rowLocks: false | { readonly skipLocked: boolean; readonly noWait: boolean }
  readonly search: false | 'tsvector' | 'fulltext' | 'fts5' | 'naive'
  readonly positionPaging: false | { readonly maxOffset: number }   // JMAP position and anchor (section 14.3.5)
  readonly jobs: 'skip-locked' | 'single-writer'      // how workers take jobs (section 14.3.9)
  readonly broadcast: boolean                          // topics and presence across processes
  readonly sql: false | { readonly dialect: 'postgres' | 'mysql' | 'sqlite' }
  readonly processes: 'single' | 'host' | 'network'   // in-memory: single; SQLite file: host; servers: network
}
```

Capabilities are checked at three moments, always failing closed:

- At `connect`, for every namespace of the placement: chain entities need `eventStore`;
  `richText` and `sequence` fields need a codec module (section 15.3.9); a module that declares
  data needs (`defineModule({ data: { needs: ['search', 'rowLocks', 'positionPaging', { sql: 'postgres' }] } })`)
  needs them, including the SQL dialect it writes queries for; a deployment with several processes
  needs `processes` beyond `single`. A failure marks the backends of that namespace `unavailable`
  and names the module and the capability; other namespaces start.
- At `core.tenant.create` and `core.tenant.move`: the target placement must satisfy the app,
  including every module's dialect, else `unsupported`.
- When a plan or a query is compiled: an operator or field kind the adapter declares unsupported
  fails with `unsupported`, never a wider filter.

#### 14.3.4 Conditions: one AST, fixed semantics

The filter model of the data layer is the condition AST of section 8.3, unchanged.
Both interpreters (the compiled one in each adapter and the in-memory one in the core) implement
the semantics below; the dual-evaluation suite checks them on every adapter.

| Operator | Meaning, identical in both interpreters | PostgreSQL | MySQL 8.4 | SQLite |
|---|---|---|---|---|
| `eq` | equal; a `null` or `undefined` value makes the comparison false (section 8.3) | `=` | `=` | `=` |
| `ne` | not equal, null-safe: an absent field value is not equal to any present value; a `null` or `undefined` comparison value makes the comparison false | `IS DISTINCT FROM` | `NOT (a <=> b)` | `IS NOT` |
| `lt` `lte` `gt` `gte` | order; an absent value never matches | `col IS NOT NULL AND col < $1` | same | same |
| `in` | membership in a non-empty list without null; an empty list matches nothing | `= ANY($1)` | `IN (...)` | `IN (...)` |
| `nin` | null-safe negation of `in`; an empty list matches everything | `col IS NULL OR NOT (col = ANY($1))` | same form | same form |
| `contains` | strings: case-sensitive substring; `set` and `list`: element membership | `LIKE` with escaping; `@>` | `LIKE` on `utf8mb4_bin`; `JSON_CONTAINS` | `instr(col, ?) > 0`; `EXISTS (SELECT 1 FROM json_each(col) WHERE value = ?)` |
| `startsWith` | strings: case-sensitive prefix | `LIKE $1 \|\| '%'` with escaping | `LIKE` on `utf8mb4_bin` | `substr(col, 1, length(?)) = ?` |
| `isNull` | `true`: absent; `false`: present | `IS NULL` | `IS NULL` | `IS NULL` |
| `and` `or` `not` | two-valued boolean logic: every compiled predicate is wrapped so it never yields SQL `NULL` | `NOT COALESCE(p, false)` | same | same |
| `some` `none` `every` `is` | relation quantifiers; `every` holds for an empty relation; `is` on an absent reference is false | `EXISTS`, `NOT EXISTS` | same | same |

Rules that keep the two interpreters equal:

- Strings compare by Unicode code point. Columns use binary collations (`COLLATE "C"` on
  PostgreSQL, `utf8mb4_bin` on MySQL, SQLite's default `BINARY`), and the in-memory interpreter
  compares code points (not UTF-16 code units). Locale-aware ordering, when added, is a sort option
  only and never available in conditions.
- Restricted kinds: `json`, `richText` and `list` with merge `sequence` support only `isNull`;
  `binary` supports `eq`, `ne` and `isNull`; `secret` supports nothing; `set` and `list` support
  `contains` and `isNull`; on SQLite, `decimal` values are stored as canonical text, so ordering
  operators on `decimal` are unsupported there.
- Relation quantifiers are evaluated by the database in both directions. When the in-memory
  interpreter meets a quantifier (an item check on a post-image, a live event, an offline
  mutation), it asks the unit (`rows.matching`) to evaluate `EXISTS` for the row ids with the same
  compiler that plans use. The row being checked is already written in the unit (post-images are
  written before the item check and rolled back on failure), and live events concern committed
  rows, so the database sees the state the check is about. The in-memory adapter's quantifier
  implementation is the reference.

Operators unsupported per adapter, beyond the kind restrictions above: PostgreSQL none, MySQL none,
SQLite ordering on `decimal`, in-memory none. A Drizzle-based adapter, if written, declares its own.
Absence is tested only with `isNull`; the wire filter's bare `null` shorthand is normalised to
`isNull: true` at the boundary and never reaches the AST (section 16.4.4).

#### 14.3.5 Pagination

Keyset pagination is the default and the only form the generated actions offer to most
transports. The sort always ends with `id` (UUIDv7, unique); the cursor is
`base64url(JSON [sort values..., id, signature])`, where the signature is a short hash of the sort
and filter, so a cursor reused with another sort or filter is a `validation` error. Absent values
sort last ascending and first descending, compiled explicitly (`NULLS LAST` on PostgreSQL,
`col IS NULL, col` on MySQL and SQLite) and mirrored in memory. `first`/`after` and
`last`/`before` follow section 6.7; `total` is an opt-in count; page sizes come
from the action's `page` specification. A field outside the principal's read mask cannot be a sort
key (section 8.4).

Positional paging exists for JMAP, whose `/query` takes `position` (negative positions count from
the end) and `anchor` with `anchorOffset`, and whose mail clients page by position. Adapters that
declare `positionPaging` accept `page: { position, limit }` up to their `maxOffset` (10,000 by
default on PostgreSQL) and implement `countBefore(id)` for anchors; a position beyond the maximum
is a `validation` error, never a slow scan. The generated `query` exposes `position` and `anchor`
only on transports that request it in their surface options (`transport-jmap`), and the
conformance suite has position cases, including negative positions and anchors that left the
result set.

#### 14.3.6 Units and transactions

- Every invocation's data access runs in one unit: commands in a read-write unit, queries in a
  read-only unit (`REPEATABLE READ READ ONLY` on PostgreSQL so several statements see one
  snapshot; a consistent snapshot on MySQL; a deferred transaction on SQLite).
- Commands run at `READ COMMITTED` on PostgreSQL and MySQL (on MySQL this avoids the gap locks of
  `REPEATABLE READ` on inserts) and under `BEGIN IMMEDIATE` on SQLite. Writers of one row queue on its
  row lock where the adapter has row locks (section 15.1.6); the versioned state update and the unique
  stream version remain the guard on every adapter.
- Nested units are savepoints: a command invoked through `ctx.invoke` inside a command runs in a
  savepoint so the caller can catch its error and continue.
- Retries: on a version conflict, a serialization failure or a deadlock, `decide` commands and the
  generated `set` are retried up to three times with jitter (they are pure apart from reads);
  `handle` commands return `conflict` with `retryable: true`, because a handler may have called a
  service whose effects are not idempotent. A `set` with `ifInState` or `ifVersion` never retries.
- A unit spans one namespace and one scope. A tenant command reads backend-level entities in a
  separate read-only snapshot, always, even when the backend's home namespace is the tenant's;
  backend-level entities change only through backend-scope actions, which a tenant command reaches
  with `ctx.enqueue` after commit (section 12.3). Control data is reached through core actions and
  services, never joined. A backend-scope or deployment-scope unit refuses tenant-tenancy
  entities.
- Invariants across rows that a concurrent insert could break (at most ten previews per project)
  cannot rely on expected versions, which only guard rows that exist. The pattern: lock a parent
  row (`lock` or `forUpdate` on the project) or bump its version in the same unit, so concurrent
  commands on the same parent queue; or declare `isolation: 'serializable'` on the action, which
  runs the unit at `SERIALIZABLE` (with the same retries as below) where the adapter supports it
  and fails at `connect` where it does not.
- Timeouts: the unit's timeout comes from the action's `timeoutMs`; PostgreSQL units set
  `statement_timeout` locally, and the adapter sets `idle_in_transaction_session_timeout` on its
  sessions.
- Appends are buffered in the unit and written at the commit tail together with their positions
  (section 15.1.4). Reads of a stream inside the same unit see the buffered events.

#### 14.3.7 How each adapter fits

| Adapter | Package | Substrate (checked) | Change feed | Tenant backstop | Naming default | Placements | Milestone |
|---|---|---|---|---|---|---|---|
| PostgreSQL | `adapter-postgres` | Kysely 0.29.6 `PostgresDialect`, `pg` 8.23.1 | `notify` | forced row-level security | schema per app, prefixed tables | all three | M1 |
| PGlite | `@pennestack/data` (tests, `pennestack dev`) | Kysely `PGliteDialect`, `@electric-sql/pglite` 0.5.8 (PostgreSQL 18.3) | `notify`, in-process | row-level security | as PostgreSQL | shared-tables | M1 |
| In-memory | `@pennestack/data` | none | in-process | the interpreter | not applicable | shared-tables | M1 |
| MySQL | `adapter-mysql` | Kysely `MysqlDialect`, `mysql2` 3.24.5, MySQL 8.4 LTS | `poll` and in-process wake | none (scoping plugin and tests) | prefix in one database | shared-tables, database-per-tenant | M7 |
| SQLite | `adapter-sqlite` | Kysely `SqliteDialect` over `node:sqlite` (SQLite 3.53.4 in Node 24.21.0); `better-sqlite3` 13.0.3 as fallback | in-process; `poll` across processes of one host | none | prefix in one file | shared-tables, database-per-tenant (a file per tenant) | M7 |
| Supabase | `adapter-supabase` | the PostgreSQL adapter with a preset | `notify` over a session connection | forced row-level security, nothing granted to `anon` and `authenticated` | schema `ps_<app>` | shared-tables, schema-per-tenant | M7 |
| Drizzle-based | `adapter-drizzle-postgres` (not planned) | drizzle-orm 0.45.4 (1.0.0-rc.4 on the `rc` tag) | as PostgreSQL | as PostgreSQL | as PostgreSQL | as PostgreSQL | after Drizzle 1.0 |

Positions use the same commit-tail counter per scope on every adapter (section 15.1.4), and every
adapter implements the job store (section 14.3.9). Milestones refer to [roadmap.md](roadmap.md).

**PostgreSQL.** The reference adapter. Units set `pennestack.tenant_id` (or `pennestack.backend_id`)
with `set_config(..., true)` at their start, and every scoped table has row-level security enabled
and forced, with a policy `USING (tenant_id = current_setting('pennestack.tenant_id', true)::uuid)`
plus the same `WITH CHECK`; tenant tables therefore deny every statement of a backend-scope unit,
which sets only the backend id. Namespace-scope units set `pennestack.scope = 'namespace'`, which
only the migration and maintenance policies admit; module code never runs in them. The adapter's
role has no `BYPASSRLS`. Row-level security protects against defects in the framework and the
adapters; module code is trusted application code, and the escape-hatch rules of section 14.3.8
keep honest mistakes out.

Wake-ups are never sent inside a writer's transaction. `NOTIFY` takes a cluster-wide lock in
PostgreSQL's pre-commit step that is held until the commit record is written, so a notifying
commit serialises with every other notifying commit on the instance (reported on pgsql-general and
in the 2025 "Write Notifications Through WAL" thread). Instead the unit records its scope in
`afterCommit`; a separate notifier connection per process sends at most one `NOTIFY` per namespace
every 50 milliseconds, carrying the scopes that committed; and readers also poll the heads every
second, so a process that crashes between commit and notification delays a wake-up by at most a
second and never loses an event. `LISTEN` uses a dedicated connection, which needs a session (a
direct connection or a session-mode pooler, never a transaction-mode pooler). `pennestack dev` uses
PGlite under `.pennestack/dev-db` when no database URL is configured, so a fresh checkout runs
without installing a database; PGlite wakes in process.

**MySQL.** No transactional DDL: a migration records each applied step and resumes at the failed
one. No row-level security: isolation rests on the scoping plugin and the adversarial tests. No
partial indexes: a partial unique index becomes a unique index on a generated column that is
`NULL` outside the condition. Session settings: `time_zone = '+00:00'`, strict SQL mode, binary
collation. `GET_LOCK` provides the migration lock and `SKIP LOCKED` the row locks and the job store's
`take`. Schema-per-tenant
is not offered, because `CREATE SCHEMA` is a synonym for `CREATE DATABASE` in MySQL;
database-per-tenant is the equivalent.

**SQLite.** `node:sqlite` is built into Node 24 and runs without an experimental warning on 24.21.0;
Kysely 0.29.6's `SqliteDialect` expects a `prepare()` whose statements expose `reader`, which
`node:sqlite`'s `StatementSync` lacks, so the adapter wraps it in a shim of about twenty lines
(deriving `reader` from `columns()`). WAL mode, `busy_timeout`, `foreign_keys = ON` per connection,
`STRICT` tables, partial indexes and `RETURNING` are used. One writer at a time; several processes on
one host can share a file; never several nodes. Database-per-tenant is a file per tenant.

**Supabase.** The PostgreSQL adapter with a preset: the pool may use the transaction-mode pooler,
while the `LISTEN` connection and migrations use a session; namespace roots default to `ps_<app>`
and the adapter refuses roots that collide with schemas Supabase manages (`auth`, `storage`,
`realtime`, `extensions`, `vault` and the others it creates); tables are not exposed through
Supabase's data API unless the operator adds the schema, and the adapter warns if that happens;
row-level security is forced and no policy grants anything to the `anon` and `authenticated`
roles. Supabase Realtime's "Postgres Changes" consumer is not needed, because the event log is the
feed. Optional modules, outside the adapter: a live carrier that sends pokes over Realtime
Broadcast, a principal resolver for Supabase-issued tokens with `auth.users` mapped as an external
entity, and a blob store on Supabase Storage.

**Drizzle-based.** Permitted by the contract and not planned. It would build Drizzle table objects
from descriptors when the adapter is created (as Payload's adapters do), compile conditions to
Drizzle SQL expressions, use Drizzle's nested transactions for savepoints, implement the event
store with the same tables and positions, and render migrations itself (drizzle-kit diffs Drizzle
schemas, not pennestack snapshots). It is worth writing for Drizzle's driver range once Drizzle 1.0
is released (1.0.0-rc.4 on 2026-10-10). The more common need, importing an existing Drizzle schema,
is served by `pennestack db introspect --drizzle <file>`, which reads table objects through
`getTableConfig` (exported by drizzle-orm 0.45.4's `pg-core`, `mysql-core` and `sqlite-core`) into
entity definitions (section 14.8.4).

**In-memory.** The reference semantics: every mandatory operation, the event store, positions,
receipts, jobs, keys and an in-process feed; serialisable units through a mutex and copy-on-write maps,
with savepoints as snapshots; naive substring search; no SQL hatch. Unit tests use it, and the
dual-evaluation suite uses it as the oracle.

#### 14.3.8 The SQL escape hatch (M7)

`ctx.sql` exists when a module declares the data need `{ sql: <dialect> }` and the placement's
adapter has that dialect; tenants are only created on, and moved to, placements that satisfy it
(section 14.3.3). It is a Kysely instance bound to the current unit and typed by `SqlTables<M>`
for the declared dialect (section 14.8.2), with logical table names (`'accounts.profile'`) and
field names. Plugins on that instance (Kysely's `transformQuery` hook):

- map logical names to physical tables and columns of the namespace;
- scope every table reference: reads see a derived table filtered by the unit's scope, updates and
  deletes get the scope predicate, inserts get the scope value (a different value is an error);
- reject writes to `chain` and `projection` tables, whose only writer is the kernel;
- on PostgreSQL, row-level security repeats the scope.

Raw SQL strings cannot be scoped by inspection, so `sql.raw` and table references inside `sql`
template fragments are available only on `ctx.asSystem(reason).sql`, which is logged. Kysely is
pre-1.0; the hatch exposes its types to module authors, which is accepted for an escape hatch and
pinned to an exact version.

#### 14.3.9 The job store

The kernel job queue of section 9.5 is implemented once, in the core, over a `JobStore` that every
adapter provides in its unit. Jobs live in `ps_jobs` in the namespace, carry the scope (so
row-level security covers their payloads) and are inserted in the unit of the command, timer or
reaction dispatch that causes them.

```ts
export interface JobStore {
  enqueue(job: StoredJobSpec): Promise<JobId>                 // keys: keep, replace or coalesce a pending job with the same key
  cancel(queue: string, key: string): Promise<number>
  /** Takes up to `limit` due jobs of a queue, respecting keys, FIFO order per key and group concurrency. */
  take(queue: string, worker: string, limit: number, leaseMs: number): Promise<readonly StoredJob[]>
  heartbeat(jobIds: readonly JobId[], worker: string, leaseMs: number): Promise<void>
  complete(jobId: JobId, outcome: JobOutcome): Promise<void>  // succeeded, retry at a time, or dead letter
  schedules(): ScheduleStore                                  // one row per schedule and scope: last tick, next tick
}
```

- On PostgreSQL and MySQL, `take` selects due rows `FOR UPDATE SKIP LOCKED`, so any number of
  workers on any number of processes share a queue. On SQLite, PGlite and the in-memory adapter,
  the single writer serialises `take`; they serve `pennestack dev`, tests and single-process
  deployments.
- Group concurrency counts running jobs per group in the same statement; FIFO per key takes only
  the oldest pending job of a key and none while one of that key runs.
- Completed jobs are removed after seven days, which bounds personal data in job inputs;
  dead letters stay until an operator replays or discards them (`pennestack jobs`).
- The conformance suite runs the same queue scenarios (keys, coalescing, FIFO under concurrency,
  groups, retries, heartbeats, expiry, dead letters, schedules ticking once per scope) on every
  adapter (section 14.10).

### 14.4 Placements, namespaces and tenancy

#### 14.4.1 Strategies

| Strategy | Namespaces | Scope key | Provisioning at tenant creation | Adapters |
|---|---|---|---|---|
| `shared-tables` (default) | one per app on the placement | `tenant_id` on every tenant table, leading the primary key `(tenant_id, id)` and every index | none: rows only | all |
| `schema-per-tenant` | one per tenant, root `t_<tenant id in base32>` | `tenant_id` kept as a constant column, so a tenant move is a copy | create the schema and the current tables (section 14.6.6) | PostgreSQL, Supabase |
| `database-per-tenant` | one per tenant in its own database or file | as above | create the database when the adapter's role may, else expect the URL given at tenant creation | PostgreSQL, MySQL, SQLite |

A different adapter per tenant is not a fourth strategy: a tenant is created on any declared
placement, and placements may use different adapters. Backend-level entities live in the backend's
home namespace, chosen when the backend is created.

#### 14.4.2 Physical names

- **Root.** A PostgreSQL schema, a MySQL database or name prefix, or a SQLite file or name prefix.
  The default root of a shared namespace is the app id with `-` mapped to `_` (`launchway`);
  `adapter-supabase` defaults to `ps_<app>`; `naming.root` overrides it per placement.
- **Module tables.** `<module>__<entity>`, with `-` mapped to `_`. Module and entity ids cannot
  contain `_`, so the mapping is injective. Auxiliary tables of an entity (an FTS5 side table, for
  example) are `<module>__<entity>__<suffix>`.
- **Framework tables.** `ps_<name>` (a single underscore, so never equal to a module table).
- **Columns.** Field names in snake case (`displayName` becomes `display_name`). System columns are
  `id`, `tenant_id` or `backend_id`, `created_at`, `updated_at`, `archived_at` and `version`;
  framework columns are `ps_last_hlc`, `ps_last_hash`, `ps_erased_at` and, from M8, `ps_merge`. A
  field whose column name would collide with a system or framework column is a compose error.
- **Length.** A name longer than the dialect's limit (63 bytes on PostgreSQL, 64 characters on
  MySQL) is truncated and suffixed with 8 hexadecimal characters of the SHA-256 of the full name.
  Every physical name is recorded in the module snapshot, so it never changes once chosen.
- **`naming.style: 'schema'`** (PostgreSQL, shared-tables only) gives each module of each app its
  own schema (`launchway_accounts.profile`). It is an option, not the default: it cannot combine
  with schema-per-tenant, and a module called `auth` would collide with a reserved schema on hosted
  PostgreSQL.

#### 14.4.3 The scope predicate

- The adapter adds `tenant_id = $tenant` (or `backend_id = $backend`) to every statement of a tenant
  (or backend) unit on every scoped table, including the subqueries compiled for relation
  quantifiers; inserts receive the scope value, and a row carrying another value is an error;
  updates and purges carry the predicate; the event store reads and appends under the unit's scope.
- Composite foreign keys `(tenant_id, ref)` towards hard dependencies make a cross-tenant reference
  impossible at the database level as well.
- On PostgreSQL, forced row-level security repeats the predicate (section 14.3.7).
- The conformance suite contains adversarial isolation tests: two tenants, every operation,
  relation subqueries, the event log, receipts, jobs, stream records, usage counters, keys and the
  escape hatch, and backend-scope units that try to read or write tenant entities (refused by the
  plan compiler and by row-level security).

#### 14.4.4 The control store

The control store is the deployment namespace. It holds the core's control entities (backends,
tenants, domains and the scope directory, placements, namespaces, operator tokens), the scope
epochs and the recorded high-water marks of positions and serials per scope (section 14.7.6), the
wrapped backend and tenant keys, the erasure ledger and the retention rules, through the same
contract in `deployment` scope and with its own event log, which is the directory change feed of
section 3.2. Receipts of tenant commands do not live here; they must share the command's
transaction (section 15.1.7).

Data adapters are deployment infrastructure (section 5.6): the control store needs one before any
app is loaded, and a placement's adapter serves every app whose namespaces it hosts.
`defineDeployment` therefore lists the adapter factories, and apps never list adapters. A module
that writes dialect-specific SQL declares its dialect as a data need (section 14.3.8).

#### 14.4.5 Moving a tenant (M7)

`core.tenant.move` (operator, asynchronous; `pennestack tenant move <tenant> --to <placement>`):

1. Freeze: admission answers `unavailable` to the tenant's commands; reads continue.
2. Copy the tenant's events with their positions into the target namespace, together with the
   scope's position counter and epoch; copy `state` rows, receipts, jobs, sync clients, usage
   counters, subject and value keys and serial counters.
3. Rebuild the tenant's state tables in the target by replay and verify row counts and the last
   hash of every stream.
4. Switch the placement in the control store.
5. Unfreeze; purge the source after a delay the operator chooses.

Positions are per scope (section 15.1.4), so they move with the tenant: tokens, IMAP `MODSEQ`
values and UIDs stay valid, and clients do not resynchronise. If verification fails, the move is
abandoned and the source stays authoritative. A move is possible at all because the chain is
complete.

### 14.5 Field kinds, identifiers and time

#### 14.5.1 Columns per field kind

| Field | PostgreSQL | MySQL 8.4 | SQLite | In events (JSON) |
|---|---|---|---|---|
| `string` | `text COLLATE "C"`, `CHECK (char_length(x) <= n)` with `maxLength` | `VARCHAR(n)` `utf8mb4_bin` (`n` = `maxLength`, 255 when indexed or unique and unset) or `TEXT` | `TEXT`, `CHECK (length(x) <= n)` | string |
| `text` | `text COLLATE "C"` | `MEDIUMTEXT` `utf8mb4_bin` | `TEXT` | string |
| `integer` | `bigint`, values limited to ±(2^53 − 1) | `BIGINT` | `INTEGER` | number |
| `integer({ wide: true })` | `bigint`, read as `bigint` | `BIGINT` | `INTEGER` | decimal string |
| `decimal({ precision, scale })` | `numeric(p, s)` | `DECIMAL(p, s)` | `TEXT`, canonical form | decimal string |
| `float` | `double precision` | `DOUBLE` | `REAL` | number |
| `boolean` | `boolean` | `BOOLEAN` | `INTEGER` 0 or 1 | boolean |
| `instant` | `timestamptz(3)` | `DATETIME(3)` in a UTC session | `TEXT` `YYYY-MM-DDTHH:MM:SS.sssZ` | RFC 3339 string |
| `date`, `timeZone` | `date`; `text` | `DATE`; `VARCHAR(64)` | `TEXT` | string |
| `enum` | `text`, `CHECK (x IN (...))` | `VARCHAR(n)`, `CHECK` | `TEXT`, `CHECK` | string |
| `json` | `jsonb` | `JSON` | `TEXT` holding JSON | JSON value |
| `ref` | `uuid`, composite foreign key towards hard dependencies | `BINARY(16)` | `TEXT` | id string |
| `subject` | `text COLLATE "C"` | `VARCHAR(255)` `utf8mb4_bin` | `TEXT` | string |
| `set` | `jsonb` array | `JSON` | `TEXT` | array; operations `add` and `remove` |
| `list` (merge `lww`) | `jsonb` array | `JSON` | `TEXT` | array |
| `list` (merge `sequence`), `richText` | `bytea` CRDT document plus a `<column>_value` materialisation (`jsonb` or `text`) | `LONGBLOB` plus `JSON` or `MEDIUMTEXT` | `BLOB` plus `TEXT` | CRDT update, base64url |
| `binary` | `bytea` | `LONGBLOB` | `BLOB` | base64url |
| `blob` (gap G5) | `jsonb` reference: id, size, SHA-256, media type, wrapped key | `JSON` | `TEXT` | the reference |
| `secret` | `jsonb` sealed value: ciphertext, nonce, value-key id | `JSON` | `TEXT` | the sealed value, never plaintext |
| `verifier` | `text` | `VARCHAR(512)` | `TEXT` | sealed with a value key (section 14.7.4) |
| `serial({ per })` | `bigint` | `BIGINT` | `INTEGER` | number |
| system `id` | `uuid` | `BINARY(16)` | `TEXT` | string |

- `field.integer()` maps to 64-bit columns and validates the safe-integer range, so no 32-bit
  overflow can surprise a module. `field.decimal()` is typed as an exact canonical string, because a
  JavaScript number cannot hold `numeric` values exactly; `field.float()` is the binary
  floating-point kind for measurements and introspected `real` and `double` columns.
- Columns of `.personal()` fields are nullable in storage whatever the field's optionality, because
  erasure clears them (section 14.7.5).
- Columns added by contributions and conditional parts are nullable or carry a default in storage,
  because rows are inserted while those parts are inactive (section 14.6.5).
- `field.serial({ per })` is a per-partition sequence allocated at insert (section 15.1.4), the IMAP
  UID of the mail server (section 17.4.5). It is named `serial` because `sequence` already names a
  merge type.
- `.stateOnly()` fields have a column and no presence in events; `.hidden()` fields have a column
  and are left out of before-images unless they opt in (section 6.6).
- Indexes may carry a `where` condition (`eq`, `ne`, `in` and `isNull` over the entity's own
  fields): a partial index on PostgreSQL and SQLite, a unique index over a generated column on
  MySQL. Every `unique` field is unique among non-archived rows by default (a partial unique index),
  so archiving releases the value and restoring a row whose value has been taken again is a
  `conflict`.

#### 14.5.2 Identifiers

- Ids are UUIDv7 generated by the kernel (`uuid` 14.0.3 `v7()`) and rendered as TypeIDs at the
  boundary (section 6.4). Event ids are UUIDv7 as well; a stream id is the entity id.
- Primary keys are `(tenant_id, id)` for tenant tables, `(backend_id, id)` for backend tables and
  `(id)` in the control store. Ids are unique per scope.
- Client-supplied ids (offline creates, JMAP creation ids) must be well-formed UUIDv7 whose
  timestamp is not later than server time plus the clock-skew bound; an id that exists in the scope
  is a `conflict`.
- External entities (section 14.8.4) keep their native key; their stream id is a deterministic UUID
  (version 8, from SHA-256 of the entity reference and the key), so the event log keeps one id type.
- Command receipts have deterministic ids as well: a UUIDv8 from SHA-256 of the scope and the
  command id, so `core.commandReceipt.get` works by command id (section 15.1.7).

#### 14.5.3 Time and clocks

- `createdAt` and `updatedAt` are set by the kernel at acceptance from `ctx.clock.now()`, also for
  offline mutations; the authoring time is the event's hybrid logical clock.
- A hybrid logical clock (Kulkarni and others, 2014) value is a string of 16 hexadecimal characters
  (12 for the physical milliseconds, 4 for the logical counter), a hyphen and a node id:
  `0192a3b4c5d60001-s7k2m9x4qa`. Values compare by the first 16 characters, then by node id. Server
  processes use `s` plus 10 random base32 characters chosen at start; clients use their client id.
  A counter overflow within one millisecond waits for the next millisecond.
- Receive rule: when the kernel loads a stream's state for a write, it advances the process clock
  past `ps_last_hlc` (and past every field clock in the merge state), so a server-authored event
  always carries a clock greater than every clock already in the stream. Online writes are therefore
  "last committed wins", and only offline-authored writes can lose an `lww` comparison (section 15.3).
- The switch to `Temporal.Instant` behind `field.instant()` (section 21) changes
  codecs, not storage.

#### 14.5.4 Wire forms of merge-typed fields

Every transport carries these forms unchanged (section 16.2.3). Reads return the materialised
value; writes take a whole value or operations.

| Field | Read | In `create` | In a patch |
|---|---|---|---|
| `integer` with merge `counter` | number | number | a number (online only; becomes `inc(value − current)`) or `{ "inc": n }` |
| `set` | array of distinct values | array | an array (online only; the server computes adds and removes) or `{ "add": [...], "remove": [...] }` |
| `list` with merge `sequence` | array | array | an array (online only; the codec computes list operations) or `{ "crdt": { "codec": "loro/1", "update": "<base64url>" } }` |
| `richText` | `RichTextValue` | a string, or a `RichTextValue` without `version` | a string (online only; a minimal text diff that keeps marks on unchanged text) or `{ "crdt": ... }` |

```ts
/** The read form of a richText field. */
export interface RichTextValue {
  readonly codec: string                                     // 'loro/1'
  readonly text: string                                      // plain text: display, search, clients without the codec
  readonly delta: readonly { readonly insert: string; readonly attributes?: Readonly<Record<string, unknown>> }[]   // text with marks (Loro toDelta)
  readonly version: string                                   // base64url version vector of the document
}
```

The document itself (a Loro snapshot) never travels in rows. Clients that edit collaboratively fetch
updates through `sync.crdt` (section 15.3.6) and push `crdt` operations; only clients with the codec can
produce them. Offline mutations use only the operation forms (`inc`, `add` and `remove`, `crdt`),
because whole-value replacement is computed against the server's current value and would undo
concurrent work the author never saw.

### 14.6 Migrations per module

#### 14.6.1 Tracks

The physical shape of a table depends on the selection: `auth` contributes `lastLoginAt` to
`accounts.profile` only when both are selected, and adds `profileId` to its own credential only when
`accounts` is selected. Migrations are therefore organised in **tracks**, each with its own snapshot,
files and history key:

| Track | Id | Active when | Contains |
|---|---|---|---|
| own | `auth` | the module is selected | the module's entities and unconditional fields |
| contribution | `auth->accounts`, `auth->projects[teams]` | the target and every `when` module are selected | columns, indexes and foreign keys the contribution adds to the target's tables |
| conditional | `auth[accounts]` | every `when` module is selected | columns the conditional part adds to the module's own tables |

```
packages/module-auth/migrations/
  own/snapshot.json                 own/0001-initial.ts
  to-accounts/snapshot.json         to-accounts/0001-login-fields.ts
  when-accounts/snapshot.json       when-accounts/0001-profile-link.ts
```

A snapshot is the neutral description of the track's tables as of its last file: physical names,
the track's version, fields (kind, column, constraints, tag, merge type, personal subject,
hidden, maskable and `stateOnly` flags), indexes, foreign keys, the history mode, the merge-state
flag, the rename history of every field, domain event shapes with their versions, and a hash of
each `evolve` source text (section 15.2.4). Column ownership is per track, so `pennestack db
check` knows which module owns each column.

An entity's shape is the union of the tracks that are active in an app. Every event therefore
records the shape it was written with: `ps_shapes` maps a shape id (a hash) to the set of active
track ids with their versions, and each event stores that id (section 15.1.9). Upcasting works per
track, and the generic evolve and every rebuild pass through the values of fields whose track is
inactive, so a rebuild in an app where a contributor was switched off keeps that contributor's
columns and their data, as toggling promises.

#### 14.6.2 Neutral steps

```ts
export type MigrationStep =
  | { readonly op: 'createTable'; readonly entity: string; readonly table: TableSpec }
  | { readonly op: 'dropTable'; readonly entity: string }                                  // contract step
  | { readonly op: 'addColumn'; readonly entity: string; readonly field: string; readonly column: ColumnSpec }
  | { readonly op: 'dropColumn'; readonly entity: string; readonly field: string }          // contract step
  | { readonly op: 'renameColumn'; readonly entity: string; readonly from: string; readonly to: string }   // contract step
  | { readonly op: 'alterColumn'; readonly entity: string; readonly field: string; readonly from: ColumnSpec; readonly to: ColumnSpec }
  | { readonly op: 'createIndex' | 'dropIndex'; readonly entity: string; readonly index: IndexSpec }
  | { readonly op: 'addForeignKey' | 'dropForeignKey'; readonly entity: string; readonly key: ForeignKeySpec }
  | { readonly op: 'enableMergeState'; readonly entity: string }                             // M8: adds ps_merge, then a rebuild
  | { readonly op: 'rebuild'; readonly entity: string; readonly reason: string }              // re-project from the log
  | { readonly op: 'sql'; readonly statements: Readonly<Partial<Record<'postgres' | 'mysql' | 'sqlite', readonly string[]>>> }

export interface MigrationFile {
  readonly id: string                                     // '0002-profile-locale'
  readonly track: string                                  // 'accounts' | 'auth->accounts' | 'auth[accounts]'
  readonly steps: readonly MigrationStep[]
  /** Event payloads written with the previous entity schema version, upgraded on read (section 15.1.9). */
  readonly upcast?: Readonly<Record<string, (data: unknown, eventName: string) => unknown>>
  /** A dialect-neutral data step through repositories, run per tenant in batches under the system principal. */
  readonly data?: (ctx: MigrationContext) => Promise<void>
}
```

Adapters render steps through Kysely's schema builder (`createTable`, `alterTable`, `createIndex`),
so most DDL needs no hand-written dialect SQL; `sql` steps carry per-dialect statements for the rest
and fail closed on a dialect they do not cover.

#### 14.6.3 History, order and locks

- `ps_migrations(track, id, checksum, applied_at, duration_ms, steps_applied)` in each namespace;
  the checksum is the SHA-256 of the canonical neutral steps, and a changed applied file is drift.
- Order: own tracks topologically by `requires` and `optional`, with tuple order as tie-break; a
  contribution track after the target's own track; a conditional track after the tracks of its
  `when` modules; files by id within a track. A file absent from the history but older than applied
  ones (a merged parallel branch) is applied with a warning, as Kysely's `allowUnorderedMigrations`
  does, because tracks are independent.
- One lock per namespace: `pg_advisory_xact_lock` on PostgreSQL, `GET_LOCK` on MySQL, the write lock
  on SQLite.
- PostgreSQL and SQLite apply each file in one transaction; MySQL records each applied step so a
  failed file resumes at the failed step.

#### 14.6.4 Development, CI and production

- Development: `pennestack dev` diffs the definitions against the development database and applies
  the difference without writing files (expand steps at once, contract steps after confirmation in
  the terminal, `rebuild` steps after confirmation). `pennestack db generate <track> --name <name>`
  writes the file and updates the snapshot when the author is ready; when a field disappears and
  another appears in one entity, the planner asks whether it is a rename (as drizzle-kit and Gel do)
  and records the answer in the file and the rename history.
- CI: `pennestack generate --check` fails when definitions and snapshots differ (a file is missing);
  `pennestack db check` migrates a scratch database and compares its catalogue with the snapshots.
- Production: the `migrate` phase verifies the history against the files and refuses to start on
  drift (section 3.3); `pennestack db apply` (alias `pennestack migrate`) applies
  pending files as a release step, and `pennestack db status` lists applied and pending files per
  namespace.
- Expand and contract: `dropTable`, `dropColumn`, `renameColumn` and narrowing `alterColumn` steps
  are contract steps. `db apply` applies only expand steps unless `--contract` is given, so the old
  and the new build of a rolling deploy both work against the schema. With several processes, a
  rename in production becomes add column, backfill and a later drop (from M7); until then, a
  deployment with a single process accepts renames directly.

#### 14.6.5 Toggling, retiring and renaming modules

- Removing a module, or the target or `when` module of a track, never drops anything; the track
  becomes inactive and its columns stay, and rebuilds keep their values (section 14.6.1). Fields of
  contribution and conditional tracks must be `.optional()` or have a `.default()`
  (`contributedFieldsNeedDefault`, section 4.7), because rows inserted while the track was inactive
  have no value; their defaults are applied on read, and reactivation runs only the files missing
  from the history plus a backfill of defaults. The conformance suite has toggle-then-rebuild
  cases.
- `pennestack module retire <module> --app <app>` (operator) is the only operation that drops tables,
  after confirmation: it runs the drop steps of every track of the module in the app's namespaces,
  purges its streams from the event log and records the retirement in the control store.
- `pennestack module rename` rewrites the track ids in `ps_migrations`, renames the tables and
  rewrites `stream_type` values in the event log. Event hashes do not cover the module id (section
  15.1.8), so the chain stays verifiable.

#### 14.6.6 Per-tenant namespaces

For `schema-per-tenant` and `database-per-tenant`, tenant creation provisions the namespace before
`onTenantCreated` runs: it creates the root and the framework tables, creates the current tables of
every active track from the snapshots and records every file as applied. This is DDL at runtime but
not a migration: no history is replayed. The `migrate` phase migrates every tenant namespace with
bounded parallelism; a namespace behind the files is `unavailable` until migrated, and
`pennestack db apply --tenants` reports progress.

#### 14.6.7 The schema contract

```ts
export interface SchemaOperations {
  /** Renders neutral steps for review (`pennestack db plan`) without running them. */
  render(namespace: NamespaceRef, steps: readonly MigrationStep[]): readonly string[]
  /** Applies one file under the namespace lock and records it; resumable where DDL is not transactional. */
  apply(namespace: NamespaceRef, file: MigrationFile): Promise<void>
  history(namespace: NamespaceRef): Promise<readonly AppliedMigration[]>
  /** Creates the root, the framework tables and the given track snapshots; idempotent. */
  provision(namespace: NamespaceRef, snapshots: readonly TrackSnapshot[]): Promise<void>
  /** Reads a live catalogue: a namespace for drift checks, or any schema and table set for `db introspect`. */
  introspect(target: { readonly namespace: NamespaceRef } | { readonly url: string; readonly schema?: string; readonly tables?: readonly string[] }): Promise<Catalogue>
  lock<T>(namespace: NamespaceRef, fn: () => Promise<T>): Promise<T>
}
```

### 14.7 Retention, tombstones and erasure

#### 14.7.1 Retention rules

Nothing in the chain is deleted until the operator adopts a rule. Rules are set per backend, with
per-tenant overrides, stored in the control store and changed through operator actions
(`core.retention.set`, `core.retention.list`); every run of the retention worker is recorded in the
control store (the rule, who adopted it, what was removed, the new horizons). Modules may declare
suggested rules on their entities (`retention: { suggest: [...] }`), which `pennestack doctor` lists;
a suggestion has no effect until adopted.

```ts
export type RetentionRule =   // durations are ISO 8601; `entity` accepts 'module.*'
  | { readonly kind: 'compactHistory'; readonly entity: string; readonly olderThan: string; readonly keepLatest?: number }
  | { readonly kind: 'purgeArchived'; readonly entity: string; readonly archivedFor: string }
  | { readonly kind: 'purgeRows'; readonly entity: string; readonly where: ConditionInput; readonly olderThan: string }  // history 'state' only
  | { readonly kind: 'shallowCrdt'; readonly entity: string; readonly field: string; readonly olderThan: string }          // M9
  | { readonly kind: 'transientRecords'; readonly olderThan: string }    // default P7D
  | { readonly kind: 'receipts'; readonly olderThan: string }            // default: each action's idempotency window (PT24H unless declared)
  | { readonly kind: 'syncClients'; readonly inactiveFor: string }       // default P90D (M8)
  | { readonly kind: 'streamRecords'; readonly stream: string; readonly maxAge?: string; readonly maxPerKey?: number }  // gap G6
```

Stream records (section 15.1.12) follow the retention their stream declares unless the operator
sets a `streamRecords` rule. A row that references blobs carries their wrapped keys in its row and
events; purging it (`purgeArchived`, `purgeRows`) removes those keys in the same unit that removes
the row, and the blob store's collector removes the bytes later, never before the deployment's
backup retention has passed (section 14.7.6; gaps G5 and G11).

The defaults govern operational buffers, not history, and the operator can change them; section
21 lists them as a decision point. The worker runs in `work` processes, one tenant-scope unit at a
time per scope and batch, outside peak hours when the operator configures a window.

#### 14.7.2 Tombstones

- Live tombstone: an archived row (`archivedAt`), hidden from reads unless asked for and allowed,
  restorable.
- Erased tombstone: a row whose data subject was erased (`ps_erased_at`); invisible to every read,
  including `includeArchived`, reported as destroyed by `changes` and as `remove` by sync.
- Purge tombstone: `ps_tombstones(scope_id, stream_type, stream_id, position, purged_at)`, written when
  `purgeArchived` removes a stream and its row, so `changes` can report the id as destroyed and sync
  can send `remove`. A row still referenced by a live row's foreign key is skipped and reported, not
  purged. Tombstones older than a type's horizon are removed and the horizon moves forward, so older
  tokens get `cannotCalculateChanges`.
- CRDT tombstones live inside Loro documents and go only through `shallowCrdt` (M9).

#### 14.7.3 Compaction

`compactHistory` replaces the events of a stream up to version `k` (the last event older than the
horizon, keeping at least `keepLatest` events) with one `snapshot` event at version `k`. It keeps the
position of the event it replaces and carries the folded state (personal values re-encrypted with the
subject's current key, or redaction markers when the key is gone) and the hash of the last removed
event as `anchor`. Versions after `k` are untouched, so expected versions and client base versions
stay valid. A `changes` token older than the compaction still works: the snapshot's position is
after it, and the stream is reported as changed.

#### 14.7.4 Personal data, credential material and keys

- **Data subjects.** Fields marked `.personal()` belong to a data subject. The entity declares
  `dataSubject`: `'id'` when the row is the subject's own record (a profile), a field holding the
  subject id (a credential's `subject`), or a path through a required, immutable reference
  (`dataSubject: 'accountId.ownerSubject'` on a mail message, resolved at write time; the key id is
  recorded per value). Rows whose data subject is erased become erased tombstones, so their
  personal fields may be required. A field may name another subject of the same row with
  `.personal({ subject: '<field>' })`; such a field must be optional, because erasing that other
  subject clears it while the row lives on. A module that cannot express ownership as a path keeps
  a denormalised subject field and says so.
- **In the chain.** Personal values in `data` and `before` are encrypted with the subject's data
  key: AES-256-GCM from `node:crypto`, a random 96-bit nonce, and additional authenticated data
  `namespace ‖ stream id ‖ event id ‖ field`, encoded as
  `{ "$pse": 1, "k": "<key id>", "n": "<nonce>", "c": "<ciphertext and tag>" }` (base64url). Random
  nonces are safe far beyond the number of encryptions one subject's key will see.
- **In state tables.** Plaintext. State tables are projections that erasure scrubs, and plaintext
  keeps uniqueness, filtering, sorting and search working. Encrypting state columns as well (with
  blind indexes for equality) would forbid `contains`, `startsWith` and ordering on personal fields
  and is not offered in the first release; section 21 lists this as a decision point.
- **Credential material.** Values of `field.secret()` and `field.verifier()` are sealed with their
  own value key (`ps_value_keys`), in the state row and in events alike, with the entity, row id and
  field as associated data. When a value is replaced, its row archived or purged, the kernel destroys
  the old value key in the same unit, so the chain keeps the current value rebuildable and every
  former password hash, token verifier, private key or environment value becomes unreadable
  (crypto-shredding on overwrite). Hidden fields are left out of before-images unless they opt in
  with a reason, and `.stateOnly()` fields never enter events.
- **Keys.** The key service is one component in the core. The deployment master key (from the
  secret providers; a key-management module later) wraps a deployment key, one key per backend and
  one per tenant, all stored wrapped in the control store; these wrap the per-subject data keys
  (`ps_subject_keys(scope_id, subject_id, key_id, wrapped, kek_version, created_at, shredded_at)`)
  and the per-value and per-blob keys in the namespace. Deployment and backend keys protect secrets
  that are not tenant data (module configuration per backend, operator tokens); tenant keys protect
  everything of a tenant. A database dump of a placement alone cannot decrypt the chain.
- **Rotation.** The master key and the deployment, backend and tenant keys rotate by re-wrapping
  (cheap). Data keys never rotate in place, because events are never re-encrypted; a new key version
  for a subject is possible and every value names its key id. Retiring a tenant destroys its tenant
  key, which makes every personal value, secret and blob of that tenant unreadable at once.
- **Subject references.** `ps_subject_refs(scope_id, subject_id, stream_type, stream_id)` is written
  when an event carries personal values; erasure walks it.
- **Caching.** Unwrapped data keys sit in a bounded per-process cache for 60 seconds, invalidated by
  the control store's erasure-ledger feed.
- **Blobs** (gap G5): a personal blob's per-blob key is wrapped by the subject's data key
  (`SubjectKeyStore.wrap`), so shredding the data key makes the blob unreadable before its bytes are
  removed.
- **Elsewhere.** The kernel redacts personal, secret, verifier and hidden values in logs, traces and
  decision logs; receipts of entity commands store references, not rows; the job store removes
  completed jobs after seven days, which bounds personal inputs in job payloads.

```ts
export interface SubjectKeyStore {
  /** The subject's current data key, created on first use when `create` is set; undefined once shredded. */
  dataKey(subjectId: string, options: { readonly create: boolean }): Promise<DataKey | undefined>
  /** A specific key version, to decrypt older values; undefined once shredded. */
  keyById(keyId: string): Promise<DataKey | undefined>
  /** Destroys every key version of the subject, keeping rows with `shredded_at` and no key material. */
  shred(subjectId: string): Promise<{ readonly keyIds: readonly string[] }>
  addRefs(subjectId: string, streams: readonly StreamRef[]): Promise<void>
  refs(subjectId: string, after: StreamRef | null, limit: number): Promise<readonly StreamRef[]>
  /** Wraps other keys (per-blob keys) under the subject's data key. */
  wrap(subjectId: string, key: Uint8Array): Promise<Uint8Array>
  unwrap(subjectId: string, wrapped: Uint8Array): Promise<Uint8Array | undefined>
  /** Value keys of credential material: one per sealed value, destroyed when the value is replaced. */
  sealValue(binding: { readonly entity: string; readonly id: string; readonly field: string }, plain: Uint8Array): Promise<SealedValue>
  openValue(sealed: SealedValue): Promise<Uint8Array | undefined>
  destroyValueKey(keyId: string): Promise<void>
}
```

#### 14.7.5 Erasure

`core.subjects.erase` is a command (asynchronous, tenant scope, input `{ subjectId, reason }`) with
its own rules: the core ships one allowing operator principals (inside a tenant they entered through
`core.tenant.enter`); modules contribute others (accounts can let a user erase their own subject,
which is self-service account deletion; the platforms decide). The worker:

1. Writes the erasure to the ledger in the control store and to the deployment's ledger sinks
   (tenant, subject, time, requester, reason) first, so a crash later, or a restore, is repaired by
   replaying the ledger (section 14.7.6).
2. Shreds the subject's data keys.
3. Appends an `erased` event to every stream in the subject references (actor: the module service
   principal of the core, on behalf of the requester; command id: the erasure's). Its evolve clears
   the subject's personal fields in that row, including `.stateOnly()` personal fields such as
   extracted message text, and, where the row's `dataSubject` (directly or through its reference
   path) is the subject, sets `ps_erased_at` and archives it.
4. Purges the stream records keyed by rows the subject owns.
5. Projections, search indexes and CRDT documents follow from the events (a scrubbed CRDT field is
   replaced by an empty document); live subscribers and sync clients receive the scrubbed row or a
   `remove` with reason `erased`.
6. Completes the receipt.

History reads after erasure (`ctx.data.<module>.<entity>.history`) return `{ redacted: true }` for
values whose key is gone, so a personal field in a history entry is typed `T | Redacted`. The same
subject index can later serve access requests (an export action); that is not part of the first
release.

#### 14.7.6 Backups and restore

A placement restored from a backup must not bring back what was erased, and clients must not mix
positions from before and after the restore. Three mechanisms keep both true:

- **The ledger outside the placement.** The erasure ledger and the tombstones of destroyed tenant
  and value keys are written to the control store and to every configured ledger sink, an
  append-only log a placement restore cannot rewind (a file on a separate volume, later object
  storage with retention lock). At `connect`, and after any restore, the kernel replays the union:
  it shreds every key the ledger has erased before the namespace serves traffic and runs steps 3 to
  5 of the erasure again, because a backup taken before an erasure lacks its `erased` events.
  `pennestack doctor` warns when the control store and a placement share a database cluster and no
  ledger sink is configured, because restoring that cluster rewinds both.
- **Epochs from what a restore changes.** The control store records, per namespace, the database
  cluster's identity (on PostgreSQL the system identifier and the timeline) and, per scope, a
  high-water mark of positions and serials, updated every minute and at shutdown. At `connect` the
  kernel compares them: a changed identity, a new timeline (point-in-time recovery) or a counter
  below its high-water mark means the scope was rewound, whatever tool restored it
  (`pg_restore`, PITR, a volume snapshot). The kernel then bumps the epoch of every affected scope
  and moves its counters past the recorded marks, so tokens of the old epoch get `reset`, positions
  and UIDs are never reused under an old epoch, and the mail server announces a new `uidValidity`.
- **Blobs outlive backups.** The blob collector removes bytes only after the deployment's declared
  backup retention, so a restored row never references bytes that are gone. A backup of a
  deployment is a database snapshot of the control store and the placements plus a snapshot of the
  blob stores taken after it.

What remains is plaintext in state tables inside old backup files, bounded by the operator's backup
retention; the operations guide states it.

#### 14.7.7 Operator redaction (M7)

`core.events.redact` (deployment scope, operator only, reason required) replaces given values in
stored events with redaction markers, rebuilds the affected rows and writes a ledger entry with the
original event hash. It exists for content that is not personal data but must go (a secret pasted
into a title, unlawful content). By design it breaks content verification of that event while the
links of the chain hold. Inside CRDT documents, redaction of a range of history uses Loro's
`redactJsonUpdates` (M9).

#### 14.7.8 Limits

- Clients that synced data keep their copy until they sync again; the protocol then tells them to
  scrub. A client that never reconnects cannot be reached; revocation is forward-looking.
- Free text not marked `.personal()` is not covered; marking fields is the module author's duty.
- Personal data already sent elsewhere (mail delivered, webhooks called) is out of reach.

### 14.8 Live types

#### 14.8.1 From definitions to exact types

The types of everything stored are computed from definitions by the model of section 4.7, with no
generator in the type path and whatever database is connected; the adapter's duty is to keep the
database equal to the definitions (migrations, the drift check at boot). Two families exist:
module-local types, computed from one module and its declared dependencies, which handlers use;
and app types, computed from the app value, which clients, transports and the generated file use
(section 3.4). The data layer adds the following derived types:

```ts
// @pennestack/core, sketch. Each is wrapped in Prettify; App-parameterised types also exist module-locally (ModuleRow<M, Ref>, ...).
interface SystemFields<Ref extends string> {
  readonly id: Id<Ref>
  readonly createdAt: Date
  readonly updatedAt: Date
  readonly archivedAt?: Date | undefined
  readonly version: number
}
type Row<App, Ref extends EntityRef<App>> = Prettify<SystemFields<Ref> & RowOf<FieldsAt<App, Ref>>>

type Insert<F> = Prettify<
  { [K in RequiredWithoutDefault<F>]: InsertValue<F[K]> } & { [K in OptionalOrDefaulted<F>]?: InsertValue<F[K]> }
>
type Patch<F> = Prettify<{ [K in keyof F]?: PatchValue<F[K]> }>
type OfflinePatch<F> = Prettify<{ [K in MergeableKeys<F>]?: PatchValue<F[K]> }>   // excludes exclusive and unique fields

type PatchValue<F> =
  F extends CounterField ? number | { readonly inc: number }
  : F extends SetField<infer T> ? ReadonlySet<T> | { readonly add?: readonly T[]; readonly remove?: readonly T[] }
  : F extends RichTextField ? string | { readonly crdt: CrdtUpdate }
  : F extends SequenceField<infer T> ? readonly T[] | { readonly crdt: CrdtUpdate }
  : F extends FieldDef<infer T, { readonly optional: true }> ? T | null   // null clears an optional field
  : F extends FieldDef<infer T, FieldFlags> ? T
  : never

/** What `decide` of an `offline: true` command may return. */
type OfflineEvents<F> =
  | { readonly kind: 'changed'; readonly ops: FieldOpsOf<Pick<F, MergeableKeys<F>>> }
  | { readonly kind: 'archived'; readonly reason?: string }
  | { readonly kind: 'restored' }

interface Repository<R extends { readonly id: unknown }, I, P> {
  get(id: R['id']): Promise<R | undefined>
  findOne(q: { readonly where: Where<R>; readonly includeArchived?: boolean }): Promise<R | undefined>
  query(q: QueryOf<R>): Promise<Page<R>>                              // { items, pageInfo, total? }
  count(where?: Where<R>): Promise<number>
  create(values: I, options?: { readonly id?: R['id'] }): Promise<R>
  update(q: { readonly where: Where<R>; readonly patch: P; readonly ifVersion?: number }): Promise<readonly R[]>
  archive(q: { readonly where: Where<R>; readonly reason?: string }): Promise<number>
  restore(q: { readonly where: Where<R> }): Promise<number>
  history(id: R['id'], range?: { readonly fromVersion?: number; readonly limit?: number }): AsyncIterable<HistoryEntry<R>>
}

/** History entries are honest about erasure: a personal value whose key is gone reads as Redacted. */
type HistoryEntry<R> = {
  readonly version: number
  readonly type: string
  readonly at: Date
  readonly actor: { readonly kind: string; readonly id: string | null }
  readonly changes: { readonly [K in keyof R]?: { readonly before: R[K] | Redacted; readonly after: R[K] | Redacted } }
}
```

`ctx.data.<module>.<entity>` is a module-local repository (`DataOf<M>`, section 7.6):

- for the module's own entities, `Repository<Row, Insert, Patch>` with the full row, hidden fields
  included and secret fields typed as `SecretRef`, under the module's authority (section 8.4);
- for entities of required and optional modules, the read half, with rows that exclude the other
  module's hidden fields, plus `update` limited to the fields this module contributed;
- `forCaller()` on any of them returns the read half narrowed by the caller's read plan, typed
  `Readable<R>` because the caller's mask may hide maskable fields;
- projection and external entities expose the read half only.

`Where<R>` is the object form of the condition AST over the fields the repository can read; a
comparison with `null` or `undefined` never matches (section 8.3). The row types a module sees
contain the fields of its own definition, its own conditional parts (optional), and the fields its
contributions add to other modules' entities; fields that other modules contribute to its entities
are not part of its view, because the module was compiled without them. App types
(`Row<App, Ref>`, `Readable<R>` for client results) are instantiated once per app in
`pennestack.generated.ts` (section 13.1), so clients and transports never fold the module tuple
again.

#### 14.8.2 Types at the database edge

Adapters convert between domain values and columns with per-dialect codecs (`Date` and `timestamptz`,
`bigint` and `BIGINT`, `ReadonlySet` and JSON arrays, decimal strings and `numeric`), so no physical
type ever reaches a module. The escape hatch is typed by the definitions as well:

```ts
/** Kysely database type of `ctx.sql`: logical table names, field names, domain value types, for the module's dialect. */
type SqlTables<M extends AnyModule> = {
  readonly [Ref in EntityRefsVisibleTo<M>]: { [K in keyof ModuleRow<M, Ref>]-?: SqlColumn<ModuleRow<M, Ref>[K], DialectOf<M>> }
}
```

`EntityRefsVisibleTo` holds the module's own entities and those of the modules it requires or
optionally uses, the same presence rules as `ctx.data`; `DialectOf<M>` is the dialect the module
declares in its data needs. No introspection codegen is involved.

#### 14.8.3 What the dev server regenerates

On every change of a definition, `pennestack dev`:

1. rebuilds the registry and rewrites `pennestack.generated.ts` (section 13.1);
2. diffs every active track against the development database and applies the result (section 14.6.4),
   asking before contract and `rebuild` steps;
3. reports drift: definitions against snapshots ("track `auth->accounts` needs a migration") and the
   database against snapshots;
4. asks the transports for their artefacts (section 13.7);
5. leaves the sources of external entities alone (they are the author's files) and reports drift
   between an external database and those sources, as `pennestack db introspect --check` does.

`tsc -b --watch` runs beside it, so the compiler remains the judge. No database type file is
generated: database types are definition types.

#### 14.8.4 Introspecting an existing database into entity definitions (M7)

```
pennestack db introspect --url <url> [--schema <name>] [--tables a,b] --module <id> --mode external|adopt
pennestack db introspect --drizzle <file> --module <id> --mode external|adopt
```

The command reads the catalogue through `SchemaOperations.introspect` (or Drizzle table objects
through `getTableConfig`) and writes TypeScript source with `defineEntity` calls, which the author
owns and edits from then on. Types then follow from those definitions like any other, so there is
one type mechanism and no generated declaration file.

| Database type | Field written |
|---|---|
| `uuid` | `field.ref(...)` when a foreign key targets a pulled table, else `field.string()` |
| `text`, `varchar(n)`, `char(n)`, MySQL `VARCHAR`, `TEXT` | `field.string({ maxLength: n })` or `field.text()` |
| `smallint`, `integer` | `field.integer({ min, max })` from the type's range |
| `bigint` | `field.integer({ wide: true })` |
| `numeric(p, s)`, `DECIMAL(p, s)` | `field.decimal({ precision: p, scale: s })` |
| `real`, `double precision`, `FLOAT`, `DOUBLE` | `field.float()` |
| `boolean`, MySQL `TINYINT(1)` | `field.boolean()` |
| `timestamptz` | `field.instant()` |
| `timestamp` without time zone, MySQL `DATETIME`, `TIMESTAMP` | `field.instant()`, with a comment that values are read as UTC |
| `date` | `field.date()` |
| `jsonb`, `json`, MySQL `JSON` | `field.json(schema)` with a placeholder schema to refine |
| `bytea`, `BLOB` | `field.binary()` |
| PostgreSQL enum types, MySQL `ENUM`, `CHECK (x IN (...))` | `field.enum([...])` |
| arrays such as `text[]` | `field.list(field.string())` |
| anything else (`money`, ranges, geometry, `citext`) | `field.string()` with a review comment; read as text |

NOT NULL becomes required and nullable `.optional()`; literal defaults become `.default(...)`;
single-column unique and plain indexes become `.unique()` and `.index()`, composite ones `indexes`;
column comments become `.describe(...)`; snake-case columns become camel-case fields.

```ts
// Written by `pennestack db introspect` on 2026-10-11 from schema public, table customers. Edit freely.
import { defineEntity, field } from '@pennestack/core'

export const customer = defineEntity({
  prefix: 'cust',
  history: 'external',
  tenancy: 'backend',
  source: {
    table: 'public.customers',
    id: { column: 'id', kind: 'integer' },                 // native key kept; the stream id is derived (6.2)
    columns: { email: 'email_address', createdOn: 'created_on' },
  },
  fields: {
    name: field.string({ maxLength: 200 }),
    email: field.string({ maxLength: 320 }).unique(),
    createdOn: field.instant(),                            // timestamp without time zone, read as UTC
    tier: field.enum(['free', 'pro']),                     // from enum type customer_tier
    notes: field.text().optional(),
  },
})
```

- **External** entities map tables the framework does not own: no system fields beyond the mapped id
  (with optional `createdAt` and `updatedAt` mappings); `deployment` or `backend` tenancy, or `tenant`
  with a `source.tenantColumn` holding pennestack tenant ids; generated `get` and `query` only;
  custom commands write through `ctx.data` (direct writes plus transient records); no migrations; the
  drift check compares the mapping with the live catalogue. A native key that is not a UUID is
  rendered at the boundary as `<prefix>_<value>`; TypeIDs apply only to the framework's UUIDv7 ids.
- **Adopt** turns existing tables into framework-owned chain entities: the definitions are written as
  ordinary entities, and a baseline migration in the module's own track moves or maps the tables into
  the namespace, adds system and framework columns (the chosen tenant, version 1, timestamps from
  mapped columns or the adoption time), replaces non-UUID keys with UUIDv7 ids (keeping the old key
  as a unique `legacyId` field) and appends one `imported` event per row as the genesis of its
  stream.

#### 14.8.5 Drift checks

- At boot in production: applied history against committed files, per namespace (refuse to start),
  and external entity definitions against the live catalogue of their source (the backends that
  use a drifted external entity are `unavailable`).
- `pennestack db check`: a migrated scratch database's catalogue against the snapshots, and a live
  namespace against the snapshots (missing or extra columns, types, indexes, row-level security
  policies).
- `pennestack generate --check`: definitions against snapshots.
- `pennestack db introspect --check`: external sources against the live catalogue.

### 14.9 Multi-tenancy in the data layer

| Concern | How the data layer handles backends and tenants |
|---|---|
| Placement | Chosen per tenant at creation from the deployment's placements; strategies in section 14.4.1; invisible to application code. |
| Namespaces | One per app on a shared placement, one per tenant otherwise. Each namespace holds one event log; positions, epochs, serials, usage counters and consumer checkpoints are per scope inside it. |
| Scope predicate | Added by the adapter to every statement and event read; composite foreign keys; forced row-level security on PostgreSQL; adversarial tests on every adapter. |
| Identifiers | Primary keys include the scope; ids are unique per scope; client-supplied ids are checked. |
| Transactions | A unit spans one namespace and one scope; backend-level reads from tenant commands use a separate snapshot on every placement; backend- and deployment-scope units refuse tenant entities (section 12.3). |
| Event log and feed | `scope_id` on every event; feeds, heads and tokens per scope (and partition); wake-ups carry the scope. |
| Consumers and jobs | Kernel consumers keep a checkpoint per scope and only enqueue jobs; jobs run per tenant with per-tenant groups, so one tenant's failing or slow work never blocks another tenant (section 15.2.3). |
| Keys | Deployment, backend and tenant keys under the master key; subject and value keys under them; retiring a tenant destroys its key. |
| Migrations | Per namespace; tenant namespaces provisioned at creation and migrated with bounded parallelism; a lagging namespace is `unavailable`. |
| Retention and erasure | Rules per backend with per-tenant overrides; erasure per tenant and subject; the ledger in the control store and the ledger sinks. |
| Moves | `core.tenant.move` copies the chain with its positions (M7). |
| Operator | Namespace-scope units exist only inside the kernel; cross-tenant work goes through deployment-scoped actions (section 8.8). |

### 14.10 Testing and conformance

Every adapter passes the conformance suite in `@pennestack/testing` before it is released:

1. Codec round trips per field kind, with edge values: the largest safe integer, wide integers,
   decimals with scale, instants at millisecond precision, empty sets, characters beyond the Basic
   Multilingual Plane.
2. Condition semantics per operator and kind against the in-memory oracle (dual evaluation): null
   rules, empty lists, `LIKE` escaping, collation, relation quantifiers including empty relations.
3. Pagination: keyset pages stable under concurrent inserts, absent values ordered, cursor
   signature mismatch rejected; on adapters with `positionPaging`, positions (including negative
   ones), anchors and the maximum offset.
4. Units: savepoints, rollback on throw, read-only enforcement, timeouts, serializable actions.
5. Isolation: adversarial cross-tenant tests over rows, events, receipts, jobs, stream records,
   usage counters, keys, serials and the escape hatch; backend-scope units refused on tenant
   entities.
6. Event store: expected-version conflicts, multi-stream atomicity, and positions under concurrency:
   many writers in several tenants with random delays before commit, readers asserting that no
   position of a scope ever appears below one they have already seen, and writers of one tenant
   never waiting on another tenant's commit tail. On PostgreSQL this runs against a networked server
   with real connections, never only on PGlite.
7. Serials: strictly increasing within a partition in commit order under concurrency, never reused.
8. Feed: wake-ups only after commit, none for rolled-back units, coalesced, and recovered by polling
   when a notification is lost.
9. Migrations: render, apply and introspect give back the snapshot; MySQL resumes a failed file;
   partial unique indexes behave; toggle-then-rebuild keeps the values of inactive tracks.
10. Stores: the job store's queue scenarios (section 14.3.9), consumer checkpoints and leases,
    tombstones, stream records and usage counters.
11. Restore detection: a rewound counter or a changed cluster identity bumps the scope epochs.
12. Capability honesty: operators declared unsupported fail with `unsupported`, and nothing else
    does.

Property tests with fast-check 4.10.2: the inline projection equals a rebuild from the log for random
command sequences; merge rules converge for random permutations of concurrent offline mutations
(M8); CRDT fields converge (M9); the hash chain verifies after compaction, shredding and a module
rename; the disclosure rule never reports an id that was never readable (a model-based test with
random rows and policies). Erasure tests search a dump of the test database for marker values of the
erased subject, and credential tests search it for former password hashes and secret values. CI runs
PostgreSQL and MySQL through testcontainers 12.2.0
(`@testcontainers/postgresql`, `@testcontainers/mysql`); local runs use PGlite and SQLite; the proof
apps are the integration suites (section 18).

### 14.11 Risks

| Risk | Mitigation |
|---|---|
| The commit-tail counter caps the write rate of one scope (a tenant), and notifications could serialise commits across the instance. | Counters are per scope, so tenants do not queue behind each other; wake-ups are sent after commit from a separate connection and coalesced; concurrent multi-tenant writers are measured on a networked PostgreSQL before M1 and on both proof apps; high-volume records go to streams; an asynchronous sequencer per scope keeps the stored format if a tenant needs more. |
| Kysely is pre-1.0 (0.29.6, with 0.30.0-beta.2 on `next`). | An exact pin; Kysely stays inside the adapters except for the escape hatch's types; the conformance suite catches breaking changes. |
| Loro's format or API evolves; its WebAssembly weighs on server processes. | A codec id on every CRDT payload and converters in the codec module; the codec loads only when an app declares a collaborative field. |
| The two condition interpreters drift apart. | One semantics table, binary collations, relation quantifiers always evaluated by the database, the dual-evaluation suite on every adapter. |
| The disclosure rule costs reads, and plans built on relations cause resets. | Bounded by `maxChanges`; a reset is correct, only slower; measured on the proof apps. |
| Storage grows: before-images, three indexes on `ps_events`, transient records. | Default expiry of transient records; compaction rules; table partitioning when measurements ask for it. |
| Client clocks are wrong or hostile. | The skew bound, offset estimation, and server-authored writes always winning. |
| Erasure is incomplete: unmarked free text, copies on clients and in old backups. | Documentation, the erasure ledger replayed at restore, scrub instructions in sync, backup retention stated in operations. |
| Parked streams and dead-letter jobs hide failures. | Metrics, alerts and `pennestack doctor` list them. |
| A restore rewinds the ledger together with the data. | Ledger sinks outside the placement, a doctor warning for shared clusters, epochs derived from the cluster identity and high-water marks (section 14.7.6). |
| Schema-per-tenant migrations take long with many tenants. | Bounded parallelism, unavailable lagging namespaces, shared tables as the default. |
| MySQL has no row-level security. | The scoping plugin and adversarial tests; PostgreSQL recommended for multi-tenant production. |

## 15. Events, sync and live updates

This section specifies the event log (streams, positions, the envelope, the write path, receipts,
the hash chain), projections and consumers, the change feed and its tokens, offline multi-actor
sync, and the `live` module. ADRs 0007, 0008 and 0012 record the decisions.

### 15.1 The event log

#### 15.1.1 Streams, and why there is no aggregate layer

- One stream per entity instance (`stream_type` is `module.entity`, `stream_id` is the entity id), as
  section 9.4 fixes. Process-manager instances are streams too
  (`module.process.<name>`).
- There is no aggregate concept. A command that must keep an invariant across entities loads every
  entity it touches and appends to each stream with its own expected version in one unit; that is
  possible because a tenant's streams share a namespace and therefore a transaction. Expected
  versions only guard rows that exist, so an invariant that a concurrent insert could break (a
  count limit) also locks or bumps a parent row, or runs the command at `serializable`
  (section 14.3.6). Parts without an identity of their own are `json` or `list` fields of the
  parent.
- Reason: entities are already the unit of actions, policies, generated actions, live updates and
  sync; an aggregate layer would duplicate each of them. The cost is that an invariant spanning
  entities needs an online command (section 15.3.5).

#### 15.1.2 Table layout

```sql
-- PostgreSQL; MySQL and SQLite use the same columns with their own types (section 14.5.1).
create table <root>.ps_positions (
  scope_id        uuid            primary key,          -- tenant id, or backend id for backend-level entities
  next            bigint          not null,             -- the next position of this scope
  epoch           integer         not null              -- bumped when the scope's positions cannot continue (14.7.6)
);
create table <root>.ps_shapes (shape_id bytea primary key, tracks jsonb not null);   -- active track ids and versions

create table <root>.ps_events (
  scope_id        uuid            not null,             -- tenant id, or backend id for backend-level entities
  position        bigint          not null,             -- commit-ordered within the scope (15.1.4)
  backend_id      uuid            not null,
  stream_type     text            not null,             -- 'accounts.profile'
  stream_id       uuid            not null,
  stream_version  integer         not null,             -- 1-based
  partition_key   text,                                 -- value of the entity's partition field, if declared
  event_id        uuid            not null,
  name            text            not null,             -- 'created', 'changed', 'archived', 'deactivated', ...
  shape_id        bytea           not null,             -- the tracks and versions the payload was written with (15.1.9)
  data            jsonb           not null,             -- personal fields encrypted per subject, credential material sealed
  before          jsonb,                                -- previous values of the fields this event changed
  meta            jsonb           not null,             -- actor, command, action, causation, correlation, client, merge, trace
  hlc             text            not null,
  recorded_at     timestamptz(3)  not null,
  transient       boolean         not null default false,
  prev_hash       bytea,
  hash            bytea,
  primary key (scope_id, position),
  unique (scope_id, stream_type, stream_id, stream_version)
);
create index ps_events_type on <root>.ps_events (scope_id, stream_type, partition_key, position);
```

The unique constraint is the expected-version check: a concurrent append of the same version fails
with SQLSTATE 23505 on PostgreSQL (verified on PostgreSQL 18.3), and the unit fails with `conflict`.
Row-level security covers `ps_events` like every scoped table. Partitioning the table (by position
range or by scope hash) is left until the proof apps show the need.

#### 15.1.3 The envelope

```ts
export interface StreamRef { readonly type: string; readonly id: string }   // { type: 'accounts.profile', id: '0192...' }

export type Hlc = string & { readonly __hlc: true }

export interface EventEnvelope<Type extends string = string, Data = unknown> {
  readonly eventId: string                     // UUIDv7
  readonly position: Position                  // within the scope
  readonly namespace: string                   // NamespaceRef.id
  readonly scope: { readonly backendId: string; readonly tenantId: string | null }
  readonly stream: StreamRef
  readonly version: number                     // 1-based within the stream
  readonly partition: string | null
  readonly type: Type                          // full name: 'accounts.profile.deactivated'
  readonly shape: string                       // the shape id it was written with; reads through the kernel are upcast (15.1.9)
  readonly data: Data
  readonly before: Readonly<Record<string, unknown>> | null
  readonly hlc: Hlc                            // authoring time: the server's, or the client's for offline mutations
  readonly recordedAt: Date                    // acceptance time on the server
  readonly actor: { readonly kind: 'anonymous' | 'user' | 'service' | 'operator' | 'system'; readonly id: string | null; readonly via: string }
  readonly commandId: string | null            // null for kernel work: retention, erasure, imports
  readonly action: string | null               // 'accounts.profile.deactivate'
  readonly causationId: string | null          // the event or command that caused this one
  readonly correlationId: string
  readonly client: { readonly id: string; readonly seq: number } | null   // offline-authored mutations (M8)
  readonly merge: MergeReport | null           // what lost an lww comparison (M8)
  readonly transient: boolean
  readonly prevHash: string | null             // hexadecimal SHA-256
  readonly hash: string | null
  readonly traceparent: string | null
}

export interface MergeReport {
  readonly lost?: readonly string[]                              // lww fields whose proposed value lost
  readonly winners?: Readonly<Record<string, Hlc>>               // the clocks they lost against
}
```

The envelope meets the constraints of section 9.4 (one stream per entity instance,
expected-version appends, commit-ordered positions per scope, a clock, the actor and the command
id, the hash chain, the trace context) and adds `before`, `partition`, `client`, `merge`,
`transient` and `shape`. All of them are written from M1, so the stored format is final then.

#### 15.1.4 Positions, partitions and serials

Requirements: a reader that has seen position `p` must never later see an event at or below `p`;
tokens must be cheap per scope, type and partition; IMAP `MODSEQ` needs integers that grow in commit
order (G7); a long transaction must not stall other readers; one tenant's writes must not queue
behind another tenant's or reveal another tenant's activity; and the scheme should be the same on
every adapter.

Decision: every adapter assigns positions from one counter row per scope (`ps_positions`, keyed by
tenant id, or by backend id for backend-level entities), advanced at the commit tail of each unit
that appends events. A unit appends only in its own scope (section 14.3.6), so it takes exactly one
counter. The unit's buffered events are inserted with consecutive positions just before `COMMIT`,
and the counter's row lock is held until the commit completes. A unit of the same scope reaching
its tail meanwhile waits, then reads the committed counter, so positions follow commit order within
the scope and have no gaps at commit (a rolled-back allocation is reused).

```sql
-- Commit tail of a unit that appended $n events in scope $scope (PostgreSQL; MySQL and SQLite have the same shape).
update <root>.ps_positions set next = next + $n where scope_id = $scope returning next - $n as first;  -- waits for earlier tails of this scope only
insert into <root>.ps_events (scope_id, position, ...) values ($scope, $first, ...), ($scope, $first + 1, ...);
commit;
-- after commit: the unit's afterCommit hook hands ($namespace, $scope) to the process's notifier (section 14.3.7)
```

Properties:

- Readers of a scope see positions in order: whoever sees `p` sees everything below it.
  Consumers read `position > checkpoint` per scope with no visibility heuristics, and the head of
  a scope is its maximum position.
- Positions are 63-bit integers, usable directly as IMAP `MODSEQ` and inside JMAP state strings.
- The writer knows its positions at commit and can return an exact token.
- A long transaction never holds a counter until its own tail, so it delays only itself.
- Tenants do not contend: two tenants in one shared namespace commit in parallel, and a tenant's
  positions count only its own commits, so tokens and `MODSEQ` values disclose nothing about other
  tenants.
- Cost: appending units of one scope serialise for the length of their tail (one insert and the
  commit), so a single tenant commits at most about one appending unit per write-ahead-log flush:
  several hundred to a few thousand per second on local NVMe storage. Every write appends (state
  entities through transient records), so this is the write ceiling of one tenant. High-frequency
  ephemeral data belongs in streams (section 15.1.12) or presence, not in entities. The ceiling and
  the absence of cross-tenant waiting are measured with concurrent multi-tenant writers on a
  networked PostgreSQL before M1 (roadmap M0) and again on both proof apps.
- Wake-ups never run inside the writer's transaction (section 14.3.7).

Alternatives considered:

| Scheme | Why not (now) |
|---|---|
| PostgreSQL `xid8` plus snapshot-xmin visibility (as Emmett does) | No write serialisation, and the functions work as expected (checked on PostgreSQL 18.3), but positions are pairs, unusable as `MODSEQ`; their order is not commit order; and one long-running transaction holds back the visibility horizon of every reader, stalling every feed. |
| A sequence with gap timeouts (Marten's high-water mark) | A slow but committed transaction can be skipped once the timeout passes: a silent miss. |
| Per-stream order plus clocks, no total order | Consumers would need vector checkpoints and tokens could not be single values. |
| One counter per namespace, shared by every tenant of a shared-tables namespace | Simpler, but every tenant's commit tail queues behind every other tenant's, and the positions a tenant sees disclose the namespace-wide commit count (an activity side channel). |
| An asynchronous sequencer (events inserted without position; one worker per scope numbers the committed prefix in order) | Keeps integer, commit-ordered positions without serialising writers, at the price of a second write per event and positions known only after numbering. This is the upgrade path for a tenant that outgrows the counter; the stored format stays the same. |

**Partitions.** An entity may declare `partition: '<field>'` (an immutable field; the mail server
uses `accountId`). Its events store the value in `partition_key`, and the index
`(scope_id, stream_type, partition_key, position)` makes the head per scope, type and partition one
index lookup. Tokens of a partitioned entity are per partition, and its generated `changes` and
`queryChanges` take the partition value as input (the JMAP `accountId`). Positions stay per scope,
so the `MODSEQ` of a message (the position of its last change) grows within every mailbox and
account of the tenant.

**Serials.** `field.serial({ per: ['mailboxId'] })` takes, at insert, the next value of a counter row
in `ps_serials(scope_id, entity, field, partition, next)` keyed by the `per` values. The row lock is
held until commit, so values are strictly ascending in commit order within a partition and never
reused (a value rolled back was never visible). Inserts into one partition serialise; a unit that
allocates in several partitions locks them in key order.

```ts
export interface SerialStore {
  /** Allocates `count` consecutive values in one partition; the lock is held until the unit ends. */
  next(entity: EntityDescriptor, field: string, partition: readonly unknown[], count?: number): Promise<bigint>
}
```

#### 15.1.5 Generated events and field operations

| Event | Written by | `data` | Evolve |
|---|---|---|---|
| `created` | the first event of every stream | `{ values }`: every field after defaults, except `stateOnly` fields; credential material sealed; CRDT fields as initial updates | the new row |
| `changed` | `ctx.data` writes, generated `set` updates, `decide` returning field operations | `FieldOps` | the generic evolve, with merge rules when the entity has merge state |
| `archived` | archive through any action | `{ reason? }` | `archivedAt` set (an `lww` field ordered by clock) |
| `restored` | restore | `{}` | `archivedAt` cleared |
| `erased` | erasure (section 14.7.5) | `{ subject, fields, ledgerId }` | the subject's personal fields cleared; rows whose data subject is the subject itself become erased tombstones |
| `snapshot` | retention compaction (section 14.7.3) | `{ state, anchor }` | replaces the fold up to this version |
| `imported` | adoption of an existing table (section 14.8.4) | `{ values }` | the row |
| domain events | `decide` | the event's declared shape | the author's `evolve` |

```ts
/** The payload of `changed`: what an actor proposed, per field. */
export interface FieldOps {
  readonly set?: Readonly<Record<string, unknown>>                    // lww and exclusive fields; null clears an optional field
  readonly inc?: Readonly<Record<string, number | string>>            // counter fields; wide integers as decimal strings
  readonly add?: Readonly<Record<string, readonly unknown[]>>         // set fields
  readonly remove?: Readonly<Record<string, readonly unknown[]>>      // set fields: removes the adds the author had observed
  readonly crdt?: Readonly<Record<string, { readonly codec: string; readonly update: string }>>   // sequence and richText, base64url
}
```

The generated event names are reserved (section 5.1) and are the same everywhere: the surface's
events, `EntityChange` items and outbound webhook event types all say `created`, `changed`,
`archived`, `restored` and `erased`.

Events record proposals; the resolution is a deterministic function of the stream in version order
(the generic evolve applies the merge rules of section 15.3.4 against the merge state carried in the
row). A rebuild therefore reproduces every resolution, and the `merge` report in the envelope is an
explanation computed at append, never an input to evolve.

#### 15.1.6 The write path

For a command on a chain entity written with `decide`:

1. The invoker resolves the scope's namespace and opens a read-write unit on it; the first statement
   inserts the pending receipt (section 15.1.7).
2. The target row is selected by the action's plan (`not_found` outside it), locked where the
   adapter supports it, and handed to `decide` as the full row.
3. The clock receives `ps_last_hlc` and the field clocks of the merge state (section 14.5.3).
4. `decide(input, current, ctx)` returns events; offline mutations stamp them with the client's
   clock (section 15.3).
5. Each event is evolved in order (the generic evolve for `changed`, the author's `evolve` for
   domain events); the kernel diffs the row before and after each event and stores the previous
   values of the changed fields as `before` (CRDT, hidden, `stateOnly` and credential fields
   excluded).
6. Personal values in `data` and `before` are encrypted with the subject's key, subject references
   are recorded (section 14.7.4), and credential material is sealed with fresh value keys while the
   replaced values' keys are destroyed.
7. The post-image is item-checked (section 8.2), and the entity invariant, if declared, is
   evaluated; a failure fails the unit.
8. The hash is chained from `ps_last_hash` (section 15.1.8).
9. The events are appended with the loaded version as expected version, and the state row is
   updated with `expectedVersion` (new version, `ps_last_hlc`, `ps_last_hash`, merge state).
10. Inline reactions run in module order (section 7.7).
11. Jobs and timers are enqueued in the unit (section 9.5) and the receipt is completed.
12. The commit tail assigns the scope's positions, inserts the events and commits.
13. After commit, the notifier and the local live hub are woken, the output is shaped, and the
    response's state token is the head (section 15.2.6).

A `handle` command performs steps 2 to 9 for every row it writes through `ctx.data` (selection by
the module's authority instead of the action's plan, section 8.4); a create uses expected
version 0 and inserts the row. A `history: 'state'` write updates the row and appends a
transient record instead of a chain event (section 15.1.10).

Rows loaded for a write are locked where the adapter has row locks (PostgreSQL and MySQL; SQLite and
the in-memory adapter have a single writer), so concurrent writers of one row queue instead of
conflicting; the versioned update stays as the guard, and conflicts remain for `ifVersion` and
`ifInState`. An increment of a counter field is therefore atomic, and `update` returns the row with
the resulting value: the atomic increment with result that G7 asks for (quota usage).

#### 15.1.7 Receipts and the asynchronous outbox

Receipts are the core module's `commandReceipt` entity (`history: 'state'`; fields `commandId`,
`action`, `fingerprint`, `principal` (a reference, section 8.5), `status`, `outcome`, request
metadata (transport, remote address, user agent), `clientId`, `clientSeq`, `expiresAt`). Its tenancy
is `invocation`, a mode only the core uses: a row carries the scope of its command, so a tenant
command's receipt is a tenant row in the tenant's namespace (`core__command_receipt`, unique on
`(tenant_id, command_id)`), a backend command's receipt lives in the backend's home namespace, and
an operator command's in the control store. Idempotency only holds if the receipt commits with the
effect, so it shares the command's namespace and unit. Only the kernel writes receipts: the
generated set operations are switched off, and the generated `get` and `watch` accept tenant,
backend and deployment scope. A receipt's id is a UUIDv8 derived from the scope and the command id,
so clients that hold only a command id (a REST `Location`, `pennestack ... --wait`, a webhook
delivery id) call `core.commandReceipt.get` with it. Command ids are stored as the client gives them
(section 7.5).

- The first statement of every command's unit inserts the receipt as `pending` and holds its row
  lock until commit, so a concurrent duplicate gets `core.command_in_progress` instead of running
  the handler a second time; the receipt is completed (or, for an asynchronous command, set to
  `accepted`) in the same unit.
- The outcome of an entity command is a reference (`{ entity, id, version }`): a replay re-reads the
  row and masks it for the caller. Other commands store their serialised output.
- Receipts expire after their action's idempotency window (default 24 hours, section 7.5). They are
  operational records, outside the "nothing deleted" rule. Receipts of sync mutations are kept until
  the client acknowledges them (section 15.3.6).
- Receipts of asynchronous commands write transient change records (section 15.1.10), so their progress
  can be watched; receipts of synchronous commands do not, because nobody waits on a finished
  command.
- An asynchronous command's job is enqueued in the same unit as its `accepted` receipt, on every
  adapter, because the job store is part of the unit (section 14.3.9); no relay exists. The worker
  records `completed` or `failed` in its own unit.

```ts
export interface ReceiptStore {
  get(commandId: string): Promise<Receipt | undefined>
  /** Inserts the receipt; `conflict` when the id exists with another fingerprint. */
  put(receipt: Receipt): Promise<void>
  complete(commandId: string, outcome: ReceiptOutcome): Promise<void>
  /** Sync: outcomes of one client's mutations after a client sequence number (M8). */
  forClient(clientId: string, afterSeq: number, limit: number): Promise<readonly Receipt[]>
  acknowledge(clientId: string, uptoSeq: number): Promise<void>
}
```

#### 15.1.8 The hash chain

- Every chain event stores `hash = SHA-256(prevHash ‖ JCS(content))`, where JCS is the JSON
  Canonicalization Scheme of RFC 8785 and `content` holds the event id, stream id, version, local
  event name, schema version, `data` (with ciphertext for personal values), `before`, clock,
  recorded time, actor, command id and client fields. The state row keeps `ps_last_hash`, so chaining
  costs no read. The canonicaliser lives in the core; `canonicalize` 5.1.0 (Apache-2.0) serves as an
  independent implementation in tests.
- The chain survives crypto-shredding (the ciphertext does not change) and module renames (the
  module id is not hashed).
- Retention compaction writes a `snapshot` event whose `anchor` is the hash of the last removed
  event, and verification starts there. Operator redaction (section 14.7.7) keeps the stored hash, so
  links hold while that event's content no longer matches, and the redaction ledger explains why.
- `pennestack db verify [--stream <ref>]` recomputes the chain.
- Always on for chain entities: one SHA-256 per event is negligible next to the write itself.
  Transient records carry no hash.

#### 15.1.9 Upcasting and schema evolution of events

- Every event stores the shape it was written with: the id of a `ps_shapes` row listing the active
  tracks and their versions (section 14.6.1). Reads through the kernel upcast each track's fields to
  the track's current version. Renames recorded by the planner are applied automatically, fields a
  track removed are dropped, and added fields are absent (their defaults apply on evolve). Fields of
  tracks that are inactive in the reading app are passed through unchanged by the generic evolve and
  by rebuilds, so their columns keep their data. A type change needs an `upcast` function in the
  migration file; the planner refuses to write a migration with an unhandled type change.
- Domain event shapes are part of the snapshot and evolve the same way.
- Upcasting never rewrites stored events.
- CRDT payloads carry their codec id (`loro/1`); a change of codec format ships a converter in the
  codec module.

#### 15.1.10 Transient change records

"Live updates on everything" needs a change record for every entity, also those that are not
history:

- `history: 'state'` entities append a `created`, `changed` or `archived` record with
  `transient = true` and no hash on every write; versions follow the row's version. Records are
  purged after the feed horizon (default 7 days, operator-configurable, section 14.7.1). An entity that
  switches off `changes` and `queryChanges` and is read by no live source writes no records.
- `history: 'projection'` entities (section 15.2.2) append transient records when their projector
  writes, so read models have live updates and `changes` too.
- `history: 'external'` entities (section 14.8.4) append transient records for writes made through
  the framework; writes by other systems stay invisible until a `stream`-level feed captures them.

#### 15.1.11 The event store contract

```ts
export interface EventStore {
  /** Buffers appends to one or more streams; they are written atomically at the commit tail. `conflict` on a version mismatch. */
  append(batch: readonly StreamAppend[]): Promise<readonly { readonly eventId: string; readonly version: number }[]>
  /** One stream in version order, as stored (encrypted, not upcast); includes events buffered in this unit. */
  readStream(stream: StreamRef, range?: { readonly fromVersion?: number; readonly toVersion?: number; readonly limit?: number }): Promise<readonly StoredEvent[]>
  /** Events of the unit's scope after a position, in position order, filtered by the selector. */
  readAll(after: Position | null, options: { readonly limit: number; readonly selector?: EventSelector; readonly includeTransient?: boolean }): Promise<{ readonly events: readonly StoredEvent[]; readonly next: Position | null }>
  /** The highest committed position of the unit's scope for the selector: the basis of tokens. */
  head(selector?: EventSelector): Promise<Position | null>
  /** Positions this unit assigned, available after commit. */
  committed(): readonly Position[]
  /** The scopes of this namespace whose head moved after the given marks (wake-up recovery and kernel fan-out). */
  movedScopes(since: ReadonlyMap<string, Position>, limit: number): Promise<readonly { readonly scopeId: string; readonly head: Position }[]>
  // Kernel maintenance in the scope's unit:
  compact(stream: StreamRef, uptoVersion: number, snapshot: NewEvent): Promise<void>
  purgeStream(stream: StreamRef): Promise<number>
  purgeTransient(before: Date, limit: number): Promise<number>
  redact(eventId: string, replacement: { readonly data: unknown; readonly before: unknown }): Promise<void>
}

export interface StreamAppend {
  readonly stream: StreamRef
  readonly expectedVersion: number             // 0 creates the stream
  readonly partition: string | null
  readonly events: readonly NewEvent[]
}

export interface NewEvent {
  readonly eventId: string
  readonly name: string                        // local name: 'changed', 'deactivated'
  readonly schemaVersion: number
  readonly data: unknown                       // personal values already encrypted
  readonly before: unknown | null
  readonly hlc: Hlc
  readonly recordedAt: Date
  readonly meta: EventMeta                     // actor, commandId, action, causationId, correlationId, client, merge, traceparent
  readonly transient: boolean
  readonly prevHash: string | null
  readonly hash: string | null
}

export interface EventSelector {
  readonly streamTypes?: readonly string[]
  readonly partition?: string
  readonly names?: readonly string[]
  readonly streams?: readonly StreamRef[]
}

/** As stored: `data` and `before` encrypted and not upcast. The kernel decrypts and upcasts on read. */
export type StoredEvent = EventEnvelope<string, unknown>
```

#### 15.1.12 Streams of records (G6)

Deployment logs and delivery attempts are high-volume, append-only records keyed by an entity, with
a short retention. They are not chain events: putting them in `ps_events` would put them on the
commit-tail counter and in front of every consumer. Streams (`defineStream`, gap G6) store them in
`ps_stream_records(scope_id, stream, key, seq, at, data)` through the unit's `StreamRecordStore`,
with `seq` from a serial per key (section 15.1.4), the stream's own retention, the same scope
predicate and wake-ups, and no hash, projection or offline sync. Live subscriptions read them by
`(key, seq)`. Personal values in records are encrypted with the key of the subject that owns the
keyed row, and erasure purges the records of every row the subject owns (section 14.7.5).

### 15.2 Projections, consumers and the change feed

#### 15.2.1 Inline state projections

The state table of a chain entity is its inline projection: updated in the same unit as the append,
so a command's own reads and the next request see the new state. It is also the snapshot: `decide`
receives the row, so no stream is replayed on the write path and long streams cost nothing until a
rebuild or a history read. Framework columns: `version` (the stream version), `ps_last_hlc`,
`ps_last_hash`, `ps_erased_at` and, from M8, `ps_merge` (field clocks, set dots, CRDT document
versions).

#### 15.2.2 Projection entities (M7)

Cross-entity read models are entities with `history: 'projection'`: maintained asynchronously by a
consumer, read through `ctx.data` like any entity, governed by policies, served by the generated
`get`, `query`, `changes` and `queryChanges`, and rebuildable at any time. Nothing but their
projector writes them.

```ts
const projectStats = defineEntity({
  prefix: 'pstat',
  history: 'projection',
  fields: {
    projectId: field.ref.own('project').unique(),
    deployments: field.integer().default(0),
    lastDeployAt: field.instant().optional(),
  },
  projection: {
    from: ['deployments.deployment.created'],                         // typed against the registry
    key: (event) => ({ projectId: event.data.values.projectId }),    // the unique key of the row an event updates
    evolve: {
      'deployments.deployment.created': (row, event) => ({
        projectId: event.data.values.projectId,
        deployments: (row?.deployments ?? 0) + 1,
        lastDeployAt: event.recordedAt,
      }),
    },
    start: 'beginning',
  },
})
```

A projection that reads another module's events depends on that module like a reaction does
(`requires`, or inside a conditional part). Projections are a history mode rather than a new
builder step (section 6.6).

#### 15.2.3 Consumers

Consumers read the event log of a namespace and are kernel-only: projection entities, the reaction
dispatcher of section 7.7 and the sync poke. Module code never runs inside a consumer and never
receives a namespace-scope unit; the live hub's reader is not a consumer either (it runs in every
serving process, outside leases, section 15.2.5).

```ts
export interface ConsumerSpec {
  readonly id: string                            // stable: 'core.reactions', 'reports.stat'
  readonly selector: EventSelector
  readonly start: 'beginning' | 'now'            // projections: beginning; the reaction dispatcher: now for reactions added later
  /** Runs in one tenant-scope unit together with the checkpoint advance of that scope. */
  readonly handle: (events: readonly EventEnvelope[], unit: Unit) => Promise<void>
  readonly maxAttempts?: number                  // before the stream is parked; default 5
}
```

- State: `ps_consumers(consumer_id, scope_id, position, updated_at)`, one checkpoint per consumer
  and scope, plus `ps_consumer_leases(consumer_id, lease_owner, lease_expires_at)` and
  `ps_parked(consumer_id, scope_id, stream_type, stream_id, from_position, attempts, last_error,
  parked_at)`.
- Leases: one active instance per consumer and namespace across all processes, acquired by a
  conditional update and renewed every third of the lease; only processes with the `work` role run
  consumers. The instance learns which scopes moved from wake-ups and from `movedScopes`, and
  handles each scope in its own tenant-scope unit, so one scope's batch never shares a unit, a
  checkpoint or a failure with another's.
- Delivery: at least once. Effects inside the namespace commit with the scope's checkpoint, so they
  happen effectively once.
- Work: the reaction dispatcher only enqueues keyed jobs (section 9.5); network calls, retries and
  backoff happen in jobs, so a slow GitHub call or a failing handler never holds a checkpoint.
  Projections evolve rows, which is short and local.
- Ordering and failures: events of one stream are handled in order. A failing event is retried a few
  times; after `maxAttempts` its stream is parked for that consumer and scope, later events of that
  stream are skipped and recorded, and every other stream and every other scope continues.
  `pennestack consumers unpark` (or a redeploy with a fix) replays the parked stream from
  `from_position`. Parked streams are a metric and an alert.
- New reactions start at the head, so adding a reaction to a running system does not replay history
  into side effects (no welcome mail to every existing user); projections start at the beginning.

#### 15.2.4 Rebuilds

- M1, offline: `pennestack db rebuild <entity>` takes an exclusive per-entity lock (writers of that
  entity take it shared), clears the entity's rows in the namespace, replays its streams in version
  order, verifies their hashes and releases the lock. Writes to that entity wait meanwhile.
- M7, online blue/green: the new table `<table>__r<n>` is built from the log while writers continue,
  catches up, takes the exclusive lock briefly for the final catch-up, swaps names, and the old table
  is dropped after a grace period. Projection entities switch the same way, without a writer lock.
- Triggers: `rebuild` and `enableMergeState` migration steps. The snapshot stores a hash of each
  `evolve` source text; when it changes, `pennestack db generate` asks whether the change alters
  results (a formatting change does not) and writes a `rebuild` step if it does.

#### 15.2.5 The change feed and live delivery

```ts
export interface ChangeFeedSource {
  readonly level: 'poll' | 'notify' | 'stream'
  /** Wake-ups, never data: something may have been committed in these scopes. */
  wake(namespaces: readonly NamespaceRef[], signal: AbortSignal): AsyncIterable<{ readonly namespace: string; readonly scopeIds: readonly string[] }>
}
```

- The core's `ChangeFeed` (section 9.6) is implemented once: `read(scope, after, selector)` loops
  over `unit.events.readAll` in read-only units of the scope, and `wake(scope)` filters the
  adapter's wake-ups.
- Wake-up sources: on PostgreSQL, the process's notifier sends at most one
  `NOTIFY ps_events, '<namespace>:<scopes>'` per namespace every 50 milliseconds after commit, from
  its own connection and outside any writer's transaction (section 14.3.7), with payloads far below
  the 8,000-byte limit (a namespace-wide wake-up replaces the scope list when it would not fit); on
  MySQL and SQLite, an in-process wake on commit plus polling for other processes (every 250 ms,
  backing off to 2 s while idle). Every reader also polls heads every second, so a lost
  notification costs latency, never an event.
- The live hub (section 15.4, ADR 0012) runs one reader per scope with local subscribers in each
  serving process, outside consumer leases: after each wake-up it reads the log after its position
  up to the head and fans out in memory. Subscriptions are grouped by their resolved plan: each
  distinct plan is evaluated once per batch, field operators in memory and relation quantifiers
  with one `rows.matching` query per distinct plan and batch, never one per subscriber. Masks are
  applied per row. While a stream is connected, the hub's set of delivered ids decides `removed`
  items exactly; after a resume from a token, the disclosure rule of section 15.2.6 decides them for
  the replayed range.
- Clients use poke-then-pull: the live module's pokes (section 15.4.2) carry the new
  token per entity type the principal may read, and the client calls `changes` or `sync.pull`.
  Server-side subscriptions built with `ctx.live` emit rows directly. A live source over a `state`
  entity with `from: 'beginning'` first emits the current rows, then the changes after the head taken
  before that scan.

#### 15.2.6 Tokens and the disclosure rule

A token is `v1.<epoch>.<position>.<scope>.<check>`: the scope's epoch in base 36; the position in
decimal; `scope`, the first 8 hexadecimal characters of SHA-256 over the backend id and the scope
id (independent of the namespace, so tokens survive a tenant move); and `check`, the first 8
hexadecimal characters of SHA-256 over the rules that govern reads of the token's entity type for
that principal (their ids and a hash of their conditions and field lists), the principal's id,
roles and memberships, the entity type, the partition and, for `queryState`, the filter and sort.
A deploy that changes rules for other entities, or rules that do not apply to the principal,
leaves the token valid; one that changes what this principal may read of this type resets it. It is
the core's opaque `StateToken`: JMAP `state` and `queryState`, live stream tokens (section
15.4.4) and the sync cursor (which adds a shapes hash) all use this form.

- A token is always the head for its selector at the moment it is issued. Positions are commit
  ordered, so a token never points past an invisible event, and a writer's response carries the exact
  position of its own last event.
- `get` and `query` read the head as the first statement of their read-only unit, so the `state` they
  return describes exactly the snapshot their rows come from. It is a valid `after` for `watch` and
  `changes`, with no gap and no duplicate: the confirmation section 15.4.2 asks for.
- A token whose `scope` part belongs to another scope is a `validation` error
  (`core.token_scope_mismatch`, section 15.4.4).
- `cannotCalculateChanges` (JMAP) or `reset` (sync and live) is answered when the epoch differs;
  when the check differs (other roles, memberships, rules, principal or selector), so the client
  re-queries under its current visibility; or when the position is older than the entity type's
  retention horizon (section 14.7.2).

`changes` since a token at position `p`, for principal `P`:

1. Read the events of the scope, type and partition after `p`, grouped per stream, up to
   `maxChanges` streams.
2. A stream whose current row `P` can read is reported `created` (its `created` event is after `p`)
   or `changed`.
3. A stream whose current row `P` cannot read (including archived and erased rows) is reported
   destroyed only if `P` could read it at `p`. The row at `p` is reconstructed from the current row
   and the `before` images of the events after `p` (the earliest image of each changed field).
   Relation quantifiers are evaluated with the reconstructed keys against the related rows' current
   state, but only if those related streams did not change after `p`; otherwise the stream is
   uncertain.
4. A stream `P` could not read at `p` and cannot read now is omitted.
5. If any stream is uncertain, the call answers `cannotCalculateChanges` instead of guessing.

`queryChanges` applies the same reconstruction: `removed` lists changed ids that were in the old
results (readable and matching at `p`), and `added` lists changed ids readable and matching now, each
with its index from a keyset count bounded by `maxChanges` (beyond it, `tooManyChanges`).

Fields that before-images do not carry (hidden, `stateOnly` and credential fields) cannot appear
in rule conditions, so the reconstruction never needs them.

This is principle 5 made concrete: an id the principal never could read is never revealed, a row it
lost is never silently kept, and when the evidence is insufficient the client resynchronises. Live
subscriptions apply the same steps to the range they replay after a resume, with `p` the token they
resumed from, and send `reset` (section 15.4.5) when uncertain.

### 15.3 Offline multi-actor sync

#### 15.3.1 Model: rows down, commands up

- **Reads are row sync.** A client pulls current rows (masked, filtered by its shapes and the
  principal's plan) for everything that changed after its cursor, which is JMAP's `changes` plus
  `get` over several types at once. Shipping events instead would make every client implement every
  `evolve`, show it history it may no longer read and force it to upcast old payloads; rows are
  current, masked and small.
- **Writes are commands replayed at ingest.** A client pushes the commands it ran offline, each with
  its command id, client sequence, base versions and authoring clock. The server runs every one
  through the invoker: validation, authorization against committed state, the command's own logic
  against the current row, the merge rules, the item check. A client can propose, never forge
  events.
- This is the mutation-replay family (Replicache, Linear, Jazz 2.0) adapted to a server that keeps
  an event chain, with per-field merge rules where replay alone would lose concurrent work.

#### 15.3.2 Shapes

A client registers shapes: `{ entity, where?, partition?, fields? }`. Its view of an entity is the
shape's condition conjoined with the principal's read plan, through the field mask narrowed by
`fields`. The first pull (or a pull after a reset) takes the head first, then scans each shape with
keyset pages and returns every row as `put`; later pulls start at that head, so changes made during
the scan arrive again, which is harmless, and none is missed.

#### 15.3.3 Clocks

Clients author with a hybrid logical clock (section 14.5.3) whose physical source is the device clock
corrected by the offset the client estimates from the `serverTime` of every response, and which
receives the server clocks it pulls. A mutation whose clock is ahead of server time by more than the
skew bound (default 5 minutes, per backend) is deferred with `clock_skew`; the client corrects its
offset and re-stamps its pending mutations, which is allowed because none of them was accepted. A
clock far in the past is accepted: an edit authored long ago loses `lww` comparisons against later
edits, which is the intended meaning.

#### 15.3.4 Merge rules per field type

| Merge type | Offline operation | Rule, at ingest and in the generic evolve | Merge state per row |
|---|---|---|---|
| `lww` (default for scalars, `json` and `lww` lists) | `set` | applied when its clock is greater than the field's clock (ties broken by node id), otherwise recorded as lost in the event's merge report; server-authored writes always win (receive rule, section 14.5.3) | one clock per field |
| `counter` | `inc` | summed; an offline `set` is rejected; an online `set` is turned into `inc(value − current)` by the server | none |
| `set` | `add`, `remove` | observed-remove: a remove deletes the adds its author had observed (adds at versions up to the mutation's base version, and the author's own adds); concurrent adds it had not seen survive | per element: the versions and authors of live adds |
| `sequence`, `richText` | `crdt` | the codec imports the update; the materialised value is validated against the field afterwards, and an invalid result rejects the mutation | the CRDT document (its own column) |
| `exclusive` (every unique field, or explicit) | none | online commands only; an offline mutation that touches one is rejected with `sync.exclusive_field` | none |
| archive state | `archive`, `restore` | `archivedAt` is an `lww` field ordered by clock: a concurrent edit and archive both apply (the row ends archived, with the edit), and a later restore wins | one clock |

After merging, the policies' item check and the entity invariant (an optional pure predicate over the
row; section 4.2) run on the merged post-image. A violation rejects the mutation: field-level
merges can combine into a state no single author produced (two dates edited apart), and the
invariant catches that. Merge rules decide how concurrent allowed writes combine; policies decide
what is allowed. A policy that freezes archived rows rejects a late offline edit even though the
merge rule would have kept it.

#### 15.3.5 What may run offline, and what must stay synchronous

| Command | Offline | Why |
|---|---|---|
| Generated set operations with `generated: { set: { offline: true } }`: create with a client id, update of mergeable fields, archive, restore | yes | field semantics are generic |
| A custom command with `offline: true` whose `decide` returns only field operations on mergeable fields, `archived` or `restored` | yes | replayable and mergeable |
| A command with `handle` | no | it can read anything and call services |
| A command whose `decide` returns domain events with an author `evolve` | no | an opaque transition cannot be merged |
| Writes to unique or `exclusive` fields (slugs, host names, mail addresses, mailbox names) | no | uniqueness needs one authority at one moment |
| Authentication, sessions, tokens, credentials, secrets shown once | no | issuance is a decision of the server |
| External side effects (sending mail, running a deployment, payments) | no; online commands, or async reactions to accepted events | the effect cannot be merged or undone |
| Invariants across entities (quotas, limits, capacity) | no | the check needs every entity at one moment |
| `execution: 'async'` commands, backend- and deployment-scoped actions | no | the push is already the deferral; offline mutations are tenant-scoped |

An `offline: true` command must use `decide`, `execution: 'sync'` and `auth: 'policy'`; `defineApp`
checks this, and the type of its `decide` result is restricted to `OfflineEvents<E>` (section 14.8.1).
Section 17.6.3 expects no offline authorship in Launchway and offline `set` merges for mail keywords,
mailbox membership and drafts, which fit this table.

#### 15.3.6 The protocol

The protocol is four actions of the `sync` module (in `@pennestack/events`), five from M9, so every
transport can carry it; section 15.4.8 maps them onto carriers.

```ts
export interface ShapeSpec {
  readonly entity: string                        // 'mail-store.email'
  readonly where?: ConditionInput                // object form, typed per entity in the client
  readonly partition?: string                    // partitioned entities
  readonly fields?: readonly string[]            // narrower than the principal's mask
}

/** sync.register (command): a device registers, or replaces its shapes. */
export interface RegisterInput { readonly clientId?: string; readonly label?: string; readonly shapes: readonly ShapeSpec[] }
export interface RegisterOutput { readonly clientId: string; readonly lastClientSeq: number; readonly serverTime: string }

/** sync.push (command): mutations in client order. */
export interface PushInput { readonly clientId: string; readonly mutations: readonly Mutation[]; readonly ackUpTo?: number }   // ackUpTo: outcomes processed
export interface Mutation {
  readonly clientSeq: number                     // 1, 2, 3, ... per client, without gaps
  readonly commandId: string                     // UUIDv7; the receipt key
  readonly action: string                        // an offline-capable action, 'mail-store.email.set'
  readonly input: unknown                        // validated by the action's schema at ingest
  readonly baseVersions?: Readonly<Record<string, number>>   // per entity id: the version the client last pulled
  readonly hlc: string                           // authoring clock
}
export interface PushOutput { readonly results: readonly MutationResult[]; readonly serverTime: string }
export type MutationResult =
  | { readonly clientSeq: number; readonly status: 'accepted'; readonly position: string; readonly merge?: Readonly<Record<string, MergeReport>> }
  | { readonly clientSeq: number; readonly status: 'duplicate' }
  | { readonly clientSeq: number; readonly status: 'rejected'; readonly error: WireError }
  | { readonly clientSeq: number; readonly status: 'deferred'; readonly reason: 'out_of_order' | 'clock_skew' | 'unavailable' | 'rate_limited' }

/** sync.pull (query; writes nothing). */
export interface PullInput { readonly clientId: string; readonly cursor: string | null; readonly knownClientSeq: number; readonly limit?: number }
export interface PullOutput {
  readonly changes: readonly RowChange[]
  readonly cursor: string
  readonly hasMore: boolean
  readonly lastClientSeq: number                 // highest client sequence processed, accepted or rejected
  readonly outcomes: readonly MutationResult[]   // results after `knownClientSeq`; acknowledged by `ackUpTo` on a later push
  readonly reset?: 'epoch' | 'visibility' | 'retention' | 'shapes'
  readonly serverTime: string
}
export type RowChange =
  | { readonly op: 'put'; readonly entity: string; readonly id: string; readonly version: number; readonly row: Readonly<Record<string, unknown>>; readonly crdt?: Readonly<Record<string, { readonly codec: string; readonly version: string }>> }
  | { readonly op: 'remove'; readonly entity: string; readonly id: string; readonly reason: 'archived' | 'left-view' | 'purged' | 'erased' }

/** sync.poke (subscription): a pull would return something new; built on the live module's pokes, filtered by the client's shapes. */
export interface SyncPoke { readonly cursor: string }

/** sync.crdt (query, M9): updates of one collaborative field since a version. */
export interface CrdtPullInput { readonly entity: string; readonly id: string; readonly field: string; readonly since: string | null }
export interface CrdtPullOutput { readonly codec: string; readonly update: string; readonly version: string }
```

Push semantics:

- The client row (`sync.client`, a `history: 'state'` entity of the `sync` module: principal, label,
  shapes, shapes hash, `lastClientSeq`, acknowledged sequence, last push, registration time) binds a
  client to the principal
  that registered it; a push by another principal is `forbidden` (`sync.client_principal`).
- Mutations are processed in order. `clientSeq ≤ lastClientSeq` is `duplicate` (its outcome comes
  back through `outcomes`); `clientSeq > lastClientSeq + 1` defers it and every later one with
  `out_of_order`; a clock beyond the skew bound defers with `clock_skew`; a deferral stops the batch.
- Otherwise the mutation runs through the invoker in its own unit, with sync metadata on the
  invocation (`Invocation.sync`, section 9.2): locate (the action must be offline-capable, else `forbidden` with
  `sync.not_offline`), admit, validate, authorize, execute with merge rules, item check. The same
  unit writes the receipt (with client id and sequence) and advances `lastClientSeq`.
- A rejected mutation's unit rolls back; a second, small unit records the rejected receipt and
  advances `lastClientSeq`, so the client's queue never blocks on a rejection.
- A push carries at most 100 mutations by default. `sync.push` is declared with
  `transaction: 'per-item'` (section 7.3): each mutation is an independent invocation in its own
  unit, as in the invocation protocol's batch, so a long offline session does not become one huge
  commit tail.
- `ackUpTo` acknowledges the outcomes the client has processed (see pull).

Pull semantics:

- Changes after the cursor are computed per stream with the disclosure rule of section 15.2.6, the
  shape conditions added: in view now gives `put` with the current masked row; in view at the cursor
  but not now gives `remove` with its reason; uncertain gives `reset: 'visibility'`, after which the
  client rescans.
- `outcomes` are the client's receipts after `knownClientSeq`. A pull is a query and writes
  nothing: the client acknowledges outcomes with `ackUpTo` on its next push (an empty push serves
  when nothing is pending), and only acknowledged receipts may expire. This is the per-client inbox,
  built on the receipts of section 7.5.
- A client inactive beyond the `syncClients` rule (measured from its last push or registration) is
  retired and must register again; the receipt
  fingerprints of a retired client are kept for one more inactivity window, so a client returning
  late re-pushes as duplicates instead of repeating effects.

#### 15.3.7 Authorization at ingest

Every mutation runs under the principal resolved for the push request, not the one that authored it:
the gate, target selection by the plan's `where` (the target must be inside the plan now) and the
item check of section 8.2 on the merged post-image, `check` conditions included. A principal that
lost a right between authoring and pushing is rejected, with the rule ids of the decision.
Revocation is forward-looking: data a client already holds stays there until its next pull removes
it. Clients may use the principal's effective rules from `core.me` (section 8.7) to predict
outcomes and grey out controls; the server decides.

#### 15.3.8 Rejections and the client journal

- Outcomes reach the client twice: in the push response, and in `outcomes` of every pull until
  acknowledged, so a client that crashed after pushing still learns them.
- The reference client reverts automatically: a rejected mutation leaves the pending queue, the
  client rebases its remaining mutations on the server rows, and the mutation moves to a local
  rejected journal with its original input and the error, so an application can show it, let the
  user retry or copy the text. Nothing a user typed disappears silently.
- An accepted mutation whose `lww` fields lost is reported as a notice (`merge.lost`), not a
  rejection.
- The framework has no server-side merge tasks; a module that wants them can build them from
  rejected receipts.

#### 15.3.9 Collaborative fields

`sequence` lists and `richText` fields hold CRDT documents through a codec. Codecs fill a kernel
extension point (`crdtCodecs`, section 5.6), so the core carries no WebAssembly; an app that declares such a
field without a codec module fails at compose.

```ts
export interface CrdtCodec {
  readonly id: string                                            // 'loro/1'
  readonly kinds: readonly ('richText' | 'sequence')[]
  create(kind: 'richText' | 'sequence', initial: unknown, peer: bigint): CrdtResult
  /** Imports a client's update; the kernel validates `value` against the field afterwards. */
  apply(document: Uint8Array, update: Uint8Array): CrdtResult
  /** An online write of a whole value, turned into operations (for text, a minimal diff). */
  replace(document: Uint8Array, value: unknown, peer: bigint): CrdtResult
  updatesSince(document: Uint8Array, version: Uint8Array | null): Uint8Array
  /** Drops history before a version (retention, M9). */
  shallow(document: Uint8Array, version: Uint8Array): Uint8Array
}
export interface CrdtResult {
  readonly document: Uint8Array                                  // full state, stored in the row
  readonly update: Uint8Array                                    // stored in the event's `crdt` operation
  readonly value: unknown                                        // materialised: text with marks, or the list
  readonly version: Uint8Array                                   // encoded version vector after the change
}
```

- **Library.** Loro (`loro-crdt` 1.16.4, MIT, format stable since 1.0), as the events research
  recommends: Peritext-style rich text, movable lists, version vectors, shallow snapshots and
  redaction. The calls the codec uses were checked in the 1.16.4 type definitions: `LoroDoc`,
  `getText`, `getMovableList`, `import`, `export({ mode: 'update', from })`,
  `export({ mode: 'snapshot' })`, `export({ mode: 'shallow-snapshot', frontiers })`, `oplogVersion`,
  `vvToFrontiers`, `VersionVector.encode` and `decode`, `setPeerId` (64-bit peers: a random one per
  server process and per client session), `LoroText.update` (a Myers diff, used by `replace`) and
  `redactJsonUpdates`. Yjs 13.6.33 (MIT) could become a second codec (`yjs/13`) for editor
  ecosystems; the codec is chosen per field and recorded in the snapshot.
- **Storage.** The document sits in the row's column and the materialised value in
  `<column>_value`; each accepted update is the event's `crdt` operation (encrypted when personal),
  with the version vector after it in the event's metadata, which `shallowCrdt` retention uses to find
  its cut. A rebuild re-imports the updates in version order.
- **From the first app that declares one.** Online writes of a whole value go through `replace`, so
  the stored form is a CRDT from the start and M9 only opens the protocols.
- **Sync (M9).** A `put` carries the materialised value and the document version; the client fetches
  `sync.crdt` updates since its own version and pushes local updates as `crdt` operations.
  Real-time typing pushes small updates batched every 250 ms through the same push. Presence
  (cursors, selections) is ephemeral, never stored, and travels through the live module.

#### 15.3.10 The reference client (M8)

`@pennestack/sync-client` is framework-agnostic TypeScript: a local store behind a `SyncStorage`
interface (memory, IndexedDB in browsers, SQLite elsewhere), the clock with offset correction, the
pending queue with client sequences, optimistic application of generated `set` operations (and, in
M9, of custom offline commands whose `decide` a module exports for clients), rebase after every pull,
the rejected journal, typed local queries over the synced rows and a poke subscription that triggers
pulls. It talks to the server through the app's typed client (`AppClient`), so it works over any
transport that carries the `sync` actions.

### 15.4 Live updates

#### 15.4.1 What the module provides

The brief asks for live updates on everything, delivered by a module. `@pennestack/live` (module id
`live`) is that module. It fills these kernel extension points:

| Extension point | Filled with |
|---|---|
| `liveHub` (mode `single`; provides `contracts.live`) | the hub of section 9.6: reads the change feed, authorizes and masks per event, issues stream tokens |
| `liveCarriers` | the SSE carrier and the WebSocket carrier (`pennestack.live.v1`) |
| `entityActionGenerators` | the core's `watch` template, added to every entity that is not `external` and whose `generated` settings do not switch it off; typed `EntityChange<Row>` per entity (section 4.7) |
| `principalResolvers` | the stream-ticket resolver (section 15.4.6) |

and declares two module actions: `live.pokes` (subscription) and `live.ticket` (command). The hub
also serves the stream records and ephemeral topics of G6 (whose DSL, `defineStream`
and `defineTopic`, belongs to the core) and, from milestone M9, presence. Modules that build their
own subscription sources list the `live` contract in `requires` (or `optional`, which types
`ctx.live` as possibly undefined, or as a `when` condition of a conditional part), exactly like any
other dependency (section 5.2).

Without the live module there are no subscriptions anywhere: `watch` does not exist in the types,
and `invoker.subscribe` on a custom subscription fails with `not_implemented` (code
`core.live_unavailable`). "Live updates on everything" is therefore one line in the app's tuple.

#### 15.4.2 Sources

| Source | Declared as | Emits | Resumable |
|---|---|---|---|
| entity changes | the generated `watch` of every entity (`history: 'state'` entities included, through transient change records, section 15.1.10); `ctx.live.entity(...)` inside custom sources | `EntityChange<Row>` | yes |
| live query | `watch` with a `filter`: the same source, plus `removed` items when a row leaves the filter or the principal's view | `EntityChange<Row>` | yes |
| pokes | `live.pokes` | `Poke`: the new state token of each readable entity type that moved, for clients that pull (section 15.2.5) | yes |
| command receipts | the generated `watch` of the core's command receipt entity | receipt states until a terminal state | yes |
| stream records | `ctx.live.stream(module, stream, { key, from })` in a subscription's source (G6, deployment logs) | the stream's records | yes, by the per-key serial |
| topics | `ctx.live.topic(module, topic, { key })` (G6, container logs) | the topic's records; never stored | no; a `gap` frame marks dropped records |
| custom | a subscription action's `source(input, ctx, resume)` | the action's declared item | when built on `ctx.live` (with `mapItems` to change items); not when it wraps a plain iterable with `unresumable` (section 7.3) |

The data layer's own sync protocol (`sync.register`, `sync.push`, `sync.pull`, `sync.poke` and
`sync.crdt`, section 15.3.6) consists of ordinary actions of the `sync` module and travels over every
transport like any other; section 15.4.8 says which carrier suits which.

```ts
export type EntityChange<Row> =
  | { readonly type: 'created' | 'changed' | 'restored'; readonly id: string; readonly version: number; readonly cause?: string; readonly row: Readable<Row> }
  | { readonly type: 'archived'; readonly id: string; readonly version: number; readonly cause?: string; readonly row?: Readable<Row> }
  | { readonly type: 'removed'; readonly id: string; readonly reason: 'left-view' | 'purged' | 'erased' }   // no data; reasons as the sync protocol's RowChange

/** Input of the generated `watch` (wire names follow the generated `query`: `filter`). */
export interface WatchInput<F> {
  readonly ids?: readonly string[]
  readonly filter?: F
  readonly fields?: readonly string[]
  readonly includeArchived?: boolean
  readonly from?: 'now' | 'beginning'                    // 'beginning' first emits the current rows, then `head`, then follows (section 15.2.5)
  readonly partition?: string                            // partitioned entities (section 15.1.4)
}

/** Item of `live.pokes` (section 15.2.5): the new token per entity type the principal may read. */
export interface Poke {
  readonly upto: StateToken                              // the position after the batch
  readonly changed: Readonly<Record<string, StateToken>> // entity ref -> its new state token
  readonly partition?: string
}
```

`cause` names the domain event behind a change (`deactivated`) without its data, which may contain
fields the subscriber cannot read. A client upserts on `created`, `changed` and `restored`, and drops
the row on `removed` (and on `archived` unless it asked for archived rows).

Two client patterns are gap-free: `watch` with `from: 'beginning'`, which emits the current rows,
then a `head` frame, then changes; or `query` (or `get`) followed by `watch` with `after` set to the
`queryState` (or `state`) it returned. Section 15.2.6 guarantees the second: `get` and `query` read the
head as the first statement of their unit, so their state is a valid `after` for `watch` and
`changes`, and one token form serves JMAP states, live resumption and sync cursors.

#### 15.4.3 Authorization per event

1. At subscribe time the pipeline runs up to the gate for the subscription action. The generated
   `watch` is governed by the same rules as the entity's reads: the `read` alias covers it, so a rule
   that allows reading also allows watching unless a deny rule names `watch` (section 8.1).
2. For each batch from the change feed, the hub loads the post-images of the changed rows once per
   scope (with the kernel's authority) and groups the subscriptions by resolved plan. Each distinct
   plan (`never`, `always` or a conditional `where`) is evaluated once per batch: field operators
   in memory, with the interpreter of section 8.3 that the dual-evaluation suite covers, and
   relation quantifiers with one `rows.matching` query per distinct plan and batch (section
   14.3.4). Each subscription's own filter is then applied in memory. Relation-based rules, the
   common case, therefore cost one query per distinct plan and batch, not one per subscriber; the
   cost is measured on the proof apps.
3. Visibility is tracked per subscription. While a stream is connected, its set of delivered ids
   decides exactly: a delivered row the subscriber can no longer see produces `removed`, a row that
   becomes visible produces `changed` with the row, a row it never could see is never mentioned. The
   set is bounded (10,000 ids by default); past the bound, and for the range replayed after a resume,
   the disclosure rule decides (section 15.2.6), and when the evidence is insufficient the stream
   sends `reset` with reason `resync` instead of guessing.
4. Field masks are applied per row, with `$masked` as in section 16.4.5.
5. Permissions are always the current ones: a resumed stream replays history under the
   principal's permissions at replay time, never under those it had when the events happened.
6. The session is revalidated as section 16.3.4 describes; a revoked session ends the stream with
   `unauthenticated`.
7. Stream records are authorized through the stream's `readAs` entity (G6): the
   subscriber must be allowed to `get` the keyed row at subscribe time and at every revalidation.
   Topics are authorized the same way through their key.

#### 15.4.4 Stream tokens and resume

- A stream token is the core's `StateToken` in the form `v1.<epoch>.<position>.<scope>.<check>`:
  the namespace epoch, a commit-ordered position in the namespace's event log, a hash of the
  namespace and scope, and a check over the rule set, the principal, its roles and memberships, the
  entity type, the partition and the selector (section 15.1.4 and 15.2.6). Positions follow commit order
  without gaps, so no high-water heuristics are needed. Stream records resume by their per-key
  serial instead.
- Every item of a resumable source carries the token of its position. A client resumes with
  `after` (SSE: `Last-Event-ID`, which browsers send automatically; GraphQL: the `after` argument;
  tRPC: `lastEventId`; WebSocket: `after` in `subscribe`).
- A token that cannot be parsed is a `validation` error, and so is a token of another scope (code
  `core.token_scope_mismatch`). A token whose epoch or check does not match (another namespace
  generation, principal, role set, rule set or selector) produces `reset` with reason `resync`; a
  token older than the entity type's retention horizon produces `reset` with reason `expired`. In
  both cases the client queries again under its current visibility.

#### 15.4.5 Delivery guarantees, ordering and backpressure

- Items of one subscription are ordered by log position within its scope. Delivery is at least
  once across reconnects; clients drop duplicates by `(id, version)` or by token order. Exactly-once
  delivery is not promised.
- Each subscription has a bounded buffer (1,000 items or 1 MiB). When a slow client fills it, the
  hub drops the buffer and sends `reset` with reason `overflow` and the last delivered token; the
  client catches up with `changes` from that token and subscribes again. Topics, which cannot be
  replayed, drop records instead and send a `gap` frame. Memory never grows with a slow client.
- A resumed stream, or one that starts from the beginning, sends a `head` frame once it has caught
  up with the head of the log, so a client (or the CLI without `--follow`) knows that everything up
  to now has arrived.
- Heartbeats: an SSE comment line every 15 seconds; a WebSocket ping every 30 seconds, and the
  connection is closed when no pong arrives within 10 seconds.
- A stream lasts at most 24 hours, then ends with reason `max_duration`; the client reconnects with
  its token, which also moves long-lived connections onto new processes after a deploy.
- On shutdown, streams end with reason `going_away` (SSE `end` frame, WebSocket close 1001).

#### 15.4.6 The SSE carrier

Used by the invocation protocol (`/_pennestack/v1/subscribe`) and by REST subscription paths.

```
retry: 3000

id: <stream token>
event: data
data: {"type":"changed","id":"prof_01j9...","version":12,"row":{"id":"prof_01j9...","displayName":"Jens","version":12}}

event: head
data: {"state":"<stream token>"}

event: reset
data: {"reason":"overflow","state":"<stream token>"}

event: gap
data: {"missed":12}

event: error
data: {"kind":"forbidden","code":"core.forbidden","message":"...","retryable":false,"requestId":"..."}

event: end
data: {"reason":"going_away"}

: ping
```

- `GET` with query parameters serves browsers' `EventSource`; `POST` with a JSON body serves fetch
  based clients and long inputs. Responses are `text/event-stream` with `Cache-Control: no-cache`.
- A browser `EventSource` cannot send an `Authorization` header. Cookies work; otherwise the client
  first calls `live.ticket` (authenticated) and gets `{ ticket, expiresAt }`: an opaque value, single
  use, valid for 60 seconds, bound to the session's scope and principal and optionally to one action
  reference. The live module's principal resolver accepts `?ticket=` on SSE endpoints only, so
  long-lived credentials never appear in URLs or access logs.
- One SSE stream carries one subscription. Clients with many subscriptions use the WebSocket
  carrier or HTTP/2, which removes the per-host connection limit of HTTP/1.1.

#### 15.4.7 The WebSocket carrier

Endpoint `GET /_pennestack/v1/live`, subprotocol `pennestack.live.v1`, JSON text frames:

```ts
export type ClientMessage =
  | { readonly type: 'hello'; readonly token?: string; readonly backend?: string; readonly tenant?: string; readonly traceparent?: string }
  | { readonly type: 'subscribe'; readonly id: string; readonly action: string; readonly input?: unknown; readonly after?: string }
  | { readonly type: 'unsubscribe'; readonly id: string }
  | { readonly type: 'invoke'; readonly id: string; readonly request: InvokeRequest }
  | { readonly type: 'presence'; readonly channel: string; readonly state: unknown }     // M9
  | { readonly type: 'ping' }

export type ServerMessage =
  | { readonly type: 'welcome'; readonly principal: { readonly kind: string; readonly id: string | null }; readonly heartbeatMs: number }
  | { readonly type: 'data'; readonly id: string; readonly state?: string; readonly item: unknown }
  | { readonly type: 'head'; readonly id: string; readonly state: string }
  | { readonly type: 'reset'; readonly id: string; readonly reason: 'overflow' | 'expired' | 'resync'; readonly state?: string }
  | { readonly type: 'gap'; readonly id: string; readonly missed?: number }
  | { readonly type: 'presence'; readonly channel: string; readonly peers: readonly PresencePeer[] }
  | { readonly type: 'result'; readonly id: string; readonly response: InvokeResponse }
  | { readonly type: 'error'; readonly id?: string; readonly error: WireError }
  | { readonly type: 'end'; readonly id: string; readonly reason: 'complete' | 'going_away' | 'max_duration' }
  | { readonly type: 'pong' }

export interface PresencePeer {
  readonly peer: string                                  // a connection-scoped id
  readonly principal: { readonly kind: string; readonly id: string | null }
  readonly state: unknown
  readonly updatedAt: string
}
```

- The upgrade request is checked like a cookie-authenticated state-changing request, because
  browsers send cookies with WebSocket upgrades and WebSockets are not subject to CORS: its
  `Origin` (or `Sec-Fetch-Site: same-origin`) must match an allowed origin of the tenant, otherwise
  the host refuses the upgrade with `forbidden` and code `core.csrf` (section 16.4.10). The same
  check applies to cookie-authenticated SSE requests.
- The first frame must be `hello` within 10 seconds. Credentials come from `hello.token` or from the
  upgrade request's cookie or `Authorization` header; they open the connection's session.
- One connection multiplexes up to 100 subscriptions. `invoke` carries commands on the same
  connection, so collaborative clients (rich-text edits, flushes of an offline queue) do not open a
  request per edit; results are the invocation protocol's responses.
- Close codes: 1000 normal, 1001 going away, 1011 internal, 1013 try again later, 4000 protocol
  violation, and the 44xx codes of section 16.4.6 for errors that end the connection.
- Presence (milestone M9) is ephemeral and never stored: a client joins a channel named by
  a row and a field (`mail-store.email:<id>:body`) only if it may `get` that row, publishes small
  states (a cursor, a selection), and receives the peers of the channel within its own scope.
  States expire 30 seconds after their last update. Across processes, presence and topics travel
  through a broadcast capability of the data adapter (PostgreSQL `NOTIFY` with payloads below its
  8,000-byte limit); without it they reach only subscribers on the same process (section 21).
- The same carrier with `subscribe` and `invoke` on one connection is what Launchway's agent
  protocol v2 needs (section 17.3.4): the agent holds `nodes.channel` and calls its actions with
  the typed client, without oRPC.
- The same carrier hosts JMAP's WebSocket subprotocol (RFC 8887) when the mail platform adds it.

#### 15.4.8 Subscriptions per transport

| Transport | Carrier | Resume | Credentials |
|---|---|---|---|
| invocation protocol | SSE `/_pennestack/v1/subscribe`; WebSocket `pennestack.live.v1` | `Last-Event-ID` or `after` | header, cookie, ticket; `hello.token` |
| REST | SSE on the subscription's own path | `Last-Event-ID` | header, cookie, ticket |
| GraphQL | GraphQL over SSE (Yoga); graphql-ws 6.3.0 | `after` argument, `state` field | header, cookie; `connectionParams` |
| tRPC | `httpSubscriptionLink` (SSE); `wsLink` when enabled | `tracked()` ids as `lastEventId` | cookie, header through an `EventSource` ponyfill; `connectionParams` over WebSocket |
| CLI | invocation protocol SSE | automatic, from the last token | profile credential |

The `sync` actions of section 15.3.6 map like any others: `sync.register`, `sync.push`, `sync.pull`
and `sync.crdt` are commands and queries that every transport carries (REST `POST /sync/push`, a
GraphQL mutation, a tRPC procedure, the invocation protocol); `sync.poke` is a subscription over SSE
or WebSocket. A client that types into a collaborative field pushes its batched updates every 250
milliseconds through `invoke` on the WebSocket carrier, which avoids a request per batch; a push of
100 mutations with CRDT updates can exceed the default body limit, so the `sync` module's backends
raise `maxBodyBytes` for that action's transports.

#### 15.4.9 Fan-out across processes

- Each serving process keeps one reader per scope with local subscribers (section 15.2.5), outside
  consumer leases. A reader wakes on the adapter's wake-ups (PostgreSQL `NOTIFY` from the notifier
  after commit, coalesced per namespace, with polling every second as the fallback; polling on
  MySQL and SQLite), reads the log after its position up to the head, and fans out in memory by
  selector, evaluating each distinct plan once per batch. Positions are commit-ordered (section 15.1.4), so a reader never skips a late commit. A
  batch's post-images are loaded once and shared by every local subscription; a subscriber that
  resumes from an older token catches up with its own scoped reads and then joins the shared reader.
- No sticky sessions are needed: a reconnect to another process resumes from the client's token.
- Pokes are computed from the same batches without loading rows.
- Topic hooks (`onFirstSubscriber`, `onLastSubscriberLeft`, G6) must fire on the
  deployment-wide subscriber count, not per process, or two processes would both start a container
  log tail. The hub keeps a lease per (topic key, process) in the control store, renewed while it
  has local subscribers, and fires `onLastSubscriberLeft` five seconds after the last lease ends, so
  a reconnect does not flap the producer.

#### 15.4.10 Limits and tenancy

- A subscription is bound to the scope of its session; the change feed is filtered by scope in the
  data layer; tokens are bound to the principal and the selector (section 15.2.6), so a token presented
  by anyone else resynchronises instead of disclosing.
- Admission runs in the pipeline's `admit` stage at subscribe time: concurrent subscriptions per
  tenant (default 1,000), connections per principal (20) and subscriptions per WebSocket (100).
  Subscription and connection limits are counted deployment-wide through leases in the control
  store, with per-process counters for the fast path (section 12.2); defaults are per backend with
  per-tenant overrides.

#### 15.4.11 Interfaces

```ts
/** Fills the kernel's `liveHub` extension point; implements section 9.6. */
export interface LiveHub {
  entity<Row>(session: InvocationSession, entity: string, input: WatchInput<unknown>, resume?: StateToken): AsyncIterable<LiveFrame<EntityChange<Row>>>
  pokes(session: InvocationSession, resume?: StateToken): AsyncIterable<LiveFrame<Poke>>
  stream<R>(session: InvocationSession, stream: string, key: unknown, options: { readonly from: 'start' | 'now' }, resume?: string): AsyncIterable<LiveFrame<R>>
  topic<R>(session: InvocationSession, topic: string, key: unknown): AsyncIterable<LiveFrame<R>>
}

/** What a subscription yields, and what `Invoker.subscribe` returns: items and control frames. */
export type LiveFrame<E> = Emitted<E> | StreamControl                                 // Emitted<E> is { event, state? }

export type StreamControl =
  | { readonly control: 'head'; readonly state: StateToken }
  | { readonly control: 'reset'; readonly reason: 'overflow' | 'expired' | 'resync'; readonly state?: StateToken }
  | { readonly control: 'gap'; readonly missed?: number }

/** Fills `liveCarriers`: frames one stream on one connection; owns heartbeats, backpressure and close semantics. */
export interface LiveCarrier {
  readonly name: 'sse' | 'websocket' | (string & {})
  serve(stream: AsyncIterable<LiveFrame<unknown>>, connection: CarrierConnection, options: CarrierOptions): Promise<void>
}

export interface CarrierOptions {
  readonly heartbeatMs: number
  readonly maxBufferedItems: number
  readonly maxBufferedBytes: number
  readonly maxDurationMs: number
}

/** `ctx.live` for modules that require the `live` contract (or list it as optional, then possibly undefined).
 *  Module-local like ctx.data: the entities are the module's own and its dependencies'. In-process names follow ctx.data: `where`. */
export interface LiveQueries<M extends AnyModule> {
  entity<R extends EntityRefsVisibleTo<M>>(
    module: ModuleOf<R>, entity: EntityOf<R>,
    options?: { readonly where?: Where<ModuleRow<M, R>>; readonly ids?: readonly string[]; readonly fields?: readonly string[]; readonly includeArchived?: boolean; readonly from?: 'now' | 'beginning'; readonly after?: StateToken },
  ): AsyncIterable<LiveFrame<EntityChange<ModuleRow<M, R>>>>
  stream<S extends StreamRefsVisibleTo<M>>(module: ModuleOf<S>, stream: StreamOf<S>, options: { readonly key: StreamKeyOf<M, S>; readonly from: 'start' | 'now'; readonly after?: string }): AsyncIterable<LiveFrame<StreamRecordOf<M, S>>>
  topic<T extends TopicRefsVisibleTo<M>>(module: ModuleOf<T>, topic: TopicOf<T>, options: { readonly key: TopicKeyOf<M, T> }): AsyncIterable<LiveFrame<TopicRecordOf<M, T>>>
}

/** Maps items and keeps stream tokens and control frames, so a custom subscription stays resumable. */
export declare function mapItems<A, B>(frames: AsyncIterable<LiveFrame<A>>, fn: (item: A) => B | undefined): AsyncIterable<LiveFrame<B>>   // undefined drops the item
/** Declares a source that cannot resume; the surface then reports `resumable: false`. */
export declare function unresumable<E>(items: AsyncIterable<E>): AsyncIterable<LiveFrame<E>>
```

## 16. Transports and CLI

This section specifies how pennestack is reached from outside its process: the API surface every
interface reads, the transport adapter contract and the HTTP host, the rules every projection
shares, REST with OpenAPI, GraphQL, tRPC, the invocation protocol and the typed client, the
`pennestack` CLI, how a later user interface plugs in, and the observability and tenancy of the
interface layer. The live module is section 15.4; the development workflow is section 13. ADRs
[0010](adr/0010-transports-project-a-derived-api-surface.md),
[0011](adr/0011-rest-graphql-and-trpc-projections.md),
[0012](adr/0012-live-updates-over-the-event-log.md) and
[0013](adr/0013-cli-and-development-workflow.md) record the decisions. Four claims were verified by
running the tools on 2026-10-10 and 2026-10-11 (Appendix B): a tRPC router type and a typed client
can be derived from an action tree without code generation (TypeScript 7.0.2, `@trpc/server`
11.19.0); `isolatedDeclarations` rejects the inferred exports of the configuration DSL; Vitest 5.0.3
type tests run on TypeScript 7.0.2; and Node 24.21.0 runs a linked workspace package from its
TypeScript source through an export condition but refuses the same files inside `node_modules`.

### 16.1 Principles

1. **Transports are projections.** A transport maps its wire format onto invoker calls and maps
   outcomes back. It never contains behaviour, never evaluates a policy, never touches the data
   layer and never resolves a tenant or a principal itself (principle 4 of section 1).
2. **One derived description.** Every transport, the CLI, introspection and every generated
   document read the same serialisable description of an app, the API surface (section 16.2).
   Nothing in the interface layer reads module internals or the registry directly.
3. **Names are functions.** Every wire name (GraphQL type and field, REST path, tRPC path, CLI
   route, OpenAPI operation id) is a pure function of an entity or action reference. Hints may
   rename; a collision is a named build error, never a silent rename.
4. **One meaning everywhere.** Errors, pagination, filters, field masks, execution preference,
   idempotency and optimistic concurrency mean the same thing in every transport; section 16.4 holds
   the projection tables, and a conformance suite proves them (section 16.3.8).
5. **Artefacts are deterministic and committed.** Generated documents are pure functions of the
   surface and of static transport options. They are committed and checked for drift in CI;
   production never generates anything.
6. **Types without a generator in the type path.** TypeScript clients get their types by inference
   from the app value (`AppClient<App>`, `TrpcRouterOf<App>`). The one generated TypeScript file only
   re-exports those types.
7. **The framework does not know its clients.** A user interface, a script or an SDK generator is a
   client of a transport and of the surface. No framework package names a frontend framework.
8. **Fail closed at the edge.** An unknown host, an unresolvable tenant, a stale stream token, a
   name collision or an unsupported filter is an error with a stable code, never a fallback.

### 16.2 The API surface

#### 16.2.1 Why a derived description

Transports need a description of the app that is complete (every reachable action with its input,
output, declared errors, execution mode and pagination), serialisable (the CLI and user interfaces
fetch it, CI diffs it), deterministic (artefacts must be byte-stable) and free of runtime objects
(handlers, validators, closures). The registry is none of these. The core therefore derives an
`ApiSurface` per app during `compose`, and every interface reads it. The registry stays the source;
the surface is a projection the core owns, so no transport depends on registry internals and a
change to the registry's internal shape does not ripple into transports.

#### 16.2.2 Shape

```ts
/** One app's public interface. Derived by the core during `compose`; serialisable, deterministic, order-independent. */
export interface ApiSurface {
  readonly format: 'pennestack.surface/1'
  readonly app: string                                   // the app id, e.g. 'launchway'
  readonly hash: string                                  // 'sha256-' + base64url of SHA-256 over the RFC 8785 form, without `hash`
  readonly modules: readonly SurfaceModule[]             // sorted by id
  readonly entities: readonly SurfaceEntity[]            // sorted by ref
  readonly actions: readonly SurfaceAction[]             // sorted by ref
  readonly errors: readonly SurfaceError[]               // sorted by code; includes the core codes of section 16.4.6
  readonly events: readonly SurfaceEvent[]               // sorted by entity ref, then name
}

export interface SurfaceModule {
  readonly id: string
  readonly version: string
  readonly description?: string
}

export interface SurfaceEntity {
  readonly ref: string                                   // 'accounts.profile'
  readonly module: string
  readonly name: string
  readonly prefix: string                                // TypeID prefix; unique within the app
  readonly history: 'chain' | 'state' | 'projection' | 'external'   // section 6.6; the last two are read-only through actions
  readonly tenancy: 'tenant' | 'backend' | 'deployment'
  readonly fields: Readonly<Record<string, FieldNode>>   // system fields included; tenantId and hidden fields never
  readonly relations: Readonly<Record<string, SurfaceRelation>>
  readonly generated: readonly string[]                  // switched on: get, query, changes, queryChanges, create, update, archive, restore, set, watch, history
  readonly page: PageSpec                                // pagination of the generated `query`
  readonly origin: Readonly<Record<string, string>>      // contributed field or relation name -> contributing module id
  readonly description?: string
}

export interface SurfaceRelation {
  readonly kind: 'one' | 'many' | 'through' | 'derived'
  readonly target: string                                // entity ref
  readonly by?: string                                   // the field on the other side, for 'many'
  readonly description?: string
}

export interface SurfaceAction {
  readonly ref: string                                   // 'accounts.profile.deactivate'
  readonly module: string                                // the namespace the action is mounted in
  readonly entity?: string
  readonly name: string
  readonly mount: 'entity' | 'module' | 'app'
  readonly kind: 'query' | 'command' | 'subscription'
  readonly generated?: string                            // 'get' | 'query' | 'changes' | 'queryChanges' | 'create' | 'update' | 'archive' | 'restore' | 'set' | 'watch' | 'history'
  readonly instance: boolean                             // entity commands: the input carries `id` and an optional `ifVersion`
  readonly input: FieldNode                              // kind 'shape', 'foreign' or 'void'
  readonly output: FieldNode                             // for subscriptions: one emitted item
  readonly errors: readonly string[]                     // declared error codes, sorted
  readonly auth: 'policy' | 'public'
  readonly scope: 'tenant' | 'backend' | 'deployment'
  readonly execution: 'sync' | 'async' | 'either'        // effective, after defineApp({ execution }); queries are 'sync'
  readonly idempotent: boolean
  readonly offline: boolean
  readonly resumable: boolean                            // derived from the source's type (section 7.3): built on ctx.live, or not
  readonly page?: PageSpec
  readonly timeoutMs?: number
  readonly hints: TransportHints
  readonly contributedBy?: string                        // module id when mounted by a contribution or a conditional part
  readonly description?: string
  readonly deprecated?: { readonly reason: string }
}

export interface SurfaceError {
  readonly code: string                                  // 'accounts.email_taken', 'core.version_mismatch'
  readonly kind: ErrorKind                               // section 10
  readonly message: string
  readonly retryable: boolean
  readonly data?: FieldNode
}

export interface SurfaceEvent {
  readonly entity: string
  readonly name: string                                  // 'created', 'changed', 'archived', 'restored', 'erased' or a domain event
  readonly generated: boolean
  readonly data?: FieldNode                              // domain events only
}

export interface PageSpec {
  readonly sortable: readonly string[]
  readonly defaultSort: readonly { readonly field: string; readonly direction: 'asc' | 'desc' }[]
  readonly defaultSize: number
  readonly maxSize: number
}
```

`TransportHints` (section 7.3) is defined by the core with the shapes of the first-party
transports and an open member for later ones, so that no transport package needs declaration
merging:

```ts
export interface TransportHints {
  readonly rest?: { readonly path?: string; readonly collection?: string; readonly expose?: boolean }
  readonly graphql?: { readonly field?: string; readonly type?: string; readonly expose?: boolean }
  readonly trpc?: { readonly path?: string; readonly expose?: boolean }
  readonly cli?: { readonly route?: readonly string[]; readonly aliases?: readonly string[]; readonly positional?: readonly string[]; readonly login?: { readonly tokenField: string } }
  readonly http?: { readonly cookie?: CookieHint; readonly response?: ResponseHint }   // every HTTP transport, sections 16.4.10 and 16.5.8
  readonly [transport: string]: unknown                  // later transports: typed through a helper exported by their package
}
export interface CookieHint {
  readonly set?: { readonly name: string; readonly from: string; readonly expiresFrom?: string }
  readonly clear?: { readonly name: string }
  readonly omitFromBody?: readonly string[]
}
export type ResponseHint =
  | { readonly kind: 'json' }                                                        // the default
  | { readonly kind: 'raw'; readonly contentType: string; readonly from: string }    // a text output field as the body
  | { readonly kind: 'redirect'; readonly from: string; readonly status?: 302 | 303 | 307 }
  | { readonly kind: 'download'; readonly from: string }                             // a blob or binary output field, with ranges
  | { readonly kind: 'empty'; readonly status?: 202 | 204 }
```

A hint renames, hides an action from one transport (`expose: false`) or chooses how an output is
carried (a cookie, a raw body, a redirect, a download). It never changes behaviour, authorization or
validation.

#### 16.2.3 Field nodes

```ts
export interface FieldNodeBase {
  readonly optional: boolean
  readonly default?: unknown                             // in wire form
  readonly description?: string
  readonly access: 'read-write' | 'read' | 'write'       // system fields 'read'; field.secret() 'write'
  readonly maskable?: true                               // rules may hide it per row; optional in Readable<Row>
  readonly merge?: 'lww' | 'counter' | 'set' | 'sequence' | 'richText' | 'exclusive'
  readonly unique?: true
  readonly personal?: true
  readonly tag?: number
  readonly deprecated?: { readonly reason: string }
}

export type FieldNode = FieldNodeBase & (
  | { readonly kind: 'string' | 'text'; readonly minLength?: number; readonly maxLength?: number; readonly pattern?: string; readonly format?: 'email' | 'uri' | 'hostname' }
  | { readonly kind: 'integer'; readonly wide: boolean; readonly min?: number; readonly max?: number }
  | { readonly kind: 'decimal'; readonly min?: string; readonly max?: string }               // exact (section 4.2)
  | { readonly kind: 'serial'; readonly per: readonly string[] }                             // field.serial, read-only
  | { readonly kind: 'boolean' | 'float' | 'instant' | 'date' | 'timeZone' | 'subject' | 'richText' | 'binary' | 'blob' | 'secret' | 'void' }
  | { readonly kind: 'enum'; readonly values: readonly string[] }
  | { readonly kind: 'id' | 'ref'; readonly target: string; readonly prefix: string }        // 'id' is the entity's own id
  | { readonly kind: 'list' | 'set'; readonly item: FieldNode }
  | { readonly kind: 'shape'; readonly fields: Readonly<Record<string, FieldNode>> }
  | { readonly kind: 'json'; readonly schema: JsonSchema }                                   // field.json(schema)
  | { readonly kind: 'page'; readonly item: FieldNode }                                      // e.page()
  | { readonly kind: 'foreign'; readonly input: JsonSchema; readonly output: JsonSchema }    // a free-form Standard Schema
)
```

`JsonSchema` is a JSON Schema draft 2020-12 document. For `json` and `foreign` nodes the core
obtains it through Standard JSON Schema (`~standard.jsonSchema.input()` and `.output()` with target
`draft-2020-12`); a schema that cannot produce one is a `compose` error, because no transport
could describe it.

`richText` fields and lists with the `sequence` merge type travel in the wire forms of section
14.5.4. On read, rich text is a `RichTextValue` `{ codec, text, delta, version }`: `text` is the
plain text, `delta` the text with marks as a list of `{ insert, attributes? }` runs (for `loro/1`,
Loro's delta form), and `version` the encoded version vector in base64url; a sequence reads as the
list itself. On write they are either a whole value, which the server turns into operations, or
`{ crdt: { codec, update } }` with a base64url update; clients fetch incremental updates with
`sync.crdt`. Verifier fields and hidden fields never appear in the surface.

How each kind is projected (the wire column is the JSON encoding every HTTP transport uses,
section 16.4.2):

| Kind | TypeScript | Wire JSON | JSON Schema | GraphQL | CLI flag |
|---|---|---|---|---|---|
| `string`, `text` | `string` | string | `type: string` with constraints | `String` | `--name <text>`; `text` also `@file` |
| `integer` | `number` | number | `type: integer` | `Int` when `min` and `max` fit 32 bits, otherwise `SafeInt` | integer parser |
| `integer` (wide) | `bigint` | decimal string | `type: string`, pattern `^-?[0-9]+$` | `BigInt` | `BigInt()` parser |
| `decimal` | `string` (section 4.2) | canonical decimal string | `type: string`, decimal pattern | `Decimal` | decimal parser |
| `float` | `number` | number | `type: number` | `Float` | number parser |
| `serial` | `number` | number | `type: integer`, `readOnly` | `SafeInt` | not an input |
| `boolean` | `boolean` | boolean | `type: boolean` | `Boolean` | `--name` and `--no-name` |
| `instant` | `Date` | RFC 3339 string in UTC with `Z` | `format: date-time` | `Instant` | RFC 3339 or `now` |
| `date` | `string` | `YYYY-MM-DD` | `format: date` | `LocalDate` | `YYYY-MM-DD` |
| `timeZone` | `string` | IANA zone name | `type: string` | `TimeZone` | checked against `Intl.supportedValuesOf('timeZone')` |
| `enum` | union of literals | string | `enum` | enum type, e.g. `AuthCredentialKind` | enumerated flag with completion |
| `id`, `ref` | `Id<'module.entity'>` | TypeID string | `type: string`, pattern from the prefix | `ID` | TypeID with prefix check |
| `list`, `set` | `readonly T[]`, `ReadonlySet<T>` | array (`set`: unique items) | `type: array` (`uniqueItems` for `set`) | `[T!]` | repeatable flag |
| `shape` | object | object | `type: object` | object type or input type | dotted flags to depth 2, else `--input` |
| `json` | the schema's output type | JSON value | the schema's JSON Schema | object and input types for the convertible subset, else `JSON` | `--name-json <json\|@file>` |
| `richText` | document handle | read: `{ codec, text, delta, version }`; write: a whole value or `{ crdt: { codec, update } }` (section 14.5.4) | object schema | `RichText` (a JSON scalar) | `@file` only |
| `binary` | `Uint8Array` | base64url string | `contentEncoding: base64url` | `Base64URL` | `@file` |
| `secret` | `string`, write only | string | `writeOnly: true` | input fields only | prompt, or `--name-stdin` |
| `foreign` | the schema's output type | JSON value | the schema's own JSON Schema | convertible subset, else `JSON` | `--input` (flags when it is an object of scalars) |
| `page` | `Page<T>` | `{ items, pageInfo, total?, queryState? }` | object | connection type | table output |

#### 16.2.4 Derivation rules

- The surface contains everything that is active in the app: own parts, active contributions and
  conditional parts, generated entity actions that are switched on, system fields, and the
  effective execution mode after `defineApp({ execution })`.
- It never contains `tenantId`, fields marked `.hidden()`, verifier fields, handlers, validators or
  policies.
  Policies belong to the composition report (section 16.2.6).
- Access: system fields (`id`, `createdAt`, `updatedAt`, `archivedAt`, `version`) are `read`;
  `field.secret()` fields are `write`; every other field is `read-write`. Field masks still apply
  at runtime; access only says what a transport may ever show or accept.
- It is order-independent: arrays are sorted by reference, code or name, and objects are serialised
  with sorted keys (RFC 8785, JSON Canonicalization Scheme). Two apps with the same modules in a
  different tuple order have the same surface and the same hash, as principle 6 requires.
- It depends only on the app. Backend and tenant configuration never change it; a feature a backend
  switches off at runtime stays in the surface and fails at runtime with its own error.

#### 16.2.5 Introspection

The surface is available in three places, all with the same content:

- the core action `core.introspect` (query, backend scope); its default rule allows any
  non-anonymous principal, and a backend setting makes it public or operator-only;
- `GET /_pennestack/v1/surface` on the invocation protocol (section 16.8), with the hash as `ETag`, so
  the CLI revalidates its cache with `If-None-Match`;
- the committed artefact `generated/api-surface/<app>.json` (section 13.7).

#### 16.2.6 The composition report

`core.composition` (query, backend scope, operator only) returns what the surface leaves
out: modules with their `requires` and `optional` lists, active and dropped contributions with the
reason a contribution was dropped (target absent, `when` unsatisfied), conditional parts,
extension points and their fillers, and the effective policy rules (ids, effects, reasons,
conditions rendered by `ability.explain`). `pennestack introspect` and support work use it;
transports never do.

### 16.3 The transport adapter contract

#### 16.3.1 Responsibilities

| A transport adapter does | A transport adapter never does |
|---|---|
| derive names and wire shapes from the surface | import a module's handlers or services |
| report what it cannot project (`check`) | evaluate a policy or a field mask |
| emit deterministic artefacts (`artifacts`) | read or write the data layer |
| parse its wire format into an invocation and serialise the outcome | resolve a tenant or a principal |
| fill the carrier fields its protocol knows (headers, connection parameters) | retry a command under a new command id |
| map the error taxonomy with the table of section 16.4.6 | invent an error kind or reuse an error code |
| frame subscriptions with the carriers of section 15.4 | buffer a stream without a bound |

#### 16.3.2 The contract

An adapter is a name, capabilities, a pure `artifacts` function and a `mount` function. It reads
the surface instead of the registry, has a pure `check`, and separates static options (which shape
artefacts) from per-backend configuration (which only shapes runtime behaviour):

```ts
import type { ApiSurface, Carrier, Invoker, InvocationSession, Logger, Scope, Telemetry } from '@pennestack/core'

export interface TransportAdapter<Static = unknown, Config = unknown> {
  readonly name: string                                  // 'rest', 'graphql', 'trpc', 'cli', 'webhooks', later 'jmap', 'connect'
  readonly capabilities: TransportCapabilities
  readonly static: Static                                // fixed when the module value is built
  /** Pure. What this transport cannot project, as named problems; any problem fails `generate` and boot. */
  check(surface: ApiSurface): readonly TransportProblem[]
  /** Pure: the same surface and static options give byte-identical artefacts. No I/O, no clock, no randomness. */
  artifacts(surface: ApiSurface): readonly Artifact[]
  /** Runs once per app at `listen`; registers routes on the host and returns a handle for shutdown. */
  mount(ctx: MountContext<Config>): Promise<MountHandle>
}

export interface TransportCapabilities {
  readonly streaming: readonly ('sse' | 'websocket')[]
  readonly batching: boolean                             // several invocations per request (GraphQL documents, tRPC batches)
  readonly binary: boolean                               // carries binary fields without base64
}

export interface TransportProblem {
  readonly code: 'nameCollision' | 'reservedName' | 'routeConflict' | 'unsupportedShape' | (string & {})
  readonly transport: string
  readonly subject: string                               // the entity or action reference
  readonly message: string                               // names the hint that resolves it
}

export type Artifact =
  | { readonly kind: 'file'; readonly path: string; readonly contentType: string; readonly content: string }
  | { readonly kind: 'type-fragment'; readonly content: string }   // merged into pennestack.generated.ts (section 13.7)

export interface MountContext<Config> {
  readonly app: string
  readonly surface: ApiSurface
  readonly invoker: Invoker
  readonly host: TransportHost
  readonly config: (scope: Scope) => Config              // per-backend (and per-tenant) values of the module's `config`
  readonly telemetry: Telemetry
  readonly log: Logger
}

export interface MountHandle {
  /** Stops accepting, ends streams with a going-away signal, resolves when in-flight work is done or the deadline aborts. */
  close(deadline: AbortSignal): Promise<void>
}
```

A transport module is built with the core's sugar (section 5.6). Static options make a new
module value with the same id, so an app still lists exactly one `rest` module:

```ts
import { contracts, defineTransportModule, field, shape } from '@pennestack/core'

export const restTransport = (options: RestStaticOptions = {}) =>
  defineTransportModule({
    id: 'rest',
    requires: [contracts.httpHost],                       // every HTTP transport needs the deployment's host (section 16.3.3)
    config: shape({
      cors: field.list(field.string()).default([]),       // extra allowed origins beside the tenant's domains
      docs: field.boolean().default(false),               // the API reference page outside development
      maxBodyBytes: field.integer({ min: 1024 }).default(1_048_576),
    }),
    transport: createRestAdapter({ basePath: '/api', openapi: '3.1', ...options }),
  })

export const rest = restTransport()                      // what `modules: [..., rest]` lists
```

#### 16.3.3 The HTTP host

`@pennestack/transport-http` is an infrastructure entry of the deployment: it fills the
deployment-level `httpHost` extension point (mode `single`) and provides `contracts.httpHost`,
which every HTTP transport module requires (section 5.6). It is the only package that listens on
HTTP, and it serves the invocation protocol (section 16.8) for every app of the catalogue, so the
CLI reaches every backend whether or not its app selects any ecosystem transport. It uses Hono
4.13.13 for routing, `@hono/node-server` 2.1.4 for the Node server and `ws` 8.22.0 for WebSocket
upgrades. The contract it offers transports is web-standard
(`Request`, `Response`), so Hono stays an implementation detail of the host and of the transports
that choose to use it internally.

```ts
export interface TransportHost {
  /** An HTTP handler for one app under a path prefix; prefixes of one app must not overlap. */
  route(spec: { readonly app: string; readonly transport: string; readonly prefix: string }, handler: HttpHandler): void
  /** A WebSocket endpoint for one app, selected by path and subprotocol. */
  upgrade(spec: { readonly app: string; readonly transport: string; readonly path: string; readonly protocols: readonly string[] }, handler: WebSocketHandler): void
}

export type HttpHandler = (request: Request, ctx: HttpContext) => Promise<Response>

export interface HttpContext {
  readonly session: InvocationSession                    // scope and principal, resolved once for this request (section 16.3.4)
  readonly carrier: Carrier                              // as filled by the host, transport 'http'; credentials included, for resolvers only
  readonly requestId: string                             // UUIDv7, echoed as `x-request-id`
  readonly traceparent?: string
  readonly signal: AbortSignal                           // aborts when the client disconnects
  readonly basePath: string                              // after any tenant path prefix consumed by scope resolution
}

export interface WebSocketHandler {
  /** The upgrade request's session may be anonymous; protocols with first-message credentials open a new session. */
  open(socket: WebSocketLike, ctx: HttpContext): void
}
```

Requests are dispatched in two levels, because the app (and with it the GraphQL schema, the REST
routes and the tRPC router) is only known once the scope is resolved:

```
socket ─▶ node:http ─▶ host dispatcher
            1. fill the Carrier: host, path, headers, connection (remote and local address, TLS), local socket
            2. deployment routes: /_pennestack/health, /_pennestack/ready ─▶ answered here
            3. carrier enrichers (receiver paths, section 16.5.8) set carrier.scopeKey
            4. invoker.open(carrier) ─▶ session { scope, app, principal } | error ─▶ problem response
            5. take the mount table of session.app; strip a tenant path prefix the resolver consumed
            6. longest-prefix match ─▶ transport handler(request, ctx)
                                          └─▶ invoker.invoke({ action, input, carrier, session, ... }) ─▶ wire
```

Rules for the host:

- HTTP transport modules require `contracts.httpHost`, a deployment-level contract, so
  `defineDeployment` rejects a catalogue with an HTTP transport and no host
  (`missingInfrastructure: 'httpHost'`). The deployment runs one host instance, configured where it
  is listed (`httpHost({ listen })`), shared by every app.
- Mounts are per app, not per backend: `mount` runs once for each app in the deployment catalogue
  that selects the transport, and every backend of that app shares the mount. The session tells the
  transport which backend and tenant a request belongs to.
- Deployment-scope requests (the operator socket and the operator host names) are served by the
  operator endpoint: the implicit `core` composition with the invocation protocol always mounted,
  and further transports only if `defineDeployment` lists them (section 4.6).
- The prefix `/_pennestack` is reserved for the framework on every host name. The default prefixes
  are `/api` (REST), `/graphql`, `/trpc` and `/_pennestack/v1` (invocation protocol); a user
  interface may take `/` (section 16.10). Overlapping prefixes within one app are a `routeConflict`.
- The host listens on the TCP ports and Unix sockets it is configured with and on the operator
  socket of `defineDeployment({ operator })`. A request that arrives on the operator socket gets
  `carrier.local = { socket }`, which only the core's operator resolver accepts (section 3.5).
- Cross-cutting HTTP behaviour lives in the host, not in transports: request ids, W3C trace
  context, body size limits, CORS (allowed origins are the tenant's domains plus the transport's
  `cors` setting), the origin checks of section 16.4.10 (state-changing cookie requests, WebSocket
  upgrades and cookie-authenticated SSE), security headers, compression of non-streaming responses,
  and graceful shutdown.
- A tenant whose scope comes from the host name and a request whose carrier also names a scope key
  (a receiver path, a credential's public id) must agree; a mismatch is `not_found`, so a path can
  never steer a request into another tenant of the same host.
- `GET /_pennestack/health` answers when the process runs; `GET /_pennestack/ready` answers when
  the control store, the placements the process serves and the queue are reachable. Both are
  deployment-level and unauthenticated, for orchestrators; per-backend health remains the
  `app.health` and `app.ready` actions (section 11).

#### 16.3.4 Sessions: scope and principal resolved once

A GraphQL document fans out into many invocations, and a WebSocket connection carries many
subscriptions; resolving the scope and the principal again for each would cost a principal lookup
per field batch, and the host needs the scope before it can pick the app's mounts. The invoker
therefore has `open`, and `Invocation` carries the resulting session (section 9.2):

```ts
export interface Invoker {
  /** Runs resolveScope and resolvePrincipal once for a transport request or a long-lived connection. */
  open(carrier: Carrier, options?: { readonly signal?: AbortSignal }): Promise<Outcome<InvocationSession>>
  invoke<I, O>(inv: Invocation<I>): Promise<Outcome<O>>
  /** Items and control frames (head, reset, gap; section 15.4.11). */
  subscribe<I, E>(inv: Invocation<I>, resume?: { readonly after: StateToken }): AsyncIterable<LiveFrame<E>>
}

export interface InvocationSession {
  readonly scope: Scope
  readonly app: string                                   // the app of the resolved backend; 'core' at deployment level
  readonly principal: Principal                          // kind 'anonymous' when no credentials were presented
  readonly expiresAt?: Date                              // when the presented credentials stop being valid
  /** Runs resolvePrincipal again from the retained carrier; used by long-lived connections. */
  revalidate(): Promise<Outcome<InvocationSession>>
}

// `Invocation.session` (section 9.2): when present, resolveScope and resolvePrincipal reuse it
```

Rules:

- Only the invoker creates sessions. It keeps them in a private `WeakSet` and treats a foreign
  object as an `internal` error, so a transport cannot forge a scope or a principal.
- No credentials give an anonymous principal; the gate then rejects non-public actions with
  `unauthenticated`. A bearer token or API key that is present but invalid fails `open` with
  `unauthenticated`, even when the request targets a public action, so a broken token never
  downgrades silently. A session cookie that is unknown, expired or revoked counts as absent: the
  request continues as anonymous (public actions such as `auth.login` work), and the response
  clears the cookie (`Set-Cookie` with `Max-Age=0`), so a browser is never locked out of the login
  page by a stale cookie (section 16.4.10).
- A session lives for one HTTP request. For SSE streams and WebSocket connections it lives as long
  as the connection, and the live module revalidates it at `expiresAt`, at least every 60 seconds
  (configurable), and on revocation events of the session's credential, membership or tenant (the
  principal resolver names the events it depends on). A failed revalidation ends the stream with
  `unauthenticated`.
- Listeners use a bound form of the same session (G1, `BoundSession` with `invoke` and
  `subscribe`), a convenience over `Invocation.session` with identical semantics.
- Principal enrichment (roles, memberships) happens once per session; the plan memo of
  section 8.5 stays per invocation.

#### 16.3.5 Static options and per-backend configuration

- **Static options** are passed when the module value is built (`restTransport({ basePath })`). They
  may change names, paths, document versions and serialisation, so they shape artefacts and must
  be the same for every backend of the app.
- **Configuration** is the module's `config` shape (section 5.7): stored per backend,
  overridable per tenant, read at request time through `ctx.config(session.scope)`. It may only
  change runtime behaviour: limits, CORS origins, whether introspection and documentation pages
  are served. It never changes a name or a document.

#### 16.3.6 Lifecycle

| Phase (section 3.3) | Interface layer |
|---|---|
| `compose` | the core derives the surface of every app |
| `setup` | every selected transport's `check` runs against its app's surface; any problem fails boot with the transport's named problems |
| `listen` | the host builds one mount table per app: each selected transport's `mount` runs once per app, in transport-name order; the host then opens its sockets and reports ready |
| `stop` | the host stops accepting connections; each `MountHandle.close` ends SSE streams with an `end` frame (reason `going_away`) and closes WebSockets with code 1001; in-flight requests drain until the deadline |

#### 16.3.7 Non-HTTP listeners

Listeners that do not speak HTTP (SMTP and IMAP for the mail platform) contribute to the kernel's
`listeners` extension point, not to `transports`; gap G1 (section 17.7) proposes their contract
(`ListenerSpec`, `ListenerKit`, ports owned by the deployment, `Carrier.connection`, `Carrier.sasl`,
`Carrier.scopeKey`). They follow the rules of this document: they fill a carrier with what their
protocol knows (for SMTP the connection, the TLS state and the recipient domain as a scope key),
open a session per connection, per authentication or per recipient, invoke actions, and map
outcomes with the error table of section 16.4.6 translated to their protocol's reply codes. A
platform-specific WebSocket protocol, such as Launchway's agent gateway (protocol v1), is a
transport module like any other: it registers an upgrade endpoint on the host, opens a session from
the upgrade request and maps its messages onto actions.

#### 16.3.8 Conformance suite

`@pennestack/testing` ships a transport conformance suite: a fixture app (two modules with a
contribution and a conditional part, declared errors, a field mask, an `either` command, an async
command, a subscription and every generated entity action) and one scenario set run through every
selected transport. Each scenario asserts the same decoded outcome everywhere: values, error kind
and code, pagination traversal, masked fields, async receipts, idempotent replay, concurrent
duplicates (`core.command_in_progress`), optimistic concurrency failures and stream resumption.
Browser scenarios run against the HTTP host: a cross-site page that tries to open the live
WebSocket or an SSE stream with the user's cookie, a sibling subdomain that plants a `Domain`
cookie, a request whose path names a scope key of another tenant on the same host, and a stale
cookie on the login action. Every transport package runs it in its tests; CI runs it for REST,
GraphQL, tRPC and the invocation protocol.

### 16.4 Shared projection rules

#### 16.4.1 Naming

Name derivation uses the identifier grammar of section 5.1: module ids
`[a-z][a-z0-9]*(-[a-z][a-z0-9]*)*`; entity, action, field, relation and event names
`[a-z][a-zA-Z0-9]*`; error codes `<module>.<snake_case>`. Four pure functions build every wire name:

- `camel(ref)`: the segments of a reference joined in lower camel case, with kebab module ids
  camel-cased: `api-keys.key.revoke` becomes `apiKeysKeyRevoke`.
- `pascal(ref)`: the same in upper camel case: `accounts.profile` becomes `AccountsProfile`.
- `kebab(name)`: lower camel case to kebab case on word boundaries: `resetPassword` becomes
  `reset-password`.
- `plural(name)`: applied to the last word of a name, frozen as part of the naming contract: a word
  ending in `s`, `x`, `z`, `ch` or `sh` takes `es` (`mailbox`, `mailboxes`); a consonant followed by
  `y` becomes `ies` (`policy`, `policies`); every other word takes `s` (`profile`, `profiles`;
  `key`, `keys`). Irregular nouns use the `rest.collection` hint.

| Item | Reference | REST | GraphQL | tRPC path | CLI route |
|---|---|---|---|---|---|
| entity type | `accounts.profile` | collection `/accounts/profiles` | type `AccountsProfile` | n/a | `accounts profile` |
| generated `get` | `accounts.profile.get` | `GET /accounts/profiles/{id}`, `POST /accounts/profiles/get` | `accountsProfile(id)`, `accountsProfileGet(ids)` | `accounts.profile.get` | `accounts profile get <id>...` |
| generated `query` | `accounts.profile.query` | `GET /accounts/profiles`, `POST /accounts/profiles/query` | `accountsProfiles(...)` | `accounts.profile.query` | `accounts profile list` |
| generated `changes` | `accounts.profile.changes` | `GET /accounts/profiles/changes` | `accountsProfileChanges(...)` | `accounts.profile.changes` | `accounts profile changes` |
| generated `queryChanges` | `accounts.profile.queryChanges` | `POST /accounts/profiles/query-changes` | `accountsProfileQueryChanges(...)` | `accounts.profile.queryChanges` | `accounts profile query-changes` |
| generated `set` | `accounts.profile.set` | `POST /accounts/profiles`, `PATCH` and `DELETE /accounts/profiles/{id}`, `POST /accounts/profiles/{id}/restore`, `POST /accounts/profiles/set` | `accountsProfileCreate`, `...Update`, `...Archive`, `...Restore`, `accountsProfileSet` | `accounts.profile.set` | `accounts profile create`, `update`, `archive`, `restore`, `set` |
| generated `watch` | `accounts.profile.watch` | `GET /accounts/profiles/watch` (SSE) | subscription `accountsProfileWatch` | `accounts.profile.watch` | `accounts profile watch` |
| generated `history` (off by default) | `accounts.profile.history` | `GET /accounts/profiles/{id}/history` | `accountsProfileHistory(id)` | `accounts.profile.history` | `accounts profile history <id>` |
| entity command | `accounts.profile.deactivate` | `POST /accounts/profiles/{id}/deactivate` | `accountsProfileDeactivate(input)` | `accounts.profile.deactivate` | `accounts profile deactivate <id>` |
| entity query | `accounts.profile.search` | `GET /accounts/profiles/search` | `accountsProfileSearch(...)` | `accounts.profile.search` | `accounts profile search` |
| module command | `accounts.register` | `POST /accounts/register` | `accountsRegister(input)` | `accounts.register` | `accounts register` |
| module query | `accounts.identities` | `GET /accounts/identities` | `accountsIdentities(...)` | `accounts.identities` | `accounts identities` |
| subscription | `auth.sessionEvents` | `GET /auth/session-events` (SSE) | subscription `authSessionEvents` | `auth.sessionEvents` | `auth session-events` |
| app action | `app.health` | `GET /app/health` | `health` | `app.health` | `app health` |
| kebab module id | `api-keys.key.revoke` | `POST /api-keys/keys/{id}/revoke` | `apiKeysKeyRevoke(input)` | `apiKeys.key.revoke` | `api-keys key revoke <id>` |

OpenAPI operation ids are `camel(ref)`; the per-operation endpoints of `set` use the entity's
`camel` name with `Create`, `Update`, `Archive` and `Restore`, as GraphQL does
(`accountsProfileCreate`). Error type names are `pascal(code)` plus `Error`: `accounts.email_taken`
becomes `AccountsEmailTakenError`. The CLI renames the generated `query` to `list` by default, a
documented naming choice like any hint.

Collisions are found by `check`, never resolved silently. Example: a module action
`accounts.profileSearch` and an entity query `accounts.profile.search` both become
`accountsProfileSearch` in GraphQL; `check` reports `nameCollision` for both references and names
the `graphql.field` hint as the fix. In REST, a module action whose kebab name equals one of the
module's collection names is a `routeConflict`. Hints are written next to the action:

```ts
search: e.query({
  input: shape({ text: field.string({ maxLength: 80 }) }),
  output: e.page(),
  hints: { graphql: { field: 'searchProfiles' }, cli: { aliases: ['find'] } },
  handle: (input, ctx) => ctx.data.accounts.profile.query({ where: { displayName: { contains: input.text } } }),
}),
```

#### 16.4.2 Wire encoding of values

Every HTTP transport encodes values with the wire column of section 16.2.3. Further rules:

- Absent optional fields are omitted in REST, tRPC and invocation-protocol bodies; GraphQL returns
  `null` for them, since it has no absent value.
- `null` on input means "clear this optional field" in an update patch, and "is absent" as a bare
  value in a filter (the shorthand for `isNull: true`, normalised at the boundary, section 16.4.4).
  Anywhere else it is a `validation` error. Conditions written in code have no such shorthand: there
  a `null` comparison never matches (section 8.3).
- The pipeline's `validate` stage accepts the wire form or the in-process form and produces the
  in-process form (an RFC 3339 string or a `Date` for an instant; a decimal string or a `bigint` for a
  wide integer), so transports pass decoded JSON straight to the invoker. Outputs are serialised
  with `toWire(node, value)` from `@pennestack/core/wire`, a dependency-free subpath that clients
  share (section 6.5).
- Patches use the core's patch object: scalar fields are replaced or cleared with `null`;
  merge-typed fields take the operations of section 14.5.4 (for example `{ "tags": { "add": ["x"] } }`
  for a `set` field). For scalar fields the patch object is compatible with JSON Merge Patch
  (RFC 7396), and REST accepts `application/merge-patch+json` as an alias.

#### 16.4.3 Pagination

The core's model (section 3.1 and 6.7): cursor pagination with `first`/`after` and
`last`/`before`, results `{ items, pageInfo: { hasNextPage, hasPreviousPage, startCursor, endCursor },
total?, queryState? }`, `total` opt-in.

| Transport | Arguments | Result |
|---|---|---|
| REST | query parameters `first`, `after`, `last`, `before`, `total` (or the same members in a `POST .../query` body) | the core page object, plus a `Link` header (RFC 8288) with `rel="next"` and `rel="prev"` |
| GraphQL | Relay arguments `first`, `after`, `last`, `before` | `<Type>Connection { edges { cursor node } nodes pageInfo totalCount queryState }`; selecting `totalCount` sets `total: true` |
| tRPC, invocation protocol | the same members in the input | the core page object |
| CLI | `--first`, `--after`, `--all` (follows pages) | a table, then the cursor to continue |

Cursors are opaque base64url strings produced by the data layer, bound to the sort order and the
filter they were issued for; using one with another sort or filter is a `validation` error with
code `core.cursor_mismatch`. A page size above `maxSize` is a `validation` error, not a silent cap.
Positional paging (`position`, `anchor`, `anchorOffset`) is offered only to transports that request
it in their surface options, today `transport-jmap` (sections 6.7 and 14.3.5).

#### 16.4.4 Filtering and sorting

The filter on the wire is the condition object form of section 8.3, so every transport sends what
a policy author writes and the core normalises it to the AST. One difference is deliberate: on the
wire a bare `null` means "is absent", and the `validate` stage rewrites it to `isNull: true` before
the AST exists, while in code a `null` comparison never matches:

```ts
type Filter<Row, Rels> =
  & { readonly [K in keyof Row]?: Row[K] | null | FieldOps<Row[K]> }       // a bare value means eq; null means isNull
  & { readonly [R in keyof Rels]?: RelationOps<Rels[R]> }
  & { readonly and?: readonly Filter<Row, Rels>[]; readonly or?: readonly Filter<Row, Rels>[]; readonly not?: Filter<Row, Rels> }

interface FieldOps<T> {
  readonly eq?: T; readonly ne?: T | null; readonly lt?: T; readonly lte?: T; readonly gt?: T; readonly gte?: T
  readonly in?: readonly T[]; readonly nin?: readonly T[]; readonly startsWith?: string; readonly isNull?: boolean
  readonly contains?: T extends readonly (infer I)[] | ReadonlySet<infer I> ? I : string   // membership for lists and sets (section 14.3.4)
}
interface RelationOps<Target> { readonly some?: Target; readonly none?: Target; readonly every?: Target; readonly is?: Target }
```

| Transport | Filter | Sort |
|---|---|---|
| REST | `filter` query parameter holding JSON (described in OpenAPI as a parameter with `content: application/json`), or `filter` in the `POST .../query` body | `sort=displayName,-createdAt` (a leading `-` means descending), or `sort` as an array in the body |
| GraphQL | `filter: <Type>Filter` input with `and`, `or`, `not`, one operator input per field (`StringFilter`, `InstantFilter`, `IdFilter`, enum filters) and `some`, `none`, `every`, `is` per relation | `sort: [<Type>Sort!]` with `field: <Type>SortField!` and `direction: SortDirection!` |
| tRPC, invocation protocol | the object form | `[{ field, direction }]` |
| CLI | `--filter <json\|@file>`, plus `--where field=value` for equality on scalar fields | `--sort displayName,-createdAt` |

Rules, all enforced in the pipeline rather than in transports: `and`, `or` and `not` are reserved
names (no field or relation may use them, section 5.1); a filter or sort on a field the principal's
mask hides is `forbidden`; an operator the placement's adapter cannot express is `unsupported`;
only fields in `page.sortable` sort, and the data layer appends `id` as the final tie-breaker.

#### 16.4.5 Field selection and masks

- `get` and `query` take an optional `fields` list (REST `fields=displayName,email`, the GraphQL
  selection set, a `fields` array in tRPC and the invocation protocol, `--fields` in the CLI). It
  limits what is returned; `id` and `version` are always included.
- A field the principal's plan masks for a row is omitted from that row (REST, tRPC, invocation
  protocol) or `null` (GraphQL). The row also lists the masked names, so a client can tell "hidden
  from you" from "not set": a `$masked` member in JSON bodies and a `_masked: [String!]!` field on
  every GraphQL entity type. Both names lie outside the identifier grammar, so they never collide
  with a field. The member is present only when something is masked.
- TypeScript clients type reads as `Readable<Row>`: the fields declared `.maskable()` are
  optional, every other field keeps its declared type, because only maskable fields can appear in
  read rules and runtime rule sources (section 8.1).

#### 16.4.6 Errors

The closed taxonomy of section 10, projected:

| Kind | REST status | GraphQL `extensions.code` | tRPC code | Invocation protocol | CLI exit | WebSocket close |
|---|---|---|---|---|---|---|
| `validation` | 422; 400 for malformed syntax (code `core.malformed_request`); 413 for `core.payload_too_large` | `BAD_USER_INPUT` | `BAD_REQUEST` | as REST | 3 | 4400 |
| `unauthenticated` | 401 with `WWW-Authenticate` | `UNAUTHENTICATED` | `UNAUTHORIZED` | 401 | 4 | 4401 |
| `forbidden` | 403 | `FORBIDDEN` | `FORBIDDEN` | 403 | 5 | 4403 |
| `not_found` | 404 | `NOT_FOUND` | `NOT_FOUND` | 404 | 6 | 4404 |
| `conflict` | 409; 412 for failed preconditions (`core.version_mismatch`, `core.state_mismatch`); 422 for `core.idempotency_mismatch` | `CONFLICT` | `CONFLICT`; `PRECONDITION_FAILED` for failed preconditions | as REST | 7 | 4409 |
| `rate_limited` | 429 with `Retry-After` (none for `core.quota_exceeded`) | `RATE_LIMITED` | `TOO_MANY_REQUESTS` | 429 | 8 | 4429 |
| `not_implemented` | 501 | `NOT_IMPLEMENTED` | `NOT_IMPLEMENTED` | 501 | 9 | 4501 |
| `unavailable` | 503, with `Retry-After` when known | `UNAVAILABLE` | `SERVICE_UNAVAILABLE` | 503 | 10 | 1013 |
| `unsupported` | 422 | `UNSUPPORTED` | `UNPROCESSABLE_CONTENT` | 422 | 11 | 4422 |
| `internal` | 500 | `INTERNAL_SERVER_ERROR` | `INTERNAL_SERVER_ERROR` | 500 | 1 | 1011 |

CLI usage errors (unknown command, unparsable flag) exit with 2, and an interrupted command with
130. Each transport follows its ecosystem's conventions for the outer code (tRPC reports input
validation as `BAD_REQUEST`); the error object inside is the same everywhere:

```ts
export interface WireError {
  readonly kind: ErrorKind
  readonly code: string                                  // stable, module-prefixed: 'accounts.email_taken'
  readonly message: string                               // for `internal`, the taxonomy title outside development
  readonly retryable: boolean
  readonly retryAfter?: number                           // seconds; rate_limited and unavailable
  readonly issues?: readonly { readonly path: readonly (string | number)[]; readonly message: string }[]
  readonly details?: unknown                             // typed by the declared error's data schema
  readonly reason?: string                               // forbidden: the deciding deny rule's reason
  readonly rules?: readonly { readonly id: string; readonly effect: 'allow' | 'deny' }[]   // audience-dependent
  readonly requestId: string
}
```

Which members an audience sees is decided once, by the core's `toWire(error, audience)`
(section 10), never by a transport: operator principals and development get `rules` and unredacted
`internal` messages; everyone else gets the code, the kind, the message and the deny reason.
Error codes are part of the public contract; `pennestack introspect diff` (section 13.8) fails when
a code disappears and reappears with another meaning.

#### 16.4.7 Execution preference, receipts and waiting

The effective execution mode is in the surface. For `either`, the caller's preference travels as
REST `Prefer: respond-async` (RFC 7240), the GraphQL argument `prefer: ASYNC`, the tRPC operation
context (`{ context: { prefer: 'async' } }`, sent as a header by the pennestack link helpers), the
`prefer` member of the invocation protocol, or the CLI flag `--async`.

An asynchronous answer is the core's receipt `{ commandId, status: 'accepted' }`: REST answers 202
with `Location` pointing at the receipt's `get` endpoint and `Preference-Applied: respond-async`;
GraphQL returns the `CommandAccepted` member of the result union; tRPC and the invocation protocol
return the receipt as the value. A caller that wants to wait sends `Prefer: respond-async, wait=10`
(REST, at most 60 seconds) or `--wait` (CLI): the transport follows the receipt through the live
module's receipt source and answers with the result when the command completes in time, otherwise
with the receipt. Without the live module, `wait` is ignored and not listed in
`Preference-Applied`.

#### 16.4.8 Idempotency

Every command carries a command id (section 7.5): REST `Idempotency-Key`, a `commandId`
argument in GraphQL inputs, a header set from the tRPC operation context, the `commandId` member of
the invocation protocol, `--command-id` in the CLI. A transport generates a UUIDv7 when the client
sends none and returns it (REST `Pennestack-Command-Id`). A replay returns the recorded outcome
(REST adds `Idempotent-Replayed: true`); the same id with a different input is `conflict` with code
`core.idempotency_mismatch`; a duplicate that arrives while the first is still running is
`conflict` with code `core.command_in_progress`, retryable after one second. Client-chosen keys are
accepted as opaque strings (section 7.5).

#### 16.4.9 Optimistic concurrency

Instance commands (every entity-mounted command, including `set` updates, archives and restores)
accept an optional expected row version, `ifVersion` (section 6.7). REST maps it from
`If-Match: "<version>"` and returns `ETag: "<version>"` on every single-row response; `If-None-Match`
on a single-row `GET` answers 304 when the version is unchanged. GraphQL inputs carry `ifVersion`,
tRPC and the invocation protocol carry it in the input, the CLI takes `--if-version`. The batch `set`
keeps JMAP's collection-level `ifInState`. A mismatch is `conflict` with code `core.version_mismatch`
or `core.state_mismatch` (REST 412).

#### 16.4.10 Authentication context

Transports never resolve principals; they fill the carrier, and the core's resolvers turn it into
a principal (section 8.5).

| Source | What is filled | Used by |
|---|---|---|
| HTTP request | host, path, headers (including `authorization` and `cookie`), `connection` with the remote address (from forwarding headers of trusted proxies only), the local address and the TLS state | REST, GraphQL, tRPC, invocation protocol, SSE |
| Webhook receiver | the HTTP fields, plus the receiver id and the scope key set by the deployment's carrier enricher for the receiver's path (section 16.5.8) | `transport-webhooks` |
| WebSocket upgrade | the HTTP fields of the upgrade request; then first-message credentials (`hello.token` in `pennestack.live.v1`, `connectionParams` in graphql-ws and tRPC), which open a new session for the connection | GraphQL over graphql-ws, tRPC over WebSocket, live WebSocket |
| Stream ticket | the `ticket` query parameter, resolved by the live module's resolver (section 15.4.6) | browser `EventSource` |
| Operator socket | `local: { socket }` | CLI against a running deployment |
| In process | `local: { inProcess: true }` | CLI in project mode, tests |

`carrier.transport` always holds the stable transport name (`rest`, `graphql`, `trpc`, `cli`,
`webhooks`, a listener id), so rules over transports (G13) and the receipt's request
metadata (transport, remote address and user agent, G12) read one value. Handlers never see the
raw carrier: `ctx.request` carries the transport, connection metadata, request id and user agent,
while credentials (the `Authorization` and `Cookie` headers, tokens, SASL secrets) stay with the
principal resolvers (section 7.6).

Browser sessions need cookies, and a transport cannot know which action logs in. The `http.cookie`
hint lets an action's output set or clear an HttpOnly cookie while the authentication module keeps
all the knowledge:

```ts
login: b.command({
  input: shape({ identifier: field.string({ format: 'email' }), password: field.secret() }),
  output: shape({ sessionToken: field.string(), sessionId: field.ref.own('session'), expiresAt: field.instant() }),
  auth: { public: true },
  hints: {
    http: { cookie: { set: { name: '__Host-pennestack_session', from: 'sessionToken', expiresFrom: 'expiresAt' }, omitFromBody: ['sessionToken'] } },
    cli: { login: { tokenField: 'sessionToken' } },
  },
  handle: async (input, ctx) => { /* section 17.2 */ },
}),
```

Cookie rules:

- Attributes are fixed: the `__Host-` prefix, `HttpOnly; Secure; SameSite=Lax; Path=/` and no
  `Domain`. The prefix makes browsers refuse a cookie of that name planted by a sibling subdomain
  with a `Domain` attribute, so a tenant app or a pull-request preview served on another subdomain
  of the same registrable domain cannot shadow the session cookie.
- Cookie authentication exists only under host-based tenant resolution. A `__Host-` cookie must
  have `Path=/`, so under path-based resolution every tenant on the host would share it and the
  origin check could not tell tenants apart; there the HTTP transports accept bearer tokens only,
  and the login action's cookie hint is ignored.
- Cookie-authenticated requests that can change state (every method except `GET` and `HEAD`, and
  every GraphQL mutation), every WebSocket upgrade (browsers send cookies with it, and WebSockets are
  not subject to CORS) and every cookie-authenticated SSE request must carry an `Origin` (or
  `Sec-Fetch-Site: same-origin`) that matches an allowed origin of the tenant; otherwise the host
  answers `forbidden` with code `core.csrf`. Bearer-token requests are not subject to this check.
- A cookie whose session is unknown, expired or revoked counts as absent: the request runs as
  anonymous and the response clears the cookie (section 16.3.4).
- `SameSite=Lax` does not protect against code on a sibling subdomain, which counts as same-site.
  Deployments that serve untrusted apps (Launchway's tenant projects and previews) serve them under
  a separate registrable domain (section 17.5.2); the transport conformance suite has cross-site and
  cross-tenant browser scenarios (section 16.3.8).

#### 16.4.11 Timeouts, cancellation and limits

- An invocation's signal carries the action's `timeoutMs`. A client disconnect aborts queries and
  subscriptions but never a running command: the command completes and records its outcome, and a
  retry with the same command id returns it. A command that exceeds its timeout is rolled back and
  reported as `unavailable` with code `core.timeout` (section 10).
- Request bodies are limited to 1 MiB by default (`maxBodyBytes` per transport); larger bodies are
  `validation` with code `core.payload_too_large`.
- Batch sizes are bounded: GraphQL by the operation limits of section 16.6.6, tRPC batches and
  invocation-protocol batches by 20 invocations.

### 16.5 REST and OpenAPI

`@pennestack/transport-rest` (module id `rest`) is pennestack's own projection on the shared host,
with its own OpenAPI emitter and RFC 9457 problem details. ADR 0011 records why no OpenAPI library
is used.

#### 16.5.1 Resource mapping

Paths are relative to the static `basePath` (default `/api`). `{m}` is the module id, `{c}` the
collection name `kebab(plural(entity))`, `{a}` `kebab(action)`.

| Action | Method and path | Success |
|---|---|---|
| generated `query` | `GET /{m}/{c}`; `POST /{m}/{c}/query` with the same members as a JSON body | 200, page object |
| generated `get` (one) | `GET /{m}/{c}/{id}` | 200 with `ETag`; 304 on a matching `If-None-Match` |
| generated `get` (several) | `POST /{m}/{c}/get` with `{ ids, fields? }` | 200, `{ list, notFound, state }` |
| generated `changes` | `GET /{m}/{c}/changes?since=<state>&max=<n>` | 200, `{ oldState, newState, hasMoreChanges, created, changed, archived }` (JMAP's `updated` and `destroyed` are names of `transport-jmap`) |
| generated `queryChanges` | `POST /{m}/{c}/query-changes` | 200, `{ oldQueryState, newQueryState, removed, added }` |
| generated `set`: create | `POST /{m}/{c}` | 201 with `Location` and `ETag` |
| generated `set`: update | `PATCH /{m}/{c}/{id}` (patch object; `If-Match` maps to `ifVersion`) | 200 with `ETag` |
| generated `set`: archive | `DELETE /{m}/{c}/{id}` | 200 with the archived row (nothing is deleted) |
| generated `set`: restore | `POST /{m}/{c}/{id}/restore` | 200 |
| generated `set`: batch | `POST /{m}/{c}/set` with `{ create, update, archive, restore, ifInState }` | 200, per-item results |
| generated `watch` | `GET /{m}/{c}/watch` with `Accept: text/event-stream` | 200, SSE (section 15.4.6) |
| generated `history` (off by default) | `GET /{m}/{c}/{id}/history` | 200, a page of history entries |
| entity command | `POST /{m}/{c}/{id}/{a}` | 200 with the output; 204 for a void output; 202 when asynchronous |
| entity query | `GET /{m}/{c}/{a}`; `POST /{m}/{c}/{a}` when the input is not query-string representable | 200 |
| module command | `POST /{m}/{a}` | 200, 204 or 202 |
| module query | `GET /{m}/{a}`, or `POST` as above | 200 |
| subscription | `GET /{m}/{a}` (module) or `GET /{m}/{c}/{a}` (entity) with `Accept: text/event-stream` | 200, SSE |
| app action | `GET` or `POST /app/{a}` | as above |
| core action | `/core/...`, by the same rules (backend-scope and tenant-scope core actions only) | as above |

Static segments never collide with an id, because every id is a TypeID with an underscore after its
prefix and no action name or collection name contains one. Generated action names (`get`, `query`,
`changes`, `query-changes`, `set`, `watch`, `history`) and the `restore` segment are reserved in every
entity's action namespace.

#### 16.5.2 Requests

- A query input is query-string representable when it is an object whose fields are scalars (string,
  number, boolean, enum, id, instant, date) or lists of scalars. Scalars become `name=value`, lists
  repeat the parameter, `filter` is JSON and `sort` uses the compact form. Any other query input is
  sent as a JSON body to `POST`, documented as safe and idempotent (`x-pennestack-safe: true`). With
  `openapi: '3.2'`, such queries are also emitted as `QUERY` operations (RFC 10008, published as a
  Proposed Standard in 2026), and the host accepts both methods.
- Command bodies are `application/json`. Instance commands take `id` from the path; every other
  member comes from the body.
- An id in a path must carry the entity's prefix; a wrong prefix is a `validation` error, not a
  `not_found`, so a client bug is distinguishable from a missing row.

#### 16.5.3 Responses

- Single rows are returned as the row object; pages as the core page object; void outputs as 204.
- Headers: `ETag` for single rows, `Location` for creates and receipts, `Link` for pages,
  `Pennestack-Command-Id` for commands, `Preference-Applied` when a preference was honoured,
  `Idempotent-Replayed` on replays, `Retry-After` on 429 and 503, `x-request-id` always, and
  `Content-Type: application/problem+json` for errors.

#### 16.5.4 Problem details

```json
{
  "type": "https://acme.example/api/problems/accounts.email_taken",
  "title": "Conflict",
  "status": 409,
  "detail": "This e-mail address is already in use.",
  "instance": "urn:uuid:01929b5e-7c3a-7f00-9a51-2f0a0c1b4d11",
  "kind": "conflict",
  "code": "accounts.email_taken",
  "retryable": false,
  "details": { "email": "jens@acme.example" },
  "requestId": "01929b5e-7c3a-7f00-9a51-2f0a0c1b4d11"
}
```

`type` is an absolute URI built from the request's origin and base path, as RFC 9457 recommends,
and it resolves: `GET {basePath}/problems/{code}` serves a page generated from the surface (kind,
message, data schema, the actions that declare it). Because the type URI differs per backend host,
clients identify a problem by the `code` extension member, which is stable everywhere. `title` is
the taxonomy title of the kind, `instance` the request id as a `urn:uuid`, and the other members are
the `WireError` of section 16.4.6.

#### 16.5.5 The OpenAPI document

- Version: OpenAPI 3.1.1 by default, which uses JSON Schema draft 2020-12 natively, so field nodes
  translate without loss. `openapi: '3.2'` emits 3.2.0 instead, adding `QUERY` operations,
  `itemSchema` for SSE responses and nested tags. 3.1 stays the default until the client generators
  the proof apps use read 3.2 (ADR 0011).
- `info.title` is the app id; `info.version` is the surface hash, so a document changes version
  exactly when the interface changes. `servers` is `[{ url: '/api' }]` in the committed file; the
  document served by a backend at `{basePath}/openapi.json` carries the absolute URL of the request
  host.
- One tag per module; in 3.2 one nested tag per entity under its module.
- `components.schemas` holds, per entity, the read schema (`AccountsProfile`), the create and patch
  schemas, the filter schema (recursive through `and`, `or` and `not`), and per action the input
  and output schemas; plus `Problem`, one schema per declared error (`AccountsEmailTakenProblem`,
  whose `code` is a constant), `PageInfo` and `CommandReceipt`.
- Every operation documents its declared errors as a `oneOf` over the declared problem schemas and
  `Problem`, with a discriminator on `code`, under the status of each error's kind; plus the
  taxonomy statuses every action can return.
- Security schemes come from the selected principal resolvers' descriptions (section 8.5): the
  document lists what is actually selected, and public actions get `security: [{}, ...]` (optional
  authentication).
- Commands document `Idempotency-Key`; instance commands document `If-Match` and the `ETag`
  response header; `either` commands document `Prefer` and the 202 receipt response; `async`
  commands document only the 202 response.
- SSE endpoints are `text/event-stream` responses: in 3.1 with a string schema and the extension
  `x-pennestack-item-schema` referencing the item schema; in 3.2 with `itemSchema`.
- Extensions on each operation: `x-pennestack-action` (the reference), `x-pennestack-execution`,
  `x-pennestack-scope`, `x-pennestack-contributed-by` where applicable.
- CI validates the emitted document against the OpenAPI schema with `@scalar/openapi-parser`
  0.29.12 in the REST package's tests.

#### 16.5.6 Reference page

In development, and outside it when the backend's `docs` setting is on, the REST mount serves an API
reference page at `{basePath}/docs` with `@scalar/hono-api-reference` 0.12.11, reading the
backend's `{basePath}/openapi.json`.

#### 16.5.7 What is generated when

| What | When | Where |
|---|---|---|
| OpenAPI document | `pennestack dev` on change, `pennestack generate` | `generated/openapi/<app>.json`, committed; `--check` in CI |
| route table and request decoders | at `listen`, from the surface | memory |
| served OpenAPI document | at `listen`, by the same `artifacts` function, with `servers` rewritten per request | memory |
| problem type pages | at `listen` | memory |

#### 16.5.8 Webhook receivers and non-JSON responses

Gap G8 (section 17.7) needs HTTP that is not JSON in and JSON out: GitHub webhooks need the raw body
for signature checks and a path that identifies the tenant; GitHub's manifest flow and later OpenID
Connect need redirects; MTA-STS policies are `text/plain`, autoconfig documents are XML and JMAP
downloads are byte streams with ranges.

**Receivers.** `@pennestack/transport-webhooks` (module id `webhooks`, `requires: [contracts.httpHost]`)
declares the extension point `receivers` (mode `set`), which modules fill through contributions, as
the `github` module does (section 17.3.9); the contribution is dropped when `webhooks` is not
selected.

```ts
export interface WebhookReceiver {
  readonly id: string                                    // 'github', unique per app
  readonly path: string                                  // '/hooks/github/:connectionId', relative to the host root
  readonly action: string                                // 'github.ingest'
  readonly principal: string                             // the service principal granted after verification: 'github.webhook'
  readonly verify: string                                // the principal resolver of the owning module that checks the request
  readonly scopeKey?: (request: ReceiverRequest) => ScopeKey        // G2, becomes carrier.scopeKey
  readonly commandId?: (request: ReceiverRequest) => string | null  // for example the delivery id header
  readonly input?: (request: ReceiverRequest) => unknown            // default { params, headers, rawBody }
  readonly maxBodyBytes?: number                                    // default 1 MiB
}

export interface ReceiverRequest {
  readonly params: Readonly<Record<string, string>>
  readonly headers: Headers
  readonly rawBody: Uint8Array                           // exactly the bytes received, for signature verification
}
```

- The functions are pure mappings from the request to carrier fields and input, so the transport
  still never touches data.
- Receiver path patterns are registered with the deployment as carrier enrichers (section 5.6). The
  host runs them before `open`, so the scope key from the path (`webhook-endpoint:github:<id>`) is
  on the carrier when scope resolution runs, on any host name; a path whose scope key disagrees with
  a tenant resolved from the host name is `not_found` (section 16.3.3).
- Verification comes before any principal: the receiver names a principal resolver of the owning
  module (`github.webhookSignature`), bound to that module's context like any behavioural extension
  value (section 5.5). It reads the connection's secret with `ctx.secrets.reveal`, checks the
  signature over the raw body in constant time, and only then resolves the receiver's service
  principal. Until it succeeds the request is anonymous, so an unsigned request from the internet
  reaches nothing that is not public. The action's rules must allow the service principal.
- The command id makes a replayed delivery return the recorded outcome. The response is the
  action's outcome: 202 for an asynchronous action (the usual choice, because senders expect a fast
  answer), 200 or 204 otherwise, problem details on errors. Receivers appear in the composition
  report, not in the OpenAPI document.

**Response kinds.** The `http.response` hint (section 16.2.2) lets REST carry an output as a raw body
(`raw`, for MTA-STS and autoconfig documents), a redirect (`redirect`), a download (`download`: a
blob or binary field streamed with `Content-Type`, `Content-Length`, `ETag` and `Range` support; blob
fields are G5) or an empty response. OpenAPI documents the content type of each.

**Absolute paths.** A `rest.path` hint that starts with `/` is relative to the host root rather than
the base path, so `GET /.well-known/mta-sts.txt` can be an action of the mail-domains module; the
host resolves the tenant from the `mta-sts.` host name like any other domain, and `check` reports an
overlap with another mount as `routeConflict`.

### 16.6 GraphQL

`@pennestack/transport-graphql` (module id `graphql`) builds a `GraphQLSchema` directly from the
surface with graphql 17.0.2 and serves it with graphql-yoga 5.24.4 at `/graphql`. Pothos is not
used: the schema is derived, not hand-written, so a builder whose value is static typing of
hand-written resolvers adds a dependency without adding safety (ADR 0011).

#### 16.6.1 Schema derivation

- Object types: one per entity (`AccountsProfile implements Node`), with the readable fields of the
  surface, `_masked`, to-one reference objects next to the id field (`profileId: ID` and
  `profile: AccountsProfile`), and one connection field per to-many relation. Contributed fields and
  relations appear because the surface contains them; removing `auth` removes
  `AccountsProfile.lastLoginAt` from the schema at the same moment it disappears from the types.
- Input types: `<Type>CreateInput`, `<Type>Patch`, `<Type>Filter`, `<Type>Sort`, and one
  `<Action>Input` per command.
- Enums: one per enum field (`AuthCredentialKind`), plus `SortDirection`, `ExecutionPreference`
  and `ArchivedFilter` (`EXCLUDE`, `INCLUDE`, `ONLY`).
- Scalars: `ID` for TypeIDs, `Instant` (`@specifiedBy(url: "https://www.rfc-editor.org/rfc/rfc3339")`),
  `LocalDate`, `TimeZone`, `SafeInt` (integers up to 2^53 − 1), `BigInt`, `Decimal` (exact decimal
  strings), `Base64URL`, `RichText`
  and `JSON` (`@specifiedBy(url: "https://www.rfc-editor.org/rfc/rfc8259")`). Free-form inputs whose
  JSON Schema is not an object, scalar, enum or array tree become `JSON`, which ADR 0011 accepts
  as the price of free-form schemas.
- Interfaces: `Node { id: ID! }` and `Error { code: String!, message: String! }`.
- Entity fields are nullable except `id` and `version`, because a mask may hide any other field
  per row; `_masked` tells which.
- The committed SDL is `printSchema(lexicographicSortSchema(schema))`, so it is stable whatever the
  order of modules or fields.

#### 16.6.2 Queries, relations and batching

- Generated queries: `accountsProfile(id: ID!): AccountsProfile` (null when absent or invisible),
  `accountsProfileGet(ids: [ID!]!): AccountsProfileGetResult!` (the faithful `{ list, notFound,
  state }`), `accountsProfiles(filter, sort, first, after, last, before, archived, fields):
  AccountsProfileConnection!`, `accountsProfileChanges(sinceState: String!, maxChanges: Int)` and
  `accountsProfileQueryChanges(...)`. Custom queries take their input fields as arguments, or a
  single `input: JSON` argument for a free-form input.
- `node(id: ID!): Node` and `nodes(ids: [ID!]!): [Node]!` resolve the entity from the TypeID prefix
  (prefixes are unique per app, section 5.1) and call its `get`.
- Every resolver that needs data calls the invoker under the request's session; there is no other
  data path. To-one references are batched per request with DataLoader 2.2.3: all
  `profile` lookups of one execution level become one `accounts.profile.get` invocation.
- To-many relations are connection fields resolved by one `query` invocation per parent with the
  relation condition added to the filter (`{ subject: parent.id }` for `credentials`). Their cost
  is bounded by the operation limits of section 16.6.6; a planned executor (Grafast 1.x) can batch
  them later without a schema change, because the schema is a standard `GraphQLSchema`.
- Authorization is the invoker's: an invisible row reads as `null` (from `get`) or is absent from a
  connection (from `query`), so existence never leaks through GraphQL.

#### 16.6.3 Mutations and result unions

- Every command is a mutation with a single `input` argument: `accountsRegister(input:
  AccountsRegisterInput!)`. Instance commands carry `id` and `ifVersion` in the input; every
  command input carries an optional `commandId`, and `either` commands an optional
  `prefer: ExecutionPreference`.
- Every command returns a union, so that declaring an error later is an additive change:
  `AccountsRegisterResult = AccountsRegisterSuccess | AccountsEmailTakenError`. `Success` wraps the
  output (`{ result: ... }`); each declared error is an object type implementing `Error` with its
  data fields; `async` and `either` commands add `CommandAccepted { commandId: ID!, status: String! }`.
- `set` is projected as `accountsProfileCreate`, `accountsProfileUpdate`, `accountsProfileArchive`,
  `accountsProfileRestore` and the faithful batch `accountsProfileSet`.

#### 16.6.4 Errors and masks

- Declared domain errors are union members (section 16.6.3). Every other outcome is a GraphQL error
  in `errors[]` with `extensions: { code, pennestack: WireError }`, using the codes of section 16.4.6.
- A masked field resolves to `null` without an error; `_masked` lists it. A field-level error
  appears only when the field's own invocation failed (a relation whose query was `forbidden` or
  `unsupported`).

#### 16.6.5 Subscriptions

- Subscription actions and generated `watch` actions are subscription fields:
  `accountsProfileWatch(ids, filter, fields, from, after): AccountsProfileWatchEvent!`,
  `authSessionEvents(after): AuthSessionEventsEvent!`. Each returns a union of the item type and the
  shared control types `StreamHead { state }`, `StreamReset { reason, state }` and
  `StreamGap { missed }`, so control frames reach GraphQL clients typed. Every item type has a
  `state: String` field (the stream token), and `after` resumes from one.
- Carriers: GraphQL over SSE as Yoga serves it on `/graphql` (the distinct-connections mode of the
  GraphQL-over-SSE protocol), and graphql-ws 6.3.0 (`graphql-transport-ws` subprotocol, through
  `graphql-ws/use/ws`) registered on the host's upgrade table when the backend enables WebSocket.
  Both read `invoker.subscribe` under the connection's session.

#### 16.6.6 Limits and production settings

- Operation limits, checked before execution: depth 12, aliases 30, tokens 5,000 and a cost limit
  of 1,000 (1 per field, 10 per connection page), configurable per backend. The first
  implementation uses the plugins of `@escape.tech/graphql-armor` 3.2.0 (max depth, max aliases,
  max tokens, cost limit, field-suggestion blocking outside development); if that package stops
  being maintained, the same limits are a few own validation rules.
- Introspection follows the backend's `introspection` setting of section 16.2.5. GraphiQL (built into
  Yoga) is served in development only.
- Persisted operations are optional for user interfaces in production, through
  `@graphql-yoga/plugin-persisted-operations` 3.24.4, with the manifest supplied by the client
  project.

#### 16.6.7 What is generated when

| What | When | Where |
|---|---|---|
| SDL | `pennestack dev` on change, `pennestack generate` | `generated/graphql/<app>.graphql`, committed; `--check` in CI |
| `GraphQLSchema` | at `listen`, from the surface; its printed form must equal the committed SDL (a warning in development, a failure in CI) | memory |
| client types | in client projects, from the committed SDL (gql.tada 1.11.4 or graphql-codegen) | the client's repository |

### 16.7 tRPC

`@pennestack/transport-trpc` (module id `trpc`) serves tRPC 11.19.0, which the brief requires, at
`/trpc` through tRPC's fetch adapter (`@trpc/server/adapters/fetch`) inside the host handler.

#### 16.7.1 Router at runtime

The router is built at `listen` from the surface: one nested router per module and entity, one
procedure per exposed action. Procedures do not validate: they pass the raw input to the invoker,
whose pipeline validates once.

```ts
import { initTRPC, tracked } from '@trpc/server'
import superjson from 'superjson'

const t = initTRPC.context<TrpcContext>().meta<{ ref: string }>().create({
  transformer: superjson,                                 // static option; 'json' turns it off
  errorFormatter: ({ shape, error }) => ({ ...shape, data: { ...shape.data, pennestack: wireErrorOf(error) } }),
  sse: { ping: { enabled: true, intervalMs: 15_000 }, maxDurationMs: 86_400_000 },
})

function procedureFor(action: SurfaceAction) {
  const base = t.procedure.meta({ ref: action.ref }).input((raw: unknown) => raw)
  switch (action.kind) {
    case 'query':
      return base.query(({ input, ctx, signal }) => unwrap(ctx.invoker.invoke(invocation(ctx, action, input, signal))))
    case 'command':
      return base.mutation(({ input, ctx }) => unwrap(ctx.invoker.invoke(invocation(ctx, action, input))))
    case 'subscription':
      return base.subscription(async function* ({ input, ctx, signal }) {
        const { lastEventId, ...rest } = input as { lastEventId?: string | null }
        let last = lastEventId ?? undefined
        for await (const frame of ctx.invoker.subscribe(invocation(ctx, action, rest, signal), last ? { after: last } : undefined)) {
          const data = 'control' in frame ? frame : frame.event
          if ('state' in frame && frame.state) last = frame.state
          yield action.resumable && last ? tracked(last, data) : data    // tracked('') throws, so untracked until a token exists
        }
      })
  }
}
```

`TrpcContext` carries the request's session, carrier, request id and the invoker; `unwrap` turns a
failed outcome into a `TRPCError` with the code of section 16.4.6 and the `WireError` as its cause.

#### 16.7.2 The router type

Clients need the router's type without a router value and without code generation. The type is
derived from the core's action tree (`AppActionTree`, section 4.7) in two explicit levels, without recursion:

```ts
import type { TRPCBuiltRouter, TRPCMutationProcedure, TRPCQueryProcedure, TRPCSubscriptionProcedure } from '@trpc/server'

interface PennestackTrpcRoot {
  ctx: object
  meta: object
  errorShape: { message: string; code: number; data: { code: string; httpStatus: number; path?: string; pennestack: WireError } }
  transformer: true                                       // false when the static option is 'json'
}

type Procedure<A> =
  A extends { kind: 'query'; input: infer I; output: infer O } ? TRPCQueryProcedure<{ input: I; output: O; meta: object }>
  : A extends { kind: 'command'; input: infer I; output: infer O; execution: infer X }
    ? TRPCMutationProcedure<{ input: I; output: X extends 'sync' ? O : X extends 'async' ? CommandReceipt : O | CommandReceipt; meta: object }>
  : A extends { kind: 'subscription'; input: infer I; event: infer E; resumable: infer Res }
    ? TRPCSubscriptionProcedure<{
        input: I & { lastEventId?: string | null }
        output: AsyncIterable<Res extends true ? { id: string; data: E | StreamControl } : E | StreamControl, void, unknown>
        meta: object
      }>
  : never

type TrpcRecord<T> = {
  [M in keyof T]:
    & (T[M] extends { actions: infer As } ? { [A in keyof As]: Procedure<As[A]> } : {})
    & (T[M] extends { entities: infer Es } ? { [E in keyof Es]: { [A in keyof Es[E]]: Procedure<Es[E][A]> } } : {})
}

export type TrpcRouterOf<App> = TRPCBuiltRouter<PennestackTrpcRoot, TrpcRecord<AppActionTree<App>>>
```

The listing of Appendix B type-checks on TypeScript 7.0.2 with `@trpc/server` and `@trpc/client`
11.19.0: `createTRPCClient<TrpcRouterOf<App>>` gives typed `.query`, `.mutate` and `.subscribe`, with
negative cases (unknown procedure, `.query` on a mutation, unnarrowed `either` result) rejected. On
a synthetic tree of 20 modules, 100 entities and 880 actions, the client type and one call of each
kind cost 60,784 instantiations and 43 ms of checking. The generated file exports the alias
(`export type TrpcRouter = TrpcRouterOf<App>`, a type fragment of the tRPC transport), and client
projects import it from the app package.

Module ids are camel-cased in tRPC paths (`apiKeys.key.revoke`), since paths are property names.
An `either` command's result is `Output | CommandReceipt`, because tRPC cannot narrow a result by a
call option; `@pennestack/client` exports the `isReceipt` guard. The typed client of section 16.8 keeps
the precise per-call types. Subscription data is the item or a control frame (`StreamControl`:
`head`, `reset`, `gap`; section 15.4.11), wrapped by `tracked` when the subscription is resumable.

#### 16.7.3 Transformer

`superjson` 2.2.6 is the default transformer, as tRPC's documentation recommends, so `Date`,
`bigint`, `Set` and `Map` survive; `Uint8Array` is registered as a custom type. With the static
option `transformer: 'json'`, the wire is the plain JSON encoding of section 16.4.2 and the router type
sets `transformer: false`, so tRPC's own `Serialize` types show strings where dates were.

#### 16.7.4 Errors

Errors are `TRPCError`s with the code of section 16.4.6; `errorFormatter` adds the `WireError` as
`data.pennestack`, typed in the router's error shape. Declared errors cannot be typed per procedure
in tRPC; clients branch on `error.data.pennestack.code`.

#### 16.7.5 Subscriptions

Subscriptions are async generators over SSE (`httpSubscriptionLink`), yielding `tracked(state, item)`
so that the client's automatic `lastEventId` resumes the stream from the stream token. WebSocket
(`wsLink`) is available when the backend enables it: the transport registers tRPC's WebSocket
handler (`@trpc/server/adapters/ws`) on the host's upgrade table under `/trpc`. Authentication for
SSE uses cookies or an `EventSource` ponyfill with headers; tRPC's URL `connectionParams` are not
recommended, because they end up in logs, and stream tickets (section 15.4.6) cover browsers.

#### 16.7.6 What is generated when

| What | When | Where |
|---|---|---|
| `TrpcRouter` type alias | `pennestack dev`, `pennestack generate` | a type fragment in `pennestack.generated.ts`, committed |
| router value | at `listen`, from the surface | memory |

### 16.8 The invocation protocol and the typed client

#### 16.8.1 Why an own protocol

The CLI must reach every app, including apps that select none of the ecosystem transports; tests
and scripts need a typed client that carries the core's semantics without loss (command ids,
preference, receipts, the full error object, stream tokens); and operator work at deployment scope
needs a wire on the operator socket before any app transport exists. The invocation protocol is
that wire: the invoker exposed almost one to one, in JSON, over HTTP and the operator Unix socket.
It is part of the HTTP host (`@pennestack/transport-http`), mounted for every app of the catalogue
and at the operator endpoint, so no app has to select a module for the CLI to reach it.

#### 16.8.2 Endpoints

All under `/_pennestack/v1` on every host name of the app, and on the operator endpoint:

| Endpoint | Purpose |
|---|---|
| `POST /invoke` | one query or command |
| `POST /batch` | up to 20 invocations, executed in order, each independently (no shared transaction) |
| `GET /subscribe?action=&input=&after=` or `POST /subscribe` | one subscription as SSE (section 15.4.6); `GET` serves browsers' `EventSource` |
| `GET /surface` | the API surface; `ETag` is the surface hash |
| `GET /live` | WebSocket with subprotocol `pennestack.live.v1` (section 15.4.7) |

```ts
export interface InvokeRequest {
  readonly action: string                                // 'accounts.profile.deactivate'
  readonly input?: unknown                               // wire form; instance commands include `id` and optional `ifVersion`
  readonly commandId?: string
  readonly prefer?: 'sync' | 'async'
}

export type InvokeResponse =
  | { readonly ok: true; readonly value: unknown; readonly receipt?: CommandReceipt }
  | { readonly ok: false; readonly error: WireError }

export interface BatchRequest { readonly invocations: readonly InvokeRequest[] }
export interface BatchResponse { readonly results: readonly InvokeResponse[] }
```

HTTP statuses follow the REST column of section 16.4.6, and the body is always the JSON envelope above,
so a client never parses two error formats. Requests carry `authorization`, `traceparent`, and the
backend and tenant selectors the deployment's resolvers read (by default `x-pennestack-backend` and
`x-pennestack-tenant`, as in section 4.6).

#### 16.8.3 The operator socket

The host listens on the operator Unix socket configured in `defineDeployment` (default
`/run/pennestack/operator.sock` in production and `.pennestack/dev.sock` in a project during
`pennestack dev`, with a short fallback path when the platform's socket path limit would be
exceeded). The socket file is created with mode 0600 inside a 0700 directory owned by the
deployment's user, so connecting to it is proof of operator access, as for other daemons'
control sockets. Requests on it carry `carrier.local.socket`; the core resolves the operator
principal (section 3.5) and, for tenant work, requires the explicit and logged
`core.tenant.enter` of section 8.8.

#### 16.8.4 The typed client

`@pennestack/client` exports `AppClient<App>`, the client the API sketch uses (`client.invoke`,
`client.as`, `client.subscribe`). Its types are inferred from the app value through the core's
action tree; there is no generated client code.

```ts
export type Prefer = 'sync' | 'async'

export interface AppClient<App> {
  /** Runs a query or a command; rejects with a PennestackError. */
  invoke<R extends InvokableRef<App>, const P extends Prefer = 'sync'>(
    ref: R, input: InputOf<App, R>, options?: InvokeOptions<P>,
  ): Promise<ResultOf<App, R, P>>
  /** Like invoke, but returns the outcome; declared errors are typed per action. */
  attempt<R extends InvokableRef<App>, const P extends Prefer = 'sync'>(
    ref: R, input: InputOf<App, R>, options?: InvokeOptions<P>,
  ): Promise<{ ok: true; value: ResultOf<App, R, P> } | { ok: false; error: DeclaredErrorOf<App, R> | TaxonomyError }>
  /** Subscribes; yields items and control frames; resumes automatically from the last stream token. */
  subscribe<R extends SubscriptionRef<App>>(
    ref: R, input: InputOf<App, R>, options?: { readonly after?: StateToken; readonly signal?: AbortSignal },
  ): AsyncIterable<LiveFrame<EventOf<App, R>>>
  /** A client bound to another backend, tenant or credential. */
  as(selector: { readonly backend?: string; readonly tenant?: string; readonly token?: string }): AppClient<App>
  surface(): Promise<ApiSurface>
}

export interface InvokeOptions<P extends Prefer> {
  readonly prefer?: P
  readonly commandId?: string                            // generated per call when omitted, and reused for retries
  readonly signal?: AbortSignal
}

/** The result type follows the effective execution mode: sync gives the output, async a receipt, either the caller's choice. */
type ResultOf<App, R, P> =
  ActionAt<App, R> extends { kind: 'query'; output: infer O } ? O
  : ActionAt<App, R> extends { execution: 'sync'; output: infer O } ? O
  : ActionAt<App, R> extends { execution: 'async' } ? CommandReceipt
  : ActionAt<App, R> extends { output: infer O } ? (P extends 'async' ? CommandReceipt : O)
  : never

export function createRemoteClient<App>(options: {
  readonly url: string                                   // 'https://lvj.example' or 'unix:///run/pennestack/operator.sock'
  readonly token?: string
  readonly backend?: string
  readonly tenant?: string
  readonly fetch?: typeof fetch
}): AppClient<App>
```

The remote client decodes values with the surface it fetched (or the committed surface artefact it
was given), so `Date` and `bigint` arrive in their in-process form although the wire is plain JSON.
It retries network failures of queries, and of commands under the same command id (safe because of
receipts), at most three times with jittered backoff.

#### 16.8.5 The local client

`@pennestack/testing` provides `createLocalClient(runtime, { principal })`, the same interface over
the in-process invoker with a test carrier, so tests exercise the full pipeline without a socket;
the CLI's project mode uses the same mechanism with the operator principal (section 16.9.1).
`host.fetch(request)` on a test runtime calls the HTTP host without a port, which the conformance
suite uses for the HTTP transports.

### 16.9 The CLI

#### 16.9.1 One binary, three connections

`@pennestack/cli` provides the `pennestack` binary, built with Stricli 1.3.0 (`@stricli/core`,
`@stricli/auto-complete`). Its command contexts are injected objects, so command tests never touch
process globals.

| Connection | When | Principal |
|---|---|---|
| project | inside a project: a `pennestack.config.ts` that default-exports `defineDeployment` in the working directory or an ancestor, or the file named by `--config <path>` or `PENNESTACK_CONFIG` | framework commands run on the local definitions; action commands go to `.pennestack/dev.sock` while `pennestack dev` runs, otherwise to an in-process runtime (connect without listen) as the operator |
| operator socket | `--socket <path>` or a profile whose URL is `unix://...` | operator, with logged tenant entry for tenant work |
| remote | a profile with an `https://` URL and a credential | whoever the credential resolves to |

The action part of the command tree is built from the API surface: from the local registry in
project mode, otherwise from `GET /_pennestack/v1/surface`, cached by hash under
`$XDG_CACHE_HOME/pennestack/surfaces/` and revalidated with `If-None-Match` on every run.

#### 16.9.2 The command tree

```
pennestack
├── dev | build | start | generate | migrate | db | introspect | module | ...   framework commands (11.7)
├── <module> <entity> <action>      accounts profile deactivate prof_01j9... --reason "left the company"
├── <module> <action>               accounts register --display-name Jens --email jens@acme.example
├── app <action>                    app health
└── core <entity> <action>          core tenant create ...   (backend, tenant and domain are top-level aliases)
```

- The tree contains exactly the actions of the selected backend's app: a command exists when the
  action exists, and a module that is not selected has no commands.
- Generated actions appear as `get <id>...`, `list`, `changes`, `query-changes`, `create`,
  `update <id>`, `archive <id>`, `restore <id>`, `set` (a batch read from JSON) and `watch`.
- Instance commands take the id as the first positional argument; `cli.positional` names further
  positional inputs; `cli.route` and `cli.aliases` rename.
- There are no hand-written project commands: composition of actions belongs in a script with the
  typed client (section 16.8.4), and behaviour belongs in actions.

#### 16.9.3 Reserved names

Framework commands and action commands share the first level, so framework command names are
reserved as module ids (section 5.1): `app`, `backend`, `build`, `call`, `completion`, `consumers`,
`core`, `db`, `dev`, `doctor`, `domain`, `explain`, `generate`, `help`, `init`, `introspect`,
`jobs`, `keys`, `login`, `logout`, `migrate`, `module`, `operator`, `profile`, `start`, `tenant`,
`version`, `watch` and `x`. The list is frozen per major version; a new framework command lands under an existing group or
under `x` until the next major version.

#### 16.9.4 Flags from field nodes

Each input field becomes a flag with the parser of its kind (the CLI column of section 16.2.3): kebab
names (`--display-name`), `--no-` forms for booleans, enumerations with completion, TypeIDs checked
against their prefix, repeatable flags for lists and sets, dotted flags for nested shapes up to
depth 2 (`--address.city Gent`), `@file` for text, JSON and binary values, and secrets read from a
prompt without echo or from `--<name>-stdin`. `--input <json|@file|->` supplies the whole input
(or the parts that flags do not), and explicit flags win. The assembled input is validated by the
action's schema in the pipeline, like every other transport's input.

Common flags on every action command: `--profile`, `--backend`, `--tenant`, `--output`
(`text`, `table`, `json`, `yaml`, `ndjson`), `--fields`, `--async`, `--wait[=<seconds>]`,
`--command-id`, `--if-version`, `--explain` (operator and development: prints the pipeline stages,
the plan and the matched rule ids) and `--trace` (prints the trace id).

#### 16.9.5 Output and exit codes

- On a terminal, rows print as key-value blocks, pages as tables (the id plus the fields that fit,
  or `--fields`), receipts as the command id and status. When standard output is not a terminal,
  the default is JSON. YAML output uses `yaml` 2.9.1.
- `watch` and every subscription print NDJSON (`{"state":"...","item":{...}}` per line) and resume
  automatically from the last token after a disconnect. A subscription command stops at the `head`
  frame unless `--follow` is given (`pennestack deployments deployment logs <id> --follow`, as
  section 17.3.6 expects); `watch` commands start at the present and always follow. Ctrl-C ends
  with exit code 130.
- Errors go to standard error as one line per problem (`error[accounts.email_taken]: This e-mail
  address is already in use.`), the issues with their paths, and the request id; with
  `--output json` standard error receives the `WireError`. Exit codes follow section 16.4.6.
- Commands generate a command id per invocation and reuse it for automatic retries of network
  failures, so retrying never applies a command twice.

#### 16.9.6 Profiles and credentials

```json
{
  "current": "lvj",
  "profiles": {
    "lvj": { "url": "https://lvj.example", "backend": "launchway", "tenant": "jens", "credential": "lvj" },
    "lvj-operator": { "url": "unix:///run/pennestack/operator.sock" }
  }
}
```

- Profiles live in `$XDG_CONFIG_HOME/pennestack/profiles.json` (default
  `~/.config/pennestack/profiles.json`); credentials live apart in `credentials.json` in the same
  directory with mode 0600. `PENNESTACK_PROFILE` and `PENNESTACK_TOKEN` override both for CI.
- `pennestack login` finds the actions that carry a `cli.login` hint in the surface (a password
  login, an API-key exchange, a later device-authorization flow), prompts for their inputs, invokes
  the chosen one and stores the value of its `tokenField` as the profile's credential;
  `--token` stores a pasted token instead. The CLI never knows which module authenticates.
- Every command accepts `--backend` and `--tenant` overrides (section 12).

#### 16.9.7 Framework commands

| Command | Connection | What it does |
|---|---|---|
| `pennestack init [dir]` | none | creates a project: workspace, base TypeScript configuration, Biome preset, `pennestack.config.ts`, one app and one module |
| `pennestack dev` | project | the watch loop of section 13.6 |
| `pennestack build` | project | the checks of section 13.8, then emits JavaScript for production |
| `pennestack start --role serve\|work\|all` | project (built) | runs a process with the role of section 3.2 |
| `pennestack generate [--watch] [--check] [--only <producer>]` | project | writes or checks every artefact of section 13.7 |
| `pennestack migrate` | project or operator socket | applies pending migration files (an alias of `db apply`) |
| `pennestack db plan\|generate\|apply\|status\|check\|introspect\|retire\|rebuild\|verify\|restore` | project or operator socket | the data layer's commands, with the semantics of sections 14.6.4, 15.2.4, 14.7.6 and 14.8.4 |
| `pennestack consumers list\|unpark`, `pennestack jobs list\|replay\|discard`, `pennestack keys rotate`, `pennestack tenant move` | operator socket | consumers and parked streams (section 15.2.3), dead-letter jobs (section 14.3.9), key rotation (section 14.7.4), tenant moves (section 14.4.5) |
| `pennestack operator token issue\|revoke\|list` | operator socket | short-lived operator tokens for remote operator profiles (section 3.5) |
| `pennestack introspect [modules\|actions\|entity <ref>\|policies\|extensions\|diff]` | any | the surface and the composition report as a tree or JSON; `diff --base <git ref>` classifies interface changes (section 13.8) |
| `pennestack module new\|rename\|retire` | project; rename and retire also on the operator socket | scaffolding (section 16.9.8) and the operator actions of sections 5.1 and 6.6 |
| `pennestack backend ...`, `tenant ...`, `domain ...` | operator socket or remote operator | aliases of the `core` action commands |
| `pennestack call <ref> [--input ...]` | any | invokes any action by reference, for scripts that should not depend on routes |
| `pennestack watch <ref> [--input ...]` | any | subscribes to any subscription by reference |
| `pennestack explain <ref> [--input ...] [--as <principal>]` | operator socket, development | shows the authorization decision without executing (section 8.6); what `--as` may do is a decision point (section 21) |
| `pennestack doctor` | any | the checks of section 13.12, then `app.health` and `app.ready` |
| `pennestack login\|logout\|profile ...` | remote | profiles and credentials |
| `pennestack completion bash\|zsh\|fish` | none | prints a completion script |

#### 16.9.8 Module scaffolding

`pennestack module new <id> [--kind domain|transport|adapter] [--requires a,b] [--optional c]`
creates a package that already compiles, tests and type-tests:

```
packages/module-<id>/                     (modules/<id>/ in an application repository)
  package.json          name, "type": "module", exports with the source condition, publishConfig.exports without it (section 13.4)
  tsconfig.json         extends the base configuration; composite; rootDir src; references to the packages it requires
  src/index.ts          const <camelId>Def = defineModule({ id: '<id>', version: '0.1.0', requires: [...], optional: [...] })
                        export interface <PascalId> extends ModuleType<typeof <camelId>Def> {}
                        export const <camelId>: <PascalId> = <camelId>Def
  src/<id>.test.ts      a test through createLocalClient against an app made of this module alone
  src/<id>.test-d.ts    type tests: composes alone, composes with each optional module, conditional parts appear only then
```

It adds the package to the root `tsconfig.json` references and prints the import and the tuple entry
to add to an app. It never rewrites TypeScript sources.

#### 16.9.9 Completions and help

`pennestack completion zsh` (or `bash`, `fish`) prints a script that calls back into the binary, and
Stricli's `proposeCompletions` answers from the route map, which comes from the cached surface:
route names, flag names and enumerations complete without a network call; TypeID values can
complete by calling the target entity's `query` within 500 milliseconds when a profile enables it.
Help text comes from action and field descriptions (`.describe()`), with examples derived from the
input shape. The CLI's artefact `generated/cli/<app>.json` (routes, flags, descriptions)
makes CLI changes visible in review and feeds packaging.

#### 16.9.10 Interfaces

```ts
import type { CommandContext, RouteMap, TypedFlagParameter } from '@stricli/core'

export interface CliContext extends CommandContext {
  readonly surface: ApiSurface
  readonly client: UntypedClient                         // AppClient keyed by runtime strings
  readonly output: OutputWriter                          // text, table, json, yaml, ndjson
  readonly profile: ResolvedProfile
  readonly signal: AbortSignal
}

/** The action part of the route map; @pennestack/cli adds the framework commands. */
export function buildActionRoutes(surface: ApiSurface, options?: { readonly listName?: string }): RouteMap<CliContext>

/** A field node as a Stricli flag: parser, brief, optionality, variadic and enumeration. */
export function flagFor(name: string, node: FieldNode): TypedFlagParameter<unknown, CliContext>

/** Exit code for an outcome; also Stricli's `determineExitCode`. */
export function exitCodeFor(error: WireError | 'usage' | 'interrupted'): number
```

### 16.10 User interfaces and other clients

The brief requires that a later user interface is fully pluggable while everything works as an API
first. A user interface is therefore a client like any other, and the framework never learns that
it exists:

- **Where it lives.** A user interface is a separate package or repository, built with whichever
  frontend framework is chosen later. It reaches a backend only through transports: REST (types
  from the committed OpenAPI document with `openapi-typescript` 7.13.0), GraphQL (the committed SDL
  with gql.tada 1.11.4), tRPC (the `TrpcRouter` type exported by the app package) or the typed
  client over the invocation protocol. Live updates come through the live carriers.
- **What the framework offers it, generically.**
  - Discovery: the API surface (`core.introspect`) describes entities, fields with kinds,
    enumerations and descriptions, relations, actions with their inputs, outputs and declared
    errors, and pagination. A generic administration screen can be rendered from it alone.
  - Abilities: `core.me` (section 8.7) returns the principal summary and the principal's effective
    rules in CASL's raw-rule shape, which ADR 0005 already provides for, so a client can hide or
    disable what the user cannot do with `@casl/ability` on its side. Rules with relation
    quantifiers arrive with their relations resolved to id sets, or marked `serverOnly` when the set
    is unbounded, because CASL can evaluate relations only against data embedded in the row.
    Enforcement stays on the server.
  - Browser sessions: the cookie hint, the CSRF check and per-tenant CORS of section 16.4.10.
- **User-interface metadata.** Labels per locale, widgets, list columns and form layouts are not
  part of the field model. A user interface that needs them is itself a module (or a set of
  modules) that lists the domain modules as `optional` and keeps its metadata in its own
  definitions and extension points; the domain modules never import it, following the rule of
  section 5.4. Metadata that is not specific to a user interface (descriptions,
  enumerations, formats, deprecations) stays in the field model, where every client benefits.
- **Serving it.** A later `@pennestack/transport-static` module mounts a directory of built assets
  on the host for an app (default prefix `/`, with a fallback to `index.html` for client-side
  routing). It projects nothing from the surface; because mounts are per app and the host routes by
  tenant domain, the interface appears on every domain of every backend running that app.
- **Replacing it** touches no module and no transport.

### 16.11 Observability

The core opens one span per invocation and defines the metrics of section 11. The
interface layer adds:

#### 16.11.1 Traces

| Component | Span | Attributes beyond the core's |
|---|---|---|
| HTTP host | one server span per request, created by the host's middleware with OpenTelemetry's HTTP semantic conventions | `http.request.method`, `http.route` (the template, such as `/api/accounts/profiles/{id}`), `http.response.status_code`, `server.address`, `client.address`, `pennestack.transport`, `pennestack.backend`, `pennestack.tenant` |
| GraphQL | one operation span (Envelop's OpenTelemetry plugin, `@envelop/opentelemetry` 9.2.2) | operation name and type; resolver spans off by default, since every data access is already an invocation span and a DataLoader batch is one invocation |
| tRPC | attributes on the HTTP span | `rpc.system: trpc`, `rpc.method: <path>` |
| invocation protocol | attributes on the HTTP span | `rpc.system: pennestack`, `rpc.method: <action ref>` |
| live | a short span for the subscribe call; sampled `pennestack.live.deliver` spans linked to the producing invocation through the trace context stored in the event envelope (section 11) | subscription id, carrier, items delivered |
| CLI | one client span per command, exported only when `OTEL_EXPORTER_OTLP_ENDPOINT` is set | `pennestack.cli.route`; `traceparent` is propagated to the server and `--trace` prints the trace id |

A stream is not one long span: a span that lasts hours is useless in every trace viewer. Deliveries
link back to the command that caused them instead, so a trace reads "command, events, delivered to
N subscribers".

#### 16.11.2 Metrics

| Instrument | Kind | Attributes |
|---|---|---|
| `http.server.request.duration` | histogram, seconds | method, route, status, transport, backend |
| `http.server.active_requests` | up-down counter | transport |
| `pennestack.transport.errors` | counter | transport, kind, code |
| `pennestack.live.connections` | up-down counter | carrier, backend |
| `pennestack.live.subscriptions` | up-down counter | action, backend |
| `pennestack.live.items.delivered` | counter | action |
| `pennestack.live.items.filtered` | counter | action, reason (plan or filter) |
| `pennestack.live.delivery.lag` | histogram, seconds from commit to write | carrier |
| `pennestack.live.resets` | counter | reason |
| `pennestack.graphql.operation.cost` | histogram | operation type |

`backend` is always an attribute; `tenant` only when a backend opts in, because tenant counts are
unbounded and metric cardinality is not.

#### 16.11.3 Logs

One structured line per transport request at level `info`: request id, transport, route, status,
duration, backend, tenant, principal kind, a hash of the principal id, trace and span ids. Bodies
are never logged. Debug logs and explain output redact `.personal()`, `.secret()` and `.hidden()`
fields, using the field nodes. The default `Logger` implementation is pino 10.4.0 writing JSON
lines to standard output (section 11).

#### 16.11.4 Development and support

`PENNESTACK_EXPLAIN=1` makes the invoker emit a per-invocation explanation (section 11);
`pennestack dev` renders it, `--explain` requests it for one CLI call, and `pennestack explain`
shows the authorization decision without executing. `/_pennestack/health` and `/_pennestack/ready`
serve orchestrators; `app.health` and `app.ready` serve per-backend checks through every transport;
`pennestack doctor` runs all of them.

### 16.12 Multi-tenancy in the interface layer

The brief makes multi-tenancy a first-class requirement that every layer must state. For the
interface layer:

| Concern | How it is handled |
|---|---|
| Tenant resolution | only in the invoker (`open`), from the carrier the host or listener fills; no transport resolves a tenant |
| Routing | the host routes by the resolved app; mounts are per app; a tenant path prefix consumed by a resolver is stripped before routing |
| Documents | surface, OpenAPI and SDL are per app and served per backend with backend-specific server URLs; never per tenant |
| Domains, CORS, cookies | allowed origins are the tenant's domains plus configuration; session cookies carry the `__Host-` prefix (host-only, `Path=/`, no `Domain`), so one tenant's cookie never reaches another tenant's domain and sibling subdomains cannot shadow it; under path-based tenant resolution cookies are not used at all, only bearer tokens (section 16.4.10); WebSocket upgrades and cookie SSE requests are origin-checked |
| Configuration | transport configuration per backend with per-tenant overrides, read through the session's scope |
| Live | subscriptions bound to the session's scope; stream tokens bound to the principal and selector; the change feed filtered by scope in the data layer; admission limits per tenant |
| Operator work | deployment-scope actions only on the operator endpoint; tenant entry explicit and logged |
| CLI | profiles name a deployment, a backend and a tenant; `--backend` and `--tenant` override; operator profiles use the socket |
| Quotas | the `admit` stage's decisions surface as 429 with `Retry-After` in every transport and as exit code 8 in the CLI |
| Errors | an unknown host or tenant is `not_found` before any transport runs; a suspended backend is `unavailable` |
| Observability | `pennestack.backend` and `pennestack.tenant` on spans and logs; tenant as a metric attribute only by opt-in |

### 16.13 Later interfaces

- **JMAP** (mail platform): `transport-jmap` serves the session resource at `/.well-known/jmap` per
  tenant. `Foo/get`, `Foo/changes`, `Foo/set`, `Foo/query` and `Foo/queryChanges` map one to one to
  the generated entity actions (with a `jmap.method` hint where RFC 8621 fixes names such as
  `Email/get`); the method calls of one request run in order in one session, with result references
  resolved by the transport. Push uses the SSE carrier with JMAP `StateChange` frames built from
  pokes, and the WebSocket carrier with the RFC 8887 subprotocol. Errors follow RFC 8620, mapped
  from section 16.4.6. JMAP's `accountId` is the partition value of the partitioned mail entities
  (section 15.1.4), passed to the generated `changes` and `queryChanges`; JMAP `state` and `queryState`
  strings are the tokens of section 15.2.6 unchanged, and `cannotCalculateChanges` answers the
  `reset` cases there. `Email/query` pages by `position` and `anchor`, which the transport requests
  as positional paging (section 14.3.5); JMAP is therefore a projection with its own paging option,
  not a renaming of the generated actions. Section 17.4.8 decides which entities the mail app
  exposes.
- **Connect** (gRPC-compatible): needs stable field numbers (`.tag(n)`, a decision point of section
  21). Descriptors would be built at runtime from field nodes with `@bufbuild/protobuf` 2.16.0
  (`createFileRegistry`) and the `.proto` file emitted as an artefact; a runtime-descriptor spike
  (section 21) decides whether `@connectrpc/connect` 2.2.0 accepts them.
- **oRPC**: not in the first release (ADR 0011). A `transport-orpc` remains one more adapter if a
  client needs oRPC's ecosystem.
- **Outbound webhooks**: an `outbound-webhooks` module (distinct from the inbound `webhooks`
  transport of section 16.5.8), not a transport. Endpoints are entities of the module;
  deliveries are async reactions (a keyed job per endpoint and event, section 7.7), authorized per
  event under the endpoint owner's principal exactly like live deliveries; payloads are signed
  according to the Standard Webhooks specification with `standardwebhooks` 1.1.1 (`webhook-id`,
  `webhook-timestamp`, `webhook-signature`); the event type is `<module>.<entity>.<event>` with the
  generated names of section 15.1.5; requests go through the egress service (section 12.3); retries
  use the job queue with exponential backoff; secrets are per tenant (`field.secret()`).
- **Static sites** for user interfaces: `transport-static`, section 16.10.

## 17. Shared modules and platforms

This section specifies the shared accounts and authentication modules and maps the two proof
platforms of the brief onto pennestack: the deployment platform (the existing Launchway product,
whose backend is re-architected on the framework) and a mail server for the domain
`jenspenneman.com`. It ends with the gaps the core must close before both platforms can be built
and where each one lands. Sources: Launchway's specification (release v0.3.0, 2026-10-07) and its
ADRs 0003, 0004, 0006, 0009 to 0012 and 0017 to 0019; the RFCs named in the text. Libraries were
checked with `npm view` and external components against their repositories on 2026-10-11
(Appendix A). Code uses the DSL of section 4; anything that depends on an open gap carries a
comment with its gap id (`// G3`); names of platform modules are proposals.

### 17.1 Findings in brief

- Both platforms fit the composition model as specified. Every cross-module influence they need
  is a requirement, a contribution, a conditional part or an extension point: `github` contributes
  fields to `projects.project` and `deployments.deployment`, `previews` adapts itself when `github`
  is selected, `mail-store` adapts itself to `accounts`, `spam` contributes verdict fields to
  `mail-store.email`. No platform needs declaration merging, runtime module selection or an import
  cycle.
- The gaps were mostly in the runtime around the invoker: connection-oriented listeners and
  sessions, a scope directory for keys other than host names, jobs with timers and schedules,
  secrets with a key hierarchy, blob storage, streams for logs, commit-ordered change positions,
  HTTP ingress for webhooks and raw responses, process placement and tenant-editable
  configuration. Most are now specified in the core sections; G1, G2, G4, G5 and G9 remain
  proposals whose ADRs the roadmap schedules before the milestone that needs them (section 17.7).
  One composition rule needed a refinement and has it (G16, section 5.5): extension values and
  services that carry behaviour run with the context of the module that provides them.
- The mail server is built from framework modules for every protocol (SMTP for receiving and for
  submission, outbound delivery, IMAP, JMAP) over one store of entities and blobs. Spam scoring
  (rspamd), antivirus (ClamAV, optional), recursive DNS resolution (Unbound) and, from the home
  connection, an outbound relay are external components.
- The mail server does not need the raw SQL escape hatch: the data layer provides per-partition
  serials, a full-text capability, positional paging for JMAP and partitioned change tokens (G7).
  Queue locking stays inside the job store.
- Launchway's limit of one API instance holding all agent connections (its ADR 0004) disappears:
  commands to a node become rows of a node-scoped entity, delivered through a subscription over the
  live feed, so any process can hold the agent's socket.
- The residential connection constrains the mail server more than the framework does: outbound
  delivery needs a host with a static address and matching reverse DNS, and the MX host name must
  be an address record that follows the dynamic public address (a decision point in section 21).

### 17.2 Accounts and authentication

The brief requires an authentication module in which users keep their login information and sign
in, and a separate accounts module that authentication influences and that influences
authentication. Both are shared modules (`@pennestack/module-accounts`,
`@pennestack/module-auth`) that both platforms select; section 5.4 shows how they influence each
other without an import cycle, and [api-sketch.ts](api-sketch.ts) shows them in code. ADR 0014
records the decisions of this section.

#### 17.2.1 Accounts

`accounts` is the lower module: a directory of people that needs no login.

| Part | Specification |
|---|---|
| `accounts.profile` | chain entity, `dataSubject: 'id'`: `displayName`, `email` (unique, personal), `locale`, `deactivatedAt`; domain event `deactivated` |
| `accounts.register` | creates a profile; public only when the backend's configuration `allowSelfRegistration` is on, otherwise operators and administrators |
| `accounts.profile.deactivate` | a `decide` command; deny rule `frozen` on the pre-image keeps deactivated profiles read-only |
| `accounts.profile.search` | an entity query over the caller's view (`ctx.target`) |
| `accounts.identities` | reads the `identityProviders` extension point, whose values are bound to their contributors (section 5.5) |
| subjects | with `accounts` selected, a user's auth subject is a profile id; principals carry `subjectRef: 'accounts.profile'`, so `ctx.principal.subjectAs('accounts.profile')` yields a branded profile id |

#### 17.2.2 Credentials, sessions and tokens

`auth` owns two entities and shares one token format with `api-keys` and `nodes`:

| Entity | History | Fields |
|---|---|---|
| `auth.credential` | chain, `dataSubject: 'subject'`, generated set off | `subject`, `kind` (`password` or `passkey`), `identifier` (the normalised e-mail address of a password credential; unique among active password credentials), `verifier` (an Argon2id hash of the password; for passkeys the public key in a hidden field), passkey metadata (credential id, sign counter, transports), `label`, `lastUsedAt` (maskable), `revokedAt` |
| `auth.session` | state, `dataSubject: 'subject'` | `subject`, `credentialId`, `publicId` (unique), `tokenVerifier` (`field.verifier()`), `authenticatedAt` (the last full authentication), `lastSeenAt`, `idleExpiresAt`, `absoluteExpiresAt`, `revokedAt`, `rotatedFrom`, client metadata (user agent and address, personal) |

- **Tokens are not ids.** A session token is issued once by the key service (`ctx.secrets.issue`,
  gap G4): `pss_<public id>_<secret>`, with a 128-bit public id and a 256-bit secret. The row stores
  the public id and an HMAC-SHA-256 verifier of the secret under a key of the key service; the
  token itself is stored nowhere. Session ids appear in events, receipts, logs and
  `auth.sessionEvents`; they authenticate nothing. API keys, app passwords (`api-keys.key`) and node
  credentials use the same format with their own prefixes.
- **Passwords** are hashed with Argon2id through `node:crypto` (`crypto.argon2`, which runs on Node
  24.21.0 without an experimental warning, checked on 2026-10-11), with at least OWASP's current
  minimum parameters (19 MiB of memory, two passes, one lane). The parameters are part of the stored
  hash, and a successful login rehashes with the current parameters. Verification of an unknown
  identifier runs against a dummy hash, so timing does not reveal which identifiers exist.
- **Passkeys** use `@simplewebauthn/server` (14.0.3) for registration and authentication ceremonies;
  the challenge lives in a short-lived row of the session or of the pending registration, never in
  process memory, so any process can finish a ceremony.
- **App passwords and API keys** are `api-keys.key` rows with scopes and allowed transports (rules
  over credential scopes, gap G13); they are not `auth` credentials, because they authenticate
  programs and protocol clients (IMAP, SMTP submission), not people at a login page.

#### 17.2.3 Expiry, rotation and revocation

- Sessions expire after an idle period (default 12 hours) and an absolute lifetime (default 30
  days), both configurable per backend and tenant. `lastSeenAt` and `idleExpiresAt` are extended at
  most every five minutes, so active sessions do not write on every request.
- Every login creates a new session; a session is never reused across logins. Changing the password
  revokes every other session of the subject and rotates the current one; a privilege elevation
  (a role or membership granted, observed at revalidation) rotates a cookie session on the next
  response.
- `auth.logout` revokes the caller's session (the session id is the principal's credential
  reference) and clears the cookie. `auth.session.revoke` revokes one of the caller's sessions;
  `auth.revokeSubject` revokes every credential and session of a subject and is invoked by auth's
  own reactions (a deactivated profile, an erased subject) under `auth.system`.
- Revocation reaches live connections through revalidation: the session resolver names the events
  it depends on (the session's own change records, its credential's `revoked`, the profile's
  `deactivated`, membership changes), and a connection whose session they touch is revalidated at
  once and closed when it fails (section 16.3.4).

#### 17.2.4 The resolver's read path

The session resolver is a principal resolver of `auth`, bound to auth's context (section 5.5). It
runs in `resolvePrincipal`, after `resolveScope` has fixed the tenant:

1. It reads the token from the `__Host-pennestack_session` cookie or from `Authorization: Bearer`.
2. It looks up the session by public id in a read-only unit of the resolved tenant, with auth's
   module authority, and compares the HMAC of the secret with the stored verifier in constant
   time.
3. It checks revocation and both expiries and builds a `UserPrincipal` whose `ref` names the
   resolver, the subject and the session, and whose `expiresAt` is the earlier expiry.
4. Validated sessions are cached per process for at most 30 seconds, keyed by public id, and the
   cache entry is dropped when the change feed reports a change record for that session, so a
   revocation applies within the wake-up latency (and within a second if a wake-up is lost).

Session tokens are looked up in the tenant the carrier already names (host name, header or the CLI
profile's tenant). Long-lived credentials that must work without a tenant host (API keys, node
credentials) carry a public id that is also a scope key in the scope directory (gap G2).

An unknown, expired or revoked cookie session makes the request anonymous and clears the cookie;
an invalid bearer token fails with `unauthenticated` (section 16.3.4).

#### 17.2.5 Re-authentication and recovery

- Changing a credential (`accounts.profile.changePassword`, adding or removing a passkey, creating
  an app password, changing the login identifier) requires either the current password in the input
  or a session whose `authenticatedAt` is at most ten minutes old (configurable); otherwise it fails
  with `forbidden` and code `auth.reauthentication_required`. `auth.reauthenticate` (password or
  passkey assertion) refreshes `authenticatedAt`. A stolen session therefore cannot become a
  permanent takeover by setting a new password.
- Nobody sets another person's password. `auth.requestPasswordReset` (public, rate-limited, the
  same answer whether or not the identifier exists) issues a one-time reset token, valid for 30
  minutes and stored as a verifier, and hands it to the `auth.resetDelivery` extension point (the
  mail platform delivers it by mail; without a filler, an operator command shows a reset link).
  `auth.resetPassword` consumes the token, sets the new password and revokes every session of the
  subject.
- Operators help users through `core.tenant.enter` and these actions, never by reading verifiers.

#### 17.2.6 Rate limits and abuse

`auth` contributes `invocationMiddleware` that runs at `admit`: token buckets per remote address
(after trusted-proxy rules) and per identifier for `auth.login`, the passkey ceremonies,
`auth.reauthenticate`, `auth.requestPasswordReset` and `auth.resetPassword` (defaults: 10 attempts
per minute per address, 5 failed attempts per 15 minutes per identifier, configurable). Buckets are
the shared buckets of the quota model (section 12.2), so the limits hold across processes. Failures
are counted in metrics and in the decision log.

#### 17.2.7 Login flows

- **Browser.** `auth.login` (password) or the passkey ceremony (`auth.passkey.options`, then
  `auth.passkey.verify`) returns the token; the `http.cookie` hint sets `__Host-pennestack_session`
  and leaves the token out of the body (section 16.4.10); `auth.logout` clears it. Under path-based
  tenant resolution, a browser client keeps the token in memory and sends it as a bearer token.
- **CLI.** `pennestack login` finds the actions with a `cli.login` hint in the surface: the password
  login prompts for the identifier and the password (without echo) and stores the token in the
  profile's credentials file (mode 0600). Passkey-only accounts use a device authorization flow
  (`auth.device.start`, approval in a browser session, `auth.device.poll`), delivered with the
  passkey work in M3.
- **Protocols.** IMAP and SMTP submission use app passwords over TLS (section 17.4.9); the agent
  uses its node credential (section 17.3.4).

#### 17.2.8 Rules

```ts
.policies((rule) => [
  rule.allow(['login', 'passkey.options', 'passkey.verify', 'requestPasswordReset', 'resetPassword'], { public: true }),
  rule.allow(['logout', 'reauthenticate'], { principal: 'user' }),
  rule.allow('credential', ['read'], { id: 'self', principal: 'user', where: (ctx) => ({ subject: ctx.principal.subject }), fields: ['lastUsedAt'] }),
  rule.allow('credential', ['revoke'], { id: 'self-revoke', principal: 'user', where: (ctx) => ({ subject: ctx.principal.subject }) }),
  rule.deny('credential', ['revoke'], { id: 'already-revoked', where: () => ({ revokedAt: { isNull: false } }), reason: 'This credential is already revoked.' }),
  rule.allow('session', ['read', 'revoke'], { id: 'self-sessions', principal: 'user', where: (ctx) => ({ subject: ctx.principal.subject }) }),
])
```

Each tenant is its own authentication realm: credentials and sessions are tenant rows, the same
e-mail address in two tenants is two credentials, and a token of one tenant is never found in
another tenant's namespace. One login across tenants or backends would be federation through a
later OpenID Connect module.

### 17.3 The deployment platform

#### 17.3.1 What carries over and what changes

Launchway's product model stays as specified: GitHub repositories are the source, Compose is the
runtime contract, an agent per machine connects outbound over WebSocket and owns Docker there,
Caddy is the edge and is configured through its admin API, DNS providers are plugins, pull
requests get previews. What changes is the control plane: the hand-wired Hono and Drizzle API
(`apps/api`) becomes a pennestack app. The agent, Docker, Caddy and the web UI stay outside the
framework; the agent and the UI become clients of the generated interfaces.

| Launchway v0.3.0 | On pennestack |
|---|---|
| User, Session, Passkey | `accounts.profile`, `auth.credential`, `auth.session` (shared modules) |
| ApiToken (`lwy_`, scopes `read`, `write`, `admin`) | `api-keys.key` (shared) with scopes |
| Invitation; roles `owner`, `admin`, `member`, `viewer` | `members.membership`, `members.invitation` (shared); roles reach the principal through an enricher |
| GitHubConnection | `github.connection` |
| App, EnvVar | `projects.project`, `projects.envVar` (the UI keeps the word "app"; section 17.6.5) |
| Deployment and its log lines | `deployments.deployment` (chain) and the stream `deployments.log` (G6) |
| Preview | `previews.preview` |
| Node, join token, node credential | `nodes.node`, `nodes.credential`, `nodes.presence`, `nodes.command` |
| DnsProviderAccount, DnsZone | `dns.providerAccount`, `dns.zone`, `dns.record` (shared) |
| Domain, Route | `domains.domain`, `domains.route` |
| Setting (singleton row) | module configuration per tenant (section 17.3.12, G10) |
| AuditEvent | `audit.entry` (shared), projected from the chain, the receipts and the decision log |
| Webhook deliveries table (replay protection) | command receipts keyed by the delivery id (G8) |
| `startJob` loops (ADR 0012), the 15-second deployment worker | schedules, timers and event-driven dispatch (G3) |
| Composition root with a deferred deployment sink (ADR 0010) | lifecycle phases; the cycle disappears because the agent gateway calls actions through the invoker |
| SSE `GET /events` | subscriptions of the `live` module |
| REST `/api/v1`, OpenAPI from Zod routes, RFC 9457 problems | `transport-rest` projection and the error taxonomy mapping of section 16.4.6 |
| TypeID prefixes (`dep_`, `node_`, ...) | the entity `prefix`; the same prefixes are kept |
| AES-256-GCM secrets, HKDF subkeys, AAD per record (ADR 0009) | the secrets key hierarchy (G4) |

#### 17.3.2 Module map

| Module | Package | Owns | Requires | Optional | Contributes to | Fills |
|---|---|---|---|---|---|---|
| `accounts` | shared | `profile` | | | | |
| `auth` | shared | `credential` (password, passkey), `session` | | `accounts` | `accounts.profile` | `principalResolvers` |
| `api-keys` | shared | `key` (verifier hash, scopes, expiry, last use) | | `accounts` | | `principalResolvers` |
| `members` | shared, new | `membership` (subject, role), `invitation` | | `accounts`, `auth` | | `principalEnrichers` |
| `audit` | shared | `entry` | | observes every module (G12) | | `invocationMiddleware` |
| `dns` | shared, new | `providerAccount`, `zone`, `record` | | | | declares `providers` |
| `dns-cloudflare`, `dns-manual` | shared, new | | `dns` | | | `dns.providers` |
| `projects` | Launchway | `project`, `envVar` | | | | declares `gitProviders` |
| `nodes` | Launchway | `node`, `credential`, `presence`, `command` | `live` (contract) | | | `principalResolvers`; claims node-credential scope keys (G2); declares `heartbeatObservers` |
| `deployments` | Launchway | `deployment`, stream `log` | `projects`, `nodes` | | | `nodes.heartbeatObservers` (bound to deployments, G16) |
| `agent-gateway` | Launchway | | `nodes`, `deployments` | | | `transports` (protocol v1) |
| `domains` | Launchway | `domain`, `route` | `projects` | `dns` | | |
| `edge` | Launchway | `render` (last applied configuration) | `domains`, `deployments`, `nodes` | | | |
| `github` | Launchway | `connection` | `projects`, `deployments` | `webhooks` | `projects.project`, `deployments.deployment` | `projects.gitProviders` (bound to github, G16), `webhooks.receivers` |
| `previews` | Launchway | `preview` | `projects`, `deployments`, `domains` | `github` | `projects.project`, `deployments.deployment` | |

Infrastructure modules in the app: `live` and the transports `transport-rest`,
`transport-graphql`, `transport-trpc` and `transport-webhooks` (G8). The PostgreSQL adapter, the
HTTP host (which also serves the invocation protocol for the CLI) and the job queue are
infrastructure of the deployment (section 17.5.1), not modules of the app.

What toggling does:

- Without `previews`: projects have no preview settings, deployments have no `previewId`, and no
  pull request reaction exists. Nothing else changes.
- Without `github`: no webhook receiver, no mirror, no automatic deployments; `previews` loses its
  pull request reactions (conditional part) and can only be opened by hand through another git
  provider. As of 2026-10-11 no other provider exists, so `projects.gitProviders` declares
  `min: 1` and an app without `github` fails at boot with `emptyExtensionPoints` (section 5.5).
- Without `domains` and `edge`: projects still deploy; services publish ports directly, which is
  how a service that needs raw TCP ports runs in Launchway v0.3.0.
- Without `dns`: domains are not bound to zones and users create records by hand, as with the
  `manual` provider of Launchway v0.3.0.
- Without `members`: only the operator and API keys act; no roles exist.

#### 17.3.3 Tenancy and scope

- The deployment has a backend `launchway` that runs the app `launchway`. A tenant is an
  organisation that deploys its own projects on its own machines. Jens's installation is one
  tenant whose core domain is `deploy.jenspenneman.com`.
- All Launchway entities are tenant data (`tenancy: 'tenant'`): nodes, projects, deployments,
  domains, DNS provider accounts, GitHub connections. Nodes and the edge belong to one tenant, so
  containers of two tenants never share a Docker host or the proxy network (a decision point in
  section 21).
- Scope resolution per carrier, all through the pipeline's `resolveScope`:
  - the UI and REST clients: the host name (`core.domain`);
  - API tokens and node credentials: the token carries a public id that is a scope key (G2);
  - the agent WebSocket: the join token or node credential, the same way;
  - GitHub webhooks: the receiver path `/hooks/github/<connection id>`, registered as a scope key
    when the connection is created and turned into `carrier.scopeKey` by the deployment's carrier
    enricher before scope resolution (G2, G8, section 16.5.8).
- The operator (Jens) creates the backend and tenants and issues the first owner invitation from
  the CLI. Launchway's public first-run endpoint (`POST /setup`) is not needed any more.

#### 17.3.4 Agents

The agent remains a separate program (Node, the Docker CLI with Compose, git) that pennestack does
not contain. Its protocol maps onto actions as follows (messages from Launchway's ADR 0004 and its
additions in ADR 0009):

| Protocol v1 message | Direction | On pennestack |
|---|---|---|
| upgrade with `Authorization: Bearer <join token or node credential>` | agent to server | `invoker.open` (section 16.3.4) with the token in the carrier; the `nodes` resolver yields a `service` principal (`via: 'nodes.credential'` or `'nodes.join'`) |
| `hello` | agent to server | `nodes.join` (join token: returns the node credential once) or `nodes.node.connect` (protocol and agent version, Docker facts) |
| `hello.ok` | server to agent | the result of `join` or `connect` |
| `heartbeat` (every 15 s, active deployment ids) | agent to server | `nodes.node.heartbeat`: writes `nodes.presence`, resets the offline timer, calls `heartbeatObservers` |
| `deployment.progress` | agent to server | `deployments.deployment.reportPhase` |
| `deployment.log` | agent to server | `deployments.deployment.appendLog` (batched stream append, G6) |
| `deployment.result` | agent to server | `deployments.deployment.reportResult` |
| `app.status` | agent to server | `deployments.deployment.reportRuntime` |
| `logs.chunk`, `logs.end` | agent to server | publish to the topic `nodes.containerLogs` (G6) |
| `deploy`, `stop`, `remove`, `status`, `logs.start`, `logs.stop`, `deployment.cancel` | server to agent | rows of `nodes.command`, emitted by the subscription `nodes.channel`, acknowledged with `nodes.command.ack` |
| `error` | both | a `PennestackError` rendered as `{ code, message, retryable }` |

The command channel is the part that changes most:

- A module that must tell a node something calls `ctx.services.nodes.send(nodeId, command)`. The
  service is bound to `nodes` (section 5.5) and inserts a `nodes.command` row with nodes' authority
  in the caller's unit, so a state change and the message to the node commit together (the outbox
  comes for free).
- The agent holds one subscription, `nodes.channel`, whose source is the live feed over
  `nodes.command` rows of its own node that are not acknowledged yet, in position order and
  resumable. Any process can hold the socket: the change feed wakes whichever process serves the
  subscription. Launchway's single-instance limitation goes away.
- Delivery is at least once. Commands carry their row id; the agent ignores ids it has already
  handled, and unacknowledged commands are emitted again after a reconnect.
- Secrets never sit in a command row. The `deploy` row holds references (deployment, project,
  environment variable ids). At emit time, `nodes.channel` asks its `commandResolvers` extension
  point, which `deployments` fills with a value bound to its own context (G16): it checks that the
  deployment is assigned to the subscribing node and calls `ctx.services.projects.environmentFor`,
  a service of `projects` that reveals its own secret fields (`ctx.secrets.reveal`, logged with the
  deployment id as the reason, G4).
- Presence: the session's open and close hooks call `nodes.node.connected` and
  `nodes.node.disconnected` (G1). Each heartbeat replaces a keyed durable timer
  `node-offline:<id>` set 45 seconds ahead; when it fires, `nodes.node.markOffline` runs under the
  service principal `nodes.system`, not under the node's credential (section 9.5). This also covers
  a crashed process, which never calls the close hook.
- Join tokens are single use, expire after 15 minutes and are stored as verifiers (section 17.2.2);
  the bundled local agent of the installer gets a bootstrap token issued by the operator.
- Protocol v2, later: the agent uses the typed client over the live module's WebSocket carrier
  (`pennestack.live.v1`, with `subscribe` and `invoke` on one connection), holding the same
  subscription and calling the same actions (ADR 0011). The v1 transport stays until no v1 agent is
  left (a decision point in section 21).

#### 17.3.5 Deployments

- `deployments.deployment` is chain-backed. Its status follows Launchway's state machine with one
  added state, `dispatched` (sent to the node, not yet cloning), which makes the hand-over
  explicit: `queued`, `dispatched`, `cloning`, `building`, `starting`, `running`, then
  `superseded` or `stopped`; `failed` and `cancelled` from any state before `running`.
- One running deployment per project and environment is a partial unique index
  (`unique` on `projectId, environment` where `status = 'running'`, G7). A successful result marks
  the previous running deployment `superseded` and the new one `running` in one transaction, as
  Launchway's ADR 0009 point 14 requires.
- Dispatch is event-driven instead of a 15-second loop. An async reaction keyed by project
  (`ordering: 'fifo-per-key'`, section 7.7) runs when a deployment is created or finishes, when a
  node comes online and when a retry timer fires. It picks the oldest due deployment of the
  project whose node is online, moves it to `dispatched` and sends `deploy` to the node in the same
  transaction. One build per project at a time (Launchway's dispatch lane) is the key's FIFO order.
- Durable timers (G3) carry every waiting rule of Launchway:
  - a deployment for an offline node fails after 10 minutes (`deployment-node-offline:<id>`);
  - an automatic deployment whose image does not exist yet returns to `queued` and waits 1, 2, 4,
    8, 15, 15 and 15 minutes (Launchway ADR 0019; `deployment-retry:<id>`);
  - a deployment missing from two heartbeats is failed (result lost) or sent again (never
    started), decided by the `heartbeatObservers` filler that `deployments` contributes to
    `nodes`.
- Image retries are domain logic (state machine plus timers), not job retries. The job queue only
  retries infrastructure failures, driven by the error taxonomy's `retryable` flag.
- Events of `deployment` drive the edge (re-render), the GitHub mirror, preview status and audit.

#### 17.3.6 Logs

- Deployment logs are a stream `deployments.log` keyed by deployment (G6): the agent gateway
  appends batches, records are ordered per key, retention defaults to 30 days and 50,000 lines per
  deployment, and `deployments.deployment.logs` is a subscription that tails from the start and
  follows with a resume token. REST serves it as SSE, GraphQL as a subscription, the CLI as
  `--follow`.
- Container logs on demand (`GET /apps/{id}/logs?follow=true` in Launchway v0.3.0) are an
  ephemeral topic `nodes.containerLogs` that is never stored. The first subscriber triggers
  `logs.start` to the node and the last one leaving triggers `logs.stop`, which needs subscriber
  lifecycle hooks on topics (G6). Slow subscribers lose lines with a gap marker rather than
  holding the agent back.

#### 17.3.7 Domains and the edge

- `domains.domain` keeps Launchway's statuses (`pending`, `verified`, `misconfigured`, `active`)
  and the `force` flag; `domains.route` keeps the kinds `app`, `external` and `redirect`, the
  options `protected`, `compress` and `hsts`, and the admin-only `extraDirectives`. The DNS
  preflight is an action (`domains.domain.verify`, execution `either`) and a schedule (G3).
  Managed domains ask `dns` for a `CNAME` to the anchor host name.
- Three different "domain" concepts exist in one deployment and must not be confused:
  `core.domain` maps a host name to a backend and tenant for pennestack's own HTTP host;
  `domains.domain` is a host name a Launchway tenant's edge serves for its projects;
  `mail-domains.mailDomain` is an e-mail domain of a mail tenant (section 17.4.4).
- `edge` owns only a small state entity, `render` (the last applied configuration and its hash).
  Its reconciler renders the complete Caddyfile from the routes, domains, deployments and nodes of
  the tenant (a pure function, as in Launchway v0.3.0), validates it with Caddy's `/adapt`, loads
  it with `/load`, and marks verified domains `active`. It runs as a keyed, coalescing job
  triggered by route, domain, deployment and configuration changes (G3, G10), plus a drift-repair
  schedule every 10 minutes, and never twice at the same time for one tenant (G9).
- Applying the file needs either the Caddy admin socket, which only a process on the edge host can
  open (a process capability, G9), or a new agent message `edge.apply` that the edge node's agent
  executes locally (a decision point in section 21).
- `edge.rendered` (query) returns the rendered file with the reason above each placeholder site,
  replacing `GET /edge/config`.
- The pennestack deployment's own HTTP host sits behind this edge: `external` routes in the
  Launchway tenant point at the pennestack container with the `Host` header preserved, for
  `deploy.jenspenneman.com` and for the mail tenant's HTTPS host names (section 17.5.3).

#### 17.3.8 DNS (shared with the mail server)

- `dns.providerAccount` holds the provider kind and its credentials as `field.secret()` values
  (G4); `dns.zone` is discovered from the account; `dns.record` holds the desired record, its
  owner (`module`, `entity`, `id`), the provider's external id and the applied status.
- Providers fill the extension point `dns.providers` with a factory and a credentials `shape()`;
  the walkable field model yields the JSON Schema the UI renders as a form, which Launchway does
  with Zod in v0.3.0. The provider contract grows from Launchway's `A`, `AAAA`, `CNAME` and `TXT` to
  `MX` and `SRV` for the mail server, with `CAA` and `TLSA` later.
- Other modules call services instead of writing records: `ctx.services.dns.ensure(owner, records)`
  and `ctx.services.dns.release(owner)`. A keyed job per record applies changes with retries and
  respects provider rate limits (G3).
- The public-address schedule (every 5 minutes, two independent services must agree) updates the
  anchor `A` record and every record marked `followPublicAddress`. The mail server needs the
  latter: an MX target must be an address record, never an alias (RFC 2181 section 10.3), so
  `mail.jenspenneman.com` cannot be a `CNAME` to the anchor.
- The module only modifies records it created (stored external ids, plus a comment tag where the
  provider supports it). Two backends can therefore manage disjoint records in one zone, which is
  the case for `jenspenneman.com` (section 17.5.3).

#### 17.3.9 GitHub

- `github.connection` holds the kind (`app` or `token`), the GitHub App ids and installation id,
  and the private key, client secret, webhook secret or personal access token as secrets (G4).
- The manifest flow is two actions with redirect results (G8): `github.startManifest`
  answers with a redirect to GitHub carrying a `state`, and `github.completeManifest`
  receives the `code`, converts it and stores the secrets. The installation callback works the
  same way.
- Webhooks arrive through a receiver of `transport-webhooks` at `/hooks/github/<connection id>`
  (G8). The deployment's carrier enricher turns the path into the scope key before scope
  resolution; the receiver's verification resolver, bound to `github`, checks
  `X-Hub-Signature-256` with the connection's webhook secret in constant time over the raw body,
  and only then does the request act as `github.webhook` (section 16.5.8). `X-GitHub-Delivery` is
  the command id (receipts drop replays; the deliveries table goes away), and `github.ingest`
  parses the payload and appends domain events to the connection's chain: `releasePublished`,
  `pushed`, `pullRequestChanged`, `installationChanged`.
- Automatic deployments are async reactions to those events. They invoke
  `deployments.createAutomatic` with the command id `release:<tag>` or `push:<sha>`, whose
  idempotency window is 30 days (`idempotency: { window: 'P30D' }`); beyond it, a unique
  `(projectId, environment, triggerKey)` on automatic deployments is the deduplication of record, so
  a delivery GitHub repeats weeks later never deploys twice.
- The deployment mirror is an asynchronous reaction to `deployments.deployment` events, keyed by
  deployment and coalescing (G3), so steps of one deployment run one at a time and GitHub converges
  on the latest status. A refusal pauses the connection for 5 minutes (`refusedUntil` on the
  connection); rate-limited answers are `rate_limited` errors with `retryAfter`, which the queue
  honours.
- Release polling for token connections is a schedule every 5 minutes per tenant (G3).
- Contributions: `projects.project` gains `githubConnectionId`, `repository`,
  `autoDeployReleases`, `autoDeployPrereleases`, `autoDeployBranch` and `githubDeployments`;
  `deployments.deployment` gains `githubDeploymentId`; `projects.gitProviders` receives the
  GitHub implementation of `GitProvider` (`listRepos`, `listReleases`, `resolveRef`,
  `cloneCredentials`, `getPullRequest`).
- Libraries: `@octokit/app` 16.1.4, `@octokit/rest` 22.0.1 and `@octokit/webhooks` 14.2.0 (all
  MIT).

#### 17.3.10 Previews

- `previews.preview` keeps Launchway's fields and statuses (`pending`, `deploying`, `running`,
  `failed`, `closing`, `closed`) and its limits (10 per project, 20 in total), checked
  synchronously in `previews.open` because they are cross-entity invariants. Expected versions
  cannot see a concurrently inserted preview, so `previews.open` locks the project row and the
  tenant's preview counter (a usage counter, section 12.2) for its unit before counting; two
  concurrent opens on one project queue instead of both counting nine (section 14.3.6).
- Contributions: the preview settings become fields of `projects.project` (`previewsEnabled`,
  `previewSkipBots`, `previewRequireLabel`, `previewHostTemplate`, `previewEnvOverrides`,
  `previewComposeFiles`) and `previewId` a field of `deployments.deployment`. Without the module,
  none of them exists in the types or the tables.
- A conditional part on `github` adds the reaction to `pullRequestChanged` (opened, reopened,
  synchronize, labeled, unlabeled, closed), keyed by repository and pull request number (G3).
  Without `github`, previews are opened by hand through `previews.open`, which reads the pull
  request through the project's git provider.
- Closing removes the route and domain through `domains` actions and sends `remove` to the node;
  a step that cannot finish leaves the preview `closing` and a timer retries it (G3). Purging
  closed previews after seven days is a retention rule (G11), not a worker.

#### 17.3.11 Accounts, authentication, tokens and roles

The shared modules are used unchanged; Launchway's rules live in Launchway's modules, reference
roles from the `members` enricher and combine them with conditions, which is the point of the
CASL-style engine over plain roles.

```ts
// examples/launchway/modules/projects.ts (excerpt)
.policies((rule) => [
  rule.allow('project', ['read'], {
    id: 'read',
    principal: 'user',
    where: (ctx) => hasRole(ctx, 'viewer', 'member', 'admin', 'owner'),
  }),
  rule.allow('project', ['create', 'update'], {
    id: 'manage',
    principal: 'user',
    where: (ctx) => hasRole(ctx, 'member', 'admin', 'owner'),
    fields: ['name', 'slug', 'composeFiles', 'dockerfile', 'context', 'nodeId'],   // the fields members may change
  }),
  rule.allow('project', ['create', 'update'], {
    id: 'admin-fields',
    principal: 'user',
    where: (ctx) => hasRole(ctx, 'admin', 'owner'),
    fields: ['trustedMounts', 'proxyServices'],
    reason: 'Bind mounts and proxy attachments change what a node and the edge expose.',
  }),
  rule.allow('project', ['archive', 'restore'], {                       // members edit; only admins archive
    id: 'archive',
    principal: 'user',
    where: (ctx) => hasRole(ctx, 'admin', 'owner'),
  }),
  rule.allow('envVar', ['read'], {
    id: 'read-env',
    principal: 'user',
    where: (ctx) => hasRole(ctx, 'member', 'admin', 'owner'),          // viewers never see variables; `value` is a secret field (G4)
  }),
])

// examples/launchway/modules/deployments.ts (excerpt): a node reports only on its own work.
rule.allow('deployment', ['reportPhase', 'reportResult', 'reportRuntime', 'appendLog'], {
  id: 'assigned-node',
  principal: 'service',
  where: (ctx) => (ctx.principal.via === 'nodes.credential' ? { nodeId: ctx.principal.idAs('nodes.node') } : false),
  reason: 'A node reports only on deployments assigned to it.',
})

// @pennestack/module-api-keys (excerpt): read-only keys cannot run commands in any module.
rule.deny({ kinds: ['command'] }, {                                    // G13
  id: 'read-only-key',
  when: (ctx) => ctx.principal.via === 'api-keys.key' && !hasScope(ctx, 'write'),
  reason: 'This API key has the read scope only.',
})
```

The gate authorizes `reportResult` for the node; inside the handler, `deployments` reads and
supersedes the previous running deployment with its own authority (section 8.4), so the node
principal needs no rule on other deployments.

- The owner cannot be removed: a deny rule on `members.membership` with
  `where: () => ({ role: 'owner' })` and a reason; ownership moves through a dedicated command.
- Session cookies, origin checks (`Origin` and `Sec-Fetch-Site`) and trusted proxies for the client
  address are concerns of the HTTP host (sections 16.3.3 and 16.4.10); rate limits on login,
  passkey and token actions are `auth`'s middleware at `admit` (section 17.2.6).
- Passkeys stay on `@simplewebauthn/server` (14.0.3, MIT) inside `auth` (section 17.2.2).
- The home node that runs pennestack and PostgreSQL is itself a Launchway node, and its agent
  controls Docker. A project with `trustedMounts` could mount pennestack's volumes or the Docker
  socket, so on that node `allowedBindRoots` excludes pennestack's volumes and the Docker socket by
  default, and the admin role of the tenant that owns the node is treated as operator-equivalent in
  the threat model (section 17.5.2).

#### 17.3.12 Settings as module configuration

Launchway's settings row becomes the configuration of the modules that use it. Owners and admins
edit it in the UI of v0.3.0, so configuration must be editable by tenant principals through actions,
under policies, with change events (G10).

| Launchway setting | Module configuration |
|---|---|
| `publicUrl` | the tenant's `core.domain`, plus `edge.config.platformHost` |
| `acmeEmail` | `edge.config.acmeEmail` |
| `anchorHostname`, dynamic DNS on or off | `dns.config.anchor`, `dns.config.detectPublicAddress` |
| `forwardAuthUrl`, `forwardAuthTarget` | `edge.config.gate` (a union of the two) |
| `edgeNodeId` | `edge.config.edgeNodeId` |
| `previewBaseDomain`, `previewMaxPerApp`, `previewMaxTotal` | `previews.config.baseDomain`, `.maxPerProject`, `.maxTotal` |

#### 17.3.13 The app definition

```ts
// examples/launchway/app.ts
import { defineApp, field, shape, type AppType, type Row } from '@pennestack/core'
import { accounts } from '@pennestack/module-accounts'
import { auth } from '@pennestack/module-auth'
import { apiKeys } from '@pennestack/module-api-keys'
import { members } from '@pennestack/module-members'
import { audit } from '@pennestack/module-audit'
import { dns } from '@pennestack/module-dns'
import { dnsCloudflare } from '@pennestack/dns-cloudflare'
import { dnsManual } from '@pennestack/dns-manual'
import { live } from '@pennestack/live'
import { rest } from '@pennestack/transport-rest'
import { graphql } from '@pennestack/transport-graphql'
import { trpc } from '@pennestack/transport-trpc'
import { webhooks } from '@pennestack/transport-webhooks'                   // G8
import { projects } from './modules/projects.ts'
import { nodes } from './modules/nodes.ts'
import { agentGateway } from './modules/agent-gateway.ts'
import { deployments } from './modules/deployments.ts'
import { domains } from './modules/domains.ts'
import { edge } from './modules/edge.ts'
import { github } from './modules/github.ts'
import { previews } from './modules/previews.ts'

const launchwayDef = defineApp({
  id: 'launchway',
  modules: [
    accounts, auth, apiKeys, members, audit,
    dns, dnsCloudflare, dnsManual,
    projects, nodes, agentGateway, deployments, domains, edge, github, previews,
    live, rest, graphql, trpc, webhooks,
  ],
  actions: (b) => ({
    health: b.query({ auth: { public: true }, scope: 'backend', output: shape({ ok: field.boolean() }), handle: async () => ({ ok: true }) }),
  }),
  execution: {
    'previews.preview.close': 'either',          // the UI waits; the CLI may prefer a receipt
    'domains.domain.verify': 'either',
  },
  authorization: { mode: 'strict', decisionLog: 'denials' },
})

export interface Launchway extends AppType<typeof launchwayDef> {}
export const launchway: Launchway = launchwayDef
export type Project = Row<Launchway, 'projects.project'>
//   contains githubConnectionId, autoDeployReleases, ... (from github) and previewsEnabled, ... (from previews)
```

The `nodes` module shows the agent channel, the heartbeat timer and the extension point through
which the higher `deployments` module observes heartbeats without `nodes` importing it:

```ts
// examples/launchway/modules/nodes.ts (excerpt)
export interface HeartbeatObserver {
  readonly id: string
  observe(nodeId: Id<'nodes.node'>, activeDeploymentIds: readonly string[]): Promise<void>     // bound to the contributor (G16)
}

export interface CommandResolver {
  readonly types: readonly AgentCommand['type'][]
  resolve(nodeId: Id<'nodes.node'>, command: AgentCommandRow): Promise<AgentCommandPayload>   // bound to the contributor (G16)
}

const nodesDef = defineModule({
  id: 'nodes',
  version: '0.1.0',
  requires: [contracts.live],                          // the agent channel is a live subscription
  config: shape({
    heartbeatTimeoutSeconds: field.integer({ min: 15 }).default(45),
    joinTokenTtlSeconds: field.integer({ min: 60 }).default(900),
  }),
  extensionPoints: {
    heartbeatObservers: extensionPoint<HeartbeatObserver>({ mode: 'set' }),
    commandResolvers: extensionPoint<CommandResolver>({ mode: 'set' }),
  },
})
  .entities({
    node: defineEntity({
      prefix: 'node',
      fields: {
        name: field.string({ maxLength: 63 }).unique(),
        lanIp: field.string().optional(),
        arch: field.enum(['amd64', 'arm64']).optional(),
        allowedBindRoots: field.list(field.string()).default([]),
        status: field.enum(['pending', 'online', 'offline']).default('pending'),
      },
    }),
    credential: defineEntity({
      prefix: 'nodecred',
      fields: {
        nodeId: field.ref.own('node').index(),
        kind: field.enum(['join', 'node']),
        verifier: field.verifier(),                     // verifier of a token shown once (section 17.2.2)
        expiresAt: field.instant().optional(),
        revokedAt: field.instant().optional(),
      },
      history: 'state',
      reason: 'Credentials are issued and revoked, never edited; audit records both.',
    }),
    presence: defineEntity({
      prefix: 'pres',
      fields: { nodeId: field.ref.own('node').unique(), lastSeenAt: field.instant(), activeDeploymentIds: field.list(field.string()) },
      history: 'state',
      reason: 'A heartbeat every 15 seconds is liveness, not history.',
    }),
    command: defineEntity({
      prefix: 'ncmd',
      fields: {
        nodeId: field.ref.own('node').index(),
        type: field.enum(['deploy', 'stop', 'remove', 'status', 'logs.start', 'logs.stop', 'deployment.cancel', 'edge.apply']),
        payload: field.json(agentCommandPayload),       // references only; secrets are revealed at emit time
        ackedAt: field.instant().optional(),
      },
      history: 'state',
      reason: 'An outbox row per message; acknowledged rows are purged by retention (G11).',
    }),
  })
  .entityActions('node', (e) => ({
    heartbeat: e.command({
      input: shape({ activeDeploymentIds: field.list(field.string()) }),
      execution: 'sync',
      handle: async (input, ctx) => {
        await ctx.data.nodes.presence.update({ where: { nodeId: ctx.target.id }, patch: { lastSeenAt: ctx.clock.now(), activeDeploymentIds: input.activeDeploymentIds } })
        await ctx.timers.set({                                                          // keyed; replaces the previous timer; fires as nodes.system
          key: `node-offline:${ctx.target.id}`,
          at: new Date(ctx.clock.now().getTime() + ctx.config.heartbeatTimeoutSeconds * 1000),
          invoke: 'nodes.node.markOffline',
          input: { id: ctx.target.id },
        })
        for (const observer of ctx.extensions.heartbeatObservers) await observer.observe(ctx.target.id, input.activeDeploymentIds)
      },
    }),
    markOffline: e.command({ execution: 'sync', handle: async (_input, ctx) => { /* status 'offline'; event for dispatch and the UI */ } }),
  }))
  .actions((b) => ({
    join: b.command({ output: shape({ nodeId: field.ref.own('node'), credential: field.string() }), execution: 'sync', handle: async (_input, ctx) => {
      /* consume the join token; issue the node credential with ctx.secrets.issue and claim its public id as a scope key (G2) */
    } }),
    channel: b.subscription({
      event: agentCommandShape,
      principal: 'service',                                                         // node credentials resolve to a service principal
      source: (_input, ctx, resume) => {
        const nodeId = ctx.principal.idAs('nodes.node')
        if (nodeId === null) throw errors.forbidden('Only a node may hold its command channel.')
        const commands = ctx.live.entity('nodes', 'command', { where: { nodeId, ackedAt: { isNull: true } }, from: 'beginning', after: resume })   // G6: live feed over a state entity
        return mapItems(commands, async (change) => change.type === 'removed' ? undefined : resolvePayload(ctx.extensions.commandResolvers, nodeId, change.row))
      },
    }),
  }))
  .services((s) => ({
    // bound to nodes: inserts with nodes' authority in the caller's unit; callers write ctx.services.nodes.send(nodeId, command)
    send: s.service(async (own, nodeId: Id<'nodes.node'>, command: AgentCommand) => own.data.nodes.command.create({ nodeId, ...command })),
  }))
  .contributes((c) => [c.to(core, { extensionPoints: { principalResolvers: [nodeCredentialResolver] } })])
export interface Nodes extends ModuleType<typeof nodesDef> {}
export const nodes: Nodes = nodesDef
```

The `deployments` module records results, schedules image retries and supersedes the previous
deployment; the lane is a FIFO key on the dispatch reaction:

```ts
// examples/launchway/modules/deployments.ts (excerpt)
const deployment = defineEntity({
  prefix: 'dep',
  fields: {
    projectId: field.ref(projects, 'project').index(),
    nodeId: field.ref(nodes, 'node').index(),
    environment: field.string().default('production'),            // 'production' or 'preview/pr-<n>'
    ref: field.string({ pattern: '^[A-Za-z0-9._/-]+$' }),
    commitSha: field.string({ pattern: '^[0-9a-f]{40}$' }),
    trigger: field.enum(['manual', 'auto', 'preview']),
    status: field.enum(['queued', 'dispatched', 'cloning', 'building', 'starting', 'running', 'superseded', 'stopped', 'failed', 'cancelled']),
    retryCount: field.integer().default(0),
    nextAttemptAt: field.instant().optional(),
    failureReason: field.enum(['image-not-found', 'policy', 'build', 'start', 'node-offline', 'lost', 'unknown']).optional(),
  },
  indexes: [{ fields: ['projectId', 'environment'], unique: true, where: { status: 'running' } }],   // G7: partial unique index
})

const imageRetryMinutes = [1, 2, 4, 8, 15, 15, 15] as const          // Launchway ADR 0019

const deploymentsDef = defineModule({ id: 'deployments', version: '0.1.0', requires: [projects, nodes] })
  .entities({ deployment })
  .streams({                                                          // G6
    log: defineStream({
      key: field.ref.own('deployment'),
      record: shape({ at: field.instant(), source: field.enum(['stdout', 'stderr', 'system']), line: field.text() }),
      retention: { maxAge: '30d', maxPerKey: 50_000 },
    }),
  })
  .entityActions('deployment', (e) => ({
    reportResult: e.command({
      input: shape({ outcome: field.enum(['succeeded', 'failed', 'cancelled']), reason: field.string().optional(), message: field.string().optional() }),
      execution: 'sync',
      handle: async (input, ctx) => {
        const d = ctx.target
        const waitMinutes = imageRetryMinutes[d.retryCount]
        if (input.outcome === 'failed' && input.reason === 'image-not-found' && d.trigger !== 'manual' && waitMinutes !== undefined) {
          const at = new Date(ctx.clock.now().getTime() + waitMinutes * 60_000)
          await ctx.data.deployments.deployment.update({ where: { id: d.id }, patch: { status: 'queued', retryCount: d.retryCount + 1, nextAttemptAt: at, failureReason: 'image-not-found' } })
          await ctx.timers.set({ key: `deployment-retry:${d.id}`, at, invoke: 'deployments.deployment.retryDue', input: { id: d.id } })   // fires as deployments.system
          return
        }
        if (input.outcome === 'succeeded') {                          // deployments' own authority: the node needs no rule on other deployments
          const previous = await ctx.data.deployments.deployment.findOne({ where: { projectId: d.projectId, environment: d.environment, status: 'running' } })
          if (previous) await ctx.data.deployments.deployment.update({ where: { id: previous.id }, patch: { status: 'superseded' } })
          await ctx.data.deployments.deployment.update({ where: { id: d.id }, patch: { status: 'running' } })
          return
        }
        await ctx.data.deployments.deployment.update({ where: { id: d.id }, patch: { status: input.outcome === 'failed' ? 'failed' : 'cancelled' } })
      },
    }),
  }))
  .reactions((r) => [
    // One dispatcher per project lane: a keyed job per event, FIFO per key, so one build per project runs at a time.
    r.own('deployment.changed', { timing: 'async', key: (event) => event.current?.projectId ?? event.stream.id, ordering: 'fifo-per-key' }, dispatchNextForProject),
    r.inline(nodes, 'node.changed', wakeLanesOfNode),
  ])
  .contributes((c) => [c.to(nodes, { extensionPoints: {
    heartbeatObservers: (own) => [reconcileActiveDeployments(own)],               // G16: bound to deployments' context
    commandResolvers: (own) => [deployCommandResolver(own)],                      // checks the assignment, calls projects.environmentFor
  } })])
export interface Deployments extends ModuleType<typeof deploymentsDef> {}
export const deployments: Deployments = deploymentsDef
```

`github` and `previews` show contributions and a conditional part in the same app:

```ts
// examples/launchway/modules/github.ts (excerpt)
export const github = defineModule({ id: 'github', version: '0.1.0', requires: [projects, deployments], optional: [webhooks] })
  .entities({
    connection: defineEntity({
      prefix: 'gh',
      fields: {
        kind: field.enum(['app', 'token']),
        appId: field.integer().optional(),
        installationId: field.integer({ wide: true }).optional(),
        privateKey: field.secret().optional(),                    // G4
        webhookSecret: field.secret().optional(),
        token: field.secret().optional(),
        refusedUntil: field.instant().optional(),
      },
      events: { releasePublished: releaseShape, pushed: pushShape, pullRequestChanged: pullRequestShape },
    }),
  })
  .actions((b) => ({
    ingest: b.command({
      input: shape({ connectionId: field.ref.own('connection'), event: field.string(), signature: field.string(), rawBody: field.text() }),
      execution: 'sync',                  // verify and record before answering GitHub; reactions run asynchronously
      handle: async (input, ctx) => { /* constant-time HMAC check with the revealed webhook secret, then append domain events */ },
    }),
  }))
  .contributes((c) => [
    c.to(projects, {
      entities: {
        project: {
          fields: {
            githubConnectionId: field.ref.own('connection').optional(),
            repository: field.string({ pattern: '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$' }).optional(),
            autoDeployReleases: field.boolean().default(false),
            autoDeployPrereleases: field.boolean().default(false),
            autoDeployBranch: field.string().optional(),
            githubDeployments: field.boolean().default(true),
          },
        },
      },
      extensionPoints: { gitProviders: (own) => [githubProvider(own)] },                    // G16
    }),
    c.to(deployments, { entities: { deployment: { fields: { githubDeploymentId: field.integer({ wide: true }).optional() } } } }),
    c.to(webhooks, { extensionPoints: { receivers: [githubReceiver] } }),        // G8; verified by github's own resolver; dropped when webhooks is absent
  ])
  .reactions((r) => [
    r.async(deployments, 'deployment.changed', mirrorToGitHub, { key: (event) => event.stream.id, coalesce: true }),   // a keyed, coalescing job per deployment
    r.own('connection.releasePublished', { timing: 'async' }, createAutomaticDeployment),
    r.own('connection.pushed', { timing: 'async' }, createAutomaticDeployment),
  ])
  .schedules((s) => [s.every('5m', 'github.pollReleases', { scope: 'each-tenant' })])                                 // G3

// examples/launchway/modules/previews.ts (excerpt)
export const previews = defineModule({
  id: 'previews',
  version: '0.1.0',
  requires: [projects, deployments, domains],
  optional: [github],
  config: shape({
    baseDomain: field.string({ format: 'hostname' }).optional(),
    maxPerProject: field.integer({ min: 0 }).default(10),
    maxTotal: field.integer({ min: 0 }).default(20),
  }),
})
  .entities({ preview })
  .contributes((c) => [
    c.to(projects, {
      entities: {
        project: {
          fields: {
            previewsEnabled: field.boolean().default(false),
            previewSkipBots: field.boolean().default(true),
            previewRequireLabel: field.string().optional(),
            previewHostTemplate: field.string().default('{slug}-pr-{number}.{base}'),
            previewEnvOverrides: field.json(envOverridesShape).default({}),
            previewComposeFiles: field.list(field.string()).optional(),
          },
        },
      },
    }),
    c.to(deployments, { entities: { deployment: { fields: { previewId: field.ref.own('preview').optional() } } } }),
  ])
  .conditional((w) => [
    w.when([github], {
      reactions: (r) => [
        r.async(github, 'connection.pullRequestChanged', syncPreview, { key: (event) => `${event.data.repository}#${event.data.number}` }),   // G3
      ],
    }),
  ])
```

### 17.4 The mail server

#### 17.4.1 What "fully functional" covers

The brief asks for a fully functional mail server for `jenspenneman.com`. Read as the minimum a
person can live on, with common desktop and mobile clients, and with mail that other providers
accept:

| Function | Standards | Release |
|---|---|---|
| Receive from the internet (MX) | SMTP (RFC 5321), message format (RFC 5322), MIME (RFC 2045 to 2049), SIZE (RFC 1870), 8BITMIME (RFC 6152), PIPELINING (RFC 2920), STARTTLS (RFC 3207), SMTPUTF8 (RFC 6531), ENHANCEDSTATUSCODES (RFC 2034), DSN (RFC 3461) | first |
| Submission by clients | RFC 6409 on port 587 with STARTTLS, implicit TLS on 465 (RFC 8314), SMTP AUTH (RFC 4954) with SASL PLAIN (RFC 4616) | first; OAUTHBEARER (RFC 7628) later |
| Outbound delivery | RFC 5321 retry rules, delivery status notifications (RFC 3464), MTA-STS (RFC 8461), TLS reporting (RFC 8460) | first; DANE (RFC 7672) later |
| Sender authentication | SPF (RFC 7208), DKIM (RFC 6376) with RSA and Ed25519 (RFC 8463), DMARC (RFC 7489), ARC (RFC 8617), Authentication-Results (RFC 8601) | first; ARC sealing for forwarding later |
| Client access, current | JMAP core (RFC 8620), JMAP mail and submission (RFC 8621), quotas (RFC 9425) | first |
| Client access, compatible | IMAP4rev2 (RFC 9051) and IMAP4rev1 (RFC 3501), CONDSTORE and QRESYNC (RFC 7162), QUOTA (RFC 9208) | second phase (decision point 22 of section 21) |
| Automatic replies and filters | vacation responses (JMAP VacationResponse, RFC 3834 rules); Sieve (RFC 5228), ManageSieve (RFC 5804), JMAP Sieve (RFC 9661) | vacation first; Sieve later |
| Discovery | SRV records (RFC 6186), JMAP discovery (RFC 8620 section 2.2), an autoconfig document for clients that read one | first |
| Spam handling | content scoring, DNS blocklists, learning from user actions | first |

#### 17.4.2 Framework modules and external components

The rule applied: what decides who may do what, what is stored, and how state changes is a
pennestack module, so that tenancy, authorization, live updates and the chain apply to mail like to
anything else. A component is external when its value is a corpus or a database of its own (spam
rules, virus signatures), when it is generic infrastructure (a recursive resolver), or when the
network forces it (a relay with a clean address).

| Part | Where | Why |
|---|---|---|
| SMTP protocol for receiving and submission | listener modules `smtp-in` and `smtp-submission` on `smtp-server` 3.19.21 (MIT-0) | the library handles the protocol (STARTTLS, implicit TLS, SNI, PROXY protocol, SIZE, 8BITMIME, SMTPUTF8, DSN, REQUIRETLS, AUTH PLAIN, LOGIN and XOAUTH2) and accepts sockets handed to it (`connect(socket)`), so the deployment can own the port; recipients, scope and storage are actions |
| Outbound delivery | module `mail-delivery` with the SMTP client of Nodemailer 10.1.0 (MIT-0) and jobs on the kernel queue | retries, per-domain concurrency and delivery status are jobs and entities |
| SPF, DKIM, DMARC, ARC, MTA-STS policy parsing | module `sender-auth` on `mailauth` 7.3.0 (MIT) | a maintained library that covers all of them, including Ed25519 DKIM |
| MIME parsing and indexing | inside `mail-store`, on `mailparser` 3.9.38 (MIT), `libmime` 5.4.7 (MIT) and `mailsplit` 5.4.6 (MIT or EUPL-1.1+, used under MIT) | byte offsets of MIME parts must be recorded for IMAP sections and JMAP body parts |
| Mailbox storage | entities of `mail-store` plus the blob store (G5) | one store for JMAP, IMAP, live updates and authorization |
| JMAP | the framework transport `transport-jmap` | a projection of the action registry; the generated entity actions already have JMAP semantics (ADR 0004) |
| IMAP | listener module `imap`, an own implementation | no maintained, permissively licensed IMAP server library exists for Node: WildDuck 1.46.1 is EUPL-1.2 and tied to MongoDB; `imapflow` 2.4.0 (MIT) is a client and serves as the test client |
| Spam scoring | external: rspamd 4.2.2 (Apache-2.0) with Valkey 9.1.2 (BSD-3-Clause) for its statistics | the rules, Bayes classifier, fuzzy hashes and blocklist logic are a product of their own; pennestack talks to its HTTP interface |
| Antivirus, optional | external: ClamAV (GPL-2.0) through `clamd` | signature database |
| Recursive DNS for blocklists and DNSSEC | external: Unbound (BSD-3-Clause) next to rspamd | Spamhaus refuses blocklist queries that arrive through large public resolvers |
| Outbound relay from the home connection | external host with a static address and matching reverse DNS | residential address ranges sit on policy blocklists and their reverse DNS belongs to the provider (decision point 21 of section 21) |
| TLS certificates for the mail listeners | shared module `certificates` (ACME DNS-01 through `dns`) | listeners terminate TLS inside the pennestack process |
| HTTPS for JMAP, the MTA-STS policy and the autoconfig document | the Launchway edge in front of the pennestack HTTP host | the edge already terminates TLS for every HTTP host of the deployment |
| Conformance references | Stalwart v0.16.25 (AGPL-3.0-only or its own enterprise licence) as a reference server; imaptest (MIT) for IMAP; `jmap-jam` 0.13.8 (MIT) as JMAP test client | not dependencies |

#### 17.4.3 Module map

| Module | Package | Owns | Requires | Optional | Contributes to | Fills |
|---|---|---|---|---|---|---|
| `mail-domains` | mail | `mailDomain` | | `dns` | | claims mail-domain scope keys (G2) |
| `mail-store` | mail | `mailAccount`, `address`, `identity`, `mailbox`, `email`, `mailboxEntry`, `thread`, `inbound`, `vacationResponse` | `mail-domains` | `accounts` | | declares `inboundChecks` |
| `sender-auth` | mail | `dkimKey` | `mail-domains` | `mail-store`, `mail-delivery`, `dns` | `mail-store.inbound`, `mail-store.email` (authentication results) | `mail-store.inboundChecks`, `mail-delivery.signers` |
| `spam` | mail | | `mail-store` | `mail-delivery` | `mail-store.email`, `mail-store.inbound` (score, verdict, symbols) | `mail-store.inboundChecks`, `mail-delivery.outboundChecks`; declares `scanners` |
| `antivirus` (optional, later) | mail | | `spam` | | | `spam.scanners` |
| `smtp-in` | mail | | `mail-store`, `mail-domains` | | | `listeners` (G1) |
| `mail-delivery` | mail | `submission`, stream `attempt` | `mail-store` | | | declares `signers`, `outboundChecks` |
| `smtp-submission` | mail | | `mail-store`, `mail-delivery` | | | `listeners` (G1) |
| `imap` | mail | | `mail-store` | | | `listeners` (G1) |
| `mta-sts` | mail | | `mail-domains` | `dns` | | raw HTTP endpoint (G8) |
| `autoconfig` | mail | | `mail-domains` | `dns` | | raw HTTP endpoint (G8) |
| `certificates` | shared, new | `certificate` | | `dns` | | TLS provider for listeners (G1) |
| `transport-jmap` | shared, new | | | | | `transports` |
| `sieve`, `dmarc-reports` | mail, later | `script`; `report` | `mail-store` | | | `listeners` (ManageSieve) |

Shared modules in the app: `accounts`, `auth`, `api-keys`, `members`, `audit`, `dns`,
`dns-cloudflare`, `live` and `transport-rest` (administration API). The PostgreSQL adapter, the
blob store (`blobs-fs`, G5), the HTTP host with the invocation protocol and the job queue are
infrastructure of the deployment (section 17.5.1).

The split follows what can be switched off: `mail-store` alone is the store; adding `smtp-in` gives
a receive-only archive; `mail-delivery` with `smtp-submission` and without `smtp-in` and `imap` is
an outbound sender for applications; JMAP without `imap` is a server for JMAP clients only. The
submission entity belongs to `mail-delivery` rather than `mail-store`, so a receive-only server has
no submission types at all.

#### 17.4.4 Tenancy and scope

- The deployment has a backend `mail` that runs the app `mail`. A tenant is a household or
  organisation with one or more mail domains; `jenspenneman.com` belongs to Jens's tenant.
- Creating a mail domain claims the scope key `mail-domain:jenspenneman.com`, unique across the
  deployment (G2), so two tenants (or two backends) can never both receive mail for one domain. A
  released mail domain stays quarantined for longer than the scope directory's cache staleness
  before another tenant may claim it, and the SMTP listener checks mail-domain claims
  synchronously against the control store, so a stale cache can never route mail to the previous
  owner (G2).
- Receiving: an SMTP connection on port 25 starts without a scope. Each `RCPT TO` resolves a scope
  from the recipient's domain. One SMTP transaction can therefore reach several tenants (even
  several backends), each through its own session and its own `mail-store.acceptInbound`
  invocation (G1). The message is written once to a deployment-level staging area and adopted into
  each tenant's blob namespace (G5), so no tenant's data is written in another tenant's scope.
- Submission and IMAP: the scope comes from the domain of the SASL authentication identity
  (`jens@jenspenneman.com`), or from the TLS server name when the identity has no domain; the
  principal comes from an app password (section 17.4.9).
- JMAP and the administration API: host name resolution, as for every HTTP transport
  (`mail.jenspenneman.com` is a `core.domain` of the mail tenant).
- Mail between two tenants of the same deployment goes through normal delivery to the deployment's
  own MX, so no code running in one tenant's scope writes into another's. A shortcut can come
  later as an operator-level path.
- The operator sees queues and abuse signals across tenants through deployment-scoped actions.

#### 17.4.5 Storage model

| Entity | Main fields | History | Notes |
|---|---|---|---|
| `mail-domains.mailDomain` | `name` (scope key), `status`, `catchAllAddressId`, `dmarcPolicy`, `mtaStsMode`, `tlsRptAddress` | chain | creating it claims the scope key and publishes records |
| `mail-store.mailAccount` | `ownerSubject`, `name`, `quotaBytes`, `usedBytes` (counter) | chain | the JMAP account; `profileId` appears when `accounts` is selected |
| `mail-store.address` | `localPart`, `domainId`, `kind` (`mailbox`, `alias`, `catchAll`), `targets` | chain | unique per tenant, so synchronous |
| `mail-store.identity` | `accountId`, `email`, `name`, `replyTo`, `signature` | chain | JMAP Identity; who may send as which address |
| `mail-store.mailbox` | `accountId`, `name`, `parentId`, `role` (RFC 6154 roles), `sortOrder`, `subscribed`, `uidValidity` | chain | name unique among siblings |
| `mail-store.email` | `accountId`, `raw` (blob), `size`, `receivedAt`, `threadId`, `mailboxIds` (set), `keywords` (set), header cache, `preview`, `mimeTree`, `searchText` | chain, `dataSubject: 'accountId.ownerSubject'` | the content is immutable; keywords and mailboxes change; header cache, `preview` and `mimeTree` (attachment names) are personal; `searchText` is hidden, personal and `stateOnly` |
| `mail-store.mailboxEntry` | `mailboxId`, `emailId`, `uid` (sequence per mailbox) | chain | the IMAP view of one message in one mailbox |
| `mail-store.thread` | `accountId` | chain | threading by `Message-ID`, `In-Reply-To`, `References` |
| `mail-store.inbound` | envelope, staged blob, client address and HELO, status | state | a transient hand-over record; the email chain is the history; envelope and client fields are personal |
| `mail-store.vacationResponse` | `accountId`, `isEnabled`, `fromDate`, `toDate`, `subject`, `textBody` | chain | JMAP singleton per account |
| `mail-delivery.submission` | `accountId`, `identityId`, `emailId`, envelope, `sendAt`, `deliveryStatus` per recipient | chain | JMAP EmailSubmission |
| `mail-delivery.attempt` | stream keyed by submission: recipient domain, MX host, reply, TLS details | stream (G6) | records are personal (the reply quotes addresses); erasure purges them with the submission's owner |
| `sender-auth.dkimKey` | `domainId`, `selector`, `algorithm`, `privateKey` (secret), `publicKey`, `state` | chain | `pending`, `published`, `active`, `retiring`, `retired` |

How the protocols' requirements map onto the core model:

- IMAP UIDs are a per-mailbox serial that never repeats while `uidValidity` stays the same:
  `field.serial({ per: ['mailboxId'] })`, allocated by the data layer at insert (G7; section
  15.1.4 specifies it). A restore that rewinds serials bumps the scope's epoch, and the mail
  server then announces a new `uidValidity` (section 14.7.6).
- IMAP MODSEQ (RFC 7162) and JMAP state strings are positions of the tenant's event log. They are
  only correct if a reader never sees a later position before an earlier one commits; section
  15.1.4 provides commit-ordered positions from a counter per scope (G7).
- JMAP keeps one state per account and data type, so `changes` must be computable per account
  without scanning a tenant's whole chain: the entities declare `partition: 'accountId'`, which
  section 15.1.4 turns into per-partition tokens (G7).
- The raw RFC 5322 bytes are a blob (G5), stored once per tenant, encrypted with a per-blob key
  wrapped by the account's key. `mimeTree` records each part's byte range, so an IMAP
  `BODY[1.2]<0.1024>` fetch or a JMAP part download is a range read, never a re-parse.
- Header fields used for lists (`from`, `to`, `cc`, `subject`, `preview`) and the MIME tree are
  cached on the row and marked `.personal()`. The data subject is the account owner, reached through
  the immutable `accountId` reference (`dataSubject: 'accountId.ownerSubject'`, section 14.7.4), so
  the required personal fields need no placeholder: erasing the owner turns the messages into
  erased tombstones. Erasing an account destroys its keys: blobs and personal fields become
  unreadable, the chain stays intact.
- Search: the entity declares a search index over `subject`, `from`, `to`, `cc` and `searchText`
  (text extracted at filing, capped in size). `searchText` is `stateOnly`: it lives in the state
  table and the index only, never in events, so erasure scrubs it completely; rebuilds re-extract
  it from the blob (`rederive`). IMAP `SEARCH TEXT` and JMAP's `text` filter use the adapter's
  full-text capability combined with the principal's plan (G7). The index is a projection that
  erasure drops (G11).
- "Nothing deleted": IMAP `EXPUNGE` and JMAP `Email/set destroy` append `archived` events; the
  message disappears from every view at once. A retention rule chosen by the operator (for example
  30 days) later destroys the per-blob key, removes the bytes and keeps a tombstone (G11). Trash
  and Junk purges are the same mechanism with shorter defaults.
- Quotas: `usedBytes` is a counter maintained by filing and purging; RFC 9208 and RFC 9425 read it.

#### 17.4.6 Receiving mail

1. A connection on port 25 reaches the deployment's socket and is handed to `smtp-in`. The
   `admit` stage limits connections per remote address. TLS comes from `certificates` through
   SNI.
2. `EHLO` and `MAIL FROM` are recorded on the connection.
3. Each `RCPT TO` resolves a scope from the recipient's domain (G2). An unknown domain is refused
   with `550 5.7.1`. A known domain opens (or reuses) a session for that tenant with the
   listener's own service principal (`via: 'smtp-in'`) and invokes `mail-store.resolveAddress`, a
   rate-limited query that only this principal may call; an unknown address is refused with
   `550 5.1.1`.
4. `DATA` is streamed into the staging area with the size limit enforced while streaming (G5).
5. For each tenant among the recipients, the listener invokes `mail-store.acceptInbound`
   synchronously, with a command id derived from the staged content hash, the envelope and the
   tenant. Senders retry for days, longer than any receipt window, so the deduplication of record
   is a unique key on the `inbound` row (the content hash per mail account and envelope), not the
   receipt: a retry days later finds the row and is answered as accepted without storing the
   message twice. The action runs the `inboundChecks`
   that selected modules contributed (`sender-auth`: SPF from the client address, `MAIL FROM` and
   HELO, DKIM, DMARC, ARC; `spam`: the score), applies the tenant's policy (reject above the
   reject score, reject on DMARC `p=reject` failure), adopts the staged blob and writes the
   `inbound` row. `mail-store` imports neither module: they fill its extension point (G16).
6. The listener answers `250` when at least one tenant accepted and none failed transiently,
   `550` when every tenant rejected, and `451 4.3.0` when any tenant failed transiently; the
   sender then retries and the receipts make the retry idempotent.
7. An asynchronous reaction `mail-store.inbound.file` per `inbound` row expands aliases, sends a
   vacation reply when one applies (RFC 3834 rules, through `mail-delivery`), files into Junk
   above the junk score, allocates UIDs, threads, extracts search text and creates the `email` and
   `mailboxEntry` rows. The live feed then reaches IMAP `IDLE` sessions and JMAP push connections.

Forwarding to external addresses (aliases with external targets) goes through `mail-delivery` and
needs sender rewriting (SRS) and, later, ARC sealing, so that the receiving side's SPF and DMARC
checks do not fail on forwarded mail.

#### 17.4.7 Submission and outbound delivery

Submission:

1. A client connects on 587 (STARTTLS required before `AUTH`) or 465 (implicit TLS) and
   authenticates with SASL PLAIN; the listener opens a session with the SASL credentials in the
   carrier (G1).
2. `MAIL FROM` and the message's `From` must belong to an identity of the principal. The
   post-image item check on the new submission (its identity must belong to an account the
   principal owns) enforces it and rolls the command back otherwise.
3. `DATA` is streamed into the tenant's blob namespace and `mail-delivery.submit` runs
   synchronously: it signs through the `signers` that `sender-auth` contributes (once at
   submission, so retries reuse the signature and rotation overlaps cover queued mail), records
   the submission with a status per recipient and enqueues one delivery job per recipient domain.
   The client gets `250` only after commit. JMAP `EmailSubmission/set` calls the same action.

Delivery (one job per submission and recipient domain, G3):

- Jobs are grouped by destination domain with a concurrency limit (two connections per domain by
  default).
- Direct mode resolves MX records, applies the domain's MTA-STS policy (fetched and cached per its
  `max_age`), requires STARTTLS where the policy enforces it, and delivers with Nodemailer's SMTP
  client. Relay mode sends every external delivery to the configured relay with authentication;
  the relay then owns MTA-STS and DANE. Every outbound connection (MX hosts, MTA-STS policy hosts,
  the relay) goes through the egress service, which refuses loopback, private and link-local
  destinations unless the deployment allowlists them (section 12.3), so an MX record pointing into
  the home LAN reaches nothing there.
- A `2xx` reply marks the recipients delivered. A `4xx` reply or a timeout is a retryable error:
  the first retry follows after 5 minutes, because greylisting usually clears by then, backing off
  to a 4-hour maximum and giving up after 5 days (RFC 5321 section 4.5.4.1 sets the give-up time at
  4 to 5 days at least). A `5xx` reply or giving up produces a delivery status notification
  (RFC 3464) delivered to the sender through `mail-store.acceptInbound` in the same tenant.
- Every attempt is a record in the stream `mail-delivery.attempt`; `submission.deliveryStatus`
  changes are live, so JMAP clients see them pushed.
- Future sending (`sendAt`) is a delayed job (G3).
- Outbound rate limits per principal (messages per hour) and an outbound spam check catch
  compromised app passwords; suspending a key is a deny rule with a reason.

#### 17.4.8 Client access: JMAP and IMAP

JMAP comes first because it is a projection the framework already plans:

- `transport-jmap` serves the session resource at `/.well-known/jmap` on the tenant's host, one
  API endpoint, upload and download endpoints, and an EventSource endpoint for push. Capabilities
  come from the modules that are selected: `urn:ietf:params:jmap:mail` and
  `urn:ietf:params:jmap:vacationresponse` from `mail-store`, `urn:ietf:params:jmap:submission` from
  `mail-delivery`, quotas from `mail-store`.
- One JMAP request is one session with many invocations; method calls with result references run
  in order through the invoker under the same scope and principal (G1).
- `Email`, `Mailbox`, `Thread`, `Identity`, `EmailSubmission` and `VacationResponse` are entities
  whose generated `get`, `query`, `changes`, `queryChanges` and `set` actions carry `hints.jmap`;
  `Email/import`, `Email/parse`, `Email/copy` and `SearchSnippet/get` are custom actions with
  hints. `destroy` maps to an archive. TypeID strings are valid JMAP ids (the URL-safe alphabet of
  RFC 8620 section 1.2 includes `_`).
- Uploads and downloads are blob inputs and outputs of actions (G5); push is the LiveHub's change
  feed per account rendered as `StateChange` objects.
- JMAP accounts are the `mailAccount` rows the principal may read; sharing between people
  (RFC 9670) comes later.

IMAP follows as a listener module with its own protocol implementation (decision point 22 of
section 21):

- IMAP4rev2 (RFC 9051, which folds in IDLE, NAMESPACE, UIDPLUS, MOVE, ENABLE and SPECIAL-USE) and
  IMAP4rev1 for older clients, plus CONDSTORE and QRESYNC (RFC 7162) and QUOTA (RFC 9208), on port
  993 with implicit TLS; port 143 with STARTTLS stays off unless a client needs it (RFC 8314).
- After `AUTHENTICATE` or `LOGIN`, every command is one or more actions under the connection's
  session: `SELECT` and `EXAMINE` call `mail-store.mailbox.select`; `FETCH` calls
  `mail-store.mailbox.fetch` and `mail-store.email.readPart` (a blob range, G5); `STORE` calls
  `mail-store.email.setKeywords`; `COPY` and `MOVE` call `copyTo` and `moveTo`; `EXPUNGE` calls
  `mail-store.mailbox.expunge`; `APPEND` uploads a blob and calls `mail-store.importEmail`;
  `SEARCH` calls `mail-store.mailbox.search`; `IDLE` holds the subscription
  `mail-store.mailbox.idle`.
- Message sequence numbers are connection state inside the listener; UIDs, MODSEQ and flags are
  store state. The listener contains protocol logic only, never policy or data access.
- Conformance: imaptest in CI against the listener, `imapflow` as the test client, and a manual
  matrix of Thunderbird, Apple Mail and iOS Mail.

#### 17.4.9 Authentication reuse

- The mail app uses the same `accounts`, `auth`, `api-keys` and `members` packages as Launchway.
  Realms stay separate because the brief makes the authentication realm per tenant, and the mail
  tenant is a different scope from the Launchway tenant. One login for both would be federation
  through a later OpenID Connect module, not shared tables.
- HTTP (JMAP, administration): session cookies or Bearer tokens as for any HTTP transport, with
  passkeys for the web login.
- IMAP and SMTP submission cannot use passkeys. They use SASL PLAIN over TLS with an app password,
  which is an `api-keys` key bound to the subject with the scopes `mail:imap` and
  `mail:submission`. The `api-keys` principal resolver accepts carriers with SASL credentials (G1)
  and the scope check limits the key to those listeners (G13). Passwords of `auth` are accepted on
  these listeners only when a tenant switches it on.
- OAUTHBEARER (RFC 7628) arrives with the OpenID Connect work.
- Brute force: `admit` limits per remote address and per authentication identity, and failed
  attempts feed the rate limiter.
- Mail administrators are a `members` role. They manage domains, addresses and app passwords, and
  no rule lets them read mail: the default deny covers it, which plain roles could not express
  next to "owners read their own mail".

#### 17.4.10 Spam and abuse handling

- At connection time: connection limits per address; optional greylisting through rspamd.
- At `DATA` time: rspamd scores the message through its HTTP interface (`/checkv2`) with the
  envelope, client address and HELO. `sender-auth` computes the stored Authentication-Results
  with `mailauth` and enforces DMARC; rspamd evaluates the same mechanisms for its score, which
  costs a few duplicate DNS lookups that the local resolver caches.
- Policy per tenant in `spam.config`: reject above `rejectScore`, file into Junk above
  `junkScore`, add headers in between. The check reaches `mail-store` through its `inboundChecks`
  extension point; the verdict and symbols are fields contributed to `mail-store.email`.
- Learning: an asynchronous reaction to `mail-store.email` changes moves into and out of the
  mailbox with the Junk role and tells rspamd's controller to learn spam or ham.
- Outbound: per-principal rate limits and an rspamd check of submitted mail.
- `antivirus` fills `spam.scanners` with a ClamAV client when selected; DMARC aggregate reports
  arrive by mail and are parsed by `dmarc-reports` later.

#### 17.4.11 DNS records for jenspenneman.com

| Name | Type | Value | Owner |
|---|---|---|---|
| `jenspenneman.com` | MX | `10 mail.jenspenneman.com.` | `mail-domains` |
| `mail.jenspenneman.com` | A | the public IPv4 address, following detection; never a CNAME (RFC 2181 section 10.3) | `dns` (follow list), requested by `mail-domains` |
| `jenspenneman.com` | TXT | `v=spf1 mx -all`, plus the relay's address or `include:` when relaying | `mail-domains` |
| `<selector>._domainkey.jenspenneman.com` | TXT | `v=DKIM1; k=rsa; p=...`, and a second selector with `k=ed25519` | `sender-auth` |
| `_dmarc.jenspenneman.com` | TXT | `v=DMARC1; p=none; rua=mailto:dmarc@jenspenneman.com` at first, then `quarantine` or `reject` | `mail-domains` |
| `_mta-sts.jenspenneman.com` | TXT | `v=STSv1; id=<policy version>` | `mta-sts` |
| `mta-sts.jenspenneman.com` | CNAME | the anchor; the edge serves `/.well-known/mta-sts.txt` from pennestack | `mta-sts` (record), Launchway route |
| `_smtp._tls.jenspenneman.com` | TXT | `v=TLSRPTv1; rua=mailto:tls-reports@jenspenneman.com` | `mta-sts` |
| `_submissions._tcp.jenspenneman.com` | SRV | `0 1 465 mail.jenspenneman.com.` | `autoconfig` |
| `_submission._tcp.jenspenneman.com` | SRV | `0 1 587 mail.jenspenneman.com.` | `autoconfig` |
| `_imaps._tcp.jenspenneman.com` | SRV | `0 1 993 mail.jenspenneman.com.` | `autoconfig` |
| `_jmap._tcp.jenspenneman.com` | SRV | `0 1 443 mail.jenspenneman.com.` | `autoconfig` |
| `autoconfig.jenspenneman.com` | CNAME | the anchor; the edge serves the autoconfig document from pennestack | `autoconfig` (record), Launchway route |
| reverse DNS of the sending address | PTR | `mail.jenspenneman.com` or the relay's name | the owner of the address, outside the zone |
| `_25._tcp.mail.jenspenneman.com` | TLSA | later; needs DNSSEC on the zone | later |

The apex `A` record of `jenspenneman.com` is unaffected (the site at the apex lives elsewhere); MX
and TXT records coexist with it.

#### 17.4.12 TLS certificates for the listeners

- `certificates` obtains certificates through ACME (RFC 8555) with the DNS-01 challenge through
  `dns`, which works for `mail.jenspenneman.com` without any HTTP route and while Caddy owns
  ports 80 and 443. It stores the certificate and its private key (a secret, G4) per host name and
  renews 30 days before expiry on a schedule (G3).
- Listener sockets are deployment-wide, and the SNI callback runs during the handshake, before any
  scope or principal exists; the shared MX host name belongs to no tenant. The G1 and G2 ADRs
  therefore add a deployment-level certificate directory keyed by host name, filled by the
  `certificates` module of each backend for the host names it owns and by the operator for shared
  names, with one defined principal (the module's service principal) allowed to open private keys.
  The callback reads that directory and picks up renewals without a restart (`smtp-server` has
  `updateSecureContext`).
- The library question is open: `acme-client` 5.4.0 (MIT) is complete but has had no commit since
  2024-07-17 (section 21).

#### 17.4.13 The app definition

```ts
// examples/mail/app.ts
import { defineApp, field, shape, type AppType } from '@pennestack/core'
import { accounts } from '@pennestack/module-accounts'
import { auth } from '@pennestack/module-auth'
import { apiKeys } from '@pennestack/module-api-keys'
import { members } from '@pennestack/module-members'
import { audit } from '@pennestack/module-audit'
import { dns } from '@pennestack/module-dns'
import { dnsCloudflare } from '@pennestack/dns-cloudflare'
import { certificates } from '@pennestack/module-certificates'
import { live } from '@pennestack/live'
import { rest } from '@pennestack/transport-rest'
import { jmap } from '@pennestack/transport-jmap'
import { mailDomains } from './modules/mail-domains.ts'
import { mailStore } from './modules/mail-store.ts'
import { senderAuth } from './modules/sender-auth.ts'
import { spam } from './modules/spam.ts'
import { smtpIn } from './modules/smtp-in.ts'
import { smtpSubmission } from './modules/smtp-submission.ts'
import { mailDelivery } from './modules/mail-delivery.ts'
import { imap } from './modules/imap.ts'
import { mtaSts } from './modules/mta-sts.ts'
import { autoconfig } from './modules/autoconfig.ts'

// mail-store requires contracts.blobs (G5): the blob store is infrastructure of the deployment (section 17.5.1).
const mailDef = defineApp({
  id: 'mail',
  modules: [
    accounts, auth, apiKeys, members, audit,
    dns, dnsCloudflare, certificates,
    mailDomains, mailStore, senderAuth, spam,
    smtpIn, smtpSubmission, mailDelivery, imap, mtaSts, autoconfig,
    live, rest, jmap,
  ],
  actions: (b) => ({
    health: b.query({ auth: { public: true }, scope: 'backend', output: shape({ ok: field.boolean() }), handle: async () => ({ ok: true }) }),
  }),
  authorization: { mode: 'strict', decisionLog: 'denials' },
})
export interface Mail extends AppType<typeof mailDef> {}
export const mail: Mail = mailDef

// Other platforms from the same modules, each with exact types for its selection. The CLI reaches
// them like any app, because the host serves the invocation protocol for every app (section 16.8).
const mailArchiveDef = defineApp({
  id: 'mail-archive',              // receive-only: no submission entity, no delivery queue, no listener on 587
  modules: [accounts, auth, apiKeys, dns, dnsCloudflare, certificates, mailDomains, mailStore, smtpIn, live, jmap],
})
const mailSenderDef = defineApp({
  id: 'mail-sender',               // outbound only, for applications that send notifications
  modules: [apiKeys, dns, dnsCloudflare, certificates, mailDomains, mailStore, senderAuth, mailDelivery, smtpSubmission, rest],
})
```

The store declares the protocol-facing structure; the conditional part links mail accounts to
profiles only when `accounts` is selected:

```ts
// examples/mail/modules/mail-store.ts (excerpt)
const email = defineEntity({
  prefix: 'email',
  partition: 'accountId',                              // per-account JMAP state (section 15.1.4)
  dataSubject: 'accountId.ownerSubject',               // the account owner, through an immutable reference (section 14.7.4)
  fields: {
    accountId: field.ref.own('mailAccount').index(),
    raw: field.blob({ mediaType: 'message/rfc822', maxBytes: 64 * 1024 * 1024 }),        // G5
    size: field.integer(),
    receivedAt: field.instant().index(),
    threadId: field.ref.own('thread').index(),
    mailboxIds: field.set(field.ref.own('mailbox')).merge('set'),
    keywords: field.set(field.string({ maxLength: 255 })).merge('set'),
    messageId: field.string().optional().index(),
    from: field.json(addressList).personal(),
    to: field.json(addressList).personal(),
    cc: field.json(addressList).optional().personal(),
    subject: field.text().optional().personal(),
    sentAt: field.instant().optional(),
    preview: field.string({ maxLength: 256 }).personal(),
    hasAttachment: field.boolean(),
    mimeTree: field.json(mimeTreeShape).personal(),    // MIME parts with byte ranges into `raw`; attachment names are personal
    searchText: field.text().hidden().personal().stateOnly(),   // input of the full-text index: never returned, never in events
  },
  searchIndexes: [{ name: 'text', fields: ['subject', 'from', 'to', 'cc', 'searchText'] }],   // G7
})

const mailboxEntry = defineEntity({
  prefix: 'mbe',
  fields: {
    mailboxId: field.ref.own('mailbox').index(),
    emailId: field.ref.own('email').index(),
    uid: field.serial({ per: ['mailboxId'] }),       // G7: IMAP UID, never reused within a uidValidity
  },
})

const mailStoreDef = defineModule({
  id: 'mail-store',
  version: '0.1.0',
  requires: [mailDomains, contracts.blobs, contracts.live],
  optional: [accounts],
  extensionPoints: { inboundChecks: extensionPoint<InboundCheck>({ mode: 'ordered' }) },   // filled by sender-auth and spam (G16)
  config: shape({
    defaultQuotaBytes: field.integer({ wide: true }).default(10n * 1024n ** 3n),
    rejectUnknownRecipients: field.boolean().default(true),
  }),
})
  .entities({ mailAccount, address, identity, mailbox, email, mailboxEntry, thread, inbound, vacationResponse })
  .actions((b) => ({
    resolveAddress: b.query({
      input: shape({ address: field.string({ format: 'email' }) }),
      output: shape({ deliverable: field.boolean() }),                                  // rate-limited at admit
      handle: async (input, ctx) => ({ deliverable: (await ctx.services.mailStore.expand(input.address)).length > 0 }),   // camelCase key, bound service
    }),
    acceptInbound: b.command({
      input: shape({ staged: field.blob(), envelope: field.json(envelopeShape), client: field.json(clientShape) }),
      output: shape({ verdict: field.enum(['accepted', 'rejected']), reply: field.string().optional() }),
      execution: 'sync',                               // durable before the SMTP 250
      handle: async (input, ctx) => { /* run ctx.extensions.inboundChecks, apply policy, adopt the blob, write `inbound` */ },
    }),
    importEmail: b.command({ execution: 'sync', handle: async (input, ctx) => { /* IMAP APPEND, JMAP Email/import; returns the UID */ } }),
  }))
  .entityActions('inbound', (e) => ({
    file: e.command({ execution: 'sync', handle: async (_input, ctx) => { /* aliases, vacation, Junk, UIDs, thread, search text; runs in the reaction's job */ } }),
  }))
  .entityActions('mailbox', (e) => ({
    select: e.query({ output: selectStateShape, handle: async (_input, ctx) => { /* uidValidity, uidNext, highestModseq, counts */ } }),
    fetch: e.query({ input: shape({ uids: field.string(), items: field.list(field.string()) }), output: fetchRowsShape, handle: async (input, ctx) => { /* rows by UID set */ } }),
    idle: e.subscription({                             // IMAP IDLE; `watch` is the generated name, reserved per entity
      event: mailboxChangeShape,
      source: (_input, ctx, resume) => mapItems(ctx.live.entity('mail-store', 'mailboxEntry', { where: { mailboxId: ctx.target.id }, after: resume }), toMailboxChange),
    }),
  }))
  .policies((rule) => [
    rule.allow(['resolveAddress', 'acceptInbound'], {
      id: 'mx-listener',
      principal: 'service',
      when: (ctx) => ctx.principal.via === 'smtp-in',                   // the listener's service principal (G1); never public
      reason: 'Only the MX listener hands over inbound mail.',
    }),
  ])
  .reactions((r) => [r.own('inbound.created', { timing: 'async' }, (event, ctx) => ctx.invoke('mail-store.inbound.file', { id: event.stream.id }))])   // a job per row, as mail-store.system
  .conditional((w) => [
    w.when([accounts], { entities: { mailAccount: { fields: { profileId: field.ref(accounts, 'profile').optional() } } } }),
  ])
export interface MailStore extends ModuleType<typeof mailStoreDef> {}
export const mailStore: MailStore = mailStoreDef
```

The receiving listener holds no domain logic: it resolves scopes per recipient, streams the
message to staging and asks each tenant to accept it:

```ts
// examples/mail/modules/smtp-in.ts (excerpt)
import { SMTPServer } from 'smtp-server'
import { defineListenerModule, field, shape } from '@pennestack/core'           // G1: sugar that contributes to core.listeners

const smtpError = (code: number, message: string) => Object.assign(new Error(message), { responseCode: code })

export const smtpIn = defineListenerModule({
  id: 'smtp-in',
  requires: [mailStore, mailDomains],
  config: shape({ maxMessageBytes: field.integer().default(52_428_800) }),
  ports: { mx: { default: 25, tls: 'starttls', proxyProtocol: 'optional' } },   // G1: a named port, bound by defineDeployment
  capability: 'smtp-public',                                                     // G9
  listener: (kit) => {
    const server = new SMTPServer({
      name: kit.hostname,
      size: kit.limits.maxMessageBytes,
      SNICallback: kit.certificates.sniCallback,                                 // G1: the deployment's certificate directory (section 17.4.12)
      disabledCommands: ['AUTH'],                                                // an MX never authenticates clients
      async onRcptTo(address, smtp, done) {
        const domain = address.address.slice(address.address.lastIndexOf('@') + 1).toLowerCase()
        const session = await kit.sessions.open({ connection: kit.connectionOf(smtp), scopeKey: { kind: 'mail-domain', value: domain } })   // G1, G2
        if (!session.ok) return done(smtpError(550, '5.7.1 Relaying denied'))
        const found = await session.value.invoke('mail-store.resolveAddress', { address: address.address })
        if (!found.ok || !found.value.deliverable) return done(smtpError(550, '5.1.1 No such recipient'))
        kit.state(smtp).recipients.push({ address: address.address, session: session.value })
        done()
      },
      async onData(stream, smtp, done) {
        const staged = await kit.blobs.stage(stream, { maxBytes: kit.limits.maxMessageBytes })                  // G5
        const outcomes = await Promise.all(
          groupBySession(kit.state(smtp).recipients).map(({ session, recipients }) =>
            session.invoke('mail-store.acceptInbound',
              { staged: staged.ref, envelope: { mailFrom: smtp.envelope.mailFrom, rcptTo: recipients }, client: kit.clientOf(smtp) },
              { commandId: inboundCommandId(staged.sha256, smtp.envelope, session.scope) })),               // retries stay idempotent
        )
        if (outcomes.some((o) => !o.ok)) return done(smtpError(451, '4.3.0 Try again later'))
        if (outcomes.every((o) => o.ok && o.value.verdict === 'rejected')) return done(smtpError(550, '5.7.1 Message refused'))
        done()
      },
    })
    return {
      accept: (socket) => server.connect(socket, {}),                            // the deployment owns the port and hands over sockets
      updateCertificates: (options) => server.updateSecureContext(options),
      drain: () => new Promise<void>((resolve) => server.close(() => resolve())),
    }
  },
})
```

Delivery is a job per submission and destination domain, with the queue options this needs:

```ts
// examples/mail/modules/mail-delivery.ts (excerpt)
export const mailDelivery = defineModule({
  id: 'mail-delivery',
  version: '0.1.0',
  requires: [mailStore],
  extensionPoints: {
    signers: extensionPoint<MessageSigner>({ mode: 'ordered' }),                  // sender-auth: DKIM (G16)
    outboundChecks: extensionPoint<OutboundCheck>({ mode: 'ordered' }),           // spam: outbound scoring (G16)
  },
  config: shape({
    relay: field.json(relayShape).optional(),               // { host, port, tls: 'implicit' | 'starttls', username }
    relayPassword: field.secret().optional(),               // G4
    connectionsPerDomain: field.integer({ min: 1 }).default(2),
    giveUpAfterHours: field.integer({ min: 96 }).default(120),
  }),
})
  .entities({ submission })
  .streams({ attempt: defineStream({ key: field.ref.own('submission'), record: attemptShape, retention: { maxAge: '90d' } }) })   // G6
  .actions((b) => ({
    submit: b.command({ execution: 'sync', handle: async (input, ctx) => { /* outbound checks, signers, submission row, one job per domain */ } }),
  }))
  .entityActions('submission', (e) => ({
    deliver: e.command({
      input: shape({ domain: field.string({ format: 'hostname' }) }),
      execution: 'async',
      async: {                                                                      // G3: job options of an asynchronous action
        group: (input) => ({ id: `mx:${input.domain}`, concurrency: (ctx) => ctx.config.connectionsPerDomain }),
        retry: { schedule: ['5m', '15m', '30m', '1h', '2h', '4h'], thenEvery: '4h', giveUpAfter: (ctx) => `${ctx.config.giveUpAfterHours}h` },
        onGiveUp: 'mail-delivery.submission.bounce',
      },
      handle: async (input, ctx) => { /* relay or MX, MTA-STS, STARTTLS, Nodemailer's SMTP client; a 4xx reply throws a retryable error */ },
    }),
    bounce: e.command({ execution: 'async', handle: async (_input, ctx) => { /* RFC 3464 report to the sender through mail-store.acceptInbound */ } }),
  }))
```

The IMAP listener maps commands onto the store's actions under one session per connection, and
`sender-auth` rotates keys on a schedule:

```ts
// examples/mail/modules/imap.ts (excerpt)
export const imap = defineListenerModule({
  id: 'imap',
  requires: [mailStore],
  ports: { imaps: { default: 993, tls: 'implicit' }, imap: { default: 143, tls: 'starttls', enabled: false } },   // G1
  listener: (kit) => imapServer({                                               // own IMAP4rev2 and IMAP4rev1 implementation
    authenticate: (connection, sasl) =>
      kit.sessions.open({ connection, sasl, scopeKey: { kind: 'mail-domain', value: domainOf(sasl.authcid) } }),   // G1, G2
    select: (session, mailboxId) => session.invoke('mail-store.mailbox.select', { id: mailboxId }),
    fetch: (session, mailboxId, uids, items) => session.invoke('mail-store.mailbox.fetch', { id: mailboxId, uids, items }),
    readPart: (session, emailId, section, range) => session.invoke('mail-store.email.readPart', { id: emailId, section, range }),   // a blob range (G5)
    idle: (session, mailboxId, resume) => session.subscribe('mail-store.mailbox.idle', { id: mailboxId }, resume),
  }),
})

// examples/mail/modules/sender-auth.ts (excerpt)
.schedules((s) => [
  s.every('1d', 'sender-auth.rotateDue', { scope: 'each-tenant' }),            // G3: publish a new selector, switch after DNS propagation, retire the old one
])
```

### 17.5 One deployment carrying both

#### 17.5.1 The deployment definition

```ts
// pennestack.config.ts of the installation for jenspenneman.com
import { byHeader, byHostname, byScopeKey, defineDeployment, env, secret } from '@pennestack/core'
import { ledgerFile } from '@pennestack/core/ledger'
import { postgresAdapter } from '@pennestack/adapter-postgres'
import { httpHost } from '@pennestack/transport-http'
import { blobsFs } from '@pennestack/blobs-fs'
import { launchway } from './examples/launchway/app.ts'
import { mail } from './examples/mail/app.ts'

export default defineDeployment({
  apps: [launchway, mail],
  infrastructure: [
    postgresAdapter(),
    httpHost({ listen: [{ port: 3000 }], trustedProxies: ['172.18.0.0/16'] }),   // behind the Launchway edge
    blobsFs({ root: '/var/lib/pennestack/blobs', keepDeletedFor: 'P35D' }),       // G5; longer than the backup retention
    ledgerFile({ path: '/var/lib/pennestack-ledger/erasure.log' }),               // a separate volume, backed up off the host
  ],
  control: { adapter: 'postgres', url: env('PENNESTACK_CONTROL_URL') },           // its own PostgreSQL instance (section 17.5.2)
  placements: {
    default: { adapter: 'postgres', url: env('PENNESTACK_DATA_URL'), strategy: 'shared-tables' },
  },
  ports: {                                                                          // G1: sockets belong to the deployment
    'smtp-in.mx': 25,
    'smtp-submission.submissions': 465,
    'smtp-submission.submission': 587,
    'imap.imaps': 993,
  },
  processes: {                                                                      // G9
    home: { roles: ['serve', 'work'], capabilities: ['smtp-public'] },
  },
  // Carriers that name a scope key (tokens, node credentials, webhook paths, mail domains) resolve through the directory.
  tenantResolution: [byHostname(), byScopeKey(), byHeader('x-pennestack-tenant')],  // G2
  egress: { allow: [] },                                                            // no private destinations (section 12.3)
  keys: { masterKey: secret('PENNESTACK_MASTER_KEY') },                            // G4
  operator: { socket: '/run/pennestack/operator.sock', bootstrapSecret: secret('PENNESTACK_OPERATOR_SECRET') },
  telemetry: { otlp: env('OTEL_EXPORTER_OTLP_ENDPOINT') },
})
```

#### 17.5.2 Topology on the home server

The installation replaces the Launchway v0.3.0 containers on the home server (Docker Desktop on
Windows 11, residential connection with a dynamic public IPv4 address and no inbound IPv6):

| Container | Ports | Role |
|---|---|---|
| `pennestack` (one image with both apps) | 3000 on the proxy network; 25, 465, 587 and 993 published on the host | process `home`, roles `serve` and `work` |
| `postgres-control` (`postgres:18-alpine`) | internal | the control store, with the erasure ledger and the recorded high-water marks |
| `postgres` (`postgres:18-alpine`) | internal | the default placement, with the job store |
| `caddy` (`caddy:2-alpine`) | 80, 443 | the Launchway edge for every HTTP host of the deployment |
| `launchway-agent` | none (outbound WebSocket) | the node agent of the home server |
| `rspamd`, `valkey`, `unbound` | internal | deployed as a Launchway project from a small repository with a Compose file |

- The control store runs in its own PostgreSQL instance, so restoring the placement never rewinds
  the erasure ledger, and the ledger file on a separate volume covers a restore of both
  (section 14.7.6). Backups snapshot both instances and the blob directory; blob bytes outlive the
  backup retention.
- The router forwards 25, 465, 587 and 993 to the home server, in addition to 80 and 443.
- External services: the DNS provider, GitHub, Let's Encrypt and, for outbound mail, the relay
  (a decision point in section 21).
- Two facts must be verified on the home server before it becomes the MX host (section 21): whether
  the connection allows inbound port 25 and outbound port 25 at all, and whether Docker Desktop's
  port publishing preserves the client's source address. SPF, DMARC, blocklists and rate limits all
  need the real address; if it is hidden, the listeners need host networking or another host.
- Untrusted HTTP content lives on a separate registrable domain. Launchway serves tenant projects
  and pull-request previews, which are code pennestack does not control; served as subdomains of
  `jenspenneman.com`, they would be same-site with `deploy.jenspenneman.com` and
  `mail.jenspenneman.com`, so `SameSite=Lax` would not stop them from sending the session cookie.
  Deployed apps and previews therefore get a domain of their own (a decision point in section 21),
  in addition to the `__Host-` cookies and origin checks of section 16.4.10.
- The home server is also a Launchway node, and its agent controls Docker. On that node,
  `allowedBindRoots` excludes pennestack's volumes, the ledger volume and the Docker socket by
  default, and the admin role of the tenant that owns the node is treated as operator-equivalent in
  the threat model: whoever can deploy a project with trusted mounts there can reach the mail
  backend's data.

#### 17.5.3 How the two backends meet

- No backend invokes another. They are separate scope sets, and the brief's isolation applies
  between them as between tenants. They meet only through infrastructure the operator configures:
  - the Launchway tenant's edge has `external` routes for the mail tenant's HTTPS host names
    (`mail`, `mta-sts`, `autoconfig`), pointing at the pennestack HTTP host with the `Host` header
    preserved; the mail tenant has those names as `core.domain` rows. The Launchway domain for
    `mail.jenspenneman.com` is not bound to a zone, because the mail backend's `dns` module owns
    its `A` record;
  - both backends' `dns` modules manage disjoint records in the `jenspenneman.com` zone, each with
    its own provider credentials, and touch only records they created (section 17.3.8);
  - rspamd runs as a Launchway project; the mail backend reaches it by configuration, through an
    egress allowlist entry for its internal address.
- Bootstrapping: the installer starts `pennestack`, both PostgreSQL instances, `caddy` (with a
  bootstrap configuration that routes the platform host to pennestack) and the agent. The operator
  then creates the backends and tenants over the operator socket; from then on the Launchway tenant
  owns the edge configuration, including the route to pennestack itself.
- The operator sees and administers both backends; each tenant sees only itself.

#### 17.5.4 Bring-up

The operator's steps, written against the typed client the CLI uses (section 16.8.4):

```ts
// Operator work at deployment scope, over the operator socket.
const launchwayBackend = await operator.invoke('core.backend.create', { name: 'launchway', app: 'launchway', placement: 'default' })
const home = await operator.invoke('core.tenant.create', { backendId: launchwayBackend.id, name: 'home', domains: ['deploy.jenspenneman.com'] })
const inHome = await operator.enter({ backend: launchwayBackend.id, tenant: home.id, reason: 'first owner invitation' })   // core.tenant.enter, logged
await inHome.invoke('members.invitation.createOwner', { email: '<owner address>' })

const mailBackend = await operator.invoke('core.backend.create', { name: 'mail', app: 'mail', placement: 'default' })
const mailTenant = await operator.invoke('core.tenant.create', {
  backendId: mailBackend.id,
  name: 'jenspenneman',
  domains: ['mail.jenspenneman.com', 'mta-sts.jenspenneman.com', 'autoconfig.jenspenneman.com'],
})
const inMail = await operator.enter({ backend: mailBackend.id, tenant: mailTenant.id, reason: 'first owner invitation' })
await inMail.invoke('members.invitation.createOwner', { email: '<owner address>' })

// The mail tenant's owner, after accepting the invitation (a separate realm from the Launchway tenant).
const owner = client.as({ backend: mailBackend.id, tenant: mailTenant.id, token: ownerToken })
await owner.invoke('dns.providerAccount.create', { kind: 'cloudflare', credentials: { apiToken: '<token>' } })
const domain = await owner.invoke('mail-domains.addDomain', { name: 'jenspenneman.com' })     // claims the scope key, creates DKIM keys, publishes records
const account = await owner.invoke('mail-store.mailAccount.create', { name: 'Jens' })
await owner.invoke('mail-store.address.create', { localPart: 'jens', domainId: domain.id, kind: 'mailbox', targets: [account.id] })
const phone = await owner.invoke('api-keys.create', { label: 'Phone', scopes: ['mail:imap', 'mail:submission'] })   // shown once
```

### 17.6 Platform decisions

#### 17.6.1 Shared and platform-specific modules

| Module | Kind | Launchway | Mail |
|---|---|---|---|
| `accounts`, `auth`, `api-keys`, `audit` | shared, in the core plan | yes | yes |
| `members` (roles and invitations) | shared, new | yes | yes |
| `dns`, `dns-cloudflare`, `dns-manual` | shared, new | yes | yes (`dns-manual` optional) |
| `certificates` | shared, new | no (the edge obtains certificates) | yes |
| `blobs`, `blobs-fs`, `blobs-s3` | shared, new (G5) | later (log archives) | yes |
| `transport-webhooks` | shared, new (G8) | yes | no |
| `transport-jmap` | shared, new | no | yes |
| `adapter-postgres`, `transport-http` (with the invocation protocol), `blobs-fs` | infrastructure of the deployment | yes | yes |
| `live`, `transport-rest` | shared modules | yes | yes |
| `transport-graphql`, `transport-trpc` | shared infrastructure | yes | optional |
| `projects`, `nodes`, `agent-gateway`, `deployments`, `domains`, `edge`, `github`, `previews` | Launchway | yes | no |
| `mail-domains`, `mail-store`, `sender-auth`, `spam`, `smtp-in`, `smtp-submission`, `mail-delivery`, `imap`, `mta-sts`, `autoconfig`; later `sieve`, `antivirus`, `dmarc-reports` | mail | no | yes |

#### 17.6.2 Commands that must stay synchronous

Launchway:

| Command | Why |
|---|---|
| `projects.project.set` (create, slug change) | slug unique per tenant; Compose project names and proxy aliases derive from it |
| `projects.envVar.set` | key unique per project; keys starting with `LAUNCHWAY_` refused |
| `nodes.join`, `nodes.node.issueJoinToken`, `api-keys.create` | a secret is shown exactly once |
| `auth.login`, passkey ceremonies, `auth.logout` | token issuance and revocation |
| `members.invitation.accept` | single use |
| `domains.domain.set` (create) | host name unique per tenant |
| `domains.route.set` | one route per domain; proxy aliases unique across projects |
| `deployments.create` | resolves the ref to a commit and returns the id; deduplicates automatic triggers per tag or commit |
| `deployments.deployment.cancel`, `.stop` | the state change is visible at once; the node message follows through the outbox |
| `deployments.deployment.report*`, `nodes.node.heartbeat` | node reports must be ordered with the state machine |
| `previews.open` | limits per project and in total (cross-entity invariant) |
| `github.completeManifest` | GitHub returns the App's secrets once |
| `github.ingest` | signature check and receipt before GitHub gets its answer |
| `<module>.config.set` (G10) | settings apply to the next request |

Asynchronous by design: edge reconciliation, DNS record application, the GitHub deployment
mirror, release polling, preview teardown steps, and automatic deployments created by reactions to
webhook events.

Mail:

| Command | Why |
|---|---|
| `mail-store.acceptInbound` | durable before the SMTP `250` |
| `mail-delivery.submit` | durable before the SMTP `250` or the JMAP response |
| `mail-domains.addDomain` | scope key unique across the deployment (G2) |
| `mail-store.address.set` | address unique per tenant, aliases included |
| `mail-store.mailbox.set` (create, rename) | name unique among siblings (IMAP, JMAP) |
| `mail-store.importEmail`, `mail-store.email.copyTo`, `.moveTo` | IMAP clients receive the new UIDs (UIDPLUS) |
| `mail-store.email.setKeywords` from IMAP `STORE` | IMAP clients receive the new MODSEQ (CONDSTORE) |
| `api-keys.create` (app passwords) | a secret is shown exactly once |
| `sender-auth.createKey` | the private key is generated and sealed; publication follows asynchronously |

Asynchronous by design: `mail-store.inbound.file`, `mail-delivery.submission.deliver` and
`.bounce`, DNS publication, spam learning, DKIM rotation steps and retention purges.

#### 17.6.3 Offline authorship and live updates

| Data | Live updates | Offline authorship |
|---|---|---|
| Every Launchway entity | yes (UI refresh, logs, deployment progress) | no: every command touches machines, DNS or GitHub, or checks a uniqueness or a quota; offline edits would be proposals that mostly fail |
| `mail-store.email.keywords` (`$seen`, `$flagged`, ...) | yes | yes, merge `set` |
| `mail-store.email.mailboxIds` (moving and labelling) | yes | yes, merge `set`; the rule "at least one mailbox" is checked at ingest |
| Drafts (new `email` rows in the Drafts mailbox) | yes | yes; the blob is uploaded on reconnect |
| `mail-store.mailbox.sortOrder`, `.subscribed`; `identity` fields; `vacationResponse` | yes | yes, merge `lww` |
| Mailbox names, addresses, domains, submissions, app passwords | yes | no: unique fields or external side effects |

JMAP clients already work offline in their own way (state strings and `ifInState`); the
pennestack push protocol of section 15.3 applies to clients that use the framework's
own client.

#### 17.6.4 The SQL escape hatch

The mail server does not force it. Mailbox search uses a declared full-text capability combined
with the authorization plan, UIDs use a per-partition serial, JMAP and IMAP synchronisation use
partitioned, commit-ordered change positions and positional paging for JMAP (all G7), and queue
locking lives inside the job store behind `JobQueue`. A `mail-store` that needs any of these on an
adapter without the capability fails at `connect` with `unsupported`, as the core prescribes. The escape hatch remains
useful for operator reports and DMARC aggregate statistics, which are optional modules.

#### 17.6.5 Names that differ from the first draft

The first draft of this specification (2026-10-08) named the proof apps' modules provisionally.

| First draft | Now | Reason |
|---|---|---|
| `teams` (Launchway) | `members` | Launchway's roles and invitations are tenant-wide memberships; `teams` stays free for groups inside a tenant |
| `projects` | `projects`, shown as "apps" in Launchway's UI | "app" is pennestack's word for a composition and `app` is a reserved module id |
| `domains` (mail) | `mail-domains` | an e-mail domain differs from a Launchway domain and from `core.domain` |
| `mailboxes`, `messages` | `mail-store` | one cohesive store; the protocol modules around it are what can be switched off |
| `smtp` | `smtp-in`, `smtp-submission`, `mail-delivery` | receiving, submission and delivery are toggled independently |
| `queues` | the kernel job queue and `mail-delivery` | the queue is the kernel's `JobQueue` over the adapters' job store; delivery is a module |
| `dkim` | `sender-auth` | SPF, DKIM, DMARC and ARC belong together |

#### 17.6.6 Where platform modules live

Shared platform modules (`module-members`, `module-dns`, `dns-cloudflare`, `dns-manual`,
`module-certificates`, `blobs-fs` and later `blobs-s3`, `transport-webhooks`, `transport-jmap`) are
packages of this repository (section 18). Launchway's and the mail server's own modules live under
`examples/launchway/modules/` and `examples/mail/modules/` until they are stable; whether
Launchway's modules later move to the Launchway repository as its real backend is open
(section 21).

### 17.7 Gaps for the core and where they land

Mapping both platforms onto the core found sixteen gaps. The ids are stable references, because
other sections cite them; G16 was found last and therefore carries the highest id, although it
ranks third. Most gaps are now specified in the core sections; the rest are proposals whose ADRs
the roadmap schedules before the milestone that first needs them ([roadmap.md](roadmap.md)).

| Id | Gap | Needed by | Status | Where |
|---|---|---|---|---|
| G1 | Connection-oriented listeners and invoker sessions | Launchway agents; SMTP, IMAP, JMAP | sessions specified; listener contract proposed, ADR before M4 | sections 9.2 and 16.3.4; proposal below |
| G2 | Scope directory for keys other than host names | tokens, node credentials, webhook paths, mail domains | proposed, ADR before M3 | proposal below |
| G16 | Extension values bound to their contributor's context | git providers, heartbeat observers, DKIM signers, inbound checks | specified (ADR 0003) | section 5.5 |
| G3 | Jobs, durable timers and schedules | both platforms throughout | specified (ADR 0015) | sections 7.7, 9.5 and 14.3.9 |
| G4 | Secrets and a key hierarchy | Launchway environments and credentials; DKIM keys, relay password, certificates | key service and sealing specified; the `ctx.secrets` interface proposed, ADR before M3 | sections 6.6 and 14.7.4; proposal below |
| G5 | Blob storage | messages, attachments, uploads; later log archives | proposed, ADR before M4 | section 5.2 (the `blobs` contract); proposal below |
| G6 | Streams, topics and a live feed for state entities | deployment logs, container logs, the agent channel, delivery attempts | storage and live delivery specified; the DSL lands in M2 | sections 15.1.10, 15.1.12 and 15.4 |
| G7 | Change positions and data capabilities | IMAP and JMAP synchronisation, mail search, UIDs, Launchway's one-running-deployment rule | specified | sections 14.3.3, 14.3.5, 14.5.1 and 15.1.4 |
| G8 | HTTP ingress beyond JSON actions | GitHub webhooks and manifest flow; MTA-STS, autoconfig, JMAP downloads | specified | section 16.5.8 |
| G9 | Process capabilities and singleton work | mail ports, the edge, reconcilers | proposed, ADR before M3 (singleton) and M4 (capabilities) | proposal below |
| G10 | Tenant-editable configuration with change events | Launchway settings, mail policies | specified | section 5.7 |
| G11 | Retention and purge | Trash and Junk, previews, logs, delivery queues, command rows | specified | section 14.7.1 |
| G12 | Cross-cutting observers and request metadata | audit, later outbound webhooks and search indexers | request metadata specified; `observes: 'all'` proposed | sections 11 and 15.1.7; proposal below |
| G13 | Rules over credential scopes | API key scopes, app passwords per listener | specified (ADR 0005) | section 8.1 |
| G14 | Extension-point cardinality and carrier coverage checks | git providers, SASL-capable resolvers | specified | sections 5.2 and 5.5 |
| G15 | Hyphenated module ids in the context types | every module with a hyphen in its id | specified | sections 3.4 and 5.1 |

#### G1. Connection-oriented listeners and invoker sessions

Status: sessions (`Invoker.open`, `InvocationSession`) are specified in sections 9.2 and 16.3.4; the
listener contract below is a proposal, and its ADR lands before M4 (roadmap).

Problem. The pipeline resolves scope and principal per invocation from a carrier. SMTP, IMAP and
the agent WebSocket are long-lived connections: the scope is known only after `AUTHENTICATE` or
`LOGIN` (IMAP, submission), or once per recipient (an SMTP transaction can reach several tenants),
and a connection performs hundreds of invocations under the same principal. Section 16.3.4 has
`invoker.open(carrier)`, which returns an `InvocationSession` (scope, app, principal, `expiresAt`,
`revalidate()`) that invocations reuse, and section 16.3.7 sends non-HTTP listeners through the
same call. What the platforms still need from the core is the listener side:
ports are a deployment resource while listener modules belong to apps (one port 25 must serve every
backend that runs `smtp-in`), the `Listener` extension point of section 5.6 has no
contract, and `Carrier.connection` is unspecified.

Proposal:

```ts
interface Connection {
  readonly id: string
  readonly listener: string                                   // 'smtp-in.mx', 'imap.imaps', 'agent-gateway.ws'
  readonly remote: { address: string; port: number }          // after PROXY protocol or trusted-proxy rules
  readonly local: { address: string; port: number }
  readonly tls?: { serverName?: string; protocol: string; cipher: string }
}
interface Carrier {                                            // section 9.2, extended
  readonly transport: string
  readonly connection?: Connection
  readonly sasl?: { mechanism: 'PLAIN' | 'LOGIN' | 'OAUTHBEARER' | 'XOAUTH2'; authcid: string; authzid?: string; secret: string }
  readonly scopeKey?: { kind: string; value: string }         // G2
  // host, path, headers, token, local as before
}
interface ListenerSpec {
  readonly id: string
  readonly ports: Readonly<Record<string, { default: number; tls: 'none' | 'starttls' | 'implicit'; proxyProtocol?: 'off' | 'optional' | 'required'; enabled?: boolean }>>
  readonly capability?: string                                // G9
  start(kit: ListenerKit): Promise<{ accept(socket: Socket, port: string): void; updateCertificates(options: SecureContextOptions): void; drain(deadline: Date): Promise<void> }>
}
interface ListenerKit {
  readonly hostname: string
  readonly certificates: { sniCallback: SniCallback }        // filled by the certificates module
  readonly blobs: { stage(body: ReadableStream<Uint8Array>, options: { maxBytes: number }): Promise<StagedBlob> }   // G5
  readonly limits: Readonly<Record<string, number>>           // from the module's config; the largest value over backends
  /** invoker.open (section 16.3.4) plus invocations and subscriptions bound to the session. */
  readonly sessions: { open(carrier: Omit<Carrier, 'transport'>): Promise<Outcome<BoundSession>> }
  readonly telemetry: Telemetry
}
interface BoundSession {
  readonly scope: Scope
  readonly principal: Principal
  invoke(ref: string, input: unknown, options?: { commandId?: string; prefer?: 'sync' | 'async' }): Promise<Outcome<unknown>>
  subscribe(ref: string, input: unknown, resume?: { after: StateToken }): AsyncIterable<Emitted<unknown>>
}
```

- `defineDeployment({ ports })` binds sockets; one socket per listener port serves every backend
  running that module. Two different listener modules claiming one port number fail at boot.
- A connection may open several sessions (one per recipient tenant on an SMTP transaction) or open
  its session late (after `AUTHENTICATE`). `admit` runs at connection time (connections per remote
  address and per listener) as well as per invocation.
- A listener can present its own service principal for protocol steps without client
  authentication (the MX), so actions that only a listener may call are never public. The carrier
  is produced in-process, so this principal cannot be forged from the network.
- Revalidation (section 16.3.4: at `expiresAt` and at least every 60 seconds) also runs on
  revocation events of the session's credential, membership and tenant, so a revoked app password
  or node credential ends its IMAP or agent connection within seconds; the listener then closes
  with its protocol's goodbye (SMTP `421`, IMAP `BYE`, WebSocket close).
- Open and close hooks map to actions for presence (`nodes.node.connected`, `.disconnected`).
- A connection span is the parent of the invocation spans, so one IMAP session or SMTP transaction
  reads as one trace.
- TLS material comes from the deployment-level certificate directory of section 17.4.12 (SNI callback,
  reload without restart).

#### G2. Scope directory for keys other than host names

Status: proposal; its ADR lands before M3, the first milestone that resolves tenants from tokens and
webhook paths (roadmap).

Problem. `resolveScope` runs before any tenant data is reachable, and tenant data may live in
another database (placements). Resolvers by host name work because `core.domain` lives in the
control store. Launchway and mail need the same for other keys: an API token or node credential
(which tenant issued it), a webhook path (which tenant owns GitHub connection `gh_...`), a mail
domain (which tenant receives `jens@jenspenneman.com`). Some of these keys must also be unique
across the deployment: two tenants must never both claim one mail domain.

Proposal:

```ts
type ScopeKey = { kind: 'hostname' | 'mail-domain' | 'webhook-endpoint' | 'node-credential' | 'api-key' | (string & {}); value: string }
interface ScopeDirectory {
  /** Unique across the deployment; `conflict` when another scope holds the key. */
  claim(key: ScopeKey, owner: { module: string; entity: string; id: string }): Promise<void>
  release(key: ScopeKey, owner: { module: string; entity: string; id: string }): Promise<void>
  /** Cached per process and invalidated by the control store's change feed. */
  resolve(key: ScopeKey): Promise<{ backendId: string; tenantId: string } | undefined>
}
// module code:   await ctx.scopeKeys.claim({ kind: 'mail-domain', value: 'jenspenneman.com' }, owner)
// resolver:      byScopeKey()  reads carrier.scopeKey, set by listeners, receivers and token parsers
```

- `core.domain` becomes the `hostname` kind of the same directory.
- Tokens carry a public id (`<prefix>_<public id>_<secret>`, section 17.2.2); the public id is the scope
  key, the secret is verified against the hash in the tenant's data.
- The claim lives in the control store and the owning row in the tenant's placement, so the two
  cannot share a transaction. The ADR must choose between claim first with a compensating release
  on rollback, or an outbox with a reconciler that removes orphaned claims.
- Release and claim of security-sensitive kinds (mail domains, webhook endpoints) need care because
  the directory is cached per process and invalidated asynchronously: a released key stays
  quarantined for longer than the cache staleness before another scope may claim it, or the
  resolver checks those kinds synchronously against the control store. The SMTP listener does the
  latter (section 17.4.4).

#### G16. Extension values bound to their contributor's context

Problem. The declaring module reads an extension point's values through `ctx.extensions`; when a
value is a function, it used to run with the declaring module's context, so the password provider
of `auth` could not read `auth.credential`, GitHub's `GitProvider.cloneCredentials` could not reach
the connection's secret, the `heartbeatObservers` filler of `deployments` could not read
deployment rows, the DKIM signer of `sender-auth` could not reach its keys, and the inbound check of
`spam` could not read its own configuration. Services had the same defect: callers passed their own
context, so a provider ran with the caller's configuration and data view.

Status: specified in section 5.5 and ADR 0003. Behavioural fillers are factories
`(own) => value` that the kernel binds per invocation to the contributor's context (same scope,
principal, unit and trace; the contributor's data authority, services, configuration and secrets);
services are bound to their provider the same way, and call sites pass no context. The principal
never widens.

#### G3. Jobs, durable timers and schedules

Problem. The platforms need per-project dispatch lanes (FIFO per key), per-destination
concurrency (mail), debounced reconcilers (edge, DNS, the GitHub mirror), durable timers keyed by
business ids (node offline after 45 seconds, deployment offline after 10 minutes, image retries,
preview teardown retries), schedules per tenant (public address every 5 minutes, release polling,
certificate renewal, DKIM rotation, retention), retry policies with explicit schedules (mail
delivery for up to 5 days), heartbeats for long jobs, cancellation by key and dead letters, on
every adapter the proof apps run on.

Status: specified in sections 7.7, 9.5 and 14.3.9 and ADR 0015. The kernel job queue runs over the
data adapters' job store with keys (keep, replace, coalesce), groups with concurrency, FIFO per
key, retry schedules driven by the error taxonomy, heartbeats, expiry, dead letters and schedules
(`backend` or `each-tenant`). Jobs store a principal reference that is resolved again when they
run; timers, schedules and reactions run under the module's service principal. pg-boss 12.37.1 has
nearly all of these primitives on PostgreSQL alone, which is why the queue stays replaceable by an
infrastructure entry (a decision point in section 21).

#### G4. Secrets and a key hierarchy

Problem. Both platforms need module code to read secrets on purpose: Launchway builds deploy
payloads with environment values and calls GitHub with the App's private key and DNS providers
with stored tokens; the mail server signs with DKIM private keys, authenticates to the relay and
serves certificates. The brief makes secrets per tenant, and erasure and purges need per-record
keys.

Status: the key service (master key, deployment, backend and tenant keys, subject and value keys),
sealing of credential material with per-value keys destroyed on overwrite, and the rule that only
the owning module reads its secrets are specified in sections 6.6 and 14.7.4. The `ctx.secrets`
interface below is a proposal; its ADR lands before M3 (roadmap).

```ts
interface Secrets {
  /** The only read path for a `field.secret()` value: the owning module's code (and its bound services and extension values); logged with the reason. */
  reveal(value: SecretRef, reason: string): Promise<string>
  /** Seals a value with a fresh value key bound to (entity, id, field); the previous value's key is destroyed by the kernel. */
  seal(plain: string, binding: { entity: string; id: string; field: string }): Promise<SecretRef>
  /** One-time secrets: the plain token goes to the caller once; only the public id and the verifier are stored. */
  issue(options: { prefix: string; bytes?: number }): { plain: string; publicId: string; verifier: string }
  /** Constant-time comparison of a presented token with a stored verifier. */
  verify(presented: string, verifier: string): Promise<boolean>
}
```

- Verifier-only secrets (API keys, app passwords, join tokens, node credentials, session tokens)
  never use `reveal`; reversible secrets (provider credentials, DKIM and TLS private keys, the
  GitHub App key, environment values) do, always from the module that owns the field. Other modules
  reach them through that module's services, as `deployments` reaches environment values through
  `projects.environmentFor` (section 17.3.4).
- Secrets in module configuration (`relayPassword`, provider tokens) are sealed under the backend's
  key, or the tenant's for tenant overrides.

#### G5. Blob storage

Problem. `field.binary()` is a `Uint8Array`, fit for small payloads only. Mail needs streaming
writes with a size limit, hashing while streaming, range reads (IMAP partial fetches), a
deployment-level staging area for SMTP data that is adopted into several tenants, per-tenant
encryption, purge by key destruction, quotas, and uploads and downloads through JMAP, REST and the
CLI.

Status: the `blobs` contract (deployment level) and the `blobStores` deployment extension point
are specified in sections 5.2 and 5.6; the interfaces below are a proposal whose ADR lands before
M4 (roadmap).

```ts
// field kind; the value is a reference
raw: field.blob({ mediaType: 'message/rfc822', maxBytes: 64 * 1024 * 1024 })      // BlobRef { id, size, sha256, mediaType }

interface Blobs {                                                                  // ctx.blobs, for modules that require contracts.blobs
  put(body: ReadableStream<Uint8Array>, options: { mediaType: string; maxBytes: number }): Promise<BlobRef>
  get(ref: BlobRef, options?: { range?: { start: number; end?: number } }): Promise<ReadableStream<Uint8Array>>
  adopt(staged: StagedBlobRef): Promise<BlobRef>                                   // from the deployment staging area
}
interface BlobStore {                                                              // deployment extension point `blobStores`
  readonly capabilities: { range: boolean; copy: boolean }
  write(namespace: string, key: string, body: ReadableStream<Uint8Array>): Promise<{ size: number }>
  read(namespace: string, key: string, range?: { start: number; end?: number }): Promise<ReadableStream<Uint8Array>>
  copy?(from: { namespace: string; key: string }, to: { namespace: string; key: string }): Promise<void>
  remove(namespace: string, key: string): Promise<void>
}
```

- Each blob is encrypted with its own data key wrapped by the tenant's key, or by the data subject's
  key for personal blobs (section 14.7.4). Purge and erasure destroy the key; the collector removes
  the bytes later, never before the deployment's backup retention has passed (section 14.7.6).
- A blob belongs to the rows that reference it; reading it is reading that field, so field masks
  and plans apply. Transports project blob inputs as uploads and blob outputs as downloads with
  range support. Blob bytes count towards the tenant's storage quota (section 12.2).
- Stores: a file system first (`blobs-fs`), an S3-compatible API second (`blobs-s3`).

#### G6. Streams, topics and a live feed for state entities

Problem. Deployment logs (thousands of lines per build), delivery attempts and SMTP transcripts are
append-only records that are not entities: a chain event per line would multiply storage, and
`history: 'state'` rows have no chain events, so the live feed of section 9.6 does
not cover them. Container logs requested on demand must never be stored at all. The agent channel
and node presence are `history: 'state'` entities that still need live updates.

Status: storage (section 15.1.12), transient change records for `state` entities (section
15.1.10) and live delivery of streams and topics (section 15.4) are specified; the DSL below lands
with the live module in M2 (roadmap).

```ts
const log = defineStream({
  key: field.ref.own('deployment'),                           // ordered per key
  record: shape({ at: field.instant(), source: field.enum(['stdout', 'stderr', 'system']), line: field.text() }),
  retention: { maxAge: '30d', maxPerKey: 50_000 },
  readAs: 'deployment',                                       // may read the stream when it may `get` the keyed row
})
await ctx.streams.deployments.log.append(deploymentId, records)                 // batch append
ctx.live.stream('deployments', 'log', { key: deploymentId, from: 'start' })     // tail and follow, resumable

const containerLogs = defineTopic({                           // never stored
  key: shape({ projectId: field.string(), service: field.string() }),
  record: logLineShape,
  onFirstSubscriber: (key, ctx) => startContainerLogs(ctx, key),
  onLastSubscriberLeft: (key, ctx) => stopContainerLogs(ctx, key),
})
```

- The change feed also carries changes of `history: 'state'` entities, with positions, so
  subscriptions such as `nodes.channel` resume after a reconnect.
- Slow subscribers on topics lose records with a gap marker; streams resume from a token.

#### G7. Change positions and data capabilities

Requirements from the mail server first: commit-ordered positions (a reader must never see a
later position while an earlier one can still commit, or IMAP and JMAP clients miss changes for
good); change tokens partitioned by a field (`accountId`); per-partition serials for IMAP UIDs;
full-text search on declared indexes combined with the authorization plan; positional paging for
JMAP's `Email/query`; partial unique indexes (one running deployment per project and environment,
one active DKIM key per domain and algorithm); atomic increments with the resulting value for
quota counters.

Status: specified. Positions come from a counter per scope (section 15.1.4); `partition` on
entities and `field.serial` are in sections 15.1.4 and 14.5.1; the `search` and `positionPaging`
capabilities and partial unique indexes are in sections 14.3.3, 14.3.5 and 14.5.1; rows locked for
writes make increments atomic and `update` returns the resulting row (section 15.1.6). Search
ships in M4, before the mail server needs it (roadmap).

#### G8. HTTP ingress beyond JSON actions

Problem. GitHub webhooks need the raw body for HMAC verification before parsing, a delivery id that
deduplicates, scope resolution from the path and a service principal. GitHub's manifest flow (and
later OpenID Connect) needs redirect responses. MTA-STS policy files are `text/plain`, autoconfig
documents are XML, JMAP downloads are byte streams with ranges.

Status: specified in section 16.5.8: receivers with deployment-level path enrichers, verification
by a principal resolver of the owning module before any principal is granted, delivery ids as
command ids, and the response kinds `raw`, `redirect`, `download` and `empty`.

#### G9. Process capabilities and singleton work

Problem. Process roles are `serve`, `work` or `all`. Some work can only run where a resource is:
the public mail ports on a host that sees real client addresses, outbound mail on a host with a
clean address. Reconcilers (edge, DNS) must run at most once per tenant at a time across
processes.

Status: proposal. The singleton lease lands with its ADR before M3 (the edge and DNS reconcilers),
process capabilities before M4 (the mail listeners); roadmap.

Proposal: `defineDeployment({ processes: { name: { roles, capabilities } } })` and a start flag
naming the process; listeners, schedules, asynchronous actions and reactions may declare a required
`capability`; a `singleton: true` option holds a lease per (action, scope) so two processes never
run the same reconciler for one tenant; readiness reports the capabilities a process serves. With
the edge configuration applied through the agent (a decision point in section 21), no process
needs the Caddy admin socket.

#### G10. Tenant-editable configuration with change events

Problem. Module configuration is stored per backend with per-tenant overrides, but nothing said who
may change it. Launchway's owners and admins edit settings in the UI, and a change must re-render
the edge or republish DNS records.

Status: specified in section 5.7: `configAccess: { level: 'tenant', edit: 'policy' }` generates
`<module>.config.get` and `<module>.config.set` under ordinary rules (secret fields sealed, section
6.6) and a typed `config.changed` event that reactions consume.

#### G11. Retention and purge

Problem. "Nothing deleted without a retention rule the operator chose" needs a mechanism. Mail
Trash and Junk, archived emails, closed previews (purged after seven days in Launchway v0.3.0),
deployment logs, delivery attempts and acknowledged node commands all need one.

Status: specified in section 14.7.1. Rules are adopted by the operator per backend with
per-tenant overrides; modules suggest defaults (30 days for Trash, Junk and archived mail, 30 days
for deployment logs, seven days for closed previews, 90 days for delivery attempts); purges remove
payloads, destroy per-record and blob keys in the same unit and drop projections such as search
indexes, while the chain keeps tombstones; rules cover stream records and blobs. Retention ships in
M3 (roadmap).

#### G12. Cross-cutting observers and request metadata

Problem. A reaction to another module's events requires that module in `requires` or `optional`.
`audit` must see every event of every module, as Launchway v0.3.0 records every mutation, and it
needs the request's remote address and user agent.

Status: the request metadata on the receipt is specified (sections 11 and 15.1.7). Proposal for the
rest: a module declares `observes: 'all'`, which allows `r.observeAll(...)` (an async reaction to
every event, dispatched like any other, section 7.7) and is listed in the registry and by
`pennestack doctor`. It lands with `audit` in M2 and needs no ADR beyond ADR 0015.

#### G13. Rules over credential scopes

Problem. A rule's subject was one module (and optionally an entity). API keys with the `read` scope
must be denied every command in every module, and app passwords must work only on the listeners
they were made for. Writing that rule in every module defeats composition.

Status: specified in section 8.1 and ADR 0005: rule subjects that match action kinds or transports
across modules, evaluated at the gate with the usual explanation.

```ts
rule.deny({ kinds: ['command'] }, { id: 'read-only-key', when: (ctx) => isReadOnlyKey(ctx), reason: 'This API key has the read scope only.' })
rule.allow({ transports: ['imap', 'smtp-submission'] }, { id: 'app-password', when: (ctx) => keyAllowsTransport(ctx) })
```

#### G14. Extension-point cardinality and carrier coverage checks

Status: specified in sections 5.2 and 5.5. `extensionPoint<T>({ mode: 'set', min: 1 })` turns an
empty slot into a named boot error (`emptyExtensionPoints: 'projects.gitProviders'`); a contract
provided by several modules is an error unless it is `set`-valued; and every carrier a listener
produces (SASL for IMAP and submission) must have at least one principal resolver that accepts it.

#### G15. Hyphenated module ids in the context types

Status: specified in sections 3.4 and 5.1. Module ids keep their hyphens in references
(`mail-store.email.get`) and appear in lower camel case in the context (`ctx.data.mailStore`,
`ctx.services.apiKeys`); ids that camel-case to the same name cannot be selected together.

## 18. Repository layout and package plan

```
pennestack/
  README.md
  docs/                      brief, architecture (this document), roadmap, adr/, research/, api-sketch.ts
  packages/
    core/                    @pennestack/core: DSL, registry, invoker and sessions, authorization, condition AST, errors,
                             field model, surface derivation, kernel write path, key service, job queue, core module,
                             subpaths /wire (dependency-free codecs for clients) and /ledger (the file ledger sink)
    data/                    @pennestack/data: the Kysely SQL family, migration planner with tracks, introspection,
                             the in-memory and PGlite adapters, the adapter conformance kit
    adapter-postgres/        @pennestack/adapter-postgres
    adapter-mysql/           @pennestack/adapter-mysql (M7)
    adapter-sqlite/          @pennestack/adapter-sqlite (M7)
    adapter-supabase/        @pennestack/adapter-supabase (M7): the PostgreSQL adapter with a preset
    events/                  @pennestack/events: consumers (projections, the reaction dispatcher), retention and erasure
                             workers, process managers, the `sync` module (M8)
    live/                    @pennestack/live: live hub, SSE and WebSocket carriers, watch generator, pokes, tickets
    transport-http/          @pennestack/transport-http: the HTTP host, the invocation protocol, the operator socket
    transport-rest/          @pennestack/transport-rest: REST projection, OpenAPI emitter, problem details
    transport-graphql/       @pennestack/transport-graphql: schema derivation, Yoga, subscriptions
    transport-trpc/          @pennestack/transport-trpc: runtime router, TrpcRouterOf<App>
    transport-webhooks/      @pennestack/transport-webhooks: receivers (gap G8)
    transport-jmap/          @pennestack/transport-jmap (M5)
    client/                  @pennestack/client: AppClient, remote client, SSE and WebSocket clients
    cli/                     @pennestack/cli: the `pennestack` binary and the CLI manifest artefact
    blobs-fs/                @pennestack/blobs-fs (M4); blobs-s3 later
    crdt-loro/               @pennestack/crdt-loro: the Loro codec, with the first app that declares a collaborative field
    sync-client/             @pennestack/sync-client (M8)
    module-accounts/         @pennestack/module-accounts
    module-auth/             @pennestack/module-auth
    module-api-keys/         @pennestack/module-api-keys
    module-members/          @pennestack/module-members
    module-audit/            @pennestack/module-audit
    module-dns/              @pennestack/module-dns, with dns-cloudflare/ and dns-manual/
    module-certificates/     @pennestack/module-certificates (M4)
    testing/                 @pennestack/testing: harness, local client, policy matchers, conformance suites, type helpers
    biome-config/            @pennestack/biome-config: the Biome preset and the GritQL plugins
  examples/
    portal/                  the accounts and authentication app of the M1 slice (roadmap.md)
    launchway/               the deployment platform app and its modules
    mail/                    the mail server app and its modules
  spikes/                    throwaway verifications (the type-model spike, the write-path measurement, the Connect descriptor spike)
  biome.json  pnpm-workspace.yaml  tsconfig.base.json  tsconfig.json  package.json
```

Later packages: `transport-static`, `transport-connect`, `module-outbound-webhooks`, `blobs-s3`,
and possibly `transport-orpc` and `queue-pg` (a pg-boss queue behind `JobQueue`). Milestones refer
to [roadmap.md](roadmap.md); packages without one belong to M0 to M3.

Rules:

- pnpm workspace with TypeScript project references; `tsc -b` builds the graph; every package
  compiles alone with the options of section 13.3.
- The dependency graph between packages is a DAG: `core` depends on nothing in the workspace;
  `data`, `events` and `live` depend on `core`; adapters depend on `data`; transports depend on
  `core`; modules depend on `core` and on the modules they require or optionally use; `client`
  depends on `core`'s types and its `wire` subpath; `cli` depends on `core`, `data` and `client`;
  examples depend on everything they select; `testing` depends on `core`, `data` and `client`.
- Every exported module and app value has a named type (section 13.11).
- The repository is private on GitHub (JensPenneman/pennestack) until Jens approves this
  architecture; it becomes public after that approval, published under the `@pennestack` scope.
  Every commit is signed with the author's personal identity; a `CONTRIBUTING.md` states both. The
  licence is a decision point for Jens (section 21).
- One `CHANGELOG.md` per package, kept by the release tooling; semantic versions; the `core`
  package's public types are a compatibility contract.
- Examples are the integration tests: CI boots both apps against PostgreSQL (and the in-memory
  adapter for fast suites; MySQL and SQLite from M7), runs the adversarial isolation suite, the
  transport conformance suite, the dual-evaluation authorization suite, `generate --check`,
  `db check`, the declaration-emit checks and the instantiation budgets (section 13.8).

## 19. How a new requirement lands

Requirements arrive incrementally and the brief is appended. The decision procedure for each
addition, in order:

1. **Configuration**: can the requirement be met by a value in `defineApp`, `defineDeployment`,
   a module's `config` or a tenant setting? Then it is configuration.
2. **Policy**: is it about who may do what? Then it is a rule set or a `ruleSources` filler.
3. **Module**: does it own data or behaviour? Then it is a module, possibly contributing to
   others and adapting to them, with its own migrations, policies and actions.
4. **Adapter or infrastructure entry**: is it a new database, queue, blob store, carrier,
   listener, transport or secret store? Then it fills an existing kernel or deployment extension
   point, or provides an existing contract.
5. **Extension point or contract**: does a module need to let future modules influence it, or to
   depend on a capability with several implementations? Then it declares a typed extension point
   or a contract; the kernel is unchanged.
6. **Kernel**: only when the pipeline, the scope and principal model, the composition rules, the
   condition AST or the error taxonomy must change. Such a change needs an ADR and updates this
   document.

The proof of the procedure is that the two addenda of 2026-10-08 landed in this document as a
kernel concept (scope) plus configuration, extension points and adapters, not as a new
architecture, and that the review of 2026-10-11 changed rules and contracts, not the shape of the
kernel.

## 20. Requirements traceability

| Brief requirement | Where it is met | How the text reads it |
|---|---|---|
| A backend framework fully in TypeScript; platforms assembled by selecting and toggling modules | 1, 4, 5 | |
| The deployment platform (Launchway's backend re-architected) and a mail server for `jenspenneman.com`, from the start | 17.3, 17.4, roadmap M3 and M5 | |
| All platforms run inside one deployment | 4.6, 17.5 | |
| Configuration system in TypeScript; app defined as a set of modules | 4.1, 4.5, 4.7 | |
| A module owns entities | 5.1, 6.1 | |
| Entities carry actions; actions on modules and the app | 6.7, 7.2 | |
| Modules plug and play, toggled independently, the application still works | 4.7 (checks and tests), 5.2, 5.3, 5.4 | A module can be switched off on its own unless a selected module `requires` it; then both go together. Soft influence uses `optional`, contributions and conditional parts. Listed as a decision point in section 21. |
| Modules influence each other, explicit and typed, both still toggleable | 5.3, 5.4, 5.5, 17.2, api-sketch.ts | |
| Multiple platforms from different selections | 4.5, 4.6, 17 | Selections are compiled apps; runtime module toggles are rejected (decision point in section 21). |
| CASL-style authorization in code, per action, with conditions; not plain RBAC | 8.1 to 8.4, 17.3.11 | The invoked action is the unit of authorization; rules have conditions on the row acted on and the row produced. |
| Everything about authorization configurable | 8.7 | |
| Transports as modules, several active together | 5.6, 16.3 | |
| GraphQL module generating a schema served on a URL | 16.6 | |
| REST module producing a full REST backend | 16.5 | |
| tRPC module | 16.7 | |
| Other transports later | 16.3.2, 16.13 | |
| Each transport derives from the same definitions | 16.2 (one surface), 16.4 (one set of rules), 16.3.8 (conformance) | |
| Authentication module in which users keep login information and sign in | 17.2 | |
| Separate accounts module; mutual influence | 5.4, 17.2.1 | |
| Pluggable databases: PostgreSQL, MySQL, a hosted service such as Supabase, Drizzle, anything fitting | 5.6, 14.3, 14.3.7 | PostgreSQL first (M1), MySQL, SQLite and the Supabase preset in M7; a Drizzle-based adapter waits for Drizzle 1.0, and existing Drizzle schemas are imported by `db introspect` (decision point in section 21). |
| CQRS-like execution; requests handled asynchronously | 7.1, 7.4, 9.5 | |
| Choose which requests are handled synchronously | 7.4, 16.4.7 | Declared per action; the app's map decides how external callers are answered. |
| Live updates on everything, delivered by a module | 6.7, 9.6, 15.4 | |
| Nothing truly deleted, everything appended to a chain | 6.6, 15.1, 14.7 | Chain entities are append-only; `state` entities, transient records, receipts and sync clients are operational data that retention purges, with defaults for the operational buffers (decision point in section 21). History is removed only by rules the operator adopts. |
| Multiple actors online and offline at the same time, handled gracefully | 15.3, 15.4.7 | Offline authorship ships in M8 and collaborative fields in M9 (decision point in section 21). |
| Database types always live, generated by a TypeScript server or an equivalent, whatever the connection | 13.1, 14.8 | Types are inferred from definitions with no generator in the type path. Tables the framework does not own are described by introspected definitions, checked against the live catalogue at `connect`, in `pennestack dev` and in CI (decision point in section 21). |
| Compiler, linter and toolchain always know what to do | 13.2 to 13.12 | |
| No frontend framework; everything works as an API and a backend framework | 16.5 to 16.8 | |
| A later UI fully pluggable | 16.10 | |
| A CLI may be built first and may live in this repository | 16.9, roadmap M1 | |
| One deployment hosts multiple backends, each with its own module selection | 2, 3.2, 4.6, 12 | |
| Multiple tenants per backend; new tenants and backends at runtime without redeploy | 3.3, 12, 14.4 | |
| Tenants isolated in data | 8.8, 12.1, 12.3, 14.4.3, 14.9 | |
| Tenants isolated in authentication realm | 17.2.8 | |
| Tenants isolated in configuration | 5.7, 12.1 | |
| Tenants isolated in secrets | 5.7, 14.7.4 | |
| Tenants isolated in domains | 12.1, 16.4.10, gap G2 | |
| Tenants isolated in quotas | 12.2, 15.1.4 | |
| A tenant can never observe another tenant's data; the operator administers everything | 8.8, 12.1, 12.3, 15.1.4, 15.2.6 | Positions are per scope, so even token values carry nothing about other tenants. |
| Tenant resolution in the pipeline, the same for every transport, the CLI and non-HTTP listeners | 9.2, 12.1, 16.3.3, 16.3.7, gap G1 | |
| Physical tenant data placement pluggable and invisible to application code | 12.3, 14.4, 14.9 | Semantics do not depend on placement (section 12.3). |
| Each layer states how it handles multi-tenancy | 3.5, 8.8, 9.7, 12, 14.9, 16.12 | |
| Living brief: appended, never rewritten | brief.md changelog | |
| New requirements land as module, adapter, policy or configuration; kernel changes need an ADR | 19, adr/0001 | |
| A framework Jens can build on without thinking about the framework | 3.4, 7.6, 13 | |
| Public repository on GitHub, every commit signed with the author's personal identity | 18 | The repository stays private until Jens approves the architecture and becomes public then. |
| Best practice from first principles, no copied conventions | this document and the ADRs cite research, not older projects | |
| The product name never references other companies' products | the working name and all package names are generic | |

## 21. Open questions

### 21.1 Decision points for Jens

Each changes the work; each has a recommendation, which the rest of this document assumes.

1. **Runtime module selection.** Should a backend's modules be fixed by the apps compiled into the
   deployment, or toggled per backend at runtime? Options: a catalogue of compiled apps, with
   runtime variation through per-backend module configuration; runtime toggles, with types that
   cannot follow the selection. Recommendation: the catalogue (section 4.6); a new combination is
   one `defineApp` line and a deploy.
2. **Toggling with requirements.** Is it acceptable that a module can only be switched off
   together with the modules that `require` it? Options: accept it and keep hard dependencies for
   genuine needs; make every dependency optional and type every cross-module access as possibly
   absent. Recommendation: accept it (section 5.2); soft influence already uses `optional`,
   contributions and conditional parts.
3. **DSL shape.** Should modules be defined with a builder chain whose callbacks receive typed
   contexts, or with a single object literal and a hand-written context annotation on every
   handler? Recommendation: the builder chain (section 4.1), as Hono, Elysia and Better Auth do;
   it is the only way to type `ctx.data` from sibling declarations.
4. **Data access inside handlers.** Should repository calls in a handler run with the module's own
   authority (the action having been authorized as a whole), or with the caller's authority plus
   declared grants for anything more? Options: module authority with explicit `forCaller()` reads
   and no silent narrowing; caller authority by default with typed grants per action.
   Recommendation: module authority (section 8.4); it keeps uniqueness checks and quotas correct,
   and the caller's view is one explicit call where an action lists or searches.
5. **Deny rules.** Should the first release have deny rules, or allow-only rules with `unless`
   conditions? Recommendation: allow and deny, deny requiring a reason and testing the row before
   the action unless it declares `check` (section 8.2); freezes and suspensions need an override
   that composes order-independently.
6. **Job queue.** Should the kernel queue run on every data adapter's job store, or should
   pennestack depend on pg-boss and PostgreSQL for queued work? Options: the adapter-backed kernel
   queue (`ps_jobs`, section 14.3.9); pg-boss 12.37.1, which leaves MySQL and SQLite deployments,
   `pennestack dev` on PGlite and in-memory tests without a queue. Recommendation: the kernel queue,
   keeping a pg-boss entry possible behind `JobQueue`.
7. **Personal data in state tables.** Plaintext state tables with crypto-shredding of the chain,
   or encrypted state columns with blind indexes? Recommendation: plaintext plus crypto-shredding
   (section 14.7.4); exposure is limited to old backups, bounded by backup retention and the
   ledger replay at restore.
8. **Operational data and its defaults.** `state` entities change in place and retention purges
   them; transient change records expire after 7 days, receipts after their action's window
   (24 hours by default) and inactive sync clients after 90 days, without an adopted rule. Accept
   these defaults, or require the operator to adopt even these? Recommendation: accept them
   (section 14.7.1); they are buffers, not history, and the operator can change them.
9. **Offline multi-actor sync.** When should it ship? Options: M8, after the mail server; earlier.
   Recommendation: M8 (roadmap); neither proof app needs offline authorship to launch, and every
   event from M1 already carries what sync needs.
10. **Before-images.** Should every event carry the previous values of the fields it changes from
    M1? Recommendation: yes (section 15.1.3); they cannot be added later for existing events, and
    they make change reports exact.
11. **Collaborative fields.** Store `richText` and `sequence` fields as Loro documents from the
    first app that declares one, or as plain values until M9 and migrate then? Recommendation: Loro
    from the start through the codec extension point (section 15.3.9), so M9 adds protocols and no
    data migration.
12. **MySQL.** Keep MySQL in the adapter set? Recommendation: keep it in M7 because the brief names
    it, and recommend PostgreSQL for multi-tenant production (no row-level security on MySQL).
13. **Drizzle.** Build a Drizzle-based adapter now on drizzle-orm 0.45, or wait for Drizzle 1.0
    and import existing Drizzle schemas with `pennestack db introspect --drizzle`? Recommendation:
    wait (section 14.3.7); the import covers the common need.
14. **External tables.** Type tables the framework does not own by introspected entity
    definitions with drift checks at `connect`, in `pennestack dev` and in CI, or by declaration
    files generated from live introspection? Recommendation: introspected definitions (section
    14.8.4); one type mechanism and no generator in the type path.
15. **oRPC.** Include oRPC beside the required tRPC module in the first release? Recommendation:
    defer it (ADR 0011); the invocation protocol and `AppClient` already give typed clients, and
    oRPC remains one more adapter.
16. **CLI namespace.** Should action commands sit at the top level beside framework commands, or
    under a verb (`pennestack run <module> ...`)? Recommendation: top level with 29 reserved names
    (section 16.9.3); daily commands stay short.
17. **Operator impersonation.** What may `pennestack explain --as <principal>` do? Options: evaluate
    only, everywhere; also execute, logged. Recommendation: evaluate everywhere, execute only in
    development.
18. **Protobuf tags.** Allocate `.tag(n)` field numbers from day one, or when the Connect transport
    arrives? Recommendation: from day one; a number in a snapshot now, a migration of every entity
    later.
19. **Instants.** `Date` now and `Temporal.Instant` once Node 26 is the baseline, or Temporal from
    the start with a polyfill? Recommendation: `Date` now behind `field.instant()`, so the switch
    touches no application code.
20. **Licence** for the repository once it is public. Options: Apache-2.0; MIT. Recommendation:
    Apache-2.0 for its explicit patent grant; both fit every library named.
21. **Outbound mail from the home connection.** Residential addresses sit on policy blocklists and
    their reverse DNS belongs to the provider. Options: relay through an external host with a static
    address; a second pennestack process with the `outbound-mail` capability on such a host; direct
    delivery from home. Recommendation: relay first; direct delivery is built anyway and becomes the
    production path on a node with a clean address.
22. **IMAP.** How does the mail server serve IMAP clients? Options: an own IMAP listener after
    JMAP; JMAP only; an external IMAP server with its own storage. Recommendation: an own listener
    after JMAP (M6); an external server would split mailbox state from the store.
23. **Launchway compatibility.** How do deployed agents and the UI survive the migration?
    Options: a compatibility transport for agent protocol v1 plus the generated API for the UI;
    keep the `/api/v1` paths through hints; a clean break. Recommendation: the v1 transport plus
    the generated API.
24. **Edge configuration.** Apply Caddy's configuration through the edge node's agent, or through
    a shared admin socket with a process on the edge host? Recommendation: through the agent; no
    co-location rule, any number of pennestack processes.
25. **Node ownership.** Do nodes and the edge belong to one tenant, or does the operator run shared
    pools? Recommendation: tenant-owned for the first release; shared pools need container
    isolation on shared Docker hosts.
26. **A separate domain for untrusted apps.** Should Launchway serve tenant projects and previews
    under a registrable domain other than `jenspenneman.com`? Options: a separate domain; subdomains
    with cookie hardening only. Recommendation: a separate domain (section 17.5.2); same-site code
    defeats `SameSite=Lax`.
27. **Ledger and control store at home.** Run the control store in its own PostgreSQL instance
    with the erasure ledger also written to a file on a separate volume, or keep one instance with
    the ledger file only? Recommendation: two instances plus the ledger file (section 17.5.2), so a
    restore of either never brings back erased data.

### 21.2 Open for the spike (roadmap M0)

1. The type-model checklist of section 4.7: the builder chain, module-local contexts, all field
   flags, generated actions with typed `watch`, `defineApp` options, `AppActionTree` from the field
   model; and `api-sketch.ts` compiled as the acceptance test of the DSL.
2. The instantiation budgets on synthetic apps of 25 and 40 modules, and the declaration-size
   budget per module under the pnpm layout.
3. Whether the `Check` property form or a rest-parameter form gives the better editor message at
   `defineApp`.
4. Whether `ctx.data` of optional modules is best typed `| undefined` or as a `Maybe` object with
   `.ifPresent()`, after writing the auth module against it.
5. The write path on a networked PostgreSQL: concurrent writers in many tenants, the commit tail
   per scope, the notifier's coalescing, and the absence of cross-tenant waiting.

### 21.3 Open questions by area

Data:

- Which mail entities declare `partition: 'accountId'` beyond `email` and `mailboxEntry`, and
  whether mail search must work on SQLite (`fts5`) or only on PostgreSQL.
- The clock-skew bound for offline clients (5 minutes by default).
- Whether heads of the hash chain should later be anchored outside the database, and the threshold
  for partitioning `ps_events`.

Interfaces:

- Whether GraphQL should also serve an operator schema at the operator endpoint, or operator work
  stays on the invocation protocol and the CLI.
- Whether `@escape.tech/graphql-armor` (last published 2025-12-29) stays maintained, or the
  operation limits become own validation rules.
- The upload side of blobs (multipart or resumable uploads, JMAP's upload endpoint), with gap G5.
- The Connect runtime-descriptor spike, when the Connect transport is scheduled.

Platforms:

- `acme-client` 5.4.0 (MIT) implements RFC 8555 completely but has had no commit since 2024-07-17;
  `@certd/acme-client` 1.45.0 is a maintained fork with dependencies of its own. Use the original,
  the fork, or a small own ACME client on `node:crypto` and `fetch`?
- Does the home connection allow inbound ports 25, 465, 587 and 993 and outbound port 25, and does
  Docker Desktop's port publishing preserve client source addresses? Both need a probe from the
  home server.
- Account sharing (RFC 9670) and shared mailboxes in the first release, or one owner per mail
  account?
- Sieve and ManageSieve in the first release, or only the JMAP vacation response?
- Until pennestack has a UI, is a third-party JMAP web client acceptable for webmail?
- One login for Launchway and mail needs an OpenID Connect provider module; the first release keeps
  the realms separate, as the brief's per-tenant realms imply. Confirm.
- DMARC rollout: start with `p=none` and reports, move to `quarantine` and then `reject` after a
  clean month?
- The suggested retention defaults: 30 days for Trash, Junk and archived mail, 30 days for
  deployment logs, seven days for closed previews, 90 days for delivery attempts.
- Do Launchway's platform modules stay under `examples/launchway` or move to the Launchway
  repository as its backend once the framework is public?
- An outbound webhooks module (Standard Webhooks, `standardwebhooks` 1.1.1) for deployment
  notifications: part of Launchway's first pennestack release or later?

## Appendix A. Versions checked

The libraries and components named in this document, with the version checked and the date. The
toolchain is in section 13.2.

### A.1 Data layer

| Package or product | Version | Licence | Checked | Use here |
|---|---|---|---|---|
| `kysely` | 0.29.6 (`next`: 0.30.0-beta.2) | MIT | 2026-10-10; tarball inspected 2026-10-11 (dialects `postgres`, `mysql`, `sqlite`, `pglite`, `mssql`; `transformQuery` plugins; savepoints) | SQL family substrate |
| `pg` | 8.23.1 | MIT | 2026-10-10 | PostgreSQL driver |
| `mysql2` | 3.24.5 | MIT | 2026-10-10 | MySQL driver |
| `node:sqlite` | Node.js 24.21.0 with SQLite 3.53.4 | MIT | 2026-10-11, run locally without an experimental warning | SQLite driver |
| `better-sqlite3` | 13.0.3 | MIT | 2026-10-10 | SQLite fallback driver |
| `@electric-sql/pglite` | 0.5.8 (PostgreSQL 18.3) | Apache-2.0 | 2026-10-11, used to run the PostgreSQL checks of this document | tests and `pennestack dev` |
| `drizzle-orm` | 0.45.4 (`rc`: 1.0.0-rc.4) | Apache-2.0 | 2026-10-11 (`getTableConfig` in `pg-core`, `mysql-core`, `sqlite-core`) | `db introspect --drizzle`; a later adapter |
| `drizzle-kit` | 0.31.11 | MIT | 2026-10-11 | prior art for diffing and rename prompts; not a dependency |
| `@supabase/supabase-js` | 2.117.3 | MIT | 2026-10-11 | optional Supabase modules only |
| `loro-crdt` | 1.16.4 | MIT | 2026-10-11 (API names in the type definitions) | CRDT codec |
| `yjs` | 13.6.33 | MIT | 2026-10-10 | possible second codec |
| `uuid` | 14.0.3 (published 2026-10-10) | MIT | 2026-10-10 | UUIDv7 |
| `pg-boss` | 12.37.1 | MIT | 2026-10-10 | prior art for the kernel job queue; a possible `queue-pg` entry (section 9.5) |
| `kysely-codegen` | 0.20.0 | MIT | 2026-10-11 | prior art for introspection; not a dependency |
| `canonicalize` | 5.1.0 | Apache-2.0 | 2026-10-11 | independent RFC 8785 implementation in tests |
| `fast-check` | 4.10.2 | MIT | 2026-10-10 | property tests |
| `testcontainers`, `@testcontainers/postgresql`, `@testcontainers/mysql` | 12.2.0 | MIT | 2026-10-11 | CI databases |
| `@standard-schema/spec` | 1.1.0 | MIT | 2026-10-11 | adapter option schemas |
| `pg-logical-replication` | 2.5.0 | MIT | 2026-10-11 | candidate for a later `stream` feed level; not used |

### A.2 Interfaces

Checked against the npm registry on 2026-10-10 and 2026-10-11.

| Package | Version | Published |
|---|---|---|
| `typescript` | 7.0.2 | 2026-07-08 |
| `@biomejs/biome` | 2.5.15 | 2026-09-30 |
| `vitest` / `expect-type` | 5.0.3 / 1.4.0 | 2026-09-30 / 2026-06-25 |
| `@ark/attest` | 0.57.0 | 2026-10-07 |
| `hono` / `@hono/node-server` | 4.13.13 / 2.1.4 | 2026-10-04 / 2026-10-08 |
| `ws` | 8.22.0 | 2026-09-26 |
| `graphql` | 17.0.2 | 2026-07-03 |
| `graphql-yoga` | 5.24.4 | 2026-10-08 |
| `graphql-ws` / `graphql-sse` | 6.3.0 / 2.6.2 | 2026-09-24 / 2026-09-29 |
| `@graphql-yoga/plugin-persisted-operations` | 3.24.4 | 2026-10-08 |
| `@envelop/opentelemetry` | 9.2.2 | 2026-10-05 |
| `@escape.tech/graphql-armor` | 3.2.0 | 2025-12-29 |
| `dataloader` | 2.2.3 | 2024-12-03 |
| `@trpc/server` / `@trpc/client` | 11.19.0 / 11.19.0 | 2026-09-16 / 2026-09-16 |
| `superjson` | 2.2.6 | 2025-11-27 |
| `@orpc/server` (not adopted) | 1.15.5 | 2026-10-07 |
| `@hono/zod-openapi` / `hono-openapi` (not adopted) | 1.6.3 / 1.3.5 | 2026-09-04 / 2026-10-07 |
| `@stricli/core` / `@stricli/auto-complete` | 1.3.0 / 1.3.0 | 2026-07-16 / 2026-07-16 |
| `yaml` | 2.9.1 | 2026-09-11 |
| `eventsource-parser` | 4.1.1 | 2026-09-15 |
| `@scalar/hono-api-reference` | 0.12.11 | 2026-10-07 |
| `@scalar/openapi-parser` | 0.29.12 | 2026-10-07 |
| `openapi-typescript` | 7.13.0 | 2026-02-11 |
| `gql.tada` | 1.11.4 | 2026-10-02 |
| `@standard-schema/spec` | 1.1.0 | 2025-12-15 |
| `standardwebhooks` | 1.1.1 | 2026-08-28 |
| `@bufbuild/protobuf` / `@connectrpc/connect` (later) | 2.16.0 / 2.2.0 | 2026-09-29 / 2026-09-07 |
| `@opentelemetry/api` / `sdk-node` / `semantic-conventions` | 1.9.1 / 0.223.0 / 1.43.0 | 2026-03-25 / 2026-10-06 / 2026-07-09 |
| `pino` | 10.4.0 | 2026-10-02 |

Standards cited: RFC 3339 (timestamps), RFC 7240 (`Prefer`), RFC 7396 (JSON Merge Patch), RFC 8259
(JSON), RFC 8288 (`Link`), RFC 8620, 8621 and 8887 (JMAP), RFC 8785 (JSON Canonicalization Scheme),
RFC 9457 (problem details), RFC 10008 (the HTTP `QUERY` method, Proposed Standard, 2026), OpenAPI
3.1.1 and 3.2.0, the GraphQL-over-SSE and `graphql-transport-ws` protocols, the Standard Webhooks
specification, W3C Trace Context.

### A.3 Platforms

Checked on 2026-10-11 with `npm view` (packages) or the project's repository (components).

| Package or component | Version | Licence | Role here |
|---|---|---|---|
| `smtp-server` | 3.19.21 | MIT-0 | SMTP protocol for `smtp-in` and `smtp-submission` |
| `nodemailer` | 10.1.0 | MIT-0 | SMTP client for `mail-delivery` |
| `mailauth` | 7.3.0 | MIT | SPF, DKIM (RSA and Ed25519), DMARC, ARC, MTA-STS |
| `mailparser` | 3.9.38 | MIT | MIME parsing |
| `libmime` | 5.4.7 | MIT | header encoding and decoding |
| `mailsplit` | 5.4.6 | MIT or EUPL-1.1+ | streaming MIME splitting for byte offsets |
| `imapflow` | 2.4.0 | MIT | IMAP client for tests |
| `jmap-jam` | 0.13.8 | MIT | JMAP client for tests |
| `wildduck` | 1.46.1 | EUPL-1.2 | examined, not used |
| `pg-boss` | 12.37.1 | MIT | examined; the kernel queue covers its primitives (section 9.5) |
| `ws` | 8.22.0 | MIT | WebSocket server under the HTTP host |
| `@orpc/server` | 1.15.5 | MIT | examined for agent protocol v2; not adopted (ADR 0011) |
| `@simplewebauthn/server` | 14.0.3 | MIT | passkeys in `auth` |
| `@octokit/app` | 16.1.4 | MIT | GitHub App authentication |
| `@octokit/rest` | 22.0.1 | MIT | GitHub REST calls |
| `@octokit/webhooks` | 14.2.0 | MIT | webhook signature verification |
| `standardwebhooks` | 1.1.1 | MIT | outbound webhooks, later |
| `acme-client` | 5.4.0 (last commit 2024-07-17) | MIT | ACME for `certificates` (open question) |
| `@certd/acme-client` | 1.45.0 | MIT | maintained fork, examined |
| rspamd | 4.2.2 (2026-10-10) | Apache-2.0 | spam scoring, external |
| Valkey | 9.1.2 (2026-09-01) | BSD-3-Clause | rspamd statistics, external |
| Unbound | repository active 2026-10-09 | BSD-3-Clause | recursive resolver, external |
| ClamAV | repository active 2026-08-27 | GPL-2.0 | antivirus, external, optional |
| Stalwart | v0.16.25 (2026-10-05) | AGPL-3.0-only or its enterprise licence | conformance reference, not used |
| imaptest | repository active 2026-10-01 | MIT | IMAP conformance tests |

### A.4 Added while consolidating (2026-10-11)

| Package or component | Version | Licence | Use here |
|---|---|---|---|
| `typescript` | 7.0.2 and 5.9.3 | Apache-2.0 | the checks of the section 4.7 listing, the synthetic apps and the declaration-emit chain |
| Node.js `node:crypto` `argon2` | Node 24.21.0 | MIT | Argon2id password hashing in `auth` (section 17.2.2), run without an experimental warning |
| `@simplewebauthn/server` | 14.0.3 | MIT | passkeys in `auth` |

## Appendix B. Verified typing listing

Checked on 2026-10-10 and 2026-10-11 with TypeScript 7.0.2, `@trpc/server` and `@trpc/client`
11.19.0, `--strict --exactOptionalPropertyTypes --noUncheckedIndexedAccess`: zero errors, every
`@ts-expect-error` consumed, 6,618 instantiations for the file including tRPC's own types. A
generated variant with 20 modules, 100 entities and 880 actions costs 60,784 instantiations and
43 ms of checking for the client type plus one call of each kind. The action tree is written out by
hand here; in the framework it is the core's `AppActionTree<App>` (section 4.7).

```ts
import type { TRPCBuiltRouter, TRPCQueryProcedure, TRPCMutationProcedure, TRPCSubscriptionProcedure } from '@trpc/server'
import { createTRPCClient, httpLink } from '@trpc/client'

type Execution = 'sync' | 'async' | 'either'
interface ActionType<K extends 'query' | 'command' | 'subscription', I, O, X extends Execution = 'sync', Ev = never, Res extends boolean = true> {
  readonly kind: K; readonly input: I; readonly output: O; readonly execution: X; readonly event: Ev; readonly resumable: Res
}
interface CommandReceipt { readonly commandId: string; readonly status: 'accepted' }
interface Emitted<E> { readonly event: E; readonly state?: string }
type StreamControl =
  | { readonly control: 'head'; readonly state: string }
  | { readonly control: 'reset'; readonly reason: 'overflow' | 'expired' | 'resync'; readonly state?: string }
  | { readonly control: 'gap'; readonly missed?: number }
type LiveFrame<E> = Emitted<E> | StreamControl

interface Profile { id: string; displayName: string; email?: string; version: number }

// What the core's AppActionTree<App> would compute: module -> (module actions | entity -> entity actions).
interface Tree {
  accounts: {
    actions: {
      register: ActionType<'command', { displayName: string; email: string }, { profileId: string }>
      identities: ActionType<'query', { profileId: string }, { providers: { id: string; label: string }[] }>
      ticker: ActionType<'subscription', {}, never, 'sync', { n: number }, false>
    }
    entities: {
      profile: {
        get: ActionType<'query', { ids: readonly string[] }, { list: Profile[]; notFound: string[]; state: string }>
        deactivate: ActionType<'command', { id: string; reason?: string }, Profile, 'either'>
        archiveAll: ActionType<'command', { reason: string }, { count: number }, 'async'>
        watch: ActionType<'subscription', { filter?: Record<string, unknown> }, never, 'sync', { type: 'changed'; id: string }>
      }
    }
  }
  app: { actions: { health: ActionType<'query', void, { ok: boolean }> }; entities: {} }
}

// ---- flat ref map, no recursion: `${module}.${action}` and `${module}.${entity}.${action}`
type ModuleRefs<T> = { [M in keyof T & string]: T[M] extends { actions: infer A } ? `${M}.${keyof A & string}` : never }[keyof T & string]
type EntityRefs<T> = {
  [M in keyof T & string]: T[M] extends { entities: infer Es }
    ? { [E in keyof Es & string]: `${M}.${E}.${keyof Es[E] & string}` }[keyof Es & string]
    : never
}[keyof T & string]
type Refs<T> = ModuleRefs<T> | EntityRefs<T>
type ActionAt<T, R extends string> =
  R extends `${infer M}.${infer E}.${infer A}`
    ? M extends keyof T ? T[M] extends { entities: infer Es } ? E extends keyof Es ? A extends keyof Es[E] ? Es[E][A] : never : never : never : never
    : R extends `${infer M}.${infer A}`
      ? M extends keyof T ? T[M] extends { actions: infer As } ? A extends keyof As ? As[A] : never : never : never
      : never

// ---- typed client over the invocation protocol or the in-process invoker
type ResultOf<A, P> =
  A extends { kind: 'query' } ? A extends { output: infer O } ? O : never
  : A extends { execution: 'sync'; output: infer O } ? O
  : A extends { execution: 'async' } ? CommandReceipt
  : A extends { output: infer O } ? (P extends 'async' ? CommandReceipt : O) : never
type InvokeRefs<T> = { [R in Refs<T>]: ActionAt<T, R> extends { kind: 'subscription' } ? never : R }[Refs<T>]
type SubscribeRefs<T> = { [R in Refs<T>]: ActionAt<T, R> extends { kind: 'subscription' } ? R : never }[Refs<T>]
interface AppClient<T> {
  invoke<R extends InvokeRefs<T>, const P extends 'sync' | 'async' = 'sync'>(
    ref: R, input: ActionAt<T, R> extends { input: infer I } ? I : never, options?: { prefer?: P; commandId?: string },
  ): Promise<ResultOf<ActionAt<T, R>, P>>
  subscribe<R extends SubscribeRefs<T>>(
    ref: R, input: ActionAt<T, R> extends { input: infer I } ? I : never, options?: { after?: string },
  ): AsyncIterable<LiveFrame<ActionAt<T, R> extends { event: infer E } ? E : never>>
}

// ---- tRPC router type: two explicit levels, no recursion
interface PennestackTrpcRoot { ctx: object; meta: object; errorShape: { message: string; code: number; data: { pennestack: { kind: string; code: string } } }; transformer: true }
type Procedure<A> =
  A extends { kind: 'query'; input: infer I; output: infer O } ? TRPCQueryProcedure<{ input: I; output: O; meta: object }>
  : A extends { kind: 'command'; input: infer I; output: infer O; execution: infer X }
    ? TRPCMutationProcedure<{ input: I; output: X extends 'sync' ? O : X extends 'async' ? CommandReceipt : O | CommandReceipt; meta: object }>
  : A extends { kind: 'subscription'; input: infer I; event: infer E; resumable: infer Res }
    ? TRPCSubscriptionProcedure<{
        input: I & { lastEventId?: string | null }
        output: AsyncIterable<Res extends true ? { id: string; data: E | StreamControl } : E | StreamControl, void, unknown>
        meta: object
      }>
  : never
type TrpcRecord<T> = {
  [M in keyof T]:
    (T[M] extends { actions: infer As } ? { [A in keyof As]: Procedure<As[A]> } : {})
    & (T[M] extends { entities: infer Es } ? { [E in keyof Es]: { [A in keyof Es[E]]: Procedure<Es[E][A]> } } : {})
}
type TrpcRouter<T> = TRPCBuiltRouter<PennestackTrpcRoot, TrpcRecord<T>>

// ---- assertions
declare const client: AppClient<Tree>
async function useClient() {
  const r = await client.invoke('accounts.register', { displayName: 'J', email: 'j@x' })
  const id: string = r.profileId
  const p = await client.invoke('accounts.profile.deactivate', { id })
  const v: number = p.version
  const receipt = await client.invoke('accounts.profile.deactivate', { id }, { prefer: 'async' })
  const c: string = receipt.commandId
  const queued = await client.invoke('accounts.profile.archiveAll', { reason: 'x' })
  const s: 'accepted' = queued.status
  // @ts-expect-error unknown action
  await client.invoke('accounts.profile.nope', {})
  // @ts-expect-error wrong input
  await client.invoke('accounts.register', { displayName: 1 })
  // @ts-expect-error subscriptions are not invoked
  await client.invoke('accounts.profile.watch', {})
  for await (const f of client.subscribe('accounts.profile.watch', {}, { after: 's1' })) {
    if ('control' in f) { if (f.control === 'reset') { const r: string = f.reason; void r }; continue }
    const t: 'changed' = f.event.type; void t
  }
  const h = await client.invoke('app.health', undefined)
  void [id, v, c, s, h.ok]
}

const trpc = createTRPCClient<TrpcRouter<Tree>>({ links: [httpLink({ url: 'http://localhost:3000/trpc', transformer: { serialize: (x: unknown) => x, deserialize: (x: unknown) => x } })] })
async function useTrpc() {
  const p = await trpc.accounts.profile.deactivate.mutate({ id: 'prof_1' })
  // @ts-expect-error an 'either' command may answer with a receipt
  const v0: number = p.version
  const v: number = 'commandId' in p ? 0 : p.version
  const q = await trpc.accounts.profile.archiveAll.mutate({ reason: 'x' })
  const st: 'accepted' = q.status
  void [v0, st]
  const g = await trpc.accounts.profile.get.query({ ids: ['prof_1'] })
  const n: string[] = g.notFound
  const r = await trpc.accounts.register.mutate({ displayName: 'J', email: 'j@x' })
  // @ts-expect-error mutations have no .query
  await trpc.accounts.register.query({ displayName: 'J', email: 'j@x' })
  const sub = trpc.accounts.profile.watch.subscribe({}, {
    onData: (d) => { const i: string = d.id; const data = d.data; if ('control' in data) return; const t: 'changed' = data.type; void [i, t] },
  })
  sub.unsubscribe()
  const tick = trpc.accounts.ticker.subscribe({}, { onData: (d) => { if ('control' in d) return; const k: number = d.n; void k } })
  tick.unsubscribe()
  void [v, n, r.profileId]
}
void useClient; void useTrpc
```

Further checks on 2026-10-10 and 2026-10-11:

- `isolatedDeclarations`: a module and an app defined with the DSL shape (`export const accounts =
  defineModule({ id: 'accounts' }).entities({ ... })`, `export const app = defineApp({ ... })`) fail
  with TS9010 ("Variable must have an explicit type annotation with --isolatedDeclarations") and
  TS9013 ("Expression type can't be inferred with --isolatedDeclarations") on TypeScript 7.0.2.
- Vitest 5.0.3 `--typecheck` with TypeScript 7.0.2: a passing `expectTypeOf` assertion passes and a
  deliberately wrong one is reported as a `TypeCheckError`.
- TypeScript 7.0.2 reports `Instantiations` under `--extendedDiagnostics` and writes a trace with
  `--generateTrace`.
- Node 24.21.0: a workspace package linked into `node_modules` and resolved through the
  `@pennestack/source`-style condition runs from its `.ts` source; the same package copied into
  `node_modules` fails with `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`.
