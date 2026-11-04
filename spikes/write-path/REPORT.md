# Write-path spike (M0): the event log and the job queue on PostgreSQL 18

Date: 2026-11-04. Covers architecture.md section 26.2 items 6 and 7 (the task named "item 5", which is
the `prepare` comparison; the write-path items are 6 and 7). Throwaway code; nothing here is the data
layer.

## Verdicts

| # | Assumption (section) | Holds? | Evidence |
|---|---|---|---|
| 1 | Writers of one tenant never wait on another tenant's commit tail (15.1.4, ADR 0007 item 2) | yes | 0 cross-scope lock waits in every sample of every run; with one tenant's counter row held for 1.5 s the other seven tenants kept p95 13.8-15.8 ms; 8 tenants commit 2.13-2.23x the units/s of 1 tenant under the same 16 writers |
| 2 | One tenant commits "several hundred to a few thousand" appending units/s (15.1.4 cost) | only with a nearby database | 4-16 writers of one scope: 1,035-1,397 units/s at 0.2 ms round trip, 110-147 units/s at 2.8 ms. The counter lock is held for round trips, not for a WAL flush |
| 3 | Wake-ups leave writer transactions untouched (14.3.7, 15.2.5, ADR 0007 item 11) | yes | coalescing notifier 2,240 vs 2,318 units/s without wake-ups (within the run-to-run range); NOTIFY inside the writer costs 34 % of throughput and doubles the tail hold |
| 4 | The fair take scales with lanes and batch; lane caps hold (9.5.3, 9.5.5) | caps yes; scaling with caveats | take p95 3.7-5.2 ms up to 10 lanes, 8.0-9.7 ms at 1,000 lanes; 0 of 325 samples over cap; up to 59 % empty takes when lanes are fewer than `$lanes` x takers |
| 5 | Positioned loads at READ COMMITTED are cheap and correct; REPEATABLE READ per decision is the costlier alternative (7.9.4 phase 5, 26.2 item 6) | cheap yes, correct **no**; RR is not viable | +0.06-0.07 ms per load; but a locked target load after a lock wait records a stale position in 100 of 100 commits on a hot row; RR fails 36-77 % of units after three retries even on distinct rows |

## Specification findings

Blocking for M1:

1. **Stale snapshot position on locked loads (7.9.4 phase 5, 15.1.6 step 2, 7.9.6).** At READ COMMITTED
   a `for update` load that waits for a row lock returns the newest row version (EvalPlanQual) but the
   counter subselect keeps the statement's original snapshot, so the decision record says position
   `p - 1` for a row written at `p`; an `asOf` replay would return the older row. Measured: 100 stale
   positions per 100 commits on one hot row (4 and 16 writers), 0 on distinct rows (table 5b), and
   reproduced deterministically by the test `tags a locked load with a stale position after a lock
   wait`. Fix measured here: read the counter in a statement after the lock (0 stale; one more round
   trip per unit, 10-44 % fewer units/s in these runs). Unmeasured cheaper fix: take the target's
   position from a statement the unit sends anyway after the lock, e.g. `returning` on the versioned
   state update of step 9.
2. **One REPEATABLE READ snapshot per decision does not work with the per-scope counter (26.2 item
   6, 26.3).** Every appending unit updates the scope's counter row at its tail, so any other commit
   of the scope after the snapshot makes that update fail with 40001, also when the units touch
   different entities: 191-1,058 retries per 100 commits and 36-77 % of units failing after three
   retries, 99-200 units/s against 337-843 at READ COMMITTED (811-843 on distinct rows; table 5b;
   test `fails a REPEATABLE READ unit at the tail`). Keep READ COMMITTED with positioned loads and
   close the open question.
3. **Row-level security policy cast (14.3.7).** `current_setting('keelwerk.tenant_id', true)::uuid`
   raises 22P02 on any connection that ran a tenant unit before: after the unit the setting exists
   with the value `''` (test `leaves '' behind after a tenant unit`). A namespace- or backend-scope
   unit on a pooled connection would then fail instead of seeing no tenant rows. The spike's policies
   use `nullif(current_setting('keelwerk.tenant_id', true), '')::uuid`.

