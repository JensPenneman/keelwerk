# @keelwerk/transport-trpc

The tRPC projection of the action surface at `/trpc` (section 16.7): the router built at `listen` for every API version, `TrpcRouterOf<App>` as a type fragment of the generated file, subscriptions over server-sent events with the stream token as the event id, and the shared conformance suite.

- Module: list `trpc` in `modules`, or `trpcTransport({ path, transformer })` for static options; per-backend `config` holds `cors` and `maxBodyBytes`.
- Static options: `path` (default `/trpc`) and `transformer` (`'superjson'` by default, `'json'` for the plain wire of section 16.4.2 and `TrpcRouterOf<App, false>`).
- Client: pass `keelwerkSuperjson()` as the `transformer` of every link (unless the app sets `transformer: 'json'`), send the command id as `Idempotency-Key` and `Prefer: respond-async` as the header of the call, and read subscriptions with `httpSubscriptionLink`.
- Batching: a request of several calls (`batch=1`) with `Idempotency-Key` or `Prefer: respond-async` is refused, so send such a call alone. A JSON-lines batch (`trpc-accept: application/jsonl`, tRPC's `httpBatchStreamLink`) that calls a command or a cookie-hinted action is answered whole, after every call has run, so that its `Set-Cookie`, `Keelwerk-Command-Id`, `Keelwerk-Effects` and `Preference-Applied` headers reach the caller; a slow query in such a batch delays every answer of that batch. To keep queries incremental, send such calls alone or through a link that does not stream. Every other JSON-lines batch streams incrementally.
- Subscriptions: every message holds exactly one frame, an item (`{ data }`, and `id` for an item that carries a state token) or a control frame (`{ control: 'head' | 'reset' | 'gap', ... }`, never with `data`), and never the bare event, so an event of any shape, even one with a member named `control`, is an item. A frame that carries a state token (an item of a resumable action, `head`, a `reset` with a state) is tracked: `httpSubscriptionLink` hands it over as `{ id, data: <frame> }` and resumes from that `id`; the other frames arrive as they are. An event with no value (the `void` output of an empty shape) arrives as `undefined`, or as `null` with `transformer: 'json'`, so that the item keeps its `data` (the router type says so: with `TrpcRouterOf<App, false>` a `void` event is typed `null` and a `string | undefined` event `string | null`). Unwrap a value that has a string `id` once, then narrow with `'data' in frame`:

  ```ts
  onData(value) {
    const frame = 'id' in value ? value.data : value; // tRPC's tracked wrapper
    if ('data' in frame) show(frame.data); // an item: the event
    else if (frame.control === 'reset') resubscribe(); // head, reset, gap
  }
  ```

- Known limits: a browser client on another origin needs CORS headers for `trpc-accept` and `preference-applied` that the host does not list yet; `hints.trpc.expose: false` hides a procedure at run time but `TrpcRouterOf` still lists it; a stream of this transport is not ended when its session ends, its key is revoked or the host stops, until the host fixes the life of a mounted stream once.
