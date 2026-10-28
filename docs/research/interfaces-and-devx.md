> Note (2026-10-28): the project was renamed from pennestack to **keelwerk** on 2026-10-28; this
> research note keeps the old name as written at the time.

# Interfaces and developer experience

Date: 2026-10-08. Status: research input for the architecture document and the ADRs; it decides
nothing by itself. Scope: the brief's sections "Interfaces to the backend (transport modules)",
"Live updates" (execution model), "Types and tooling" and "Interfaces for humans". Every package
version named here was checked with `npm view` on 2026-10-08; appendix A lists publish dates.

## 1. The design problem

The brief requires that GraphQL, REST, tRPC "and others later" are modules, several can be active,
and each derives from the same module/entity/action definitions. That constrains the registry more
than it constrains the transports:

- A transport is a projection of the registry. It never touches handlers. It maps its wire format
  onto one in-process call (`invoke`) and maps results and errors back.
- The registry must carry transport-neutral metadata that every projection needs: input and output
  shapes with both runtime validation and JSON Schema, a closed error vocabulary, one pagination and
  filter model, authentication requirements, streaming semantics, and per-transport naming hints.
- Each projection bridges a shape mismatch: GraphQL wants a graph with field-level resolution, REST
  wants resources and verbs, RPC wants procedures, Connect wants numbered protobuf fields, JMAP wants
  `Foo/get`-style methods with state strings.

## 2. Schema layer: Standard Schema

Standard Schema (`@standard-schema/spec` 1.1.0, published 2025-12-15) defines a `~standard`
property with `version: 1`, `vendor`, `validate(value)` returning `{ value }` or
`{ issues: [{ message, path? }] }`, and optional `types.input`/`types.output` for inference.
Version 1.1 added Standard JSON Schema: `~standard.jsonSchema.input(options)` and `.output(options)`
with `target` values `draft-2020-12`, `draft-07` and `openapi-3.0`.

Implementers: Zod 4.6.5 (Standard JSON Schema since 4.2; `z.toJSONSchema()`), Valibot 1.5.0
(validation only; JSON Schema through `@valibot/to-json-schema` 1.8.0, whose `toStandardJsonSchema`
wrapper adds the `~standard.jsonSchema` member), ArkType 2.2.8 (both interfaces; `toJsonSchema()`
with `fallback` handlers and cyclic `$ref`s), Effect 4.0.2 (`StandardSchema` module).

Consumers: tRPC 11 for input and output validators, oRPC for every schema including typed error
data, Pothos `@pothos/plugin-validation` 4.3.4, Hono `@hono/standard-validator` 0.4.0,
`hono-openapi` 1.3.5, and the community `fastify-type-provider-standard-schema` 0.2.0 (2025-07-26).

What Standard Schema does not give is a way to walk a schema. Projections that need structure
(GraphQL object and input types, protobuf fields, CLI flags, database columns) cannot be derived
from a `validate` function, and JSON Schema to GraphQL is lossy (unions, nullability, identifiers).
Consequence: entities and action payloads are authored in a small pennestack field-descriptor model
that emits a Standard Schema validator, a JSON Schema and a GraphQL type. Free-form Standard Schemas
from any library stay accepted for action inputs; they are projected through Standard JSON Schema
for OpenAPI and through a small JSON Schema to GraphQL input converter for the
object/scalar/enum/array subset, with everything else becoming a `JSON` scalar.

## 3. Transport survey

### 3.1 GraphQL

graphql-js 17.0.0 was released 2026-06-15 (17.0.2 is current); Pothos 4.15.1 and Yoga 5.24.4 both
declare peer ranges that include 17.

Pothos (`@pothos/core` 4.15.1) is a code-first builder without decorators or codegen; types are
inferred from the builder. Relevant official plugins: relay 4.8.1 (nodes, global ids,
`t.connection` with `resolveCursorConnection`), errors 4.9.3 (declared error classes become union
result types; undeclared errors still surface as GraphQL errors), validation 4.3.4 (Standard
Schema on arguments, input types and fields; `InputValidationError` carries issues and paths),
dataloader 4.4.6, scope-auth 4.2.1, with-input 4.1.5, simple-objects 4.1.4, smart-subscriptions
4.1.7, tracing 1.1.4 with `@pothos/tracing-opentelemetry` 1.2.1, drizzle 0.20.0 (pre-1.0) and
grafast 0.1.2 (documented as experimental).