Should fix:

4. **The single-tenant ceiling is set by round trips (15.1.4 cost, ADR 0007 consequences).** As
   written, the tail holds the counter lock across the event insert and COMMIT: two round trips plus
   the flush (hold p50 0.45-0.83 ms at 0.2 ms round trip, 6.3-7.2 ms at 2.8 ms). Folding counter
   update, event insert and the lane's `enqueued` counter into one statement leaves one round trip
   plus the flush under the lock (commit-only hold 0.25-0.63 ms; 147 vs 110 units/s at 2.8 ms). The
   section should give the tail as one statement and state the ceiling per round trip, and the M1
   adapter should keep the database within about 1 ms of the writers or plan the sequencer.
   Beyond about four writers a scope gains nothing (1,170 to 1,035 units/s from 4 to 16 writers)
   and only queues (p95 5 to 42 ms).
5. **Empty takes while work is available (9.5.3, 9.5.6).** A take locks every lane it might use for
   the whole take unit, `skip locked`, so concurrent takers on few lanes come back empty: 44-59 % on
   1 lane, 46-56 % on 10 lanes with batch 10 or 50, 9 % on 100 lanes with batch 50. A fetcher that
   treats an empty take as "no work" waits for the next wake-up or the one-second poll. The
   specification should say how `$lanes` is chosen (it is unspecified; the spike used the batch size)
   and distinguish "lanes skipped" from "no work".
6. **The lane pick sorts every eligible lane (9.5.3).** The order by load per weight and virtual
   time cannot use an index, so the take statement's p95 grows from 1.6-1.9 ms (1-10 lanes) to 2.1-2.2 ms
   (100) and 4.3-4.8 ms (1,000 lanes). Lanes are per tenant, queue, capability set and priority, so a
   placement with thousands of tenants will want a bounded candidate set.
7. **The planning figure of 2,000 jobs/s (9.5.7).** With four takers and trivial handlers the take
   delivers 417-718 jobs/s at batch 1, 4,020-5,500 at batch 10 and 16,067-20,899 at batch 50
   (completions batched per take here). Since each job completes in its own unit (9.5.2), a placement's
   job rate is bounded by its unit rate (1,757-2,519 units/s across eight tenants in table 1), so
   2,000 jobs/s is reachable only with batched takes and is then limited by the job units, not the take.

Silent or open in the specification:

