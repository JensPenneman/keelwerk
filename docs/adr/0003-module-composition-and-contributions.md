# 3. Module composition: a const tuple, hard requirements and contracts, soft contributions, extension points, deployment infrastructure

Date: 2026-10-08 (revised 2026-10-11)

## Status

Proposed

## Context

The brief requires an application defined as a set of modules that are individually toggleable,
that influence each other in an explicit and typed way (accounts and authentication being the
canonical pair), with exact types, and that can be composed into different platforms. It also
requires that one deployment hosts several backends with their own module selection, created at
runtime.

The research (module-systems.md) surveyed thirteen frameworks. Runtime-resolved systems (NestJS,
Vendure, Medusa, Strapi, Fastify) type cross-module contributions by assertion or by
`declare module` augmentation, which applies whenever a file is compiled rather than when a module
is selected. Generator-based systems (Payload, Keystone, RedwoodJS, Wasp) are correct only after a
second compiler runs. Inference-based systems (Better Auth, Elysia, Hono, Effect) derive types from
the composing value, so toggling changes the types; Better Auth's plugins contributing columns to
core tables is the closest match. The research also measured the checker's limits and showed that
mapped types keyed by module id with `Extract` avoid recursion.

Mutual influence raises a second problem: two packages that import each other form a cycle that
`tsc -b` project references forbid.

The review of 2026-10-11 found five more problems in the first version of this decision:

- Module values had anonymous inferred types, and `requires`, `optional` and `contributes[].to`
  hold each dependency's full type. Declaration emit, mandatory under `composite`, copied every
  dependency's structure into each dependant's `.d.ts`, recursively, until TypeScript refused with
  TS7056 at a depth both proof apps reach.
- Conflicting fields were detected by comparing types, which misses subtype-related types (an
  enum and a string); case 9 of the listing contradicted the reference rules; generated actions,
  conditional module actions, core and app actions were missing from the action references.
- Capabilities with several implementations (a blob store, a live hub) could only be required as a
  concrete module, which defeats plug and play, or typed as present when absent.
- Data adapters, the HTTP host, blob stores, tenant resolvers and listener ports were app-level
  extension points, although one deployment shares them across apps and some must exist before any
  app loads.
- Behavioural extension values and services ran with the wrong module's context: a filler with
  the declaring module's, a service with the caller's.

## Decision

1. An app is `defineApp({ id, modules: [...] })` over a `const` tuple of module values; the `core`
   module is always prepended. Every derived type (`AppEntities`, `ActionRef`, `AppActionTree`) is a
   non-recursive mapped type over the union of module ids with `Extract` by id. Declaration merging
   is never used for anything that depends on the selection. Module types are computed from the
   module alone where code runs inside a module (`ActionContext<M>`, ADR 0004); app types serve
   clients, transports and the generated file.
2. Every exported module and app value has a named type: `export interface Auth extends
   ModuleType<typeof authDef> {}` and `export const auth: Auth = authDef`, so declaration emit stays
   about one kilobyte per module (measured 2026-10-11 on TypeScript 7.0.2, against 219 KB at the
   tenth module of a chain without names). `pennestack module new` scaffolds it, a GritQL rule
   flags an exported value without it, and CI checks declaration sizes and TS7056, TS2742 and
   TS4023 for both proof apps. `@pennestack/core` exports every type that can appear in a module
   value's type.
3. A module declares hard dependencies in `requires` and soft dependencies in `optional`. Both hold
   module values or **contracts**: named capabilities with a typed interface (`live`, `blobs`,
   `httpHost`) that modules or infrastructure entries `provide`. App-level contracts must be
   provided by a selected module (checked by `defineApp`), deployment-level contracts by an
   infrastructure entry (checked by `defineDeployment`); the context types the matching member as
   present, possibly undefined or absent. References may point only at the module itself, its hard
   requirements, and, inside a contribution or conditional part, at the target and `when` modules.
