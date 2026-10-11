# 4. Actions as the only unit of behaviour, with command and query semantics

Date: 2026-10-08 (revised 2026-10-11)

## Status

Proposed

## Context

The brief requires that entities carry actions, that actions can also be mounted on a module or
the app, that transports (GraphQL, REST, tRPC and others) derive from the same definitions, that
requests can be handled asynchronously with an application-chosen set handled synchronously,
that live updates exist on everything, and that authorization is per action. The interfaces
research (interfaces-and-devx.md) concluded that transports must be projections of one registry
calling one invoker, never handlers, and recommended adopting JMAP's generic method semantics
(`get`, `query`, `changes`, `queryChanges`, `set`) for framework-generated entity actions. The
events research (events-and-sync.md) recommended deciders over state producing events, inline
projections, a transactional queue, and declaring per command whether it is synchronous,
asynchronous or offline-capable.

The review of 2026-10-11 found that handler types depended on the app (`ActionContext<M, App>`),
although module packages are compiled before any app exists and several apps share them; that an
app's execution override could turn a `sync` action into `async` after the calling module was
compiled; that the generated `set` was one action for authorization; that subscription sources
could not resume; and that idempotency allowed two concurrent duplicates to run.

## Decision

1. Every behaviour is an action: a `query` (no side effects, always synchronous), a `command`
   (writes, runs in a unit, appends events) or a `subscription` (observes the live feed). An
   action has a reference (`module.entity.action`, `module.action`, `app.action`), a Standard
   Schema input and output, a closed error set, an `auth` requirement and optional principal kinds,
   a `scope` level, an `execution` mode, an idempotency window, optional pagination and transport
   hints.
2. Commands declare `execution: 'sync' | 'async' | 'either'`; the app's execution map decides how
   external callers (transports, the CLI, clients, listeners) are answered, and a caller may choose
   for `either`. Module code calling `ctx.invoke` gets the action's declared mode, so its types hold
   without an app. Asynchronous commands are validated and gated synchronously, recorded as an
   `accepted` receipt with their job in one unit, answered with a receipt, and executed by a worker
   that resolves the stored principal reference again (failing with `unauthenticated` when the
   credential was revoked) and authorizes again against current state.
3. Commands on chain-backed entities are written as pure deciders (`decide(input, current, ctx)`
   returning events) that receive the full current row; other commands and all queries use
   `handle(input, ctx)`. Every `ctx.data` write inside `handle` is recorded as field-level events.
   Field masks never apply to the write path.
4. Every entity receives generated `get`, `query`, `changes` and `queryChanges`, the set operations
   `create`, `update`, `archive` and `restore` (authorized under their own names, with `ifVersion`)
   and the batch `set` (authorized item by item), with RFC 8620 semantics; the live module's
   generator adds `watch`, and `history` is opt-in. History modes switch set operations off for
   projections and leave only reads for external tables. Transports that need JMAP's positional
   paging request it in their surface options.
5. One invoker runs a fixed pipeline (resolve scope, resolve principal, locate, admit, validate,
   authorize, execute, shape, complete); `Invoker.open` resolves scope and principal once per
   request or connection into an unforgeable session. Transports, listeners, the CLI, tests and
   modules calling each other all go through it. Transports never contain behaviour, never evaluate
   policies and never touch the data layer.
6. Every command invocation has a command id (a UUIDv7 or an opaque client key of up to 128
   characters). A receipt per `(scope, commandId)` is inserted as `pending` by the first statement
   of the command's unit, so a concurrent duplicate answers `core.command_in_progress` instead of
   running twice; receipts live in the command's namespace with tenancy `invocation`, are
   addressable by command id, and expire after the action's window (24 hours by default). Longer
   deduplication uses durable business keys.
7. The context passed to handlers, `ActionContext<M>`, is computed from the module alone: its own
   entities with the module's authority, read access to its dependencies, services bound to their
   providers, contracts it declares, and `ctx.invoke` for its own and its required modules'
   actions; commands of another scope run after commit through `ctx.enqueue`, which returns a
   receipt. Reads on behalf of the caller are explicit (`forCaller()`); `ctx.asSystem(reason)`
   invokes as the system principal and is logged. Authorization of the invoked action is ADR 0005.
8. Reactions are how a module responds to events: inline in the producing unit, or asynchronous as
   a keyed job per matching event (with key, ordering, coalescing, concurrency and retry options)
   that the kernel's dispatcher enqueues; both run under the module's service principal with the
   causing actor recorded. They are conditional on the module whose events they observe.
9. A subscription's `source(input, ctx, resume)` returns frames: items with stream tokens and
   control frames (`head`, `reset`, `gap`). Sources built on `ctx.live` are resumable, `mapItems`
   keeps them so, and `unresumable` declares the opposite; the surface derives `resumable` from
   that.

## Consequences

- Adding a transport never touches a module; adding a module never touches a transport.
- The query and command split is enforced structurally: a query has a read-only unit, a command's
  output is what it produced.
- "Which requests are synchronous" is a declaration with an app-level override for external
  callers, which satisfies the brief without per-transport configuration and keeps module types
  exact.
- Generated entity actions give every transport state-based incremental sync and optimistic
  concurrency for free. The JMAP transport maps onto them with one addition, positional paging,
  so it is a projection with its own option, not a renaming; tokens come from the data layer's
  positions (ADR 0007).
- Deciders make commands testable without a database and make convergence of offline edits
  property-testable; the price is two handler forms that authors must choose between.
- Internal calls cannot escalate silently; system work is explicit and audited, and queued work
  stops when its principal loses its credential.
