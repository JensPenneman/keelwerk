# Brief

Date: 2026-10-08. Author: Jens Penneman (requirements, lightly edited for structure). This is the
source of truth for what pennestack must become. The architecture, the ADRs and the roadmap
derive from it and must not silently drop or reinterpret anything here.

"pennestack" is a working name only. Everything else in this document is a requirement.

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

## Constraints

- Public repository on GitHub, every commit signed with the author's personal identity.
- Best practice from first principles, no copying of conventions from older personal projects.
- The name of the product never references other companies' products or trademarks.

## Changelog

- 2026-10-08: initial brief (modules, authorization, transports, authentication and accounts, data
  layer, execution model, types and tooling, interfaces for humans, constraints).
- 2026-10-08, addendum 1: multi-tenancy and one deployment.
- 2026-10-08, addendum 2: living brief.