8. **No DDL for the queue tables (9.5.2, 14.3.9).** Columns, keys and indexes of `kw_jobs`,
   `kw_job_lanes`, `kw_job_lane_counts` and `kw_job_groups` are not given; `src/create-schema.ts`
   derives them from the take and `JobSpec`. `kw_job_lane_counts` needs the lane's scope column: the
   enqueue bump runs in the tenant's unit under forced row-level security, and a counter row it cannot
   see is updated zero times without an error (seen in the spike's first smoke run).
9. **`$vmin` (9.5.3)** is a parameter without a source; the spike reads the least virtual time of
   lanes with available work in the take's unit. The retry jitter window (14.3.6) is unspecified;
   the spike uses full jitter over 2, 4 and 8 ms.
10. The take statement runs unmodified on PostgreSQL 18.6 (its numeric `limit` is accepted).

Not covered: the interpreter's per-request overhead (the second half of 26.2 item 6), groups and
rates, lease reclaim and promotion, units with several events, the asynchronous sequencer, MySQL and
SQLite.

## Environment and method

- PostgreSQL 18.6 (`postgres:18.6-alpine`, started by `@testcontainers/postgresql` 12.2.1) on Docker
  Engine 29.9.2 in the Docker Desktop VM (8 vCPU, 9.7 GiB) of an Apple silicon Mac; clients in Node 26.13.0 with `pg`
  8.23.1, each writer on its own connection, over TCP through the port forwarding (round trip p50
  0.19 ms). The "proxy" rows add a Node TCP proxy delaying each chunk 1 ms each way (round trip p50
  2.76 ms, roughly another availability zone).
- Image defaults for durability (fsync, synchronous_commit on, fdatasync); shared_buffers 128 MB;
  `pg_stat_statements` loaded. A WAL flush costs about 0.03 ms here (autocommit insert 0.220 ms
  against `select 1` 0.192 ms), far below cloud block storage, so the direct rows understate the
  flush part of the hold.
- Every unit runs as a non-superuser role without BYPASSRLS against forced row-level security, as
  section 14.3.7 requires. Tables follow 15.1.2 column for column; a unit follows 15.1.6: pending
  receipt, loads, locked target, evolve with before-image, chained SHA-256, versioned state update,
  optional job, receipt completion, commit tail. One event per unit.
- Seeded data is deterministic (ids derived from indexes, seeded random generator). Runs are 1.5-2 s
  after a 0.3-0.5 s warm-up; every table row is the median of three runs with configurations
  alternating within each repetition, and `min-max` columns show the spread.
- **Noise.** Other projects' containers shared the VM (one reached 646 % CPU near the end of the
  first suite run; host load average 4.3-12.4). The first suite run's tables 3 and 5 were unusable
  (ranges 464-1,049 and 3-689 units/s), so tables 3, 5a and 5b come from later reruns of only those
  items (5a also redesigned as paired alternation); table 1 was repeated once. Absolute rates are
  lower bounds for dedicated hardware; comparisons within a table are the result.
- Paced latency at equal offered load (table 1, `paced` rows) is dominated by such stalls: 8 tenants
  showed the higher p95 in both suite runs (69.6 vs 39.7 ms, 36.5 vs 10.7 ms), a separate
  diagnostic at 400 units/s the lower (7.9 vs 16.2 ms, 2.9 vs 3.3 ms); the tail wait p95 was lower
  with 8 tenants every time, and pg_stat_activity showed the backends mostly in `Client:ClientRead`
  (waiting for the next statement of the unit), so the spread is not the commit tail.

Run: `pnpm --filter @keelwerk/spike-write-path measure [0 1 2 3 4 5a 5b]` (Markdown on stdout, one
container for the whole run, stopped at the end). Tests: `pnpm vitest run --project spike-write-path`
(three unit-test files, and `src/write-path.test.ts` against one PostgreSQL 18 container).

## Results

### (0) Environment

Sections: 15.1.4 (cost model)

| measure | value |
| --- | --- |
| server | PostgreSQL 18.6 |
| commit_delay | 0 |
| default_transaction_isolation | read committed |
| fsync | on |
| max_connections | 200 |
| shared_buffers | 128MB |
| synchronous_commit | on |
| wal_sync_method | fdatasync |
| round trip (select 1) p50 / p95 ms | 0.192 / 0.371 |
| autocommit insert p50 / p95 ms | 0.220 / 0.333 |

### (1) Concurrent writers in many tenants

Sections: 15.1.4, 9.4, ADR 0007 item 2, 26.2 item 6

| run | tenants | writers | commits/s | p50 ms | p95 ms | p99 ms | tail wait p95 ms | tail hold p50 ms | retries/100 commits | failed/100 units | lock waits same scope | lock waits cross scope | commits/s min-max | runs | held tenant max ms | other tenants max ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| closed loop | 1 | 16 | 1131 | 10.18 | 38.59 | 60.54 | 35.59 | 0.80 | 0 | 0 | 1991 | 0 | 1116-1167 | 3 |  |  |
| closed loop | 8 | 16 | 2519 | 6.10 | 8.48 | 11.73 | 1.73 | 1.96 | 0 | 0 | 67 | 0 | 2465-2522 | 3 |  |  |
| paced 566/s | 1 | 16 | 497 | 1.97 | 39.74 | 334.58 | 26.38 | 0.64 | 0 | 0 |  |  | 287-566 | 3 |  |  |
| paced 566/s | 8 | 16 | 566 | 2.25 | 69.61 | 87.51 | 3.23 | 0.78 | 0 | 0 |  |  | 561-566 | 3 |  |  |
| probe: tenant 1 tail held 1500 ms | 8 | 15 | 1576 | 7.59 | 15.78 | 25 |  |  |  |  | 185 | 0 |  |  | 1487.40 | 70 |

