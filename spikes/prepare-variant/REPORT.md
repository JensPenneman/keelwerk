# The `prepare` variant, prototyped on the M1 kernel

Date: 2026-11-04. Open item of section 26.2, register entry S-30. Written for Jens.

## The question

Decision 50a keeps `decide` pure. Inline effects (a call to an outside system whose answer the caller
needs inside the same request) therefore live in a separate `prepare` that runs before the unit opens.
On 2026-10-28 you asked to test one variant: no `prepare` member at all, `decide` performs inline
effects only before its first load, the kernel opens the unit at that first load and refuses a later
inline effect with a clear error. This spike builds both forms on the merged M1 kernel, for two real
flows, and compares them.

The kernel in `packages/core` is untouched. The separate form runs on the kernel as it is, with a
test-only inline executor plugged into the write path's `perform` seam. The variant needs a driver the
kernel does not have, so the driver lives here (`src/run-inline-variant.ts`).

## What was built

Everything is under `spikes/prepare-variant/src`.

- Two small modules: `trail` (device, position, and a device-updated event) and `github` (connection,
  a pending connection start, and the code exchange as an effect).
- Per scenario, one command in each form, side by side in the same module:
  `separate-prepare/{ingest-positions,connect-github}.ts` and
  `inline-before-load/{ingest-positions,connect-github}.ts`, plus one probe command
  (`inline-before-load/connect-late.ts`) that does what the variant forbids.
- `inline-effect-stub.ts`: the test-only inline executor. It writes a `requested` record, calls the
  handler, writes a `settled` record, keys the call by the effect id (command id plus index) and, on a
  repeat of the same id, answers the recorded outcome without calling the destination again.
- `run-inline-variant.ts`: the driver. Phase one runs `decide` until its first request that is not an
  inline effect, handing each effect to the executor; no read-write unit exists yet. Phase two is the
  kernel's own unit: `decide` runs again, answers the effects it requested before its first load from the
  recorded outcomes, and throws the named error if it asks for one after a load.
- Tests: GitHub flow, Trail ingest, the merged kernel's baseline, type tests, and a measuring test.

## The two scenarios

**Trail position ingest.** A batch of fixes for a device, deduplicated by time, written as positions
plus one `trail.device.updated` event. There is no outside call. In both forms the command is the same
49 to 52 lines and writes the same event types and the same device-updated payload (the tests compare them). The variant costs
nothing here, and the separate form needs no `prepare`. This is the common case, and it is neutral.

**GitHub connection.** The browser comes back with a code and the state it was started with. The command
checks that the state belongs to an open start, exchanges the code for a token through an inline effect,
then stores the connection and consumes the start.

## Side by side: GitHub connection

Separate form (50 lines):

- `prepare` loads the open start for the state. If there is none, or it is already used, it returns
  `refused` and the code is never spent. Otherwise it performs the exchange and returns
  `exchanged` with the outcome.
- `decide` reads `ctx.prepared`, throws the matching error, re-reads the start inside the unit (the
  prepare read was a stale snapshot), and writes the connection and the consumed event.

Inline form (41 lines):

- `decide` performs the exchange as its first act, then loads the start, then writes.

The inline form is shorter, but it cannot check the state first, because a load before the effect is
exactly what the rule forbids.

## Types

- Separate: no new type. The prepare context already has `perform`; the decide context has no
  `perform`; `ctx.prepared` is whatever `prepare` returned, inferred (a union of `refused` and
  `exchanged` here), so `decide` narrows it with an ordinary `if`. Type tests pin this
  (`types.test-d.ts`).
- Inline: `perform` has to exist on the decide context. The decide context type of `defineCommand`
  does not carry it, so the spike adds it through a one-line helper (`performs(ctx).perform(...)`). A
  real implementation would put `perform` on the decide context of sync commands. Either way the
  ordering rule ("only before the first load") is not expressible in types: both orders type-check, and
  a late effect fails only when the command runs. The separate form moves that rule into the structure of
  the code, where the compiler enforces it.
- Whole spike, both forms, test files included: 59,798 types, 250,526 instantiations, 0.13 s check.
  Neither form is a type-cost problem.

## Error messages

