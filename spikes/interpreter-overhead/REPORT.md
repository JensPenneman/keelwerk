# Interpreter overhead (M1): the cost of driving a decision, per request

Date: 2026-11-05. Closes the second half of former item 6 of architecture.md section 26.2 (the
interpreter's overhead per request) for the in-memory adapter; on PostgreSQL 18 it leaves a
residual that this spike does not explain (see the verdict). Throwaway code; nothing here is part
of `@keelwerk/core`.

## Verdict

| Question                                                                                | Answer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What does a load request cost the interpreter, beyond the adapter call? (7.9.4 phase 5) | About 2.5 to 6 us per request at 5 and 20 loads on the in-memory adapter (4.4 us unbatched and 3.5 us in one `ctx.all` at 20 loads in the final run; 2.4 to 5.8 across the three runs). The 1-load cells are 6.7 to 15.7 us with a spread up to 44. It is an upper bound: the baseline skips the visibility check, the authority lookup and `decodeRow` (see method).                                                                                                                                                                                                                                          |
| What do the other requests cost?                                                        | `ctx.newId`: 2.4 to 2.7 us per request at 5 and 20 requests (9.5 at 1); a flag read: 4.2 to 11.9 us with a spread of 0.4 to 41.6 in the final run, which ran under a load average of 25, so only "a few us" is supported. Both without an adapter call and without a baseline.                                                                                                                                                                                                                                                                                                                                 |
| Is that visible on PostgreSQL 18?                                                       | Yes, as a residual, and the interpreter's own cost does not explain it. At 20 loads the generator form takes 8 to 26 percent longer than the imperative unit (1.4 to 4.5 ms of 16.4 to 18.0 ms in the two quieter runs). Per load request the cells are positive in every round in 3 of 4 cells of the quieter runs (96.2, 149.1 and 207.8 us; the fourth is 136.5, with a minimum of -34.4); the final run gives 182 and 189 us (spread 44 to 3,244). Per command the cells are 1,445, 3,100 and 4,450 us. The baseline's own slope is 0.57 to 0.84 ms per load, so the excess is 15 to 35 percent of a load. |
| Why?                                                                                    | Not the statements: `pg_stat_statements` counts 34.4 statements per command for the baseline and 34.5 for the generator at 20 loads, the same statements (table below), with the same server execution time per call (the positioned load is 28 us in both). Not the interpreter's CPU: 3 to 5 us per load on memory. What is left is client side time between the statements on a real socket, 100 to 200 us per load, which this spike has not isolated (open).                                                                                                                                              |
| What does a command cost beyond the imperative unit at 0 loads?                         | 48 to 53 us on the in-memory adapter (plain 50). On PostgreSQL 18 at 0 loads the cells are 0.2 to 0.5 ms with a spread wider than the number.                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Does the generator form cost more than the plain form?                                  | Not measurably: a generator that never yields costs -9 us (-10 to +11) against a plain return at 0 loads on memory.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Does `ctx.all` help?                                                                    | Slightly on memory (0.6 to 2.3 us per request fewer: one `driveHandler` step and one resumption less per member). On PostgreSQL it sends the same statements as the unbatched form (34.4 against 34.5 per command): this release answers the members one after the other, so there is no batching in the sense of one statement (finding 1).                                                                                                                                                                                                                                                                   |
| Acceptable?                                                                             | On the in-memory adapter yes: a decision with 20 loads adds 100 to 150 us over the imperative unit. On PostgreSQL the residual of 8 to 26 percent at 20 loads should be explained before the text says "below the noise"; no optimisation is proposed for M1 until it is.                                                                                                                                                                                                                                                                                                                                      |

## Specification findings

1. **`ctx.all` is not batched (7.9.3 table: "answered together, batched where the adapter can").**
   `packages/core/src/interpreter/answer-all.ts` answers the members one after the other, and the
   statement counts confirm it: a `ctx.all` of 20 loads sends 20 positioned selects, as the
   unbatched form does. Batching members of one entity that use unlocked `byId` or `one` needs no
   new `RowStore` member: one positioned `find` with `{ op: 'in', field: 'id', value: ids }` can
   answer them, with the position recorded once per member. Members of different entities or of
   different ops would need a `findMany` that takes several queries. Parallel awaits buy nothing,
   because the unit has one `pg` client and it queues the statements. The saving a batch brings on
   a real network is the round trips, about 0.2 to 0.5 ms each here and 2.8 ms across an
   availability zone (write-path spike). The section should say that M1 answers the members
   sequentially.
2. **The decision record is not a cost (7.9.6).** Building it copies the reads and the answers:
   0.1 us at 0 to 20 loads. Hashing it into the chain adds 0.8 us (0 loads), 1.0 (1), 2.1 (5) and
   6.1 us (20) over the event with an empty record, about 0.3 us per recorded read.
3. **Most of the fixed cost of a command is the write path, not the interpreter (7.9.4 phases 3, 6,
   7).** The 48 to 53 us per command that the plain form already pays over the imperative unit is
   the input fingerprint, the context, the hybrid clock, the evolve with its before-image, the
   chained SHA-256, the decision record, the meta and the receipt outcome, none of which the
   baseline does. It is incurred equally by a command that never loads.
4. **Section 26.2 still lists the item as open** (it says the interpreter's overhead per request
   remains open); the replacement below narrows that to the `prepare` comparison.

## Proposed text

7.9.4, after the paragraph of phase 5, add:

> The interpreter's own cost, measured on 2026-11-05 (`spikes/interpreter-overhead/REPORT.md`),
> is about 2.5 to 6 microseconds per load request on the in-memory adapter, and a decision that
> loads 20 rows adds 100 to 150 microseconds over the same unit written imperatively. On
> PostgreSQL 18 the same decision takes 8 to 26 percent longer than the imperative unit at 20
> loads (100 to 200 microseconds per load), with the same statements and the same server time; the
> difference is client-side and not yet explained. A generator that never yields costs no more
> than a plain return. The members of `ctx.all` are answered one after the other on the unit's
> session in this release, so a `ctx.all` saves no round trip.

26.2, replace the passage from "Neither spike covered" to "those two items remain open." with:

> Neither spike covered the `prepare` comparison of decision 50a's variant (former item 5). The
> interpreter's overhead per request (the second half of former item 6) was measured on
> 2026-11-05 (`spikes/interpreter-overhead/REPORT.md`): 2.5 to 6 microseconds per request on the
> in-memory adapter, 100 to 150 microseconds for a decision with 20 loads over the imperative
> unit, and 8 to 26 percent over the unit on PostgreSQL 18 at 20 loads. The Node 26 re-checks of
> decision 28a (former item 8) were done on 2026-11-04 on Node 26.13.0
> (`spikes/node26-rechecks/REPORT.md`) and passed. The one open item is the `prepare` comparison
> (WP-44 report).

## Environment and method

- Apple M2 Pro Mac (10 cores, 16 GiB), Node 26.13.0; PostgreSQL 18.6 (`postgres:18.6-alpine`,
  one container started by `src/start-measured-postgres.ts`, which does what `startPostgres` of
  `@keelwerk/testing/postgres` does and loads `pg_stat_statements`; label `keelwerk-test`,
  data directory on tmpfs, application role without BYPASSRLS) on Docker Desktop 29.9.2 (VM with 8
  vCPU and 9.7 GiB). Clients reach it over TCP through the port forwarding.
- Load average at the start and end of the final run: see Results.
- The unit: a command that loads `k` rows by id (k = 0, 1, 5, 20), then writes one event, a
  `changed` event on another row (`ctx.write.bench.item.update`), and completes. Forms: the
  imperative baseline (`src/baseline-command.ts`: claim the receipt, a positioned `find` per load,
  a locked read of the row to write, row update, event append, receipt completion, one unit; no
  generator, no answerer, no fingerprint, no decision record, no hash chain); the plain form (the
  decision is returned as a value, only possible with 0 loads); the generator form with one
  `yield*` per load (unbatched) and with one `yield* ctx.all([...])`. The generator and
  plain forms run through `runCommand` of `@keelwerk/core` below the pipeline's gate, as the
  prepare-variant spike does, over the harness runtime of `@keelwerk/testing`
  (`src/handlers.ts`, `src/run-bench-command.ts`).
- Every measurement runs in a freshly started runtime and database: the in-memory adapter and the
  event table slow down as the log grows (a shared world drifted from 125 to 370 us per baseline
  command over 4,000 commands), so each timed run starts from the same 21 rows and an empty log.
  Warm-up: one fifth of the iterations, discarded, in the same world. Iterations: 1,000 commands per
  cell and round on memory, 400 on PostgreSQL, one after the other on one connection.
- Each cell is the median of three alternating rounds (the order of the 13 cells is reversed in
  every second round); the figures in brackets are the minimum and maximum of the three. The
  derived rows are computed per round and then summarised, so their spread is of the difference.
  The per-request overhead is the slope of the form from 0 loads to k loads minus the slope of the
  baseline, divided by k; the per-command overhead is the form's time minus the baseline's at the
  same k.
- The decision record is measured apart (`src/measure-record-cost.ts`): `buildDecisionRecord` is
  not exported by the core, so its loop (copying reads, answers and effects) is repeated, and the
  hash is the core's `chainHash` of one event whose decision carries `k` reads, minus the same
  event with an empty record.
- Limits: one connection, no concurrency; a `ctx.all` that is answered sequentially (finding 1);
  the unit writes one event; the baseline has no hash chain, so the fixed difference per command is
  not the interpreter's alone (finding 3); positions are per-load `find` statements on both sides.

Run: `pnpm --filter @keelwerk/spike-interpreter-overhead measure` (Markdown on stdout, one
PostgreSQL container, stopped at the end; one database per measured world, created and dropped over the admin URL). Tests: `pnpm vitest run --project spike-interpreter-overhead`
(one iteration per cell on the in-memory adapter).

Notes on the method after review:

- The baseline (`src/baseline-command.ts:59-68`) skips the visibility check, the authority lookup
  and `decodeRow` that the interpreter's load does (`answer-load.ts:101-140`), so the per-load
  figure measured against it is an upper bound on the interpreter's share.
- "ctx.all" in the tables is the form with the loads in one `yield* ctx.all([...])`
  (`handlers.ts`, `bench-cells.ts`); it is not batched on the wire.
- The `ctx.newId` and flag-read cells have no adapter call and no imperative baseline (the
  baseline would cost one `newUuidV7` call, about 0.1 us, or nothing); their rows are the form's
  own slope per request, on the in-memory adapter only.
- Statements per command: one database per profile on the one container, started with
  `-c shared_preload_libraries=pg_stat_statements` and `create extension`, the statistics reset
  after seeding, 200 commands, then the calls and `total_exec_time` per normalised statement
  (`src/measure-statements.ts`). The baseline profile at 0 loads ran first and is colder (983 us
  of server time per command against 338 for the generator at 0 loads, from first-call costs of
  200 commands); the 20-load profiles agree (926, 966 and 882 us).
- The databases are created and dropped (forced) over the admin URL with the `pg` client, at the
  world's start and stop.

## Results

Final run (12:19 to 12:25). Load average (1/5/15 minutes) at the start 6.79 / 10.81 / 20.03, at the
end 25.75 / 22.66 / 22.09: other projects' agents shared the host and the run ended under heavy
load, so the PostgreSQL rows have outliers of 20 to 80 ms (the spread columns show them). Two
earlier runs with the previous table layout (load 5.8 and 13.5 at the start) gave the memory figures
within the spread of these (2.4 to 4.6 us per load request, 52 to 60 us fixed per command) and, on
PostgreSQL at 20 loads, generator minus baseline of 2,590 (unbatched) and 1,445 us (batched) in the
first and 4,451 and 3,101 us in the second, the per-load cells 136.5, 96.2, 207.8 and 149.1 us.

Microseconds per command; median over three alternating rounds with (min to max). "requests" are
loads by id except in the rows named `ctx.newId` and `flag read`.

PostgreSQL: PostgreSQL 18.6 on aarch64-unknown-linux-musl, compiled by gcc (Alpine 15.2.0) 15.2.0, 64-bit

### memory: microseconds per command

| form                | 0 requests             | 1 requests             | 5 requests             | 20 requests            |
| ------------------- | ---------------------- | ---------------------- | ---------------------- | ---------------------- |
| baseline            | 92.8 (91.8 to 107.4)   | 100.7 (100.1 to 105.2) | 136.0 (128.2 to 139.5) | 235.5 (234.8 to 237.8) |
| plain               | 150.4 (139.1 to 157.5) |                        |                        |                        |
| generator unbatched | 147.2 (141.1 to 149.9) | 164.1 (160.7 to 165.8) | 206.9 (203.1 to 220.8) | 370.3 (369.9 to 371.3) |
| generator ctx.all   | 150.2 (145.6 to 152.9) | 159.9 (159.4 to 162.3) | 207.1 (191.8 to 217.6) | 359.1 (338.2 to 413.6) |
| generator ctx.newId | 150.8 (141.8 to 169.3) | 151.3 (150.0 to 183.7) | 166.0 (153.9 to 173.9) | 204.9 (204.2 to 216.2) |
| generator flag read | 146.5 (142.3 to 155.8) | 150.7 (144.1 to 197.4) | 215.2 (151.0 to 287.9) | 239.6 (149.4 to 340.3) |

### memory: overhead over the imperative baseline

| overhead                                         | 0 requests           | 1 requests          | 5 requests          | 20 requests            |
| ------------------------------------------------ | -------------------- | ------------------- | ------------------- | ---------------------- |
| unbatched: per command over baseline             | 48.3 (39.9 to 58.1)  | 60.7 (60.0 to 64.0) | 74.9 (67.4 to 84.8) | 135.1 (132.5 to 135.8) |
| unbatched: per load request over baseline        |                      | 15.7 (1.9 to 20.8)  | 5.3 (1.9 to 9.0)    | 4.4 (3.7 to 4.8)       |
| ctx.all: per command over baseline               | 52.8 (42.8 to 61.1)  | 58.7 (57.1 to 59.9) | 71.1 (63.6 to 78.1) | 123.6 (103.4 to 175.8) |
| ctx.all: per load request over baseline          |                      | 7.0 (-2.5 to 14.3)  | 3.4 (2.2 to 5.7)    | 3.5 (3.0 to 5.7)       |
| unbatched minus ctx.all, per load request        |                      | 3.6 (1.3 to 4.2)    | 2.3 (-2.1 to 2.7)   | 0.6 (-2.2 to 1.6)      |
| ctx.newId: per request (no adapter, no baseline) |                      | 9.5 (-0.8 to 14.4)  | 2.4 (0.9 to 3.0)    | 2.7 (2.3 to 3.1)       |
| flag read: per request (no adapter, no baseline) |                      | 4.2 (1.8 to 41.6)   | 11.9 (1.7 to 28.3)  | 4.2 (0.4 to 9.7)       |
| plain minus baseline, 0 loads                    | 50.1 (47.3 to 57.6)  |                     |                     |                        |
| generator minus plain, 0 loads (never yields)    | -9.3 (-10.2 to 10.8) |                     |                     |                        |

### postgres: microseconds per command

| form                | 0 requests                 | 1 requests                 | 5 requests                   | 20 requests                  |
| ------------------- | -------------------------- | -------------------------- | ---------------------------- | ---------------------------- |
| baseline            | 4805.9 (4607.8 to 5103.0)  | 9149.4 (5135.5 to 10549.1) | 7989.0 (7416.4 to 33312.0)   | 16377.0 (15986.9 to 21617.1) |
| plain               | 7563.2 (4844.1 to 8593.8)  |                            |                              |                              |
| generator unbatched | 4844.0 (4679.6 to 29040.7) | 6198.9 (6142.9 to 37698.2) | 29397.4 (19277.7 to 31137.4) | 42911.9 (24828.7 to 81102.6) |
| generator ctx.all   | 5207.5 (5019.9 to 5334.7)  | 6077.7 (5789.8 to 6429.0)  | 9708.2 (8083.4 to 22999.6)   | 22419.3 (20369.8 to 31247.1) |

### postgres: overhead over the imperative baseline

| overhead                                      | 0 requests                | 1 requests                  | 5 requests                   | 20 requests                 |
| --------------------------------------------- | ------------------------- | --------------------------- | ---------------------------- | --------------------------- |
| unbatched: per command over baseline          | 236.1 (-423.4 to 24234.8) | 1007.3 (-2950.5 to 27149.2) | 11288.7 (-2174.5 to 21981.0) | 26534.9 (3211.6 to 65115.7) |
| unbatched: per load request over baseline     |                           | 771.2 (-2527.2 to 2914.4)   | 2342.4 (-5281.9 to 4349.0)   | 181.7 (115.0 to 3244.0)     |
| ctx.all: per command over baseline            | 528.7 (-83.1 to 599.7)    | -2720.4 (-4759.3 to 942.2)  | 2291.8 (-25228.5 to 15010.6) | 4382.9 (802.2 to 14870.1)   |
| ctx.all: per load request over baseline       |                           | -2637.4 (-5288.0 to 342.6)  | 338.4 (-5151.4 to 3018.7)    | 189.2 (44.3 to 717.1)       |
| unbatched minus ctx.all, per load request     |                           | 65.1 (-230.1 to 31908.5)    | 3937.8 (-744.4 to 4610.8)    | 583.2 (120.5 to 3036.6)     |
| plain minus baseline, 0 loads                 | 2757.3 (236.2 to 3490.9)  |                             |                              |                             |
| generator minus plain, 0 loads (never yields) | -0.1 (-3914.2 to 21477.5) |                             |                              |                             |

### postgres: statements per command (pg_stat_statements, 200 commands each)

| form                          | commands | statements per command | server execution us per command |
| ----------------------------- | -------- | ---------------------- | ------------------------------- |
| baseline, 0 loads             | 200      | 14.45                  | 983.2                           |
| baseline, 20 loads            | 200      | 34.37                  | 926.1                           |
| generator unbatched, 0 loads  | 200      | 14.13                  | 338.4                           |
| generator unbatched, 20 loads | 200      | 34.53                  | 966.2                           |
| generator ctx.all, 20 loads   | 200      | 34.36                  | 881.7                           |

| statement                                                                                                      | baseline, 0 loads | baseline, 20 loads | generator unbatched, 0 loads | generator unbatched, 20 loads | generator ctx.all, 20 loads |
| -------------------------------------------------------------------------------------------------------------- | ----------------- | ------------------ | ---------------------------- | ----------------------------- | --------------------------- |
| begin isolation level read committed read write                                                                | 1.00 x 12 us      | 1.00 x 4 us        | 1.00 x 3 us                  | 1.00 x 4 us                   | 1.00 x 4 us                 |
| begin isolation level repeatable read read only                                                                | 0.02 x 21 us      | 0.01 x 8 us        | 0.01 x 5 us                  | 0.03 x 7 us                   | 0.01 x 5 us                 |
| commit                                                                                                         | 1.02 x 2 us       | 1.01 x 1 us        | 1.00 x 0 us                  | 1.02 x 1 us                   | 1.01 x 1 us                 |
| insert into "interpreter_overhead"."core__command_receipt" ("id", "version", "created_at", "updated_at", "comm | 1.00 x 121 us     | 1.00 x 39 us       | 1.00 x 34 us                 | 1.00 x 42 us                  | 1.00 x 36 us                |
| select "r".*, "p"."position" as "kwPosition" from (select (coalesce((select k.next - $5 as "position" from "in |                   | 20.00 x 28 us      |                              | 20.00 x 28 us                 | 20.00 x 26 us               |
| select "stream_type", stream_id::text as "stream_id", max(stream_version) as "version" from "interpreter_overh | 1.00 x 159 us     | 1.00 x 68 us       | 1.00 x 59 us                 | 1.00 x 78 us                  | 1.00 x 70 us                |
| select "t"."id" as "id", "t"."created_at" as "createdAt", "t"."updated_at" as "updatedAt", "t"."archived_at" a | 1.00 x 78 us      | 1.00 x 23 us       |                              |                               |                             |
| select "t"."id" as "id", "t"."created_at" as "createdAt", "t"."updated_at" as "updatedAt", "t"."archived_at" a |                   |                    | 1.00 x 30 us                 | 1.00 x 23 us                  | 1.00 x 22 us                |
| select $1                                                                                                      | 1.02 x 5 us       | 1.01 x 1 us        | 1.00 x 1 us                  | 1.02 x 2 us                   | 1.01 x 1 us                 |
| select coalesce((select next - $2 from "interpreter_overhead".kw_positions where scope_id = $1::uuid), $3)::te | 1.00 x 35 us      | 1.00 x 10 us       | 1.00 x 10 us                 | 1.00 x 8 us                   | 1.00 x 9 us                 |
| select current_setting($1) as value                                                                            | 1.00 x 10 us      | 1.00 x 2 us        | 1.00 x 2 us                  | 1.00 x 2 us                   | 1.00 x 2 us                 |
| select p.scope_id::text as scope_id, (p.next - $5)::text as head from "kw__control".kw_positions p where p.nex | 0.02 x 72 us      | 0.01 x 23 us       | 0.01 x 26 us                 | 0.03 x 34 us                  | 0.01 x 20 us                |
| select pg_notify($1, $2)                                                                                       | 0.34 x 7 us       | 0.29 x 2 us        | 0.10 x 2 us                  | 0.41 x 3 us                   | 0.28 x 2 us                 |
| select set_config($2, $1, $3)                                                                                  | 3.02 x 9 us       | 3.02 x 3 us        | 3.00 x 2 us                  | 3.02 x 3 us                   | 3.02 x 2 us                 |
| update "interpreter_overhead"."bench__item" set "created_at" = $1, "updated_at" = $2, "version" = $3, "label"  | 1.00 x 71 us      | 1.00 x 27 us       |                              |                               |                             |
| update "interpreter_overhead"."bench__item" set "created_at" = $1, "updated_at" = $2, "version" = $3, "label"  |                   |                    | 1.00 x 23 us                 | 1.00 x 24 us                  | 1.00 x 26 us                |
| update "interpreter_overhead"."core__command_receipt" set "outcome" = $1, "status" = $2, "version" = version + | 1.00 x 125 us     | 1.00 x 48 us       | 1.00 x 40 us                 | 1.00 x 38 us                  | 1.00 x 47 us                |
| with counter as ( insert into "interpreter_overhead".kw_positions as p (scope_id, next, epoch) values ($1::uui | 1.00 x 333 us     | 1.00 x 139 us      | 1.00 x 129 us                | 1.00 x 170 us                 | 1.00 x 145 us               |

### Decision record: microseconds per decision

| loads | build us         | hash us over an empty record |
| ----- | ---------------- | ---------------------------- |
| 0     | 0.1 (0.1 to 0.1) | 0.8 (0.4 to 2.3)             |
| 1     | 0.1 (0.0 to 0.1) | 1.0 (0.7 to 3.7)             |
| 5     | 0.1 (0.1 to 0.1) | 2.1 (1.8 to 2.6)             |
| 20    | 0.1 (0.1 to 0.1) | 6.1 (5.7 to 6.1)             |
