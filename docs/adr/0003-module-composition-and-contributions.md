# 3. Module composition: a const tuple, hard requirements, soft contributions, extension points

Date: 2026-10-08

## Status

Accepted

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

## Decision

1. An app is `defineApp({ id, modules: [...] })` over a `const` tuple of module values. Every
   derived type (`AppEntities`, `ActionRefs`, contexts) is a non-recursive mapped type over the
   union of module ids with `Extract` by id. Declaration merging is never used for anything that
   depends on the selection.
2. A module declares hard dependencies in `requires` (checked at compile time: `defineApp` is
   uncallable when one is missing, and again at boot) and soft dependencies in `optional` (typed
   as possibly undefined in the context). Both hold module values, so the import graph is explicit.
3. A module adds to other modules through **contributions** (`c.to(target, { fields, relations,
   actions, policies, extension-point values, when: [...] })`), active only when the target and the
   `when` modules are selected and dropped silently otherwise; when active, they are checked
   against the target's real definition, so naming an entity the target lacks is a compile error.
4. A module adapts **itself** through **conditional parts** (`w.when([modules], { fields, actions,
   reactions })`), present only when those modules are selected.
5. A module declares typed **extension points** that others fill through contributions, without
   the owner importing them. The kernel's own extension points (transports, hosts, listeners,
   data adapters, event stores, queues, live carriers, resolvers, middleware, secret providers,
   rule sources) are how transports and data adapters plug in; a transport module is a module
   that contributes to `transports`.
6. The import graph between module packages is a DAG. The lower module publishes contracts
   (entities, events, extension points); the higher module imports it, contributes to it and
   adapts itself to it. For the accounts and authentication pair, accounts is lower.
7. `defineApp` rejects, with named errors, missing requirements, duplicate ids, fields contributed
   to one entity with different types, contributions to unknown entities and references to
   unselected modules. A type-level test suite asserts the nine cases of architecture.md
   section 4.7; the model was checked on 2026-10-08 with TypeScript 5.9.3 and 7.0.2.
8. Module ids are permanent literals; renaming is an explicit data migration.
9. Backends are runtime instances of apps compiled into the deployment (`defineDeployment({ apps })`).
   Selecting modules per backend at runtime is rejected because the types could not follow it;
   runtime variation goes through per-backend module configuration.
10. Composition at runtime mirrors the types: the same checks, topological order by `requires`
    with tuple order as tie-break, contributions applied in that order, lifecycle phases
    `setup`, `start`, `stop` (reversed), plus `onBackendCreated` and `onTenantCreated`.

## Consequences

- Removing a module removes its contributions from the types and the runtime at the same moment;
  a missing hard dependency is a compile error; nothing is typed that does not exist.
- Mutual influence is expressible without import cycles, at the cost of deciding which module of
  a pair is lower; both still compile and run alone.
- Type-instantiation cost is the main risk and is bounded by the non-recursive model, paid once
  per app, with a CI trace budget and attest benchmarks.
- Contributions require a type of the target, so a module package depends on the packages it
  contributes to; this is explicit and desirable.
- Runtime module selection is deliberately not supported; a new combination is a new `defineApp`
  line and a deploy.
- Deciding whether two identical contributed field types from two modules are a conflict cannot
  be done at the type level; the boot-time check rejects duplicate names from different modules.