GraphQL Yoga 5.24.4 is a fetch-API server (runs on Node through `node:http` or
`@hono/node-server`) built on Envelop 5.6.1 plugins (`@envelop/opentelemetry` 9.2.2).
Subscriptions are served over SSE by default in the GraphQL-over-SSE "distinct connections" mode;
"single connection" mode comes from `@graphql-yoga/plugin-graphql-sse` 3.24.4; WebSocket uses
`graphql-ws` 6.3.0 (`graphql-transport-ws` subprotocol) with `useServer` wired to Yoga's
`getEnveloped`. `createPubSub` with `@graphql-yoga/redis-event-target` 3.0.4 covers multi-instance
fan-out.

Grafast 1.1.4, grafserv 1.0.2 and PostGraphile 5.1.5: Grafast v1 was announced 2026-03-24 as
production-ready. It replaces resolvers with plans: a field declares steps (`loadOne`, `lambda`,
`get`), the engine plans the whole operation once and batches, removing N+1 structurally rather
than through DataLoader. PostGraphile derives a schema from PostgreSQL, which conflicts with the
database-agnostic data layer; Grafast alone works with any `GraphQLSchema` through its `grafast()`
executor, and the experimental Pothos plugin lets fields declare `plan` instead of `resolve`.
Verdict: not in the first release, but keep the executor pluggable (graphql-js `execute` versus
`grafast`), since both consume a `GraphQLSchema`.

### 3.2 REST with OpenAPI

Hono 4.13.13 is a web-standard router (`Request`/`Response`) with `@hono/node-server` 2.1.4
(Node 20 or later), `streamSSE` and `upgradeWebSocket` helpers (`@hono/node-ws` 1.3.1) and
`@hono/otel` 1.2.0. `@hono/zod-openapi` 1.6.3 (peer `zod ^4`) adds `OpenAPIHono`, `createRoute`,
`app.openapi()` and `app.doc()`/`app.doc31()` for OpenAPI 3.0 and 3.1; it is Zod-only.
`hono-openapi` 1.3.5 generates OpenAPI from any Standard Schema but its README still says "still in
development". Documentation UIs: `@scalar/hono-api-reference` 0.12.11, `@hono/swagger-ui` 0.6.1.

Fastify 5.12.5 validates with Ajv against JSON Schema. `@fastify/type-provider-typebox` 6.1.0
(TypeBox 0.34.52, JSON-Schema-native types) with `@fastify/swagger` 9.9.1 gives OpenAPI;
`fastify-type-provider-zod` 7.0.0 supports Zod 4.1.5 and later. Standard Schema means replacing
Fastify's `validatorCompiler`, its hot path, and the community provider is at 0.2.0. Fastify is a
sound HTTP host, but its schema model is a second source of truth next to the registry.

ts-rest 3.52.1: last publish 2025-03-04, peer `zod ^3`, no Standard Schema. Not a base.

oRPC 1.15.5 (`@orpc/server`, `@orpc/contract`, `@orpc/openapi`, `@orpc/client`, `@orpc/otel`,
all published 2026-10-07): one router serves both its own RPC protocol and an OpenAPI handler.
`OpenAPIGenerator` converts schemas through per-library converters (Zod, Valibot, ArkType) and
falls back to Standard JSON Schema; it emits OpenAPI 3.2.0 by default and downgrades to 3.1 or 3.0
through `@openapi-spec/downgrader` 0.3.0. Routes default to `POST /<router path>`, overridden with
`.route({ method, path })` and `{id}` parameters. Errors are `ORPCError(code, { message, data })`
with per-procedure `.errors({...})` typed by Standard Schema. Async-generator handlers become SSE
with `withEventMeta({ id, retry })` and `lastEventId` for resume. Adapters: Node, fetch, Fastify,
AWS Lambda and `peer` (WebSocket or MessagePort).

### 3.3 RPC: tRPC v11 and oRPC

tRPC 11.19.0 (peer `typescript >= 5.7.2`): procedures with Standard Schema input and output;
subscriptions as async generators over SSE (`httpSubscriptionLink`, `tracked(id, data)` delivering
`lastEventId`) or WebSocket (`wsLink`); the docs recommend SSE when unsure. A fixed error
vocabulary (21 `TRPCError` codes mapped to HTTP, from `PARSE_ERROR` 400 to `GATEWAY_TIMEOUT` 504),
a JSON-RPC-style error envelope, `onError` and `errorFormatter`. OpenAPI only through the community
`trpc-to-openapi` 3.3.0 (2026-05-22). Hono adapter `@hono/trpc-server` 0.4.2; fetch adapter built
in; no first-party OpenTelemetry.

Both are procedure trees and neither models entities. The differences that matter here: OpenAPI
native (oRPC) versus third-party (tRPC), per-procedure typed errors versus one global shape, native
`Date`/`Map`/binary versus a transformer, built-in OpenTelemetry versus none. tRPC's advantages are
ecosystem size (for example `@trpc/tanstack-react-query` 11.19.0) and the brief naming it.