4. A module adds to other modules through **contributions** (`c.to(target, { fields, relations,
   actions, policies, extension-point values, when: [...] })`), active only when the target and the
   `when` modules are selected and dropped silently otherwise; when active, they are checked
   against the target's real definition, so naming an entity the target lacks is a compile error.
   Contributed fields must be optional or defaulted.
5. A module adapts **itself** through **conditional parts** (`w.when([modules or app-level
   contracts], { fields, actions, reactions })`), present only when those are selected; inside them
   the `when` modules count as required.
6. A module declares typed **extension points** that others fill through contributions, without the
   owner importing them, with modes `set`, `ordered` and `single` and an optional minimum. Values
   that carry behaviour are factories `(own) => value`, and services are functions of their
   provider: the kernel binds both per invocation to the providing module's context (same scope,
   principal, unit and trace; the provider's data authority, configuration and secrets), and call
   sites pass no context. The principal never widens.
7. Extension points come in two levels. App-level kernel points hold what an app chooses
   (transports, listeners, principal resolvers and enrichers, middleware, rule sources, CRDT codecs,
   the live hub and carriers, entity action generators, schedules). Deployment-level points hold
   the infrastructure listed in `defineDeployment({ infrastructure })`: data adapter factories (with
   the event store and the job store), the job queue, blob stores, the HTTP host, secret providers,
   ledger sinks, tenant resolvers in deployment order, carrier enrichers and listener port bindings.
   Apps never list adapters or the host.
8. The import graph between module packages is a DAG. The lower module publishes contracts
   (entities, events, extension points); the higher module imports it, contributes to it and adapts
   itself to it. For the accounts and authentication pair, accounts is lower.
9. `defineModule`, `defineApp` and `defineDeployment` reject, with named errors, references outside
   the requirements, contributed fields without a default, missing modules and contracts, duplicate
   and reserved ids, fields defined by more than one source (counted by source, whatever the types),
   contributions to unknown entities, references to unselected modules, execution overrides for
   unknown commands, camel-case collisions of module ids and missing infrastructure. A type-level
   test suite asserts the fourteen cases of architecture.md section 4.7; the listing was checked on
   2026-10-11 with TypeScript 7.0.2 and 5.9.3.
10. Module ids are permanent literals matching `[a-z][a-z0-9]*(-[a-z][a-z0-9]*)*`; they appear in
    lower camel case in contexts; renaming is an explicit data migration.
11. Backends are runtime instances of apps compiled into the deployment (`defineDeployment({ apps })`).
    Selecting modules per backend at runtime is rejected because the types could not follow it;
    runtime variation goes through per-backend module configuration.
12. Composition at runtime mirrors the types: the same checks, topological order by `requires`
    with tuple order as tie-break, contributions applied in that order, lifecycle phases
    `setup`, `start`, `stop` (reversed), plus `onBackendCreated` and `onTenantCreated`.

## Consequences

- Removing a module removes its contributions from the types and the runtime at the same moment;
  a missing hard dependency or contract is a compile error; nothing is typed that does not exist.
- Mutual influence is expressible without import cycles, at the cost of deciding which module of
  a pair is lower; both still compile and run alone.
- A module can be switched off on its own unless another selected module requires it; this reading
  of "independently toggleable" is a decision point for Jens (architecture.md section 21).
- Type-instantiation cost grows faster than linearly with the module count (the fold measured
  195,783 instantiations at 25 modules and 408,543 at 40 on TypeScript 7.0.2); it is paid once
  per app, bounded by the non-recursive model and guarded by CI budgets set from synthetic 25- and
  40-module apps.
- Named module types cost two lines per module and keep declaration files proportional to each
  package; `isolatedDeclarations` still cannot be enabled in module packages.
- Contributions require a type of the target, so a module package depends on the packages it
  contributes to; this is explicit and desirable.
- Runtime module selection is deliberately not supported; a new combination is a new `defineApp`
  line and a deploy.
- Infrastructure is configured once per deployment; an app's types never depend on which database
  or blob store a deployment uses, and modules that need a dialect declare it as a data need.