- Late effect (inline form, probe command), proposed code `core.effect_after_load`, kind `internal`:
  "github.connectLate requested the inline effect github.exchangeCode after its first load; inline
  effects belong before the first load of decide." Details: the effect and the action. Nothing is stored,
  the receipt claim rolls back with the unit (it is inserted before `decide` runs), the destination is not called.
- The kernel's existing refusal for the same mistake inside the unit is `core.effect_in_unit`.
- A refused code (both forms): `github.exchange_failed`, kind `unavailable`, "GitHub did not accept the
  code.", details carry the destination's reason.
- A stray state (both forms): `github.state_unknown`, kind `conflict`. The difference is when it is
  found, see below.
- The merged invoker answers `core.not_implemented` ("declares prepare, which this release does not
  run") for the separate form, and the write path answers `core.request_not_allowed` for `perform`;
  both are placeholders of M1 that WP-41 replaces.

## Record shapes

Effect log (both forms, written by the executor, one pair per effect):

    {"phase":"requested","id":"<command id>#0","type":"github.exchangeCode","input":{"code":"good-1"}}
    {"phase":"settled","id":"<command id>#0","outcome":{"ok":true,"value":{"accountLogin":"octo-cat","token":"ghs_good-1_abcd","scopes":"repo,read:org"}}}

Decision record on the connection's event (inline form; the separate form differs only in `part` and a
digest):

    {"part":"github.connectInline","inputDigest":"da44...39a9","reads":[{"at":"1"}],
     "answers":[{"kind":"id","entity":"github.connection","value":"01a1..."}],"effects":[]}

Receipt outcome: `{"ok":true,"value":{"connectionId":"01a1..."},"effects":[]}`.

Sizes: decision record 242 bytes (separate) against 248 (inline) for the connection, 1,044 against 1,050
for a ten-fix ingest. The records are the same apart from the action name.

## Replay completeness

Replaying a decision means running `decide` again from its record and getting the same events.

- Inline form: every input of `decide` is an answer to a request in one ordered stream: effect outcomes
  first, then loads and ids. The loads and ids are in the decision record. The effect outcomes are in the
  effect log, one per index, and a test checks it: the settled record of a command carries the account and
  token the stored connection was built from, and its id is `<command id>#0`. Complete once the decision record lists the effect ids.
