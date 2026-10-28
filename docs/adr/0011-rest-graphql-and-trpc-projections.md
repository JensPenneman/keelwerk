# 11. REST with an own OpenAPI emitter, GraphQL built on graphql-js and Yoga with own limits, tRPC with a derived router type, oRPC beside tRPC

Date: 2026-10-11 (revised after review the same day; revised in place on 2026-10-28 for decisions
15b, 19b and 37a)

## Status

Proposed. Item 5 is reversed by decision 15b (2026-10-26): oRPC ships in the first release, beside
tRPC. Item 2's operation limits follow decision 37a (2026-10-27): own validation rules, with the
rule that an entity type never appears twice on one selection path.

## Context

The brief names three transport modules: GraphQL that generates a schema and serves it on a URL, a
REST module that produces a full REST backend, and tRPC. [ADR 0010](0010-transports-project-a-derived-api-surface.md)
fixes how transports derive from the API surface. This ADR chooses how each of the three is built.

The interfaces research recommended an own REST projection with an own OpenAPI 3.1 emitter and RFC
9457 problem details, Pothos 4.15.1 on GraphQL Yoga 5.24.4, tRPC 11.19.0, and oRPC 1.15.5 beside tRPC
for its typed client and native OpenAPI handler; the first draft of
[architecture.md](../architecture.md) recommended including oRPC and left the committed OpenAPI
version and the JSON fallback for free-form GraphQL inputs open. Facts checked on 2026-10-10 and 2026-10-11:

- `@hono/zod-openapi` 1.6.3 accepts only Zod; `hono-openapi` 1.3.5 still calls itself in
  development. The surface already holds JSON Schema draft 2020-12 for every input and output.
- OpenAPI 3.2.0 adds `QUERY` operations (the method is RFC 10008, a Proposed Standard published in
  2026) and `itemSchema` for SSE; client generators lag behind 3.2.
- graphql 17.0.2 and graphql-yoga 5.24.4 (peer range including graphql 17) are current; Yoga
  serves any `GraphQLSchema`.
- A tRPC router type can be written from tRPC's exported types (`TRPCBuiltRouter`,
  `TRPCQueryProcedure`, `TRPCMutationProcedure`, `TRPCSubscriptionProcedure`). A listing deriving it
  from an action tree type-checks with `createTRPCClient` on TypeScript 7.0.2 with `@trpc/server`
  11.19.0, negative cases included; a synthetic app of 880 actions costs 60,784 instantiations.
- The invocation protocol and `AppClient<App>` of ADR 0010 already give typed TypeScript clients, the
  CLI and tests.

## Decision

1. **REST** is keelwerk's own projection on the shared host with its own OpenAPI emitter:
   - resources from generated entity actions (`GET` and `POST .../query` for `query`, `GET /{id}`
     and `POST .../get` for `get`, `POST`, `PATCH`, `DELETE` and `POST .../restore` for `set`, plus
     the batch form), custom entity commands as `POST /{collection}/{id}/{action}`, module actions
     under the module, subscriptions as SSE;
   - `filter` as a JSON query parameter and as a body member, compact `sort`, cursor parameters
     and a `Link` header;
   - `ETag` and `If-Match` from row versions, `Idempotency-Key` for command ids,
     `Prefer: respond-async` (and `wait`) for asynchronous commands;
   - RFC 9457 problem details with an absolute, resolvable `type` per error code and `code` as the
     stable identifier;
   - OpenAPI 3.1.1 by default, 3.2.0 on request (adding `QUERY` operations and `itemSchema`),
     validated in tests with `@scalar/openapi-parser` 0.29.12, served per backend with its server
     URL, and a reference page through `@scalar/hono-api-reference` 0.12.11 in development.
2. **GraphQL** builds a `GraphQLSchema` directly from the surface with graphql 17.0.2 and serves it
   with graphql-yoga 5.24.4. Pothos is not used: the schema is derived, not hand-written, and
   Pothos's value is the static typing of hand-written resolvers. The schema follows Relay
   conventions (`Node` with TypeID global ids, connections), returns a result union for every
   command (declared errors as types, `CommandAccepted` for asynchronous commands), reports taxonomy
   errors in `errors[].extensions`, makes entity fields nullable except `id` and `version` (masks
   are per row, listed in `_masked`), batches to-one references with DataLoader 2.2.3 through the
   invoker, serves subscriptions over GraphQL-over-SSE (Yoga) and graphql-ws 6.3.0, and enforces
   operation limits as own validation rules checked before execution (decision 37a): no entity type
   twice on one selection path (related data is selected at the highest level where it is needed, or
   in a separate query; siblings of one type stay allowed), depth, aliases, operations per request,
   tokens and a cost computed from the surface, all configurable per backend; the same path rule
   applies to any REST `include` expansion (architecture.md section 16.4.12). Free-form inputs that
   are not object, scalar, enum or array trees become the `JSON` scalar. The executor stays
   replaceable (Grafast later) because the schema is standard.
