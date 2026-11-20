# @keelwerk/transport-orpc

The oRPC transport of keelwerk (architecture section 16.7.7): the router derived from the API surface
of each version, served by oRPC's RPC handler on `/orpc`, a typed client tree `OrpcRouterOf<App>`
for `@orpc/client`, event-iterator subscriptions over server-sent events and, as an option, oRPC's
OpenAPI handler.

```ts
import { orpc } from '@keelwerk/transport-orpc';

defineApp({ id: 'library', modules: [library, orpc] });
```

## Static options

`orpcTransport(options)` makes a module value with the same id, so an app still lists one `orpc`.

- `path` (default `'/orpc'`): the prefix of the RPC handler.
- `serializer` (default `'orpc'`): `'orpc'` is oRPC's serialiser with `orpcJsonSerializers`;
  `'json'` is the plain JSON of section 16.4.2, with no custom types.
- `openapi` (absent by default): the prefix of oRPC's OpenAPI handler. Without it the handler is not
  mounted.

The module's `config` has two members. `cors` is the extra origins the host allows (the host applies
it; a backend without an `orpc` entry allows none). `maxBodyBytes` is the most bytes of a request
body (an integer of at least 1024, default 1 MiB). The host reads every body within its own
`maxBodyBytes` first, so a setting above the host's has no effect. The transport then refuses a body
above its bound at the RPC and the OpenAPI handler with `core.payload_too_large`, status 413, in the
transport's error form: a declared `content-length` above it before the transport reads a byte, and
a body without one at the first chunk over it. The client's upload is never cut by this setting, as
the host has read it by then.

Known limit: the host's CORS lists do not yet take the headers a transport declares, so a browser
client on another origin can neither resume an oRPC subscription with `Last-Event-ID` nor read
`Preference-Applied`; the lists take them in a change of the host.

## The router

Every action of the surface is one procedure at `<module>/<action>` (`library/findByIsbn`), an
entity action below its entity (`library/book/query`); the module id is in lower camel case
(`api-keys` is `apiKeys`) and app actions are under `app`. The router is built per API version and
checked at mount: an input that is no shape, a declared error the surface does not list, two module
ids with one camel form, a module action named like an entity of its module and a cookie hint whose
name lacks the `__Host-` prefix stop the start.

A call is `POST <prefix>/<path>`; the answer to a request with another method is
`core.unsupported` with status 405.

## The typed client

`@orpc/client` types a client from the router type alone:

```ts
import { createORPCClient, isDefinedError, safe } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import { orpcJsonSerializers, type OrpcRouterOf } from '@keelwerk/transport-orpc';
import type { App } from './keelwerk.generated.ts';

const client = createORPCClient<OrpcRouterOf<App>>(
  new RPCLink({
    url: 'https://tenant.example.com/orpc',
    customJsonSerializers: orpcJsonSerializers,
    headers: { authorization: `Bearer ${token}` },
  }),
);

const [error, book] = await safe(client.library.addBook({ title: 'Dune', isbn }));
if (error !== null && isDefinedError(error)) {
  error.code; // 'library.isbn_taken'
  error.data.details.isbn;
}
```

`keelwerk generate` writes the same type as `OrpcRouter` into `keelwerk.generated.ts`. With
`serializer: 'json'` the type is `OrpcRouterOf<App, 'json'>` and a client does not pass
`orpcJsonSerializers`; values are then their wire strings.

A procedure with no input takes `{}`.

### Values

With the default serialiser an instant, a date, a wide integer, bytes and a set arrive as
`Temporal.Instant`, `Temporal.PlainDate`, `bigint`, `Uint8Array` and `Set`, as `AppActionTree`
types them. oRPC carries `bigint` and `Set` itself; `orpcJsonSerializers` adds the other three as
custom types 20, 21 and 22. Ids stay TypeIDs, decimals stay strings. oRPC's deserialiser also
revives a `Date`, a `Map`, a `URL`, a `RegExp`, a `Blob` or `File` and a number that is not finite;
no other transport can send them, so they are refused as `core.malformed_request` with an issue at
their path, an undefined member is dropped and an undefined array item is null, as JSON writes them.

### Commands