- Separate form: `decide` also depends on `ctx.prepared`, a value computed by `prepare` from its own loads
  and the outcomes. In M1 the kernel keeps neither: the loads `prepare` made are dropped when it
  returns (the connection command made three row queries against two in the inline form, and the record
  shows one read in both), and the prepared value is stored nowhere. Replay is incomplete today. It is
  fixable (record prepare's reads and its return value in the decision record), but it is an addition
  the inline form does not need.
- Both forms: `decision.effects` is empty in M1 although the field is documented to list inline effect
  ids, so neither can yet link a decision to its effects except through the command id in the effect id.
- Both forms: the `settled` record holds the token in plain text. Section 7.9.5 seals effect inputs but
  is silent about outputs; an exchange that returns a secret needs a rule (see gaps).

## Measured cost

In-memory adapter, 80 alternating runs per form on one runtime, so growth of the store favours neither
form. Absolute numbers mean little on this adapter; only the shape does.

|                    | GitHub separate | GitHub inline        | Ingest separate | Ingest inline        |
| ------------------ | --------------- | -------------------- | --------------- | -------------------- |
| median per command | 0.37 ms         | 0.34 ms              | 10.9 ms         | 11.2 ms              |
| 95th percentile    | 1.7 ms          | 1.2 ms               | 23.6 ms         | 20.5 ms              |
| read-write units   | 1               | 1                    | 1               | 1                    |
| read-only units    | 1 (prepare)     | 1 (borrowed prepare) | 0               | 1 (borrowed prepare) |
| row queries        | 3               | 2                    | 3               | 3                    |
| effect records     | 2               | 2                    | 0               | 0                    |

The read-only unit in the inline column is an artefact of the driver, which borrows the kernel's
prepare phase to get a real context; a native implementation opens none until the first load. The
differences in time are inside the noise.

Behaviour, measured by the tests:

- Stray state: the separate form calls the exchange 0 times and answers `github.state_unknown`; the
  inline form calls it once, then answers the same error. The one-time code is spent on a request that
  was never valid. For GitHub's manifest conversion, where the answer carries secrets returned only once,
  that is a lost App.
- Conflict retry (a failing first append): the unit runs twice in both forms, the effect once. In the
  inline form this only works because the driver replays the recorded outcomes into the second
  attempt; the live generator cannot be resumed in a new unit. A native version needs the same record.
- Same command id twice: both forms answer the recorded result, flagged as replayed, with no second call
  to the destination. In the separate form this is the receipt's doing, not the stub's: `prepare` finds
  the start consumed and refuses before it performs. The stub's dedupe by effect id is exercised by a
  second case: the first run fails after the effect (retries exhausted), the same id is sent again, and
  the settled record is reused with no second call, in both forms.
- Order: in both forms every effect is requested and settled before the read-write unit opens and
  before the receipt is claimed.

## What the variant cannot do, and does not tell us

- A load before the effect is forbidden by design, and flows want exactly that: validate, then spend.
  GitHub's connection is the example; OAuth state checks, "does this connection already exist" before a
  paid exchange, and the manifest flow have the same shape. The workaround is two commands, which is
  what decision 74's fallback (b) already is.
- Entity-mounted commands: the kernel loads the target (phase 4) before `decide` runs. In the variant
  the effect would have to come before the target load, so the target load must move behind the first
  `decide` request, changing the lifecycle order of 3.3. The spike's commands are module commands for
  that reason; instance commands were not prototyped.
- The unit opens at the first request, not literally at the first load: ids, random values and flags
  also end the effect window in the driver. This is a simplification, not a finding.

## Recommendation

Keep the separate `prepare`, as the decision stands. Three reasons, in order of weight:

1. The variant forbids load-then-effect, and the one real flow in the prototype needs it. The
   cost is spending a one-time code before knowing the request is valid.
2. The separate form puts the rule in the structure of the code, so the compiler enforces it; the
   variant enforces it at run time with a new error.
3. The variant's advantages are small and real: 9 fewer lines in the connection command, one concept
   fewer, and a replay record that is already complete. The first is cosmetic. The last is available to
   the separate form by recording prepare's reads and return value, which should be done in M2 regardless.

Where the variant would be fine: commands whose first act is the outside call and whose checks need no
read, such as "test this relay". A cheap compromise, if you want it later, is to allow `prepare` to be
written as the first statements of `decide` only when no load precedes them; nothing in this spike argues
for building that now.

M3 repeats the comparison on Trail's own code (register entry 150); the spike's tests carry over.

## New gaps and assumptions

1. Section 7.9.4, phase 2 ("snapshots, never open while an inline effect runs"): WP-38's `runPrepare`
   deviates. It holds one read-only unit for all of `prepare`, so in both forms an effect runs with a
   unit open (a test measures one open unit at the effect). WP-41 must open one read-only unit per load
   and keep none open across a `perform`.
2. Sections 7.9.6 and 15.1.3: `DecisionRecord.effects` is documented as listing inline effect ids and is
   always empty in M1; `prepare`'s reads are discarded. Needed before replay is complete in either form.
3. Section 7.9.5: effect outputs that carry secrets (the token above) have no sealing rule; inputs do.
4. Section 7.9.4, phase 4 against the variant: the target load precedes `decide` (see above).
5. Assumption: the error code `core.effect_after_load` is proposed here; it is not in the register.
6. Assumption: effect ids are `<command id>#<index>` in the stub; WP-41 owns the real UUIDv8 derivation.
7. The test runtime has no key service, so the spike stores the last four characters of the token, not a
   sealed secret.

8. Section 17.3.9 / WP-01 (`core-api-versions.ts`, `define-api-versions.ts` lines 10-14): importing core
   once threw "'2026-11-04' is not a YYYY-MM-DD calendar date". The validator catches every exception, so
   a missing or failing `Temporal` shows up as a bad date. Hand-off to the owner of that file: catch only
   `RangeError` so the real cause shows.

## Dependencies

No third-party package was added. The spike declares `@keelwerk/core` and `@keelwerk/testing` as
workspace links and keeps the test runner at 5.0.5, already pinned by the root work package. No registry
versions were looked up because none changed.