3. **tRPC 11.19.0** builds its router at runtime from the surface, with procedures that pass raw
   input to the invoker (the pipeline validates once). Clients get the router type
   `TrpcRouterOf<App>`, derived from the core's action tree and emitted as a type alias in the
   generated file, so there is no generated router code. `superjson` 2.2.6 is the default
   transformer (`json` as an option), with `Temporal.Instant` and `Temporal.PlainDate` registered
   as custom types (decision 19b); errors carry the `WireError` in `data.keelwerk`;
   subscriptions are async generators over SSE (WebSocket as an option) yielding items and control
   frames, wrapped in `tracked(streamToken, ...)` when the subscription is resumable; an `either`
   command's result type is `Output | CommandReceipt`.
4. **Defaults that settle two open questions of the first draft**: OpenAPI 3.1 is the committed default
   with 3.2 opt-in; the `JSON` scalar fallback for free-form GraphQL inputs is accepted, and authors
   who need exact GraphQL types use `shape()`. The Connect descriptor spike stays open.
5. **oRPC ships in the first release, beside tRPC** (decision 15b, 2026-10-26). This item first
   deferred it, because its typed client is covered by `AppClient<App>`, its OpenAPI handler by the
   REST module, and the CLI and tests use the invocation protocol; Jens included it anyway, to judge
   its implementation and quality on real use despite its youth. `@keelwerk/transport-orpc`
   (`@orpc/server` 1.16.1) builds its router from the surface like tRPC's, exports the derived type
   `OrpcRouterOf<App>` for `@orpc/client`, types declared errors per procedure, carries
   subscriptions as event iterators with stream tokens as event ids, ships in M2 and passes the same
   conformance suite. Its OpenAPI handler is offered as an option and compared in CI with the own
   emitter of item 1, which REST keeps (architecture.md section 16.7.7). Launchway's agent, first
   sketched on oRPC's WebSocket adapter, uses the typed client over the live module's WebSocket
   carrier (ADR 0012, decision 23c).
6. **HTTP beyond JSON** (gap G8): `transport-webhooks` declares a `receivers` extension point whose
   values map an inbound request (path parameters, selected headers, the raw body) to an action, a
   scope key and a service principal, with the delivery id as command id. Receiver paths are
   registered with the deployment as carrier enrichers that run before scope resolution, and a
   principal resolver of the owning module verifies the signature before the service principal is
   granted; until then the request is anonymous. The `http.response` hint carries outputs as raw bodies, redirects,
   downloads with range support, or empty responses, and a `rest.path` starting with `/` places an
   action at an absolute path such as `/.well-known/mta-sts.txt`.

## Consequences

- REST and OpenAPI follow the registry exactly, with problem details and documented declared
  errors, at the cost of owning an emitter (estimated at a few hundred lines per projection in the
  research) and keeping it valid against the OpenAPI schema in tests.
- The GraphQL schema is deterministic and contains exactly the selected modules; there is one
  dependency fewer than with Pothos, and plugins that the project would not use (validation,
  scope-auth) are not pulled in. Relay connections and error unions are generated by own code.
- Every command in GraphQL returns a union, so adding a declared error later is additive; clients
  must branch on `__typename`.
- tRPC clients get exact types without code generation, except that tRPC cannot narrow an `either`
  command's result per call; the typed client keeps that precision.
- With oRPC there is one transport more to maintain and test, which Jens accepted to evaluate it
  (decision 15b); its client types against the derived router are checked when the transport is
  built in M2.
- The operation limits are a handful of own validation rules, with no dependency on
  `@escape.tech/graphql-armor` (last published 2025-12-29); the no-repeat rule refuses selections
  some clients send today, which is the point: such data belongs higher up or in a second query.
- Receivers and response kinds keep webhook verification, well-known documents and downloads inside
  actions, so they get receipts, authorization and audit like everything else; the price is one more
  small transport module and a core resolver for receiver principals.
