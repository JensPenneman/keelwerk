## Pure handlers and the effect interpreter

Decision 50a of the register (decided 2026-10-25): fully strict. Handlers never perform effects;
commands yield load requests and return events plus effect descriptions; queries return query
descriptions; the kernel answers every request, performs every effect and records each effect with
its outcome, linked to the command and events that caused it. Jens: "fully strict, the safest
option; this way I can trace each cause and effect and rebuild a full database and logbook from
them"; option c, the split model, is the fallback. This part replaces the `handle` form of sections
4.3, 7.3 and 7.6 and the imperative members of `ctx`;
[ADR 0026](adr/0026-pure-handlers-and-the-effect-interpreter.md) records it and
[research/pure-handlers.md](research/pure-handlers.md) is the evidence.

### The rule

A part is pure when its result is a function of its parameters and of the answers the kernel gave
to the requests it yielded, and everything it produces is in its return value. Every part a module
author writes is pure. Code that awaits, or touches a database, the network, the file system, a
clock or a random source, lives only in:

- the kernel (the invoker and its interpreter, the queue, the key service);
- the infrastructure entries of `defineDeployment` (adapters, blob stores, the HTTP host, providers,
  probes, ledger sinks);
- transport and listener modules (`adapter.ts`, `listener.ts` and their `lib/`);
- effect executors (`defineEffectExecutor`, under `src/executors/`).

The kernel's own decisions are pure functions inside an imperative shell too: the scaler's plan
(section 21.4), the encryption planner (section 14.7.9.5), merge resolution, rule evaluation.

### Handler forms

| Part | Member | Yields | Returns |
|---|---|---|---|
| command | `decide(input, current, ctx)` on instances, `decide(input, ctx)` otherwise | loads, flags, ids, random values, secret and compute requests | a `Decision` |
| command, `execution: 'sync'` only | `prepare(input, ctx)`, optional | the same, plus inline effects | a value, seen by `decide` as `ctx.prepared` |
| query | `read(input, ctx)` | loads, flags, secret reveals, compute | a request whose answer is the output, or the output |
| subscription | `source(input, ctx, resume)` | nothing; its item maps may yield loads and reveals | a live source description |
| reaction, lifecycle hook | `react(event, ctx)` | as `decide` | a `Decision` |
| process manager | `react(event, state, ctx)` and `evolve(state, event)` | as `decide` | a `Decision` for its own stream |
| schedule | `defineSchedule(base, { every, invoke, input? })` | nothing | data; `input(tick)` is pure |
| service, fill | `(own, ...args)`, bound to the provider (section 5.5, gap G16) | loads with the provider's authority | a value, which may hold drafts |
| policy rule, flag targeting, version change, merge rule, `evolve`, normaliser, upcast | a plain function | nothing | a value |

Each member is a plain function or a generator function. `handle` is removed everywhere: it named
the imperative form, and keeping it for pure queries would let old examples look valid. Commands
decide, events evolve, reactions react (the decider vocabulary).

```ts
type Decision<O = void> =
  | readonly Draft[]                                                  // events only
  | { readonly events?: readonly Draft[]; readonly effects?: readonly EffectDraft[]; readonly result?: O }
type Gen<T> = Generator<Request<unknown>, T, unknown>
interface Request<T> { readonly kind: RequestKind; [Symbol.iterator](): Generator<Request<T>, T, unknown> }
// decide: (input: I, current: R, ctx: DecideContext<M, W, P>) => Decision<O> | Gen<Decision<O>>, never a Promise
```