- Closed loop, 16 writers: 8 tenants commit 2.23x the units per second of 1 tenant (medians of 3 alternating runs of 1500 ms).
- Lock waits on another scope's backend: 0 in all closed-loop samples, 0 in the probe.
- Lock waits are pg_stat_activity samples every 10 ms of writer backends waiting on a heavyweight lock, classified by the scope of the blocking backends (pg_blocking_pids).
- Probe row: latencies of the seven unblocked tenants; their commits/s is for 14 writers.

### (1) Concurrent writers in many tenants: repeat run

Sections: 15.1.4, 9.4, ADR 0007 item 2, 26.2 item 6

| run | tenants | writers | commits/s | p50 ms | p95 ms | p99 ms | tail wait p95 ms | tail hold p50 ms | retries/100 commits | failed/100 units | lock waits same scope | lock waits cross scope | commits/s min-max | runs | held tenant max ms | other tenants max ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| closed loop | 1 | 16 | 823 | 13.99 | 51.31 | 82.71 | 47.77 | 0.99 | 0 | 0 | 2029 | 0 | 724-895 | 3 |  |  |
| closed loop | 8 | 16 | 1757 | 7.91 | 16.29 | 24.20 | 3.40 | 2.44 | 0 | 0 | 115 | 0 | 1615-1929 | 3 |  |  |
| paced 412/s | 1 | 16 | 412 | 2.33 | 10.65 | 22.69 | 3.48 | 0.71 | 0 | 0 |  |  | 411-412 | 3 |  |  |
| paced 412/s | 8 | 16 | 412 | 4.05 | 36.54 | 59.56 | 1.98 | 1.25 | 0 | 0 |  |  | 412-412 | 3 |  |  |
| probe: tenant 1 tail held 1500 ms | 8 | 15 | 1620 | 7.79 | 13.80 | 30.34 |  |  |  |  | 229 | 0 |  |  | 1477.70 | 41.87 |

- Closed loop, 16 writers: 8 tenants commit 2.13x the units per second of 1 tenant (medians of 3 alternating runs of 1500 ms).
- Lock waits on another scope's backend: 0 in all closed-loop samples, 0 in the probe.
- Lock waits are pg_stat_activity samples every 10 ms of writer backends waiting on a heavyweight lock, classified by the scope of the blocking backends (pg_blocking_pids).
- Probe row: latencies of the seven unblocked tenants; their commits/s is for 14 writers.

### (2) Single-tenant ceiling of the commit tail

Sections: 15.1.4 (cost), ADR 0007 item 2 and consequences