### 3.4 Connect (gRPC-compatible)

`@connectrpc/connect` 2.2.0 with `-node`, `-fastify`, `-express`, `-next` and `-web` (all
2026-09-07) on `@bufbuild/protobuf` 2.16.0. Protocols: Connect (JSON or binary over HTTP/1.1 or
HTTP/2, usable with curl), gRPC and gRPC-Web; all four RPC types, with bidirectional streaming
needing end-to-end HTTP/2. Errors are `ConnectError` with the 16 gRPC `Code`s plus typed protobuf
details. Interceptors form an onion; `createContextKey` and `createContextValues` carry typed
values from the server plugin's `contextValues` hook to handlers, and the docs say to authenticate
in `requestGate` rather than in interceptors, which run only after the message is parsed. Services
are normally generated from `.proto` with `buf` 1.73.0 and `protoc-gen-es` 2.16.0; protobuf-es 2
also exposes `createFileRegistry(FileDescriptorSet)` and `registry.getService(name)`, so a
projection could build descriptors at runtime (a spike must confirm that `router.service` accepts
them). Either way protobuf needs stable field numbers, so entity fields need an explicit or
deterministically allocated tag that survives renames.

### 3.5 JMAP

Published RFCs: 8620 core, 8621 mail, 8887 WebSocket subprotocol, 9404 blob management, 9425
quotas, 9661 Sieve, 9007 MDN, 9219 S/MIME verification, 9610 contacts (JSContact is 9553), 9670
sharing, 9749 VAPID push; calendars are still a draft. Core shape: a session resource at
`/.well-known/jmap` (`capabilities`, `accounts`, `apiUrl`, `downloadUrl`, `uploadUrl`,
`eventSourceUrl`, `state`); one authenticated POST carries `methodCalls` (name, arguments, call id)
with result references between calls; per data type the standard methods are `Foo/get`,
`Foo/changes`, `Foo/set` (`ifInState`, `create`/`update`/`destroy`, patch paths), `Foo/copy`,
`Foo/query` (`filter` as an `AND`/`OR`/`NOT` FilterOperator over FilterConditions, `sort`,
`position`/`anchor`/`limit`, `calculateTotal`; response `queryState`, `canCalculateChanges`,
`ids`, `total`) and `Foo/queryChanges` (`sinceQueryState` to `removed` and `added`). Push:
`StateChange` objects over the EventSource endpoint, Web Push, or WebSocket. Errors: request-level
problem details `urn:ietf:params:jmap:error:*`, method-level (`invalidArguments`, `forbidden`,
`serverFail`, ...) and `SetError` types (`notFound`, `invalidProperties`, `stateMismatch`, ...).

This matters beyond the mail platform: JMAP's method set is a published, interoperable version of
the generic entity actions the brief asks for, including state-based incremental sync
(`changes`, `queryChanges`) and optimistic concurrency (`ifInState`). If pennestack's generic
entity actions adopt these semantics, the JMAP transport becomes a renaming. Test clients:
`jmap-jam` 0.13.8 (repository active 2026-10-08); `jmap-client-ts` 1.0.0 dates from 2022.
Stalwart (Rust) implements JMAP, IMAP, SMTP, CalDAV and CardDAV and is the natural conformance
reference.

### 3.6 Live updates: WebSocket versus SSE

SSE is plain HTTP (`text/event-stream`, `id:` and `retry:` fields, automatic reconnect with
`Last-Event-ID`), passes proxies and HTTP/2 multiplexing, and is the default in Yoga, tRPC and
oRPC; its limits are one direction and the per-host connection cap on HTTP/1.1. WebSocket is
bidirectional and multiplexed but needs an upgrade-capable server (`ws` 8.22.0, `@hono/node-ws`
1.3.1, cross-runtime `crossws` 0.4.15) and its own authentication handshake (connection parameters
instead of headers); Node 22 and later ship a global `WebSocket` client. OpenAPI 3.2.0
(2025-09-19) describes SSE responses with `itemSchema`.

### 3.7 Webhooks

The Standard Webhooks specification (Apache-2.0, repository active 2026-10-08) fixes the headers
`webhook-id`, `webhook-timestamp` and `webhook-signature`; HMAC-SHA256 over
`msg_id.timestamp.payload` with a `v1,` prefix (ed25519 `v1a,` for asymmetric signing), `whsec_`
secrets, space-separated signatures for rotation, a replay window on the timestamp, `webhook-id` as
idempotency key, exponential retries over about three days and `410` to disable an endpoint. The
reference JS library is `standardwebhooks` 1.1.1 (2026-08-28); `svix` 2.8.0 is a hosted-service
SDK and not needed.

