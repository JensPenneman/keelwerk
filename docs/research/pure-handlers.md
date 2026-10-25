# Pure handlers: prior art for decision 50a

Date: 2026-10-25. Status: research input for the section "Pure handlers and the effect interpreter"
(`docs/architecture.md section 7.9`) and [ADR 0026](../adr/0026-pure-handlers-and-the-effect-interpreter.md);
it decides nothing by itself. Scope: how systems that keep decisions pure place, type, record and
replay effects, and what pennestack takes under decision 50a (fully strict, decided 2026-10-25).
Method: the specification, brief addendum 4 and the decision register; versions with `npm view` on
2026-10-25; type definitions read from the npm tarballs of `@event-driven-io/emmett` 0.42.4,
`@dbos-inc/dbos-sdk` 5.3.0, `effect` 4.0.6 and `@redux-saga/types` 1.4.1, and the configuration
schema of `@biomejs/biome` 2.5.15; one local measurement (Argon2id on Node 24.21.0); five of the six
web searches and three of the four page fetches the brief allowed. Statements marked "(not
re-checked)" are prior knowledge that was not verified within the caps.

## 1. What pennestack needs

- Brief addendum 4: inputs only through parameters, outputs only through return values, no hidden
  channel, and a stated reconciliation with databases, networks, clocks and randomness that tooling
  enforces.
- Decision 50a and Jens's reason: "fully strict, the safest option; this way I can trace each cause
  and effect and rebuild a full database and logbook from them".
- Constraints the specification already fixes: an invocation is one short unit on one namespace
  (section 14.3.6); no unit waits on the network (section 9.5.2); external effects run after commit,
  at least once (ADR 0025); the chain is the event log, hashed and positioned per scope (section
  15.1); handlers are typed from the module base with no generator in the type path (section 4.1);
  TypeScript has no effect system.

## 2. Comparison

Table 1. Where effects live, how non-determinism is handled, what is recorded.

| System (version checked) | Where effects live | Time, ids, randomness | What is recorded | Replay and tests | Typing of effects |
|---|---|---|---|---|---|
| Temporal TypeScript SDK (`@temporalio/workflow` 1.24.0, 2026-09-15) | activities, called through `proxyActivities`; workflow code only schedules them | the workflow sandbox replaces `Date` (the time of the last workflow task) and `Math.random` (seeded); `uuid4()` from the SDK | the event history: commands and activity results | the history is replayed through the workflow code; a divergence is a nondeterminism error; replay tests from saved histories | activity types imported into workflows |
| Restate (`@restatedev/restate-sdk` 1.17.4, 2026-10-20) | `ctx.run(name, fn, retryPolicy)` closures, plus calls, sleeps and state through `ctx` | `ctx.date.now()` journaled; `ctx.rand` seeded from the invocation id and documented as unfit for cryptography | a journal of every context call and `ctx.run` result | re-execution skips journaled steps; context calls must come in the same order | plain async TypeScript |
| DBOS (`@dbos-inc/dbos-sdk` 5.3.0, 2026-10-15) | steps (`DBOS.runStep`), at least once, checkpointed after they complete | `DBOS.now()` and `DBOS.randomUUID()` are recorded inside workflows | step outputs in PostgreSQL | recovery resumes after the last step; `forkWorkflow` replays from a step, optionally under another application version; `rewind` replays in place | plain async TypeScript |
| Decider (Chassaing, 2021-12-17) | outside the model: `decide: 'c -> 's -> 'e list`, `evolve: 's -> 'e -> 's`, `initialState`, `isTerminal` | carried by the command | events | given events, when a command, then events | algebraic data types |
| Emmett (`@event-driven-io/emmett` 0.42.4, 2026-08-12) | `Decider.decide(command, state)` returns events; `Workflow.decide(input, state)` returns outputs as values: `reply`, `send`, `publish`, `schedule`, `complete`, `ignore`, `error`, `accept` | carried by the command | events in streams | `DeciderSpecification`: given, when, then | TypeScript types; `decide` is synchronous over one stream's state |
| Effect (`effect` 4.0.6, 2026-10-22) | `Effect<A, E, R>` values, run by Effect's runtime | `Clock` and `Random` services | nothing; no journal | services replaced through layers | `Effect` implements `[Symbol.iterator]`, so `yield*` in `Effect.gen` types each result; requirements in `R` |
| redux-saga (1.5.1, 2026-07-26; `@redux-saga/types` 1.4.1) | generators yield plain objects (`{ '@@redux-saga/IO': true, combinator, type, payload }`: `call`, `put`, `select`) that the middleware performs | `call(Date.now)` like any effect | nothing | tests step the generator and compare the yielded objects, without mocks | `yield` answers are untyped; `typed-redux-saga` 1.5.0 (2022-05-30) wraps effects for `yield*` |
| Elm architecture (not re-checked) | `update : Msg -> Model -> ( Model, Cmd Msg )`; the runtime performs commands and returns results as messages | `Time.now` and `Random.generate` are commands | nothing | `update` is a pure function | language-level purity |
| Functional core, imperative shell (Bernhardt, 2012-07-12) | "a shell of imperative code" that "manipulates stdin, stdout, the database, and the network, all based on values produced by the functional core" | in the shell | nothing prescribed | the core is tested without doubles | a convention |
| Unison abilities, Koka effect handlers (not re-checked) | operations of declared abilities or effects, interpreted by handlers | effects like any other | nothing prescribed | handlers swapped in tests | effect rows in function types |