| path | tail | job at tail | writers | commits/s | p50 ms | p95 ms | p99 ms | tail wait p95 ms | tail hold p50 ms | retries/100 commits | failed/100 units | ceiling 1/hold per s | commits/s min-max | runs |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| direct (rtt 0.20 ms) | statements | no | 1 | 521 | 1.70 | 3 | 5.80 | 0.30 | 0.45 | 0 | 0 | 2222 | 366-524 | 3 |
| direct (rtt 0.20 ms) | statements | no | 4 | 1170 | 3.08 | 5.14 | 10.82 | 1.58 | 0.70 | 0 | 0 | 1429 | 973-1180 | 3 |
| direct (rtt 0.20 ms) | statements | no | 16 | 1035 | 11.18 | 41.55 | 68.72 | 38.68 | 0.83 | 0 | 0 | 1205 | 987-1085 | 3 |
| direct (rtt 0.20 ms) | statements | yes | 16 | 767 | 14.41 | 63.28 | 90.78 | 57.69 | 1.08 | 0 | 0 | 926 | 299-919 | 3 |
| direct (rtt 0.20 ms) | single-statement | no | 1 | 516 | 1.66 | 2.79 | 4.81 | 0.50 | 0.25 | 0 | 0 | n/a | 424-639 | 3 |
| direct (rtt 0.20 ms) | single-statement | no | 4 | 1397 | 2.56 | 4.11 | 8.51 | 1.11 | 0.42 | 0 | 0 | n/a | 725-1579 | 3 |
| direct (rtt 0.20 ms) | single-statement | no | 16 | 1109 | 9.91 | 41.07 | 75.68 | 35.46 | 0.63 | 0 | 0 | n/a | 1039-1472 | 3 |
| direct (rtt 0.20 ms) | single-statement | yes | 16 | 973 | 11.86 | 44.65 | 68.51 | 39.97 | 0.67 | 0 | 0 | n/a | 801-1241 | 3 |
| proxy (rtt 2.76 ms) | statements | no | 1 | 33 | 27.26 | 36.45 | 71.99 | 4.45 | 6.40 | 0 | 0 | 156 | 30-36 | 3 |
| proxy (rtt 2.76 ms) | statements | no | 4 | 139 | 27.80 | 37.49 | 41.58 | 7.77 | 6.34 | 0 | 0 | 158 | 132-146 | 3 |
| proxy (rtt 2.76 ms) | statements | no | 16 | 110 | 113.11 | 329.05 | 430.77 | 289.06 | 7.16 | 0 | 0 | 140 | 79-149 | 3 |
| proxy (rtt 2.76 ms) | single-statement | no | 16 | 147 | 87.05 | 294.45 | 430.94 | 250.24 | 4.12 | 0 | 0 | n/a | 95-300 | 3 |

- One scope, every writer on its own entity rows: the counter row is the only shared row. Medians of 3 runs of 1.5 s, the plan walked once per repetition.
- Tail wait: the counter update (statements) or the whole tail statement (single-statement). Tail hold: counter lock acquired until COMMIT returned; for single-statement only the COMMIT, so it understates the hold by the insert.
- Ceiling 1/hold: the rate at which one scope could commit if the counter lock were the only constraint.

### (3) The notifier: wake-ups outside writer transactions

Sections: 14.3.7, 15.2.5, ADR 0007 item 11

| mode | commits/s | p50 ms | p95 ms | p99 ms | tail wait p95 ms | tail hold p50 ms | retries/100 commits | failed/100 units | commits/s min-max | runs | notifications/s | scopes/notification | wake p50 ms | wake p95 ms | wake max ms | commits not woken |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| no wake-ups | 2318 | 6.46 | 10.60 | 15.81 | 2.18 | 2.02 | 0 | 0 | 1777-2330 | 3 |  |  |  |  |  |  |
| coalescing notifier (50 ms) | 2240 | 6.36 | 10.93 | 16.89 | 1.88 | 2.04 | 0 | 0 | 1081-2422 | 3 | 20 | 8 | 26 | 48.60 | 53.70 | 0 |
| NOTIFY inside the writer (rejected) | 1521 | 8.87 | 16.60 | 47.72 | 3.43 | 4.15 | 0 | 0 | 996-1848 | 3 |  |  |  |  |  |  |

- Eight tenants, two writers each, closed loop, one event per unit; medians of 3 alternating runs of 2000 ms per mode.
- Wake latency counts every commit (not every notification), so a commit just after a flush waits up to one interval.

### (4) The fair take

Sections: 9.5.2, 9.5.3, 9.5.5, 14.3.9, 26.2 item 7