## 4. CLI frameworks

| Library | Version | Dependencies | Model | Activity | Fit for a generated command tree |
|---|---|---|---|---|---|
| Stricli `@stricli/core` | 1.3.0 | none; Apache-2.0 (Bloomberg) | `buildApplication`, route maps, commands whose parameter types drive the parser; `CommandContext` bound to `this` for injected I/O; `@stricli/auto-complete` 1.3.0 | pushed 2026-09-09 | Best: route map per module/entity, command per action, context carries the invoker |
| citty | 0.2.2 | none; built on `util.parseArgs` | `defineCommand` with `args` (`string`, `boolean`, `enum`, `positional`), lazy `subCommands` via dynamic import | pushed 2026-10-08, still 0.x | Good minimal alternative |
| cmd-ts | 0.15.0 | 4 | decoder-typed `option`/`positional` with `Type<From, To>` | pushed 2026-04-22 | Works; smaller community |
| commander | 15.0.0 | none | imperative chaining; parsed values are loosely typed | pushed 2026-10-05 | Needs a typing layer on top |
| oclif `@oclif/core` | 5.1.2 (`oclif` 6.0.2) | 18 | one file per command, plugin system, generators | pushed 2026-09-30 | Heavy for a derived tree |
| clipanion | 4.0.0-rc.4 | Typanion for validation | class per command, `Option.*` properties | last push 2024-09-06 | Stale |

Stricli's isolated context is the feature that matters: the pennestack invoker, principal and
output streams are injected, so command tests never touch globals.

## 5. Developer experience

### 5.1 TypeScript toolchain as of 2026-10-08

`typescript` 7.0.2 (released 2026-07-08) is the native port: parallel checkers (`--checkers`),
parallel project-reference builds under `--build` (`--builders`), a rebuilt watcher, and an
LSP-based language server. It ships without a programmatic API (a new one is planned for 7.1), and
the announcement says tooling that depends on language-service plugins stays on TypeScript 6.0,
available side by side as `@typescript/typescript6` (`tsc6`). TypeScript 6.0.3 (2026-04-16) is the
bridge: new defaults `strict`, `module: esnext`, `types: []` and `rootDir` at the config directory;
`baseUrl`, `node10` resolution, `outFile` and `target: es5` are deprecated in 6.0 and hard errors in
7.0. TypeScript 5.9.3 (2025-09-30) added `--module node20` and `import defer`.

Project references are unchanged across these versions: each package sets `composite: true` and
lists `references`; `tsc -b --watch` builds the graph incrementally from `.tsbuildinfo`.
`isolatedDeclarations` (5.5) makes each package's `.d.ts` emit independent of the checker, which is
what makes parallel builds and foreign emitters safe. `erasableSyntaxOnly` (5.8) plus
`verbatimModuleSyntax` and `rewriteRelativeImportExtensions` (5.7) make sources runnable directly
by Node's type stripping (default since 22.18.0 and in 24; `.ts` extensions in relative imports,
no enums or parameter properties). Node 24 is the active LTS line; Node 26 is Current since
2026-05-05.

Recommendation: a pnpm workspace with project references, `module: nodenext`, `isolatedDeclarations`,
`erasableSyntaxOnly`, `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`; Node 24 baseline;
`tsc -b` from TypeScript 7 for builds and checks; a pinned TypeScript 6 only where a tool needs the
compiler API.

### 5.2 Type tests

Vitest 5.0.3 (announced 2026-09-03; Node 22.12 or later, Vite 6.4 or later) checks `*.test-d.ts`
files under `--typecheck` with `expectTypeOf` and `assertType`, built on `expect-type` 1.4.0 (no
dependencies). `@ark/attest` 0.57.0 (README: "still in alpha") snapshots type strings, asserts type
errors and completions, and benchmarks type instantiation counts; it depends on `@typescript/vfs`
and `@typescript/analyze-trace`, so it needs a TypeScript with a compiler API, which means 6.x until
7.1. `tsd` 0.33.0 (2025-08-05) is the older approach. Recommendation: Vitest typecheck for
assertions in every package; attest instantiation benchmarks on the registry's inference types,
since type-level performance is the framework's main risk.

### 5.3 Biome

`@biomejs/biome` 2.5.15: formatter and linter in one binary, type-aware rules without `tsc` since
2.0 (June 2025), GritQL plugins with code fixes, a watcher mode and more than 500 rules since 2.5
(2026-06-05), embedded GraphQL and CSS formatting since 2.4 (2026-02-10), nested configurations
for monorepos. Recommendation: Biome as the only formatter and linter; no ESLint.

