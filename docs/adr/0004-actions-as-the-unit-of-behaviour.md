# 4. Actions as the only unit of behaviour, with command and query semantics

Date: 2026-10-08

## Status

Accepted

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

## Decision

1. Every behaviour is an action: a `query` (no side effects, always synchronous), a `command`
   (writes, runs in a transaction, appends events) or a `subscription` (observes the live feed).
   An action has a reference (`module.entity.action`, `module.action`, `app.action`), a Standard
   Schema input and output, a closed error set, an `auth` requirement, a `scope` level, an
   `execution` mode, an idempotency flag, optional pagination and transport hints.
2. Commands declare `execution: 'sync' | 'async' | 'either'`; the app may override per action and
   a caller may choose for `either`. Asynchronous commands are validated and gated synchronously,
   recorded as a receipt and enqueued in one transaction, answered with a receipt, executed by a
   worker under the original principal with a second authorization, and reported on the live
   feed. `offline: true` is a separate flag for commands that may be authored offline and touch
   mergeable fields only.
3. Commands on chain-backed entities are written as pure deciders (`decide(input, state, ctx)`
   returning events); other commands and all queries use `handle(input, ctx)`. Every `ctx.data`
   write inside `handle` is recorded as field-level events.
4. Every entity receives generated `get`, `query`, `changes`, `queryChanges` and `set` actions
   with RFC 8620 semantics (state tokens, `ifInState`, filter, sort, cursor pagination), which a
   module can switch off per entity.
5. One invoker runs a fixed pipeline (resolve scope, resolve principal, locate, admit, validate,
   authorize, execute, shape, complete). Transports, the CLI, tests and modules calling each
   other all go through it. Transports never contain behaviour, never evaluate policies and never
   touch the data layer.
6. Every command invocation has a `commandId`; receipts per `(scope, commandId)` give idempotency
   for HTTP retries, queues and the offline protocol with one mechanism.
7. The context passed to handlers is typed from the module's declared dependencies and applies
   the principal's authorization plan to every read and write; `ctx.asSystem(reason)` is the only
   bypass and is logged.
8. Reactions (inline in the producing transaction, or asynchronous and checkpointed) are how a
   module responds to another module's events; they are conditional on that module.

## Consequences

- Adding a transport never touches a module; adding a module never touches a transport.
- The query and command split is enforced structurally: a query has no transaction, a command's
  output is what it produced.
- "Which requests are synchronous" is a declaration with an app-level override, which satisfies
  the brief without per-transport configuration.
- Generated entity actions give every transport state-based incremental sync and optimistic
  concurrency for free, and make the mail platform's JMAP transport a renaming; they depend on
  the chain's position tokens, which data.md must provide.
- Deciders make commands testable without a database and make convergence of offline edits
  property-testable; the price is two handler forms that authors must choose between.
- Internal calls cannot bypass authorization silently; privileged work is explicit and audited.