| lanes | batch | takers | take p50 ms | take p95 ms | take p99 ms | statement p95 ms | takes/s | jobs/s | empty takes % | jobs/take | jobs/s min-max | runs | taken per lane min-max | cap | max running per lane (db samples) | db samples over cap | max running per lane (takers) | lanes with taken-done != running |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 1 | 4 | 2.65 | 3.73 | 4.74 | 1.61 | 971 | 542 | 43.79 | 0.56 | 500-546 | 3 | 2832-2832 |  |  |  |  |  |
| 1 | 10 | 4 | 2.70 | 3.94 | 4.88 | 1.58 | 955 | 4767 | 50.60 | 4.94 | 4693-5120 | 3 | 26230-26230 |  |  |  |  |  |
| 1 | 50 | 4 | 2.73 | 5.16 | 6.74 | 1.86 | 895 | 18700 | 58.84 | 20.58 | 16100-20167 | 3 | 96700-96700 |  |  |  |  |  |
| 10 | 1 | 4 | 2.85 | 3.97 | 4.56 | 1.72 | 718 | 718 | 0 | 1 | 457-733 | 3 | 345-346 |  |  |  |  |  |
| 10 | 10 | 4 | 2.84 | 4.21 | 6.11 | 1.55 | 888 | 4477 | 46.13 | 5.41 | 4287-5364 | 3 | 2534-2561 |  |  |  |  |  |
| 10 | 50 | 4 | 2.61 | 4.35 | 5.21 | 1.65 | 865 | 19107 | 55.90 | 22.10 | 17705-20891 | 3 | 10542-10673 |  |  |  |  |  |
| 100 | 1 | 4 | 3.38 | 5.01 | 6.50 | 2.14 | 622 | 622 | 0 | 1 | 545-658 | 3 | 32-33 |  |  |  |  |  |
| 100 | 10 | 4 | 3.44 | 5.62 | 16.76 | 2.19 | 550 | 5500 | 0 | 10 | 5027-6313 | 3 | 303-305 |  |  |  |  |  |
| 100 | 50 | 4 | 4.43 | 6.21 | 9.55 | 2.14 | 467 | 20899 | 9.20 | 45.48 | 20771-21600 | 3 | 1117-1118 |  |  |  |  |  |
| 1000 | 1 | 4 | 6.50 | 8.05 | 11 | 4.33 | 417 | 417 | 0 | 1 | 397-431 | 3 | 1-4 |  |  |  |  |  |
| 1000 | 10 | 4 | 6.76 | 8.11 | 14.90 | 4.50 | 402 | 4020 | 0 | 10 | 3740-4093 | 3 | 21-24 |  |  |  |  |  |
| 1000 | 50 | 4 | 8.22 | 9.73 | 17.51 | 4.78 | 321 | 16067 | 0 | 50 | 15167-16200 | 3 | 83-85 |  |  |  |  |  |
| 10 | 10 | 8 | 3.30 | 6.34 |  |  |  | 2967 |  |  |  |  |  | 3 | 3 | 0 of 161 | 2 | 0 |
| 1 | 10 | 8 | 2.79 | 5.17 |  |  |  | 368 |  |  |  |  |  | 3 | 3 | 0 of 164 | 3 | 0 |

- Take: the namespace-scope unit (set_config, $vmin read, take statement, jobs to running, lanes taken and vtime, COMMIT); statement: the take statement alone.
- `$lanes` is set to the batch size; cap 1000 (not binding) in the grid; medians of 3 runs of 1.5 s, the grid walked once per repetition. jobs/s counts jobs taken and completed (one completion unit per batch, with a replacement job).
- Cap rows: db samples count running jobs per lane on a separate connection every ~2 ms; takers count from take commit until just before the completion unit, a lower bound of the true count.

### (5a) Cost of the per-load scope-counter read

Sections: 7.9.3, 7.9.4 phase 5, 26.2 item 6, 26.3