### 5.4 Language-service plugins versus generators

A TypeScript language-service plugin decorates the editor's language service only: the wiki states
plugins "aren't loaded during normal commandline typechecking or emitting", and the 7.0 release
keeps plugin-based tooling on TypeScript 6.0. They cannot be the mechanism behind the brief's
"perfectly, live, generated" types. The pattern that does work is type-level inference from the definitions
themselves, as Drizzle does for columns and gql.tada 1.11.4 does for GraphQL documents (its
`@0no-co/graphqlsp` 1.17.5 plugin only adds editor sugar). Generators remain necessary for files
other tools consume: Drizzle Kit 0.31.11 (migrations), `kysely-codegen` 0.20.0 (types from a live
database), `@graphql-codegen/cli` 7.4.5 and `openapi-typescript` 7.13.0 (client types).

Recommendation: everything in-process is inferred from the registry with zero generation; one
`pennestack generate [--watch] [--check]` command asks each transport adapter for its artifacts
(SDL, OpenAPI JSON, `.proto`, shell completions) and the data layer for migrations, writes them to
committed paths, and `--check` fails CI on drift. Type stripping in Node means the watch loop needs
no bundler.

### 5.5 Errors across transports

One closed taxonomy in the registry, serialised per transport:

| Kind | REST (RFC 9457 `application/problem+json`) | GraphQL `extensions.code` | tRPC / oRPC code | Connect `Code` | JMAP |
|---|---|---|---|---|---|
| validation | 400 (422 for semantic) | `BAD_USER_INPUT` | `BAD_REQUEST` | `invalid_argument` | `invalidArguments`; SetError `invalidProperties` |
| unauthenticated | 401 | `UNAUTHENTICATED` | `UNAUTHORIZED` | `unauthenticated` | HTTP 401 before JMAP |
| forbidden | 403 | `FORBIDDEN` | `FORBIDDEN` | `permission_denied` | `forbidden` |
| not found | 404 | `NOT_FOUND` | `NOT_FOUND` | `not_found` | SetError `notFound`; `accountNotFound` |
| conflict / state mismatch | 409 or 412 | `CONFLICT` | `CONFLICT`, `PRECONDITION_FAILED` | `aborted`, `failed_precondition` | `stateMismatch` |
| rate limited | 429 | `TOO_MANY_REQUESTS` | `TOO_MANY_REQUESTS` | `resource_exhausted` | SetError `rateLimit` |
| module disabled / unknown action | 501 | `NOT_IMPLEMENTED` | `NOT_IMPLEMENTED` | `unimplemented` | `unknownMethod` |
| unavailable | 503 | `SERVICE_UNAVAILABLE` | `SERVICE_UNAVAILABLE` | `unavailable` | `serverUnavailable` |
| internal | 500 | `INTERNAL_SERVER_ERROR` | `INTERNAL_SERVER_ERROR` | `internal` | `serverFail` |

Every error carries a stable string `code` (for example `accounts.email_taken`), a `kind` from the
table, a `message`, optional `issues[{ path, message }]` taken verbatim from Standard Schema, and
`retryable`. Expected domain errors are declared on the action, so GraphQL can expose them as typed
union results through the Pothos errors plugin, oRPC through `.errors()`, and OpenAPI as documented
responses; undeclared errors are reported as `internal` with the message redacted.

### 5.6 Authentication context

Each transport extracts credentials from its own carrier and resolves them to the same `Principal`
before calling `invoke`: HTTP `Authorization` or cookies for REST, GraphQL, tRPC and oRPC;
`connectionParams` for graphql-ws and tRPC's `wsLink`; `requestGate` plus a context value for
Connect; the Bearer token on the session resource for JMAP; a local token for the CLI. Authorization
(the CASL-style abilities) is evaluated inside the invoker, never in a transport; Pothos scope-auth
reuses the same ability for field-level checks. `AsyncLocalStorage` carries principal, request id
and trace context so deep code never threads a context object. Subscriptions re-evaluate the
ability per emitted event, since the principal can lose access mid-stream.

### 5.7 Pagination and filtering

One registry-level model, projected per transport:

- Cursor pagination with opaque cursors that encode the sort key and the id (keyset, stable under
  inserts). Arguments `first`/`after` and `last`/`before`; result `{ items, pageInfo: {
  hasNextPage, hasPreviousPage, startCursor, endCursor }, total? }` with `total` opt-in because it
  costs a count.
