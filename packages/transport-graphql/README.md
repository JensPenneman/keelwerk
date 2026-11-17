# @keelwerk/transport-graphql

The GraphQL transport of keelwerk (architecture section 16.6): the schema derived from the API
surface of each version, served by Yoga on `/graphql`, with the operation limits of the gate, and
subscriptions over GraphQL over SSE and `graphql-transport-ws`.

## Subscriptions

Every subscription action and every generated `watch` is a field of the `Subscription` root that
answers `<Name>Event!`, a union of the item type (the members of the event and `state`, the token of
the stream after it) and the shared control types `StreamHead { state }`,
`StreamReset { reason, state }` and `StreamGap { missed }`. The `after` argument resumes from the
`state` of an item or a head; it replaces an input member of that name. A schema without a
subscription has no `Subscription` root and none of the stream types.

- **GraphQL over SSE** (distinct connections): `POST /graphql` with `Accept: text/event-stream`. The
  host charges it to the same stream limits as every other stream and applies the same cross-site
  check when a cookie carries the session. `GET` never executes an operation.
- **graphql-ws** 6.4.1: `graphql-transport-ws` on the host's upgrade table, on the path of the
  endpoint. A backend turns it on with the `websocket` setting of its `graphql` configuration
  (default `false`; a backend without it answers 404 before the handshake). Only subscription
  operations run over the socket; queries and mutations go over HTTP.

The socket is the host's. The origin check and the retired-version check at the upgrade, the
anonymous cap per address, the subscription slots, the session check, the maximum duration and the
ping and pong bounds are the ones of `keelwerk.live.v1`; this package writes none of its own.

### Credentials

A WebSocket client cannot set headers, so the credentials come with `connection_init`:

```ts
createClient({
  url: 'wss://tenant.example.com/graphql',
  connectionParams: { token, tenant, backend, apiVersion },
});
```

`token`, `tenant`, `backend` and `apiVersion` are the members the hello of `keelwerk.live.v1` has;
all are optional and each must be a string (anything else closes the socket 4400). They are read
once, at `connection_init`, and never logged or put in a frame, an error or a close reason. Other
members are ignored. A cookie or `Authorization` header of the upgrade request is a credential as
it is for HTTP. A socket that sends no `connection_init` in time is closed 4408, a second one 4429,
and a `subscribe` before the acknowledgement 4401.

### Deprecations

A deprecated API version or action adds `extensions.keelwerk.deprecations` to the first result of an
operation (a query, a mutation, or the first item of a stream).

## The SDL

`generated/graphql/<app>/<version>.graphql` is the lexicographically sorted print of the schema of
each API version, with no header, so the file equals what the served schema prints byte for byte. It
is an artefact of the adapter: `keelwerk generate` writes it for every app that composes `graphql`
and `keelwerk generate --check` compares it. The golden files of this package's own conformance
app are under `test/generated/graphql/graphql-conformance/` and are rewritten by one command:

```sh
pnpm vitest run --project transport-graphql test/sdl.test.ts -u
```