A command is idempotent through the `Idempotency-Key` request header and answers asynchronously
when `Prefer: respond-async` is sent (set both with the link's `headers`). The response of a command
that succeeded carries `Keelwerk-Command-Id`, `Idempotent-Replayed` on a replay and
`Keelwerk-Effects`; a failed command carries none of them, as in REST. An accepted command answers
status 202 and the receipt as its body, and `Preference-Applied: respond-async` only when the
client sent that preference. A version precondition is the `ifVersion` member of the input.

### Errors

An error has the code of the taxonomy and the status of section 16.4.6; its `data` is the wire error
of the caller's audience with the `requestId`. The errors an action declares are in the procedure's
error map, so a client sees them as defined errors with typed `details`. `Retry-After` and
`WWW-Authenticate` are set as on every transport. oRPC's own refusals (a malformed body, an unknown
path, a wrong method) are answered in the same form.

### Subscriptions

A subscription is an event iterator over server-sent events (`POST`, `Accept: text/event-stream`).
Every frame is an object with one of two shapes:

- an item is `{ data, id? }`: `data` is the event exactly as it is, whatever it holds, and `id` is
  the stream token to resume from, absent when the source cannot resume;
- a control frame is `{ control, ... }` and never has `data`: `{ control: 'head', state }`,
  `{ control: 'reset', reason, state? }` or `{ control: 'gap', missed? }`.

A reader decides by the presence of `data`. A frame with `data` is an item, whatever `data`
contains, so an event of any kind (a shape, a json value, a foreign schema) may have a member
called `control`: it stays inside `data` and is never read as a control frame. A frame with
`control` and without `data` is a control frame; a frame with both, or with neither, is malformed
and a reader refuses it. A reader skips a control frame whose `control` it does not know, and
treats a reset of any `reason` as a reset, so a later control kind or reset reason does not break
it: in the OpenAPI document `control` and `reason` are plain strings.

The position to resume from is `id` on an item and `state` on a head or a reset (the `state` of
core's `StreamControl`). A client that keeps its own position reads `frame.id` of an item and
`frame.state` of a head or a reset.

```ts
for await (const frame of await client.loans.loanEvents({})) {
  if ('data' in frame) {
    frame.data; // the event; frame.id is the position to resume from
  } else if (frame.control === 'head') {
    frame.state; // the position the stream starts from
  } else if (frame.control === 'reset') {
    // The stream is over: subscribe again with `lastEventId: frame.state` when the reset has a
    // state, and from the start when it has none.
  } else if (frame.control === 'gap') {
    frame.missed; // some items were not delivered
  } else {
    // a control kind this client does not know: skip it
  }
}
```

The stream token is also the SSE event id of every item, of the head and of a reset that has a
state, as in the host's own SSE, so a client that resumes through oRPC's `lastEventId` (the
`Last-Event-ID` header) reads neither `id` nor `state`: the event id is the position. A reset
without a state, and a gap, carry no event id. A `reset` is the last frame of its stream: after it
the transport sends nothing more and ends the stream (the invocation is aborted and the source
returned), whatever the source does, and the client subscribes again as the recipe says. The
first frame is awaited before the answer starts, so a refusal (a malformed token, a forbidden
subscription) is an HTTP error and not a stream.

Known limit: a stream mounted by this transport is not ended when its session ends, its key is
revoked or the host stops; the host will end it once for every transport.

## The OpenAPI handler

With `openapi: '/orpc-openapi'` oRPC's OpenAPI handler answers `POST <prefix>/<path>` with a plain
JSON body, and `GET <prefix>/openapi.json` answers oRPC's OpenAPI document of the API version of
the session. Both documents describe the same schemas (`toJsonSchema` of the surface's field nodes).
`orpcOpenapiDocument(surface)` writes the document without a running host.

## The comparison with the REST document

`test/generated/orpc/orpc-conformance/comparison.json` holds what the two OpenAPI documents of the
conformance app say (format `keelwerk.orpc-comparison/1`): the document of `@keelwerk/transport-rest`
against oRPC's own, as counts and name lists for problem details, pagination, execution modes and
receipts and version headers. `comparison.test.ts` checks it like any generated file and the
following command writes it:

```sh
pnpm vitest run --project transport-orpc test/comparison.test.ts -u
```