- GraphQL: Relay connections from the Pothos relay plugin. REST: query parameters `first`, `after`,
  `sort`, and `filter` encoded as OpenAPI `deepObject` (`filter[status][eq]=active`). RPC: the same
  object. Connect: `page_size`/`page_token`/`next_page_token` (Google AIP-158). JMAP: `position`
  and `anchor`; the cursor's embedded id is the anchor, so both models coexist.
- Filtering is a typed AST per entity: `AND`/`OR`/`NOT` operators over field conditions (`eq`,
  `in`, `lt`, `gte`, `contains`, `isNull`), exactly JMAP's FilterOperator and FilterCondition.
  Sorting is `[{ property, isAscending }]`. The data layer compiles the AST; transports only encode
  it.

### 5.8 Observability

OpenTelemetry JS: traces and metrics are stable, logs are in development. Packages:
`@opentelemetry/api` 1.9.1, `sdk-node` 0.223.0 (SDK 2.x; `sdk-trace-node` 2.12.0),
`auto-instrumentations-node` 0.81.0, `instrumentation-http` 0.223.0, `instrumentation-undici`
0.33.0, `instrumentation-graphql` 0.71.0. Transport integrations: `@envelop/opentelemetry` 9.2.2,
`@pothos/tracing-opentelemetry` 1.2.1, `@hono/otel` 1.2.0, `@orpc/otel` 1.15.5, `@fastify/otel`
0.21.2; Connect-ES has none first-party (an interceptor is enough). Recommendation: the invoker
opens one span per action with attributes `pennestack.module`, `.entity`, `.action`, `.transport`,
`.sync` and the outcome kind; transports add their own spans through the integrations above and
propagate W3C `traceparent` (headers for HTTP and SSE, connection parameters for WebSocket).

## 6. Comparison table

| Candidate | Version | Standard Schema | Emits a contract | Streaming | Context and auth | Errors | OTel | Role for pennestack |
|---|---|---|---|---|---|---|---|---|
| Pothos + Yoga | 4.15.1 / 5.24.4 | validation plugin | SDL via `printSchema` | SSE default, graphql-ws | Yoga context factory, scope-auth | errors plugin unions, `extensions` | Envelop, tracing plugin | GraphQL module |
| Hono | 4.13.13 | standard-validator | own emitter needed | `streamSSE`, `upgradeWebSocket` | `c.set`/`c.get` typed variables | none built in | `@hono/otel` | HTTP host for every HTTP transport, REST module |
| Fastify + TypeBox | 5.12.5 / 6.1.0 | community 0.2.0 | swagger from JSON Schema | `@fastify/websocket` | hooks, decorators | reply schemas | `@fastify/otel` | not chosen (second schema source) |
| tRPC | 11.19.0 | yes | OpenAPI via community | SSE, WS | `createContext` | 21 fixed codes | none | tRPC module (required by brief) |
| oRPC | 1.15.5 | yes, plus Standard JSON Schema fallback | OpenAPI 3.2 native | SSE with resume, WS peer | `$context` + middleware | per-procedure typed | `@orpc/otel` | RPC module beside tRPC; typed client for tests and CLI |
| Connect-ES | 2.2.0 | n/a (protobuf) | `.proto` is the contract | 4 RPC types | context values, `requestGate` | 16 gRPC codes | interceptor | later transport; needs stable field tags |
| JMAP | RFC 8620 | n/a | capabilities in session | EventSource, Web Push, WS | HTTP auth + `accountId` | request/method/SetError | n/a | mail platform transport; semantics for generic entity actions |
| Stricli | 1.3.0 | n/a | completions | n/a | isolated `CommandContext` | exit codes | n/a | CLI module |

## 7. Recommendations

### 7.1 Libraries to build on

- Schema: Standard Schema 1.1 is the only schema interface the framework depends on; Zod 4.6.5 is
  the default in examples, never a hard dependency.
- HTTP host: Hono 4.13.13 with `@hono/node-server` 2.1.4; one Hono app is the `TransportHost` and
  every HTTP transport mounts under its own prefix.
- GraphQL module: Pothos 4.15.1 (relay, errors, validation, dataloader, scope-auth, tracing) on
  Yoga 5.24.4; SSE subscriptions by default, graphql-ws 6.3.0 optional; executor pluggable for
  Grafast later.
- REST module: pennestack's own projection on Hono with its own OpenAPI 3.1 emitter (3.2 behind a
  flag until client generators handle it), because the registry already holds JSON Schema and route
  conventions and neither zod-openapi (Zod-only) nor hono-openapi (in development) fits. Problem
  details per RFC 9457; Scalar for the reference UI.