| load | statement | client p50 ms | client p95 ms | server mean us | writer commits in run |
| --- | --- | --- | --- | --- | --- |
| alone | plain load | 0.27 | 0.70 | 13 | 0 |
| alone | positioned load (counter subselect) | 0.34 | 0.89 | 19 | 0 |
| alone | counter read alone (once per REPEATABLE READ decision) | 0.27 | 0.69 | 11.50 | 0 |
| beside 16 writers of the scope | plain load | 0.32 | 0.63 | 12.60 | 3877 |
| beside 16 writers of the scope | positioned load (counter subselect) | 0.38 | 0.77 | 22.40 | 3877 |
| beside 16 writers of the scope | counter read alone (once per REPEATABLE READ decision) | 0.31 | 0.61 | 17.30 | 3877 |

- 1500 rounds per load condition, the three statements alternating in rotating order inside read committed units of 50 rounds; server: mean execution time from pg_stat_statements.
- Per decision with k loads plus the target, positioned loads add (k + 1) times the server difference between the positioned and the plain load; a REPEATABLE READ decision instead adds one counter statement (a round trip) and the retries of table 5b.

### (5b) Serialization retries and stale positions on hot rows

Sections: 7.9.4 phases 5 and 7, 7.9.6, 14.3.6, 15.1.6 step 2, 26.2 item 6

| target | writers | variant | commits/s | p50 ms | p95 ms | p99 ms | tail wait p95 ms | tail hold p50 ms | retries/100 commits | failed/100 units | stale target position/100 commits | commits/s min-max | runs |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| distinct rows | 4 | read committed, positioned loads | 811 | 4.11 | 7.22 | 9.13 | 1.18 | 0.76 | 0 | 0 | 0 | 763-972 | 3 |
| distinct rows | 4 | read committed, positioned, target after lock | 729 | 4.71 | 11.09 | 17.89 | 1.39 | 0.78 | 0 | 0 | 0 | 627-825 | 3 |
| distinct rows | 4 | repeatable read | 180 | 7.30 | 35.79 | 65.23 | 0.62 | 0.89 | 191.10 | 36.20 | 0 | 132-277 | 3 |
| distinct rows | 16 | read committed, positioned loads | 843 | 14.64 | 46.71 | 66.37 | 41.29 | 1.03 | 0 | 0 | 0 | 305-988 | 3 |
| distinct rows | 16 | read committed, positioned, target after lock | 613 | 19.13 | 66.92 | 107.56 | 58.97 | 1.31 | 0 | 0 | 0 | 340-757 | 3 |
| distinct rows | 16 | repeatable read | 99 | 37.92 | 72.74 | 79.46 | 1.25 | 1.98 | 1046.30 | 76.20 | 0 | 77-108 | 3 |
| one hot row | 4 | read committed, positioned loads | 372 | 9.29 | 19.70 | 31.59 | 0.45 | 0.56 | 0 | 0 | 100 | 147-421 | 3 |
| one hot row | 4 | read committed, positioned, target after lock | 208 | 15.25 | 44.29 | 91.67 | 0.78 | 0.73 | 0 | 0 | 0 | 129-358 | 3 |
| one hot row | 4 | repeatable read | 200 | 6.02 | 28.14 | 35 | 0.40 | 0.62 | 205.30 | 38.80 | 0 | 85-259 | 3 |
| one hot row | 16 | read committed, positioned loads | 337 | 8.94 | 40.86 | 620.90 | 0.37 | 0.54 | 0 | 0 | 100 | 191-385 | 3 |
| one hot row | 16 | read committed, positioned, target after lock | 265 | 12.38 | 90.22 | 891.52 | 0.64 | 0.68 | 0 | 0 | 0 | 113-306 | 3 |
| one hot row | 16 | repeatable read | 127 | 29.04 | 48.08 | 86.12 | 0.67 | 0.79 | 1057.90 | 77.20 | 0 | 49-158 | 3 |

- Each decision loads two other rows and the locked target; one event per unit. Retries: version conflicts, serialization failures (40001) and deadlocks, up to three per unit with jitter; failed units exhausted them.
- Stale target position: the locked target load was tagged with a position below the last committed event of its stream (read in a later statement of the same unit), so `asOf` at the recorded position would return an older row than the decision saw.
- Medians of 3 runs of 1.5 s, the plan walked once per repetition.