- `events` holds what the unit appends: chain events, transient change records of `history:
  'state'` entities and stream records, as drafts from `ctx.events` (the target's events) and
  `ctx.write.<module>.<entity>` (`create`, `update`, `archive`, `restore`, a domain event by name,
  `append` on streams). The module boundary of section 8.4 types them: own entities and contributed
  fields. A draft built from a loaded row carries that row's version as its expected version.
- `effects` holds kernel and external effects, in order; `result` is the output of commands that do
  not return their target row. A thrown declared error ends the invocation and nothing applies.
- A query description is the request that `ctx.target.query(...)` or `ctx.load.<m>.<e>.query(...)`
  builds: the entity, `where`, `sort`, `page`, the scan option `scan: { limit, partial }` and the
  search form `search: { index, text, subject? }`, whose tags only the kernel computes (section
  14.7.9).

### Requests

A request is a plain value the kernel answers. It implements `[Symbol.iterator]` as a one-step
generator, so `yield*` types each answer (as in Effect); a bare `yield` is a lint error.

| Request | Where | Answered by | Recorded |
|---|---|---|---|
| `ctx.load.<m>.<e>.byId(id)`, `.one({ where })`, `.many({ where, sort, limit })` (limit at most 1,000), `.count(where)`, `.exists(where)`, `.query(q)`, `.history(id, { asOf })` | decide, prepare, read, react, services | the unit, with module authority (decision 4a) | each load's snapshot position |
| `.forCaller()` variants; `ctx.target` in entity queries | as above | narrowed by the caller's read plan, masked | as loads |
| `ctx.ask(ref, input)` | as above | a dependency's query action inside the unit, gated as the current principal | as loads |
| `ctx.load.sql(build)` (M7) | as above | a Kysely query built without a connection, scoped as in section 14.3.8 | as loads |
| `ctx.all([...requests])` | as above | answered together, batched where the adapter can | its members |
| `ctx.flags.<m>.<flag>` | every handler | the invocation's flag snapshot (section 20.3) | the envelope's `flags` |
| `ctx.newId(entity)`, `ctx.random(bytes)` | decide, prepare, react | the kernel: UUIDv7, a CSPRNG | the answers |
| `ctx.secrets.issue({ prefix })` | decide | the key service | public id and verifier, never the plaintext |
| `ctx.secrets.reveal(ref, reason)`, `ctx.secrets.verify(token, verifier)` | decide, read, react, services | the key service, logged with the reason | no |
| `ctx.compute.argon2idHash(password, salt)`, `.argon2idVerify(verifier, password)` | decide, read | a kernel worker pool, off the event loop (14 ms per hash at OWASP's minimum) | no: reproducible |
| `ctx.perform(effectDraft)` | prepare only | the effect's inline executor | the effect's record |

- Requests never throw into a generator: an infrastructure failure aborts the invocation (retried
  where the taxonomy allows), and an inline effect's outcome is answered as a value,
  `{ ok: true, value } | { ok: false, error }`.
- The clock is not a request: `ctx.clock.now()` returns the invocation's time, taken once when
  execution begins (for jobs, when the job runs), kept across retries, and recorded as the events'
  `recordedAt`.
- Pure helpers need no request: modules call their `lib/` functions, and the core exports pure
  primitives that need `node:*` (`@pennestack/core/crypto`: `sha256`, `hmacSha256`,
  `timingSafeEqual`).
- Queries may not request ids, random values, issued secrets or effects (a compose error). Offline
  commands may not request random values, issued secrets or inline effects; their ids are answered
  from the ids the pushed mutation carries.

### Phases of a command invocation

1. **Admission**: the pipeline of section 9.2 up to `authorize`; rules read the flag snapshot.
2. **Prepare**, for sync commands that declare it, outside any unit. Loads read read-only
   snapshots, never open while an inline effect runs. Each `ctx.perform` records `requested` in a short
   unit, runs the inline executor within its timeout without retries, and records `settled`; the
   outcome is the answer.
3. **Unit**: the read-write unit of the scope opens; its first statement inserts the pending
   receipt (section 15.1.7).
4. **Target**: an instance command loads its target through the plan's `where` (`not_found`
   outside it), locked where the adapter has row locks.
5. **Decide**: the kernel drives `decide` and answers each request in the unit, tagging every load
   with the scope position its snapshot saw (the counter read in the same statement). `ctx.perform`
   here fails with `internal`, `core.effect_in_unit`.
6. **Apply**: drafts are evolved with before-images, encrypted, item-checked and chained (section
   15.1.6, steps 5 to 9); inline reactions to the new events decide in turn (pure, in module order,
   up to depth 8, else `core.reaction_depth`). Then the kernel effects run in order (`invoke` as a
   nested decision in a savepoint, timers, enqueued commands), and each external effect writes its
   `requested` record and its effect job. Each decision's record joins the meta of its events.
7. **Commit**: the receipt completes, the commit tail assigns positions, the unit commits. On a
   version conflict, serialization failure or deadlock the kernel repeats phases 3 to 7 up to three
   times with jitter, for every command, since no decision performed anything; prepare is not
   repeated.
8. **Respond**: wake-ups go out, the shape stage checks and masks the output (section 8.4), and the
   response carries the head token and the ids of the deferred effects.
9. **Perform**: workers advertising the executor's capabilities run each effect job outside any
   unit, at least once, with the effect id as idempotency key; each attempt is recorded, and the
   outcome is written as `settled` in a short unit that enqueues the continuation (section 9.5.6).
10. **Continue**: the continuation is a command job, invoked under the module's service principal
    with the outcome as input: phases 1 to 9 again.

Asynchronous commands pass phase 1 at acceptance and run phases 3 to 9 in their job. A query's
`read` runs after phase 1 in a read-only unit (section 14.3.6): a returned request is planned
(section 14.7.9.5) and answered, a generator is driven, then the shape stage runs. Queries record
nothing.

### Effects

Kernel effects are constructed by functions of `@pennestack/core` and performed in the unit or at
its commit:

| Effect | Performed |
|---|---|
| `invoke(action, input, { as?: system(reason) })` | a command of the same scope, in a savepoint after this decision's events (an asynchronous one is enqueued); its result does not return to the caller; `as` replaces `ctx.asSystem`, logged with the reason |
| `enqueue(action, input, { runAt?, key?, commandId? })` | a command job committed with the unit, any scope (section 12.3) |
| `setTimer({ key, at or after, invoke, input })`, `cancelTimer(key)` | keyed timer jobs (section 9.5.1) |
| `settle(effect, outcome)` | the `settled` record of an effect with an external performer, and its continuation |
| `claimScopeKey(key, owner, { then })`, `releaseScopeKey(key, owner)` | after commit, in the control store; the effect record is the outbox, settling gap G2's open choice |

External effects are declared once and constructed by value:

```ts
// modules/mail-delivery/src/effects/smtp-deliver.ts
export const smtpDeliver = defineEffect(mailDeliveryBase, {
  input: smtpDeliveryShape,       // versioned; personal fields sealed; secrets as references, never plaintext
  output: smtpRepliesShape,
  performer: 'executor',          // the default; 'external': an outside program pulls and settles it
})
// in a decision: smtpDeliver(input, { then: recordAttempt, with: { id, domain }, key?, runAt?, deadline? })
```

`defineEffectExecutor(base, effect, options)` is the only imperative module code; section 9.5.1's
provisional name is kept and now takes the effect as its second argument.

```ts
interface EffectExecutorOptions<M, I, O> {
  readonly queue?: string                                                  // default 'effects'
  readonly capability?: readonly string[] | ((c: { config: ConfigOf<M>; input: I }) => readonly string[])   // section 21.2
  readonly inline?: boolean                                                // may run in prepare; never with a capability
  readonly timeout?: string                                                // one attempt; inline: '10s', at most '30s'
  readonly group?: (c: { config: ConfigOf<M>; input: I }) => JobGroup      // section 9.5.5
  readonly retry?: JobRetry                                                // mechanical, by the error taxonomy (section 9.5.4)
  run(input: I, ctx: ExecutorContext<M>): Promise<O>
}
interface ExecutorContext<M> {
  readonly scope: Scope
  readonly effect: { readonly id: string; readonly type: string; readonly attempt: number }   // the id is the idempotency key
  readonly config: ConfigOf<M>
  readonly secrets: { reveal(ref: SecretRef, reason: string): Promise<string> }
  readonly egress: Egress                                                  // section 12.3
  readonly blobs: ExecutorBlobs                                            // read by reference; new blobs return as references
  readonly extensions: ExecutorExtensionsOf<M>                             // executor-side values (DNS provider adapters)
  readonly log: Logger
  readonly trace: Span
  readonly signal: AbortSignal
}
```

- Executors have no data access (no repositories, `ctx.sql` or `invoke`): the input states what the
  effect does, so its record is complete, and what the executor learns returns in its output.
- An executor returns its output or throws a taxonomy error: `unavailable`, `rate_limited` (with
  `retryAfter`) and retryable `conflict` are retried by `retry`; any other kind settles the effect
  as `failed`. A lease lost after the destination may have acted, or an inline run cut by a crash,
  settles it as `abandoned` (`core.effect_outcome_unknown`).
- Effect ids are UUIDv8 derived from the scope, the cause (a command id, or a reaction id and event
  id) and the effect's index, so a repeated decision requests the same ids and idempotent
  destinations deduplicate.
- Outcomes reach module code through the continuation (`then`, an own command by value, typed by
  `outcomeOf(effect, extra)`; entity continuations get the target id through `with`) and the effect
  record (`core.effect.get` and `watch`, readable by the principal whose command caused it).
- An effect with `performer: 'external'` has no executor: a program outside pennestack holds a
  subscription over `ctx.live.effects(effect, { where })` (its pending effects, resumable), performs
  them, and calls an action of the owning module whose decision returns `settle(...)`; `deadline`
  settles an unsettled one as failed (`core.effect_deadline`). Launchway's agent is such a performer.

**Sync invocations never await a deferred effect.** The response lists the effect ids; a client that
needs the outcome watches `core.effect.watch` or the entity the continuation changes (`--wait-effects`
in the CLI, `waitForEffects` in the typed client). An effect is inline only when the caller needs the
answer inside the request, its executor needs no capability and the call is bounded: OAuth and
OpenID Connect code exchanges, GitHub's manifest conversion, connection tests. So testing the SMTP
connection (an open question of the jobs design) is `mail-delivery.testRelay`, a sync command
whose `prepare` performs the inline effect `smtpProbe` (EHLO, STARTTLS, AUTH and QUIT against the
configured relay, 10 seconds, no retries) and whose `decide` records the result; whether port 25 is
reachable for direct delivery is the `smtp-out` capability probe of section 21.2, not a command.

**Executor retries or a state machine.** Executor retries cover failures without domain meaning,
where the attempt either did not happen or cannot have a different outcome: a lost lease, a refused
connection, a 5xx or 429 from an API that honours the idempotency key (a DNS upsert). Everything with
domain meaning is a state machine in the module: one effect per attempt and a timer between attempts.
Mail delivery is a state machine, for four reasons: an SMTP transaction succeeds per recipient, so
retrying the whole effect would deliver twice to recipients already accepted; delay notices and the
bounce after five days (RFC 3464; RFC 5321 section 4.5.4.1) are decisions about the submission;
JMAP's per-recipient `deliveryStatus` and an operator's "retry now" need the attempts as state; and
each attempt then has its own record and continuation: the trace Jens asked for. A 4xx reply is an
output (`deferred`), not an error; the executor retries only infrastructure failures, twice.

### The logbook

| What | Recorded |
|---|---|
| a decision | each event's envelope (actor, command id, action, causation, writer, flags; section 15.1.3) and a decision record in `meta.decision`, hashed with the event (section 15.1.8) |
| load answers | not stored: `asOf` reads at the recorded snapshot positions reproduce them (`history: 'state'` entities within the feed horizon only) |
| ids, random values, issued secrets | in the decision record; issued secrets by public id and verifier only |
| reveals, verifications, computations | nothing: reproducible while their keys exist |
| an effect | its stream `core.effect/<id>` (kernel entity, chain, tenancy `invocation`): `requested` in the requesting unit (type; input, personal fields sealed, secrets as references; command id; the ids of the events it accompanied; continuation, key, deadline) and `settled` (`succeeded`, `failed` or `abandoned`; output up to 64 KiB, else a blob reference; error; attempts; timings; SHA-256 digest of the canonical output) |
| attempts | records of the stream `core.effectAttempt` keyed by effect id (gap G6: process, build, start, end, error), kept 90 days |
| a continuation | its own decision, whose causation is the effect id |
| logs, traces | not recorded; correlated by scope, command, effect and trace ids |

```ts
interface DecisionRecord {
  readonly part: string                                                    // 'auth.login'; a reaction id for reactions
  readonly inputDigest: string                                             // the receipt's fingerprint
  readonly reads: readonly { readonly scope?: 'backend'; readonly at: Position }[]   // per load, in yield order
  readonly answers: readonly Answer[]                                      // ids, random values, issued secrets' public parts
  readonly effects: readonly string[]                                      // requested effect ids, inline ones included
}
```

**Rebuilding.** The database is the fold of the chain: state rows per stream (section 15.2.4) and
effect state per `core.effect` stream. After a rebuild or restore, every effect `requested` and not
`settled` is enqueued again (at least once across restores; idempotency keys absorb repeats).
Receipts and job rows are operational and not rebuilt. The logbook is a projection of the same chain:
per command its decision record, events, effects with outcomes and the continuations they caused;
`pennestack explain --trace <command, event or effect id>` prints that tree, and a projection entity
can materialise it from M7.

**What replay means.**

- Re-decide: `pennestack explain --redecide <command id>` runs a recorded decision with the current
  build, answering loads `asOf` the recorded positions and ids from the record, and compares events
  and effects without committing; the input comes from the receipt within its window, else
  `--input`. Time travel is this, `--trace` and the `asOf` reads of decision 8a: the past is read and
  re-decided, never rewritten.
- Sync ingest: the server runs a pushed mutation's `decide` against current state with the
  mutation's ids and clock (section 15.3.6); a different outcome is the rebase the client journal
  reports (section 15.3.8).
- Tests: state in, events out, no mocks. `@pennestack/testing` drives a handler with answers as data,
  or runs it on the in-memory adapter from given rows (`load`, `newId` and `created` are its
  helpers):

```ts
const run = drive(register, { input: { displayName: 'Jens', email: 'jens@acme.example' }, config: { allowSelfRegistration: true } })
run.expect(load.accounts.profile.exists({ email: 'jens@acme.example' })).answer(false)
run.expect(newId(profile)).answer('prof_01j9...')
run.returns({ events: [created(profile, { id: 'prof_01j9...', displayName: 'Jens', email: 'jens@acme.example' })], result: { profileId: 'prof_01j9...' } })
```

- Dry run: `pennestack explain <ref> --input ... --dry-run [--as <principal>]` runs admission,
  `prepare` (an inline effect stops as "would perform" unless `--answer <effect>=<json>` gives its
  outcome) and `decide` in a unit that rolls back, and prints events with before-images, effects with
  ids and continuations, the result and the decision record.

**Determinism rules**, enforced by types and by the lint preset (section 13.9):

- Handler types exclude promises, so `async` and `await` in pure parts are type errors;
  `no-await-in-parts.grit` says so readably.
- `pure-parts.grit` (replacing `pure-deciders.grit`) flags `Date.now()`, `new Date()` without
  arguments, `Math.random()`, `performance.now()`, `crypto.*`, `setTimeout`, `setInterval`,
  `queueMicrotask`, `fetch` and a bare `yield` of a request in module sources outside
  `src/executors/`.
- Biome's `noNodejsModules` and `noRestrictedImports` keep `node:*`, adapters, drivers, `kysely` and
  HTTP or SMTP clients out of module packages except under `src/executors/`.
- `no-module-state.grit` flags top-level `let` and `var` and calls that mutate a top-level binding
  (`push`, `set`, `delete`, property assignment).
- `noProcessEnv`, `noProcessGlobal` and `noGlobalAssign` hold everywhere except `pennestack.config.ts`.
- The registry refuses at compose a query requesting ids, random values or effects, `prepare` on an
  asynchronous or offline command, and an inline executor with a capability.

### What the context still carries

`ctx` stays a parameter; in a decide each member is a value, a pure function or a request
constructor.

```ts
interface DecideContext<M extends AnyModuleBase, W extends readonly AnyModule[] = [], P = undefined> {
  readonly scope: Scope
  readonly principal: Principal
  readonly ability: Ability                                // pure over the rules
  readonly config: ConfigOf<M>                             // secrets as references
  readonly clock: { now(): Date }                          // the invocation's time
  readonly request: RequestInfo
  readonly prepared: P
  readonly load: LoadsOf<M, W>                             // request constructors
  readonly write: WritesOf<M, W>                           // draft constructors
  readonly events: EventDraftsOf<M>                        // the target's events
  readonly flags: FlagRequestsOf<M, W>
  readonly services: ServicesOf<M, W>                      // pure, bound to their providers
  readonly extensions: ExtensionsOf<M>                     // pure, bound to their contributors
  readonly secrets: SecretRequests                         // reveal, verify, issue
  readonly compute: CoreComputations
  newId<E extends OwnEntity<M>>(entity: E): Request<Id<E>>
  random(bytes: number): Request<Uint8Array>
  ask<R extends QueryRefsOf<M, W>>(ref: R, input: InputOf<M, R>): Request<ResultOf<M, R>>
  all<const T extends readonly Request<unknown>[]>(requests: T): Request<AnswersOf<T>>
  readonly log: Logger
  readonly trace: Span
}
```

- Removed: `data`, `egress`, `sql`, `blobs`, `timers`, `scopeKeys`, `streams`, `invoke`, `enqueue`,
  `asSystem` and `signal`. Subscription sources keep `ctx.live`, which builds descriptions. Executors
  alone see `egress`, `blobs` and `signal`; only the kernel holds repositories.
- Logging and tracing are the only capabilities: write-only (`void`), unable to influence a result,
  and not part of the logbook; a re-decide or dry run marks its lines `replay`.

### Worked examples

`accounts.register`: a uniqueness load, then events.

```ts
export const register = defineCommand(accountsBase, {
  input: shape({ displayName: field.string(), email: field.string({ format: 'email' }) }),
  output: shape({ profileId: field.ref.own('profile') }),
  errors: [emailTaken],
  auth: { public: true },
  *decide(input, ctx) {
    if (!ctx.config.allowSelfRegistration) throw errors.forbidden('Self-registration is disabled.')
    if (yield* ctx.load.accounts.profile.exists({ email: input.email })) throw emailTaken({ email: input.email })   // module authority
    const id = yield* ctx.newId(profile)
    return { events: [ctx.write.accounts.profile.create({ id, displayName: input.displayName, email: input.email })], result: { profileId: id } }
  },
})
```

A concurrent registration of the same address fails the unique blind index at commit; the repeated
unit sees the row and throws `emailTaken`.

`auth.login`: a credential load, verification as computation, events for the session, no effect.

```ts
*decide(input, ctx) {
  const cred = yield* ctx.load.auth.credential.one({ where: { identifier: input.identifier, kind: 'password', revokedAt: { isNull: true } } })
  const ok = yield* ctx.compute.argon2idVerify(cred?.verifier ?? DUMMY_VERIFIER, input.password)
  if (!cred || !ok) throw invalidCredentials()
  const now = ctx.clock.now()
  const id = yield* ctx.newId(session)
  const token = yield* ctx.secrets.issue({ prefix: 'pss' })                      // recorded without its plaintext
  const idleExpiresAt = addMinutes(now, ctx.config.sessionIdleMinutes)           // lib/: pure date arithmetic
  return {
    events: [
      ctx.write.auth.session.create({ id, subject: cred.subject, credentialId: cred.id, publicId: token.publicId, tokenVerifier: token.verifier,
        authenticatedAt: now, idleExpiresAt, absoluteExpiresAt: addDays(now, ctx.config.sessionAbsoluteDays) }),
      ctx.write.auth.credential.update(cred, { lastUsedAt: now }),
    ],
    result: { sessionToken: token.plain, sessionId: id, expiresAt: idleExpiresAt },
  }
}
```

`deployments.deployment.run`: an effect the agent performs, with a continuation. `nodes` declares
`agentCommand` with `performer: 'external'`; `nodes.channel` becomes
`ctx.live.effects(agentCommand, { where: { nodeId } })` and `nodes.ack` settles, replacing the
`nodes.command` rows of section 17.3.4.

```ts
export const run = defineCommand(deploymentsBase, deployment, {             // invoked by the dispatch reaction keyed by project
  *decide(_input, current, ctx) {
    const node = yield* ctx.load.nodes.node.byId(current.nodeId)
    if (current.status !== 'queued' || node?.status !== 'online') return []    // wakeLanesOfNode dispatches again
    return {
      events: [ctx.events.dispatched({ at: ctx.clock.now() })],
      effects: [ctx.services.nodes.send(current.nodeId, { kind: 'deploy', deploymentId: current.id }, { then: dispatchSettled, with: { id: current.id }, deadline: '60s' })],
    }
  },
})
export const dispatchSettled = defineCommand(deploymentsBase, deployment, {   // progress and results: reportPhase, reportResult
  input: outcomeOf(agentCommand),
  decide: (input, current, ctx) =>
    input.outcome.ok && input.outcome.value.accepted ? []
      : current.retryCount < 3 ? [ctx.events.requeued({ reason: 'dispatch', at: ctx.clock.now() })]
      : [ctx.events.failed({ reason: 'lost', at: ctx.clock.now() })],
})
```

Mail submission and delivery: one effect per attempt and domain; the state machine decides retries.

```ts
export const smtpDeliverExecutor = defineEffectExecutor(mailDeliveryBase, smtpDeliver, {
  queue: 'mail-delivery',
  capability: ({ config }) => (config.relay ? [] : ['smtp-out']),
  group: ({ config, input }) => ({ id: `mx:${input.domain}`, concurrency: config.connectionsPerDomain, rate: '60/1m' }),
  retry: { delays: ['30s', '2m'], giveUpAfter: 'PT10M' },                  // infrastructure only; SMTP replies are output
  run: (input, ctx) => deliverOverSmtp(input, ctx),                         // executors/lib/: MX, MTA-STS, STARTTLS, one transaction
})
// submit: creates the submission with a status per recipient, then per domain:
//   smtpDeliver({ submissionId, domain, recipients, message, dkim }, { then: recordAttempt, with: { id, domain } })
export const recordAttempt = defineCommand(mailDeliveryBase, submission, {
  input: outcomeOf(smtpDeliver, shape({ domain: field.string() })),
  decide: (input, current, ctx) => {
    const step = nextDeliveryStep(current, input, ctx.clock.now(), ctx.config.delivery)   // lib/: 5 min, backing off to 4 h, 5 days
    return {
      events: [ctx.events.attempted(step.attempt)],
      effects: [
        ...(step.retryAt ? [setTimer({ key: `retry:${current.id}:${input.domain}`, at: step.retryAt, invoke: retryDomain, input: { id: current.id, domain: input.domain } })] : []),
        ...(step.notice ? [invoke(bounce, { id: current.id, kind: step.notice })] : []),   // delayed or failed: RFC 3464
      ],
    }
  },
})
```

`retryDomain`, the timer's command, requests a new `smtpDeliver` for the recipients still deferred.

DNS record creation: a provider API effect with a continuation.

```ts
export const applyRecordExecutor = defineEffectExecutor(dnsBase, applyRecord, {
  queue: 'dns',
  group: ({ input }) => ({ id: `dns:${input.accountId}`, concurrency: 1, rate: '60/1m' }),
  retry: { delays: 'exponential', maxDelay: '10m', giveUpAfter: 'PT6H' },   // 429 and 5xx: the upsert is idempotent
  run: async (input, ctx) => ctx.extensions.providers.for(input.kind).upsert(ctx.egress, await ctx.secrets.reveal(input.token, 'dns apply'), input),
})
// dns.ensure, a service, returns record drafts plus applyRecord(input, { then: applied, with: { id } }) for its caller's decision
export const applied = defineCommand(dnsBase, record, {
  input: outcomeOf(applyRecord),
  decide: (input, _current, ctx) => input.outcome.ok
    ? [ctx.events.applied({ externalId: input.outcome.value.externalId, at: ctx.clock.now() })]
    : [ctx.events.failed({ code: input.outcome.error.code, at: ctx.clock.now() })],
})
```

### Fit with the rest of the specification

- Pipeline (section 9.2): `execute` is the interpreter (phases 3 to 7); a stage `prepare` sits
  between `authorize` and `execute`, outside any unit; `complete` adds the effect ids to the outcome.
- Jobs (sections 9.4 and 9.5): effect records and jobs commit with the unit and run after commit with
  the executor's `capability`, `group` and `retry` as job options; continuations are action jobs.
- Authorization (section 8.4): loads carry the module's authority, `forCaller()` and `ctx.target` the
  caller's plan, the shape stage checks every row leaving the invoker, and drafts obey the write
  boundary. Effects need no rules: the action was authorized as a whole, and egress bounds executors.
- Layout (section 23): `src/effects/<effect>.ts` exports one `defineEffect`, `src/executors/<effect>.ts`
  exports `<effect>Executor`, imperative helpers sit in `src/executors/lib/`, and `src/lib/` stays
  pure. Effects are parts: the module literal mounts `effects` and `executors`, keyed by effect name;
  `pennestack new effect|executor` scaffolds them.
- Versioning (sections 18 and 19): effect inputs and outputs are versioned like action inputs;
  workers take effect jobs at or below their revision; version changes are pure transforms.
- Flags (section 20): handlers read flags as requests, recorded in the envelope; rules read the
  snapshot; flag providers are infrastructure.
- Kernel extension points that modules fill (resolvers, enrichers, middleware) take pure values; a
  session's idle extension becomes an `enqueue` effect.

### Traceability

| Requirement | Subsections |
|---|---|
| Brief addendum 4: "Everything runs on pure functions." | The rule; Handler forms |
| "inputs are kept within its parameters and its outputs are only ever returned through its return value" | Handler forms; Requests; What the context still carries |
| "nothing flows through global state, module-level state, ambient context or any other hidden channel" | Determinism rules; What the context still carries |
| "a hard requirement for the framework itself and for the code written on it" | The rule; Determinism rules |
| "Where the outside world must be touched (databases, networks, clocks, randomness)" | Requests; Effects |
| "which parts perform effects" | The rule; Effects |
| "how effects enter and leave pure code" | Requests; Phases; Effects (continuations) |
| "and how the rule is enforced by tooling" | Determinism rules |
| Jens, 2026-10-25: "trace each cause and effect" | The logbook |
| "rebuild a full database and logbook from them" | The logbook: Rebuilding |