- RPC modules: tRPC 11.19.0 because the brief requires it, plus oRPC 1.15.5, whose typed client
  also serves the CLI and the tests. Fallback if the REST emitter slips: oRPC's `OpenAPIHandler`
  exposes the registry over HTTP quickly, with oRPC's error body instead of problem details.
- Live updates: one `live` module exposing `subscribe` as an async iterable with resumable state
  tokens; SSE carrier first, WebSocket carrier (graphql-ws, tRPC `wsLink`, RFC 8887) second.
- Webhooks: `standardwebhooks` 1.1.1; outbound deliveries consume the same event stream; `type` is
  `module.entity.action`.
- CLI: Stricli 1.3.0 route maps generated from the registry.
- Later: Connect-ES 2.2.0 and JMAP with the mail platform.
- Tooling: TypeScript 7.0.2 (`tsc -b`), Node 24, pnpm workspace with project references, Biome
  2.5.15, Vitest 5.0.3 with typecheck, `@ark/attest` 0.57.0 on TypeScript 6, OpenTelemetry SDK 2.x.

### 7.2 The transport adapter contract

The registry stores action definitions; adapters read them and talk only to the invoker. Types
not shown (`Registry`, `ErrorSpec`, `AbilityRef`, `PageSpec`, `Principal`, `PenneError`,
`StateToken`, `Emitted`, `Telemetry`) belong to `module-systems.md`, `authorization.md` and
`events-and-sync.md` in this directory.

```ts
import type { StandardJSONSchemaV1, StandardSchemaV1 } from "@standard-schema/spec";

export type ActionKind = "query" | "mutation" | "subscription" | "command";
// "command" is accepted and queued without a result value (the brief's asynchronous requests).

export interface ActionRef { module: string; entity?: string; name: string }

export type Shape<T> = StandardSchemaV1<unknown, T> & StandardJSONSchemaV1;

export interface ActionDefinition<I = unknown, O = unknown> {
  ref: ActionRef;
  kind: ActionKind;
  input: Shape<I>;
  output: Shape<O>;                      // for subscriptions: the shape of one event
  errors: readonly ErrorSpec[];          // closed set this action may raise, see 5.5
  auth: { ability: AbilityRef } | { public: true };
  idempotent: boolean;                   // safe for GET/QUERY, retries and batching
  sync: "sync" | "async" | "either";     // which requests are handled synchronously
  page?: PageSpec;                       // cursor pagination, filter AST and sort fields, see 5.7
  hints: Partial<TransportHints>;        // per-transport naming; augmented by each adapter package
}

export interface TransportHints {
  http: { method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "QUERY"; path: string };
  graphql: { fieldName: string; typeName?: string };
  cli: { route: string[]; aliases?: string[] };
  jmap: { method: string; capability: string };
  connect: { service: string; method: string };
}

export interface Invocation<I> {
  action: ActionRef;
  input: I;
  principal: Principal | null;
  transport: string;
  requestId: string;
  traceparent?: string;
  signal: AbortSignal;
}

export type Outcome<O> = { ok: true; value: O } | { ok: false; error: PenneError };

export interface Invoker {
  invoke<I, O>(inv: Invocation<I>): Promise<Outcome<O>>;
  subscribe<I, E>(inv: Invocation<I>, resume?: { after: StateToken }): AsyncIterable<Emitted<E>>;
}

export interface Artifact { path: string; contentType: string; body: () => Promise<string> }

export interface TransportHost {
  http: Hono;                                           // shared by every HTTP transport
  upgrade(path: string, handler: WebSocketHandler): void;   // WebSocket carriers
}

export interface TransportAdapter<Options = unknown, Handle = unknown> {
  readonly name: string;
  readonly capabilities: { streaming: ReadonlySet<"sse" | "ws">; batch: boolean };
  /** Pure function of the registry: SDL, OpenAPI document, .proto, completions. */
  artifacts(registry: Registry, options: Options): readonly Artifact[];
  /** Mounts on the host and returns a handle used for teardown and tests. */
  mount(ctx: {
    registry: Registry;
    invoker: Invoker;
    host: TransportHost;
    options: Options;
    telemetry: Telemetry;
  }): Promise<Handle>;
}
```

Rules that follow: adapters never import handlers, never evaluate abilities and never read the
database; `artifacts` is pure, so the generator runs it in watch mode without booting the
application; every entity gets framework-generated `get`, `query`, `changes`, `queryChanges` and
`set` actions with JMAP semantics, which adapters map to `GET /things`, `things(first, after,
where)`, `things.query` and `Thing/query`; `hints` only rename, they never change behaviour.

### 7.3 Order of work

