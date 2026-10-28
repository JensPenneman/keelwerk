# 12. Live updates: one module over the event log, SSE first and WebSocket second

Date: 2026-10-11 (revised after review the same day; amended 2026-10-25)

## Status

Proposed. Item 2's custom sources are amended by
[ADR 0026](0026-pure-handlers-and-the-effect-interpreter.md) (decision 50a): a module's source is a
description, and `unresumable` remains for kernel and listener code only.

## Context

The brief requires live updates on everything, delivered by a module or by framework
configuration, and data that multiple actors work on online and offline at the same time.
[architecture.md](../architecture.md) fixes the pieces around it: every entity produces events or
transient change records (sections 15.1 and 15.1.10); the data layer offers a `ChangeFeed` with
`read(scope, after, selector)` and `wake(scope)` (section 9.6); a `LiveHub` re-evaluates the
principal's plan per event, masks fields and emits with a resume token; subscriptions re-run the
plan per emitted event because a principal can lose access mid-stream (section 8.4).

The data layer fixes the storage side (ADR 0007): commit-ordered integer positions per scope;
tokens of the form `v1.<epoch>.<position>.<scope>.<check>` shared by JMAP states, live resumption
and sync cursors, with `get` and `query` states that are valid resume points and a disclosure rule
that resynchronises instead of guessing; poke-then-pull for clients; transient change records that
give `state` entities a live feed; and the `sync` module's actions. The platforms add stream records
and ephemeral topics with subscriber hooks (gap G6, deployment and container logs) and presence
travelling through the live module.