## 3. What each gets right for pennestack

### Durable execution: Temporal, Restate, DBOS

- All three make imperative-looking code replayable by recording every non-deterministic answer, and
  each detects a replay that diverges (Temporal's nondeterminism error, Restate's journal mismatch).
  That check is what pennestack's re-decide does with a recorded decision.
- They need replay because a workflow lives for hours or days inside one function. A pennestack
  invocation lives for milliseconds in one unit; long processes are state machines (process
  managers, timers, continuations) whose state is in the chain. Recording each decision and each
  effect in the chain gives the same facts in one record instead of a second history beside the
  event log, which is why ADR 0025 chose no engine.
- Time: Temporal and Restate fix one time per step or call. Pennestack fixes one time per
  invocation, which is also the `recordedAt` of its events, so the clock needs no request.
- Randomness: seeding from an invocation id (Restate) makes values reproducible and also
  predictable, and Restate's documentation warns against using them for cryptography. Pennestack
  records ids and random values in the decision record instead, and issues secrets only through the
  key service, recording the public part and never the plaintext.
- Effects run at least once and need idempotency keys: Temporal recommends them for activities,
  DBOS checkpoints a step only after it completes, and Restate documents a window between running an
  action and persisting its result. Pennestack derives each effect id from its cause, so a repeated
  decision produces the same keys.
- DBOS's `forkWorkflow` re-executes from a step under a newer application version and keeps the
  result. Pennestack's re-decide compares a recorded decision with a newer build and never applies
  it, because the chain is append-only; a correction is a new command.

### The decider and Emmett

- The decider is already pennestack's write path (`decide` and `evolve`, ADR 0004); `isTerminal`
  corresponds to an archived stream.
- Emmett's `Workflow` returns its outputs as data (send a command, publish an event, schedule a
  message, complete): the closest TypeScript precedent for a decision that returns effects.