1. Registry field model, `ActionDefinition`, `Invoker`, error taxonomy, pagination AST.
2. Hono host, REST projection with OpenAPI emitter, problem details; `generate --check` in CI.
3. GraphQL module (Pothos and Yoga) with SSE subscriptions and typed error unions.
4. tRPC and oRPC modules; oRPC client used by the CLI and integration tests.
5. Stricli CLI module generated from the registry.
6. Webhooks module on the event stream.
7. Connect-ES and JMAP when the mail platform starts; Grafast executor when query depth justifies
   it.

## 8. Open questions

1. Entity fields: allocate protobuf-style stable numeric tags from day one (cheap now, costly to
   retrofit), or defer until the Connect module exists?
2. Does the brief's "tRPC module" permit oRPC alongside it, or should oRPC replace the hand-written
   REST projection as the fallback described in 7.1?
3. OpenAPI 3.1 or 3.2 as the committed default once `openapi-typescript` supports 3.2.
4. If Grafast becomes the executor, data-layer loaders need a batch contract (`loadMany` by keys)
   now; confirm against `data-layer.md`.
5. JMAP semantics for the generic entity actions depend on state tokens coming from the
   append-only chain described in `events-and-sync.md`.
6. Type tests on TypeScript 7.0 versus 6.x: attest needs the compiler API until 7.1.
7. Whether free-form Standard Schema inputs falling back to a `JSON` scalar in GraphQL is
   acceptable, or whether every action input must come from the field model.

## Appendix A. Versions checked on 2026-10-08

| Package | Version | Published |
|---|---|---|
| `@standard-schema/spec` | 1.1.0 | 2025-12-15 |
| `zod` / `valibot` / `arktype` | 4.6.5 / 1.5.0 / 2.2.8 | 2026-09-13 / 2026-09-09 / 2026-10-07 |
| `graphql` | 17.0.2 | 2026-07-03 |
| `@pothos/core` | 4.15.1 | 2026-09-13 |
| `graphql-yoga` | 5.24.4 | 2026-10-08 |
| `graphql-ws` / `graphql-sse` | 6.3.0 / 2.6.2 | 2026-09-24 / 2026-09-29 |
| `grafast` / `postgraphile` | 1.1.4 / 5.1.5 | 2026-10-02 / 2026-09-04 |
| `hono` / `@hono/node-server` | 4.13.13 / 2.1.4 | 2026-10-04 / 2026-10-08 |
| `@hono/zod-openapi` / `hono-openapi` | 1.6.3 / 1.3.5 | 2026-09-04 / 2026-10-07 |
| `fastify` / `@fastify/type-provider-typebox` | 5.12.5 / 6.1.0 | 2026-09-16 / 2025-10-19 |
| `@ts-rest/core` | 3.52.1 | 2025-03-04 |
| `@orpc/server` (all `@orpc/*`) | 1.15.5 | 2026-10-07 |
| `@trpc/server` | 11.19.0 | 2026-09-16 |
| `@connectrpc/connect` / `@bufbuild/protobuf` | 2.2.0 / 2.16.0 | 2026-09-07 / 2026-09-29 |
| `ws` / `crossws` | 8.22.0 / 0.4.15 | 2026-09-26 / 2026-10-06 |
| `standardwebhooks` | 1.1.1 | 2026-08-28 |
| `jmap-jam` | 0.13.8 | 2026-09-24 |
| `@stricli/core` / `citty` / `cmd-ts` / `commander` / `@oclif/core` / `clipanion` | 1.3.0 / 0.2.2 / 0.15.0 / 15.0.0 / 5.1.2 / 4.0.0-rc.4 | 2026-07-16 / 2026-04-01 / 2026-02-12 / 2026-05-29 / 2026-09-25 / 2024-09-06 |
| `typescript` | 5.9.3, 6.0.3, 7.0.2 | 2025-09-30, 2026-04-16, 2026-07-08 |
| `vitest` / `expect-type` / `@ark/attest` | 5.0.3 / 1.4.0 / 0.57.0 | 2026-09-30 / 2026-06-25 / 2026-10-07 |
| `@biomejs/biome` | 2.5.15 | 2026-09-30 |
| `@opentelemetry/api` / `sdk-node` / `sdk-trace-node` | 1.9.1 / 0.223.0 / 2.12.0 | 2026-03-25 / 2026-10-06 / 2026-10-06 |

Primary sources consulted: standardschema.dev; the Pothos, Yoga, Grafast, oRPC, tRPC, Connect,
Stricli, citty, cmd-ts and Vitest documentation; the TypeScript 5.9, 6.0 and 7.0 release posts;
the Biome blog; RFC 8620 and the jmap.io specification index; the Standard Webhooks specification;
the Node.js release schedule and TypeScript module documentation; the OpenTelemetry JS status
page.