The research ([research/interfaces-and-devx.md](../research/interfaces-and-devx.md) section 3.6,
[research/events-and-sync.md](../research/events-and-sync.md) sections 8.3 and 10) points out the
known failure modes: unbounded live views and thundering-herd reconnects (Figma's LiveGraph), offline
edits authorized against stale rights, and browsers' `EventSource`, which cannot send an
`Authorization` header.

The review of 2026-10-11 found that custom subscription sources could not resume (no resume token
reached them, and mapping frames by hand lost the tokens), that relation-based rules made the hub
query the database once per subscriber and batch, that the live tail was described both as a leased
consumer and as a reader in every process, that the generated change was named `updated` here and
`changed` in the event log, and that WebSocket upgrades escaped the CSRF check.

## Decision

1. **One module.** `@keelwerk/live` (module id `live`) fills the `single` kernel extension point
   `liveHub` with the hub (and provides the `live` contract), `liveCarriers` with the SSE and
   WebSocket carriers, the kernel extension point `entityActionGenerators` with the core's `watch`
   template on every entity, and `principalResolvers` with a stream-ticket resolver; it declares
   `live.pokes` and `live.ticket`. Without it no subscription streams and `watch` does not exist in
   the types; modules that build their own sources require the `live` contract or put their
   subscriptions in a conditional part keyed on it.
2. **Sources.** Entity changes (`watch`, with optional `ids`, `filter`, `fields`, `includeArchived`,
   `partition` and `from: 'now' | 'beginning'`; a filter makes it a live query with `removed` items
   when a row leaves the view), pokes (the new token per readable entity type, for clients that
   pull), command receipts (the receipt entity's `watch`), stream records (resumable by per-key
   serial), topics (never stored; `gap` frames on overflow; subscriber hooks on a deployment-wide
   count kept as leases in the control store) and custom sources. Items are `created`, `changed`,
   `archived`, `restored` and `removed` (with the sync protocol's reasons), with the domain event's
   name as `cause` but never its data. A custom source is `source(input, ctx, resume)`; built on
   `ctx.live` with `after: resume` and mapped with `mapItems`, it keeps stream tokens and control
   frames and is resumable; wrapped with `unresumable`, it is not. The surface derives `resumable`
   from that. Since ADR 0026, module sources are descriptions built with `ctx.live` (which adds the
   pending effects of an external performer), maps are pure or generator functions, and only kernel
   and listener code wraps iterables. The `sync` actions are ordinary actions carried by every transport.
3. **Authorization per event, at current permissions.** The gate runs at subscribe time with the
   entity's read rules (the `read` alias covers `watch`). Per batch, the hub loads post-images once
   per scope and groups subscriptions by resolved plan: each distinct plan is evaluated once per
   batch, field operators in memory and relation quantifiers with one `rows.matching` query per
   distinct plan and batch. It decides `removed` items from the set of delivered ids while a stream
   is connected and by the disclosure rule after a resume (a row the subscriber never could see is
   never mentioned; uncertainty becomes `reset` with reason `resync`), masks maskable fields per
   row, and revalidates the session at its expiry, at least every 60 seconds and on revocation
   events. Replayed history is authorized under today's permissions.
4. **Stream tokens are the data layer's tokens.** Every resumable item carries a `StateToken`.
   Clients resume with `after` (or `Last-Event-ID`, or tRPC's `lastEventId`); an unparsable token or
   one of another scope is a `validation` error (`core.token_scope_mismatch`); an epoch or check
   mismatch yields `reset` with reason `resync`, a token older than retention `reset` with reason
   `expired`. Because one token form serves JMAP states, live resumption and sync cursors, "query,
   then watch from its state" is gap-free, and `from: 'beginning'` gives the same guarantee in one
   call.
5. **Delivery and backpressure.** Ordered by position within a scope, at least once across
   reconnects. Each subscription has a bounded buffer (1,000 items or 1 MiB); overflow sends `reset`
   with the last delivered token and the client catches up with `changes` (topics send `gap`
   instead). A `head` frame marks the moment a resumed or from-the-beginning stream has caught up.
   Heartbeats every 15 seconds (SSE comment) or 30 seconds (WebSocket ping); streams end after 24
   hours or on shutdown and are resumed by token on any process; no sticky sessions.
6. **Carriers.** SSE (`text/event-stream` with `id`, `event: data | head | reset | gap | error |
   end`, heartbeat comments) for the invocation protocol and REST; a WebSocket subprotocol
   `keelwerk.live.v1` (first-message `hello` with credentials, multiplexed `subscribe` and
   `unsubscribe`, `invoke` for commands on the same connection, ephemeral `presence` from milestone
   M7 (M9 before the roadmap's renumbering of 2026-10-28), close codes aligned with the error
   table). Every WebSocket upgrade and every cookie-authenticated SSE request passes the host's
   origin check. Browsers that use `EventSource`
   authenticate with cookies or a single-use stream ticket valid for 60 seconds, never with a
   long-lived token in the URL. The WebSocket carrier with the typed client also serves Launchway's
   new agent, which since decision 23c has no protocol of its own (a clean break with protocol v1).
7. **Per transport.** GraphQL subscriptions over GraphQL-over-SSE (Yoga) and graphql-ws 6.3.0,
   returning a union of the item and the control types, with a `state` field and an `after`
   argument; tRPC subscriptions over `httpSubscriptionLink` with `tracked()` ids as stream tokens
   and an optional WebSocket link; REST subscription paths as SSE; the CLI as NDJSON over the
   invocation protocol with automatic resume. All of them call `invoker.subscribe` under the
   connection's session.
8. **Fan-out.** One reader per scope in every serving process, outside consumer leases, woken by
   the adapter's wake-ups (sent after commit, coalesced, with polling as the fallback) and reading
   everything committed after its position; one post-image load per batch, fanned out in memory by
   selector. Topics and presence cross processes through the data adapter's `broadcast` capability
   where it exists, and through the kernel's polling where it does not (brief addendum 5, decision
   12a). Admission at subscribe time limits subscriptions per tenant, connections per
   principal and subscriptions per WebSocket, counted deployment-wide.

## Consequences

- Adding `live` to an app's tuple gives every entity a live feed in every transport; no module
  author writes a per-entity subscription, which is what "live updates on everything" requires.
- Slow or disconnected clients cost bounded memory; recovery always goes through the same
  `changes` path the sync protocol uses, so live and catch-up share one code path.
- Per-event authorization costs one evaluation per distinct plan and batch, in memory for field
  operators and one database query for relation quantifiers, plus one post-image load per batch;
  the dual-evaluation suite covers the in-memory interpreter, and the cost is measured on the proof
  apps before tuning.
- Delivery is at least once, not exactly once; clients must deduplicate by `(id, version)`.
- Resumption depends on the data layer's tokens and disclosure rule; a change to the token form
  would need a change of ADR 0007 as well.
- Without the `broadcast` capability, topics and presence still cross processes, through polling,
  at up to one polling interval of extra delay, which `keelwerk doctor` reports.
- WebSocket support means one more protocol to secure (origin checks, first-message authentication,
  close codes, limits); SSE remains sufficient for clients with few subscriptions or with HTTP/2.