- Both decide over the state of one stream, folded before `decide` runs. Pennestack's commands also
  need reads beyond one stream (a uniqueness check, a quota count, a dependency's rows), and the
  post's "or not fold" variant shows that what a decider receives is a design choice. Generators that
  yield loads keep the decider's shape and add those reads.
- Chassaing's process managers (`evolve`, `react`, `resume`; not re-checked) match pennestack's
  reactions, process managers and continuations, which is why reactions use the member name `react`.

### Effect

- A value that implements `[Symbol.iterator]` can be delegated to with `yield*`, and TypeScript then
  types each answer separately; with a plain `yield` every answer has the generator's single `TNext`
  type. Pennestack's requests use the same technique.
- Effect's requirements channel `R` plays the role of `ctx` typed from the module base. Pennestack
  needs neither Effect's runtime nor its fibers and layers: every handler would become an Effect
  program, and every module would depend on a large library for what a small driver in the kernel
  does.

### redux-saga

- Effects as plain, serialisable objects make tests mock-free: step the generator, compare the
  yielded request with the expected one, feed the answer as data. `@pennestack/testing` drives
  handlers the same way. Untyped answers were the weakness that `typed-redux-saga` fixed with `yield*`.

### Elm and the functional core

- Elm's commands return their results as messages to `update`: pennestack's continuations close the
  same loop (an effect's outcome in, a decision out). Bernhardt's shell is the boundary of decision
  50a: the kernel, adapters, transports, listeners and executors are the shell, everything a module
  author writes is the core.

### Effect handlers: Unison, Koka

- Language-level handlers type and interpret effects; TypeScript has none. A generator driven by the
  kernel is one handler with one-shot continuations: enough to answer requests, not enough to resume
  a computation twice, which pennestack does not need.

## 4. Consequences for pennestack

- Requests are yielded with `yield*`; effects are returned in the decision; the kernel is the
  interpreter that answers the one and performs the other.
- Load answers are not journaled: the chain plus each load's snapshot position reproduces them.
  Only what the chain cannot reproduce is recorded: ids, random values, the public part of issued
  secrets, and effect inputs and outcomes.
- One time per invocation; no request for the clock.
- Executor retries are mechanical; outcomes with domain meaning (SMTP replies per recipient) are
  state, decided in the module, with one effect per attempt.
- Argon2id is pure but slow: 14.4 milliseconds per hash at OWASP's minimum (19 MiB, two passes, one
  lane) with `crypto.argon2Sync` on Node 24.21.0 on the MacBook Pro, mean of ten runs, 2026-10-25.
  Inside a decide it would block the event loop, so the kernel answers it from a worker pool
  (`ctx.compute`), without recording the answer.
- Enforcement: Biome 2.5.15 ships `noNodejsModules` and `noProcessGlobal` (correctness),
  `noProcessEnv` and `noRestrictedGlobals` (style) and `noGlobalAssign` (suspicious); the remaining
  checks (`Date.now`, `Math.random`, module-level state, bare `yield`) are GritQL plugins of the
  preset.

## 5. Sources

- Temporal: "Workflow basics - TypeScript SDK", docs.temporal.io/develop/typescript/workflows/basics,
  and the durable-execution tutorial at learn.temporal.io, found by search on 2026-10-25;
  `@temporalio/workflow` 1.24.0, published 2026-09-15.
- Restate: "Durable Steps", docs.restate.dev/develop/ts/durable-steps, and the SDK's `Context`
  reference at restatedev.github.io/sdk-typescript, found by search on 2026-10-25;
  `@restatedev/restate-sdk` 1.17.4, published 2026-10-20.
- DBOS: `README.md` and `dist/src/dbos.d.ts` (`runStep`, `now`, `randomUUID`, `forkWorkflow`,
  rewind) of `@dbos-inc/dbos-sdk` 5.3.0, published 2026-10-15, read on 2026-10-25.
- Jérémie Chassaing, "Functional Event Sourcing Decider", thinkbeforecoding.com, 2021-12-17, fetched
  on 2026-10-25.
- Emmett: `dist/index.d.ts` (`Decider`, `Workflow`, `WorkflowOutput`, `DeciderCommandHandler`) of
  `@event-driven-io/emmett` 0.42.4, published 2026-08-12; the Emmett documentation at
  event-driven-io.github.io/emmett, found by search on 2026-10-25.
- Effect: `dist/Effect.d.ts` of `effect` 4.0.6, published 2026-10-22.
- redux-saga: `types/index.d.ts` of `@redux-saga/types` 1.4.1; `redux-saga` 1.5.1, published
  2026-07-26; `typed-redux-saga` 1.5.0, published 2022-05-30.
- Gary Bernhardt, "Functional Core, Imperative Shell", Destroy All Software screencast, 2012-07-12,
  fetched on 2026-10-25.
- Biome: `configuration_schema.json` of `@biomejs/biome` 2.5.15, published 2026-09-30.
- Kysely 0.29.7, published 2026-10-17 (the SQL load request builds a query without a connection).
- The Elm guide, Unison's abilities and Koka's effect handlers: not re-checked.
