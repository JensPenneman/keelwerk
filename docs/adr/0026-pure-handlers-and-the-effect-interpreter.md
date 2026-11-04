# 26. Pure handlers and the effect interpreter

Date: 2026-10-25 (notes of 2026-10-28; item 6 refined on 2026-11-04 after the write-path spike)

## Status

Accepted (2026-11-04). Decision 50a of the register (2026-10-25): option a, fully strict; option c, the split
model, is the fallback. Amends [ADR 0004](0004-actions-as-the-unit-of-behaviour.md) (decisions 3
and 7, and the mentions of `ctx.invoke` and `unresumable` in decisions 2 and 9) and gives
[ADR 0015](0015-jobs-timers-and-schedules.md) (decision 6) and
[ADR 0025](0025-nodes-capacity-and-autoscaling.md) (decision 4) their effect and executor contract;
ADRs 0003, 0005, 0006, 0008, 0012 and 0013 carry notes of the forms it replaces. Architecture.md
section 7.9 specifies the design; its decision points are 73 to 80 of the register, which Jens
decided on 2026-10-28 as the text assumed (73a, 74a, 75a, 76a, 77a, 78a, 79b, 80a), with a
reservation on 74: he is not sold on the phase restrictions, which the M0 spike and Trail's rebuild
test, with option c as the agreed fallback. On 2026-10-28 he also reopened and confirmed 50a and
asked the M0 spike to prototype one variant: no separate `prepare`, `decide` performing inline
effects only before its first load, the kernel opening the unit there and refusing later inline
effects (architecture.md section 26.2). With decision 47c, attempt records are kept until a
retention rule is adopted (item 6), and with decision 19b the invocation's clock is a
`Temporal.Instant` (item 3).

## Context

Brief addendum 4 (2026-10-24) requires pure functions: inputs only through parameters, outputs only
through return values, no hidden channel, and a tool-enforced reconciliation with databases,
networks, clocks and randomness. The specification had `decide` (pure apart from the clock, ids and
reads) beside the imperative `handle`, services, fills, reactions and hooks. Jens chose strict: "fully
strict, the safest option; this way I can trace each cause and effect and rebuild a full database
and logbook from them". [research/pure-handlers.md](../research/pure-handlers.md) compares the prior
art, and [architecture.md section 7.9](../architecture.md) is the specification.

## Decision

1. Every part a module author writes is pure. Imperative code lives only in the kernel, the
   deployment's infrastructure entries, transport and listener modules, and effect executors.
2. Forms: commands `decide` (a function or a generator) returning a decision `{ events, effects,
   result }`, with an optional `prepare` for sync commands; queries `read`, returning a request (a
   query description) or a generator; subscriptions `source`, returning a live source description;
   reactions, hooks and process managers `react`; services and fills are pure functions or
   generators bound to their providers. `handle` is removed.
3. Requests are yielded with `yield*` and typed one by one: loads with module authority and
   `forCaller()`, `ask`, flags, ids, random values, secret issuance, reveals and verification,
   computations (Argon2id off the event loop) and, in `prepare` only, inline effects. Requests never
   throw into a generator. The clock is the invocation's time, a `Temporal.Instant`, not a request.
4. Effects: kernel effects (`invoke`, `enqueue`, `setTimer`, `cancelTimer`, `settle`, scope-key
   claims) run in the unit or at its commit. External effects are declared with `defineEffect` and
   performed after commit, at least once, with the effect id as idempotency key, by a
   `defineEffectExecutor` (the only imperative module code, without data access) or by an external
   performer that pulls and settles them (Launchway's agent). Outcomes reach continuations and the
   effect record. A sync invocation never awaits a deferred effect; an inline effect runs only in
   `prepare`, bounded, without capability or retries.
5. Executor retries handle failures without domain meaning; anything else, mail delivery included,
   is a state machine with timers and one effect per attempt.
6. The logbook is the chain: a decision record in each event's meta (the input's digest, and the
   sealed input only for actions that opt in; the snapshot position of every load, read for a
   locked load after its lock is held and never from a subselect in the locking statement, which
   recorded a stale position in 100 of 100 commits on a hot row (architecture.md section 7.9.4,
   phase 5); ids, random
   values and the public part of issued secrets; effect ids), and one `core.effect` stream per
   effect (`requested`, `settled`), with attempts as stream records, kept until a retention rule is
   adopted (decision 47c). Load answers are reproduced
   from the chain, never stored. The database and the logbook rebuild from the chain, and unsettled
   effects are enqueued again after a restore.
7. Every command is retried on version conflicts, serialization failures and deadlocks, up to three
   times, because no decision performs anything.
8. Enforcement: handler types exclude promises; GritQL plugins (`pure-parts`, `no-module-state`,
   `no-await-in-parts`); Biome's `noNodejsModules` and `noRestrictedImports` outside
   `src/executors/`, `noProcessEnv` outside `keelwerk.config.ts`; compose checks.
9. Layout: `src/effects/`, `src/executors/` and `src/executors/lib/`; the module literal, which the
   generator writes since decision 59b (ADR 0024), mounts `effects` and `executors`.

## Consequences

- Every change and every outside interaction has a record linked to its cause; `keelwerk explain
  --trace`, `--redecide` and `--dry-run` work for every command; tests need no mocks.
- No command can call code that performs effects, so every command is retried automatically and
  offline commands are re-decided at ingest.
- Code that used to `await` becomes a generator with `yield*`; an invoked command's result does not
  return to its caller; reading an external system is a command with an effect, never a query;
  interactive flows that need an outside answer use `prepare`.
- The kernel grows (interpreter, effect records, continuations, external performers, a computation
  pool), and each effect costs two chain events plus attempt records.
- Launchway's `nodes.command` rows become effects with an external performer, mail delivery becomes
  a state machine, and gap G2's outbox choice is made.
- If strictness becomes a burden in practice (friction reported in M1 to M4, Trail's and Launchway's
  rebuilds included), option c keeps this
  design for everything that decides and allows awaited capabilities in queries and services.
