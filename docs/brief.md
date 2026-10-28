# Brief

Date: 2026-10-08. Author: Jens Penneman (requirements, lightly edited for structure). This is the
source of truth for what keelwerk must become. The architecture, the ADRs and the roadmap
derive from it and must not silently drop or reinterpret anything here.

"keelwerk" is the name chosen on 2026-10-28 (the working name until then was "pennestack"). Everything
else in this document is a requirement.

## What it is

A backend framework, written fully in TypeScript, out of which several different platforms can be
assembled by selecting and toggling modules. Two platforms must be buildable on it from the start:

1. A self-hosted deployment platform (the existing Launchway product, whose backend gets
   re-architected on top of this framework).
2. A fully functional mail server for the domain `jenspenneman.com`.

Many more pieces will be appended later. The framework is the product; the platforms are proofs.

All of these platforms run inside one deployment of the framework (see "Multi-tenancy and one
deployment" below).

## Requirements

### Modules and configuration

- A configuration system expressed in TypeScript, in which the application is defined as a set of
  modules.
- A module is a sub-part of the application. A module owns entities (data structures).
- Entities carry actions. Actions can also be mounted on a module or on the whole application.
- Modules are plug and play: any module can be selected or toggled, and the application still
  works. Modules can be switched on or off independently of each other.
- Modules influence each other. Example: the accounts (user profile) module is influenced by the
  authentication (login) module and vice versa. The framework must make such cross-module
  influence explicit and typed, while keeping both modules independently toggleable.
- The same framework must be able to produce multiple different platforms (deployment platform,
  mail server, ...) from different module selections.

### Authorization

- An authorization framework in the style of CASL: in code, per action, expressing which action
  is allowed for which user under which conditions.
- Explicitly not a plain role-based access control model; that is too basic.
- Everything about it must be configurable.

### Interfaces to the backend (transport modules)

- How the backend is interfaced with is itself a module, and several can be active:
  - a GraphQL module that generates a GraphQL schema and serves it on a URL,
  - a REST module that produces a full REST backend,
  - a tRPC module,
  - and others later.
- Each transport derives from the same module/entity/action definitions.

### Authentication and accounts

- An authentication module in which users keep their login information and sign in.
- An accounts / user profile module, separate from authentication, which authentication influences
  and which influences authentication.

### Data layer

- A data layer underneath, with plug-and-play databases: PostgreSQL, MySQL, a hosted service such
  as Supabase, query builders or ORMs such as Drizzle, or anything else that fits the abstraction.

### Execution model

- Something like CQRS: requests are sent somewhere and can be handled asynchronously.
- It must be possible to choose which requests are handled synchronously.
- Live updates on everything, delivered by a module (or framework configuration).
- In the live environment, data must be structured the way a collaborative document stores its
  data: nothing is truly deleted, everything is appended to a chain, and multiple actors can work
  on it online and offline at the same time. The framework handles this gracefully.

### Types and tooling

- The types of what is in the database must always be perfectly, live, generated (by a TypeScript
  server or an equivalent mechanism), whatever database connection is used.
- Every piece must be plug and play with the compiler, the linter and the rest of the toolchain:
  they always know what to do.

### Interfaces for humans (later)

- No frontend framework is chosen yet. Everything must work perfectly as an API and as a backend
  framework by itself.
- A later UI must be fully pluggable. A CLI may be built first and may live in this repository.

### Multi-tenancy and one deployment (addendum 1, 2026-10-08)

- One deployment of the framework (one running installation, possibly several processes or nodes)
  hosts multiple actual backends at the same time: the deployment platform, the mail server, and
  any further company, app or platform that gets created later, each with its own module
  selection.
- Inside those backends, multiple tenants (companies, organisations, apps, whatever the backend
  calls them) live side by side. New tenants and new backends are created at runtime, without a
  redeploy.
- Tenants are isolated from each other: data, authentication realm, configuration, secrets,
  domains and quotas. A tenant can never observe another tenant's data. The operator (Jens) can
  administer everything across tenants and backends.
- Tenant resolution (hostname, path, token, header, or a combination) is part of the request
  pipeline and works the same for every transport, including the CLI and non-HTTP listeners.
- Where tenant data physically lives (shared tables with a tenant key, a schema per tenant, a
  database per tenant, a different adapter per tenant) is a data-layer choice that must be
  pluggable and must not leak into application code.
- This is a first-class, cross-cutting requirement: the kernel, the data layer, authorization,
  the execution model, the transports and the CLI must each state how they handle it.

### Living brief (addendum 2, 2026-10-08)

- Requirements arrive incrementally, at any moment, in any order. This brief is appended, never
  rewritten: every addition gets a dated addendum and a line in the changelog below.
- The architecture must absorb new requirements without a re-architecture: a new requirement
  should land as a module, an adapter, a policy or a configuration, and only rarely as a change
  to the kernel. Where the kernel must change, an ADR records it.
- The goal is a framework Jens can build on without having to think about the framework itself.

### Versioning, rollouts, feature flags and project layout (addendum 3, 2026-10-23)

- Everything is versioned, in every nook and cranny of the API and the backend: packages, modules,
  apps, the API surface and each action's input and output, entity schemas, events, protocols,
  configuration, generated artefacts, clients. A version is never implicit.
- Rollouts and roll-overs are smooth: moving to a newer version never interrupts running clients
  or running processes, and backwards compatibility is kept until a major (breaking) version is
  deployed. The framework must offer the best-in-class mechanism for this, not an ad-hoc one.
- Feature flags and A/B testing exist. Whether they belong to the framework or only to the APIs
  built with it is open; the current feeling is that the framework level is the right direction.
- Every file in a project has a single purpose: each entity its own file, each library function
  its own file, each module its own place, with a directory structure that makes this natural.
  The conventions of file-based frameworks (Next.js and the like) are a starting point only; the
  structure must be designed to be the best fit for this framework and enforced by its tooling.

### Pure functions, explicit inputs and outputs (addendum 4, 2026-10-24)

- Everything runs on pure functions. A function's inputs are kept within its parameters and its
  outputs are only ever returned through its return value; nothing flows through global state,
  module-level state, ambient context or any other hidden channel. This is a hard requirement
  for the framework itself and for the code written on it.
- Where the outside world must be touched (databases, networks, clocks, randomness), the
  architecture states how this is reconciled with the rule: which parts perform effects, how
  effects enter and leave pure code, and how the rule is enforced by tooling.

### Datastore agnosticism (addendum 5, 2026-10-26)

- Any database or datastore can be plugged in as an adapter; MySQL is one of them, not a special
  case.
- The features a datastore has or lacks never influence application code and never decide
  whether an application can run: the adapter contract is the only coupling, and what a datastore
  cannot do natively the framework provides itself, at a visible cost, never by refusing or by
  changing behaviour. The one exception is code that deliberately opts into a dialect (the raw
  SQL hatch), which declares that choice.

## Constraints

- Public repository on GitHub, every commit signed with the author's personal identity.
- Best practice from first principles, no copying of conventions from older personal projects.
- The name of the product never references other companies' products or trademarks.

## Changelog

- 2026-10-08: initial brief (modules, authorization, transports, authentication and accounts, data
  layer, execution model, types and tooling, interfaces for humans, constraints).
- 2026-10-08, addendum 1: multi-tenancy and one deployment.
- 2026-10-08, addendum 2: living brief.
- 2026-10-23, addendum 3: versioning everywhere, smooth rollouts and compatibility, feature
  flags and A/B testing, single-purpose files and project layout.
- 2026-10-24, addendum 4: pure functions, explicit inputs and outputs, no global state.
- 2026-10-26, addendum 5: datastore agnosticism.
- 2026-10-28: the project is named keelwerk (working name pennestack dropped).
