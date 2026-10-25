# 10. Transports project a derived API surface through one host and one invoker session

Date: 2026-10-11 (revised after review the same day, and on 2026-10-24 for API versions)

## Status

Proposed

## Context

The brief requires that the way the backend is reached is itself a module, that several such
modules (GraphQL, REST, tRPC, later others) can be active together, and that each derives from the
same module, entity and action definitions. It also requires that a later user interface is fully
pluggable, that a CLI exists first, and that tenant resolution works the same for every transport.

The first draft of [architecture.md](../architecture.md) section 16 fixed the outline: a transport is a module that
contributes a `TransportAdapter` (a name, capabilities, a pure `artifacts(registry)` and a
`mount({ registry, invoker, host, options, telemetry })`) to the kernel's `transports` extension
point; adapters never import handlers, evaluate policies or touch the data layer; they fill a
carrier and call the invoker; errors, pagination, the condition AST and the generated entity
actions are projected, never reinterpreted. The interfaces research
([research/interfaces-and-devx.md](../research/interfaces-and-devx.md)) reached the same shape.

Five questions remained open:

1. What adapters read. The registry holds handlers, validators and closures; it is neither
   serialisable nor stable in order, yet artefacts must be byte-stable, the CLI and user interfaces
   must fetch a description over the network, and CI must diff interface changes.
2. How names are derived so that every transport is predictable and a collision cannot pass
   silently.
3. How one deployment serves several apps on one HTTP host: a request's app (and with it the GraphQL
   schema, the REST routes, the tRPC router) is known only after its backend is resolved, which the
   pipeline does inside `invoke`.
4. How often scope and principal are resolved: a GraphQL document fans out into many invocations,
   and a WebSocket connection carries many subscriptions.
5. Which wire the CLI, tests and scripts use, given that an app may select none of the ecosystem
   transports and that operator work happens before any app transport exists.

The review of 2026-10-11 added browser security: WebSocket upgrades carry cookies and escape
CORS, sibling subdomains can plant cookies, path-based tenant resolution shares one cookie path
across tenants, and a revoked session's cookie locked browsers out of the login page.

## Decision

1. **The API surface.** The core derives, per app and during `compose`, an `ApiSurface`: a
   serialisable description of every reachable action (reference, kind, input and output as field
   nodes, declared error codes, auth, scope, effective execution mode, pagination, hints), every
   entity (fields with access flags, relations, TypeID prefix, generated actions), every declared
   error and every event. It excludes `tenantId`, hidden fields, handlers, validators and policies;
   it is sorted by reference and serialised with RFC 8785, so it is order-independent. One surface
   and one SHA-256 hash exist per app and dated API version (ADR 0021): the hash identifies that
   version's interface. Every transport, the CLI, introspection and every artefact read the
   surface, never the registry.
2. **The adapter contract.** An adapter is `{ name, capabilities, static, check(surface),
   artifacts(surface), mount(ctx) }`. `check` and `artifacts` are pure. Static options (which shape
   names and documents) are fixed when the module value is built; per-backend behaviour comes from
   the transport module's `config`. `mount` runs once per app at `listen`.
3. **One host, two-level dispatch.** `transport-http` (Hono 4.13.13 on `@hono/node-server` 2.1.4,
   `ws` 8.22.0 for upgrades) is the only HTTP listener and an infrastructure entry of the
   deployment; HTTP transport modules require its contract (`contracts.httpHost`). It fills the
   carrier, runs the deployment's carrier enrichers (receiver paths), asks the invoker for a session,
   then routes to the mount table of the session's app by longest prefix. Mounts are per app and
   shared by all backends of that app. `/_pennestack` is reserved; deployment-scope requests go to
   the operator endpoint (operator socket and host names). Cross-cutting HTTP concerns (request ids,
   trace context, body limits, CORS from the tenant's domains, origin checks for cookie-authenticated
   state changes, WebSocket upgrades and cookie SSE, health endpoints, graceful shutdown) live in the
   host, and a scope key in the path must agree with a tenant resolved from the host name.
4. **Sessions.** The invoker has `open(carrier)`, which runs `resolveScope` and `resolvePrincipal`
   once and returns an unforgeable `InvocationSession` (scope, app, principal, `expiresAt`,
   `revalidate`) that later invocations reuse. Absent credentials give an anonymous principal;
   invalid bearer tokens and API keys fail `open`; an unknown, expired or revoked session cookie
   counts as absent and the response clears it. Long-lived connections revalidate their session at
   expiry, at least every 60 seconds and on revocation events. Session cookies carry the `__Host-`
   prefix (`Path=/`, no `Domain`) and exist only under host-based tenant resolution; elsewhere,
   bearer tokens.
5. **Names are functions.** Every wire name is a pure function of a reference (camel, Pascal,
   kebab and a frozen pluralisation rule; the table is in architecture.md section 16.4.1). Hints rename, hide an
   action from one transport or choose how an output is carried (a cookie); they never change
   behaviour. Collisions are named `check` problems that fail `generate` and boot.
6. **One meaning everywhere.** Errors (one mapping table across REST, GraphQL, tRPC, the
   invocation protocol, the CLI and WebSocket close codes, with one `WireError` object inside),
   cursor pagination, the condition object form as the filter wire format, field selection and
   masks (`$masked` and `_masked`), execution preference, command ids and `ifVersion` are defined
   once in architecture.md section 16.4 and only encoded per transport.
7. **The invocation protocol and the typed client.** The host serves a small JSON protocol under
   `/_pennestack/v1` (`invoke`, `batch`, `subscribe`, `surface`, `capabilities`, `live`) for every app and over the
   operator Unix socket, so the CLI reaches every backend whatever its app selects. It is the canonical, lossless projection; `AppClient<App>` from
   `@pennestack/client` speaks it remotely (or calls the invoker in process) with types inferred
   from the app.
8. **Clients discover only the surface.** `core.introspect` serves the surface and `core.me` the
   principal's effective rules in CASL raw-rule shape. A user interface is a client of transports and
   of these actions; no framework package knows a frontend framework, and user-interface metadata
   lives in modules that depend on the domain modules, not the reverse.
9. **Conformance.** `@pennestack/testing` runs one scenario set through every selected transport and
   asserts identical decoded outcomes, including cross-site and cross-tenant browser scenarios.

## Consequences

- Adding a transport is a module and an adapter; it touches neither the kernel nor another
  transport, and the conformance suite tells whether it projects faithfully.
- Artefacts are byte-stable and reviewable, and the surface hash of each API version gives every
  interface change a fingerprint, which makes breaking-change detection in CI possible.
- The surface is a second derived model of the registry that the core must keep in step; deriving it
  in the core with its own tests contains that cost.
- The core changes this decision required (`Invoker.open` and `Invocation.session`, action types in
  the type model, an identifier grammar, singular control entity names, `core.introspect` and
  `core.me`, audience-aware error serialisation) are folded into architecture.md sections 4.7, 5.1,
  9.2, 10 and 12.
- Because mounts are per app, memory for schemas and routers grows with the number of apps in the
  catalogue, not with the number of backends or tenants.
- Owning the invocation protocol is a few hundred lines of server and client code that the project
  maintains; in exchange the CLI, tests, scripts and operator work never depend on an optional
  ecosystem transport.
- Name derivation and pluralisation are frozen contracts; changing them later would rename public
  paths and fields and would need a new ADR and a major version.
