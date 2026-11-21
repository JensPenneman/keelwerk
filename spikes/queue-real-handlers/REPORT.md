# Queue spike (M2): the take with real handlers, and fairness under 10,000 jobs

Date: 2026-11-21. Covers architecture.md sections 9.5.3, 9.5.5 and 9.5.7 (the real-handler measurement
the section asks for) and criterion 8 of the M2 exit (fairness under 10,000 jobs). Throwaway code in
`spikes/queue-real-handlers/`; nothing here is the queue. The fairness proof itself is a test,
`packages/testing/test/kernel/fairness-10k.postgres.test.ts`, which the suite runs.

## Verdicts

| #   | Assumption (section)                                                                              | Holds?                           | Evidence                                                                                                                                                                                                                                                               |
| --- | ------------------------------------------------------------------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Takes lock only lane rows, so an enqueue burst never makes takers skip a lane (9.5.2)             | no before the fix; yes after     | `for update` conflicted with the `for key share` that every enqueue holds on its lane row (finding 1); fixed by `for no key update`; the test fails on the old statement and passes on the new one                                                                     |
| 2   | While tenant A enqueues 10,000 jobs, tenant B's job starts within one take interval (criterion 8) | yes, by count, on the fixed take | B's job is handed out at the latest by the first take that begins after its enqueue commits, with one worker of 4 slots (cap 4) and 10,000 jobs of A; a second case with 8 slots (2 x cap) and 15 jobs of A shows it for a lane that could be handed more than its cap |
| 3   | No lane runs more jobs than its cap (9.5.5)                                                       | yes                              | in every sample after every take of the queue, running rows and `taken - done` are at most the cap, at both slot counts                                                                                                                                                |
| 4   | The planning figure of 2,000 jobs/s with real handlers (9.5.7, 26.3)                              | open until the quiet-slot run    | the run beside other work (below) gives 139 to 489 jobs/s at batches 1 to 50, near the rate the calibration's unit rate allows; the figure for a quiet machine is not taken yet                                                                                        |

## Findings

1. **An open enqueue unit hides its lane from every take (9.5.2, 9.5.3, PostgreSQL only).** The pick
   locks lane rows `for update of l skip locked`. `kw_jobs` has a foreign key `(lane_id, scope_id)`
   to `kw_job_lanes`, and every enqueue that adds a job inserts a job row, so PostgreSQL holds
   `for key share` on the lane row until the unit ends. `for update` conflicts with it, so the take skipped the lane,
   answered it as skipped, and the fetcher retook three times after short pauses and ended its sweep
   until the next wake-up. The lane counters (`kw_job_lane_counts`) were built to avoid exactly this
   (9.5.2); the insert's key-share lock was missed. Reproduced without timing: tenant A commits ten
   jobs, a second unit of A enqueues one more and waits, and a take of four in a namespace unit
   answers no job and one skipped lane. A probe outside this repository (2026-11-21, pinned clock,
   one worker of 4 or 8 slots, A enqueueing 20 units of 500 back to back, B one job after A's
   5,000th), run once per statement while other work ran on the machine (load average 3.1 to 5.8):
   on the old statement none of A's 10,000 jobs had started by the time the drain began, just after
   A's last unit (83 takes in a run), and with `for no key update` 1,323 (4 slots) and 678 (8 slots)
   had. The probe read these counts after its drain, so they also include the work done after A's
   last commit; the counts themselves vary with the machine. **Fixed here:** the pick locks `for no
   key update of l skip locked`. That mode conflicts with itself (takers still exclude each other)
   and with an update or a delete of the lane row (a cap change still hides the lane), not with `for
   key share`; the take's own update of the lane writes `taken` and `vtime`, which no key contains.
   Of the adapters built, only PostgreSQL had the gap: the in-memory adapter and PGlite run units
   one at a time. The MySQL steps of 14.3.9 have the same gap until that adapter is built. The
   statement that settles lanes (a take that reclaims an expired lease, a drain that releases an
   attempt) took the same lock on the lane row only to change `taken`, so it waited for every open
   enqueue unit of the lane; it locks `for no key update` as well. Two cases of
   `job-store.postgres.test.ts` hold an enqueue unit open and fail on the old statements.
2. **At batches 10 and 50 the lanes bound the take, not the slots (9.5.5, 9.5.7).** The kernel gives
   every job lane a cap of four, and the runtime's `queues.<q>.running` is not wired, so eight
   tenants run at most 32 jobs of a queue (column "most running"). Four workers with 50 slots each
   have 200 slots; 32 of them can hold a job. Batches 10 and 50 therefore measure the same limit,
   which the table shows.
3. **A lane at its cap refills on the next wake-up or poll.** A fetcher wakes itself when a slot
   frees only if all its slots were in use when it took. With slots to spare and a lane at its cap,
   the lane's next job waits for a wake-up that the change feed delivers or for the next poll. In
   the probe of finding 1 (one run each; counts as read after the drain began, see finding 1), at 4
   slots it made 666 takes of the queue's name, one of them a manual take of the probe, for 1,323 of
   A's jobs, and 664 of them handed out jobs; at 8 slots it made 302 takes of the queue's name, one
   of them a manual take of the probe, for 678 jobs, and 62 of them (21 %) handed out none, because
   A's lane was at its cap while slots were free. On PostgreSQL a wake-up is one notification per
   commit, and A's units of 500 jobs give 20 of them over the whole flood, so neither the case nor
   the probe tests one notification per enqueue. Not changed here; a follow-up.
4. **A real job costs several transactions (9.5.2, 9.5.7).** In the run beside other work the
   database ended 5.7 to 6.5 transactions per job at batches 10 and 50 and 12.8 to 16.4 at batch 1.
   The write-path spike's bound of 1,757 to 2,519 units/s therefore corresponds to a few hundred real
   jobs per second, which is where the run's figures lie; the figure for a quiet machine is not taken
   yet.

## Environment and method

- Apple M1 Max Mac (10 cores, 32 GiB), Node 26.13.0; PostgreSQL 18.7 (`postgres:18.7-alpine`, one
  container started by `startPostgres` of `@keelwerk/testing/postgres`: image defaults for
  durability, `max_connections` 200, data directory on tmpfs, label `keelwerk-test`, an application
  role without BYPASSRLS) on Docker Engine 29.9.3 (VM with 10 CPUs and 27 GiB). Clients reach it over
  TCP through the port forwarding.
- The app has three real handlers on the kernel's own paths (`src/bench-actions.ts`,
  `src/bench-touch.ts`, `src/watch-module.ts`): a command that writes one row and its event (the
  command job when called asynchronously, the unit of the calibration when called synchronously); an
  asynchronous reaction on that event that writes one row (the reaction job); a command that writes the
  row and requests an effect that a trivial executor runs, with no I/O (the effect job).
- A cell is one kind at one batch in one round. It runs in a database of its own on the one container.
  The parent process (role `serve`; for reactions also the reaction dispatcher, with its workers on a
  queue that never holds a job) creates the deployment with eight tenants, commits `N` jobs for each
  tenant, and stops. Four child processes then join the deployment (`startTestRuntime` with `join`)
  with workers of `batch` slots on the kind's queue. The cell ends when `kw_job_history` holds
  `8N` rows, all `succeeded`. For commands and reactions the runner then reads the table the handler
  writes to, and throws if it does not hold `8N` rows.
- jobs/s is `8N` over the time from the first job's `started_at` to the last job's `finished_at`.
  Transactions per job is the change of `xact_commit + xact_rollback` of the cell's database from just
  before the children start to just after they have stopped, less what the measurement itself adds
  (measured at the start of each run, as the first lines of its output say): one monitoring
  connection, one transaction per poll of the history, and the children's joins (which include their
  own start-up, the reaction dispatcher's start in the reaction cells). A reading is taken only when
  the database has no open connection, because a backend hands its counts over when it ends. The
  children's idle polls and heartbeats while they run are counted: they belong to the cost of a
  worker.
- The calibration of each round: four child processes join without workers and make synchronous calls
  of the writing command spread over the eight tenants (eight calls in flight per process); its
  transactions per second, less the joins, are the rate the database sustains when every job costs one
  unit. The bound is that rate over the transactions per job of the cell, both medians. It is a
  reading, not a limit: a transaction of the take is cheaper than one of a command, so a cell may
  pass it (six of the nine cells do in the run below: command 10 and 50, reaction 1, 10 and 50,
  effect 10).
- Each row is the median of the rounds, the figures in brackets the minimum and the maximum (the
  runner prints `median (min-max)`; one round has no spread, so the brackets repeat the median). A full
  run is three rounds with `N` = 500 (4,000 jobs a cell), the order of the cells reversed in every
  second round; a quick run is one round with `N` = 100.
- Run: `pnpm --filter @keelwerk/spike-queue-real-handlers measure [quick]`, alone on the machine
  (Markdown on stdout, one container, stopped at the end, and one database per cell, created
  and dropped over the admin URL). No test project and no CI job runs it. Disk: tmpfs data and the
  shared image, so none; the container is removed at the end.
- Limits: the lane cap is the kernel's four (finding 2); the children's completions are one unit per
  job, as in 9.5.2; one quick round has no spread; `N` = 100 makes the joins' share of the transactions
  per job larger than at `N` = 500.

## Results

### Run beside other work (quick, one round, 2026-11-21)

Taken beside other work, not on a quiet machine: the 1-minute load average stood between 3.3 and
5.7 during the cells, and PostgreSQL containers that are not this run's (`amazing_poincare`,
`m3-t2-pg`) were listed by `docker ps` at the end. What else ran is not known. The run began
Sat 21 Nov 2026 03:43:58 CET; `uptime` before it:
` 3:43  up 2 days, 21:37, 1 user, load averages: 5.14 5.72 8.42`, after it:
` 3:48  up 2 days, 21:41, 1 user, load averages: 4.53 4.84 7.27`. The figures show that the runner
works and give an order of magnitude; they are not the report's result.

Transactions the measurement adds, taken away from every count: monitoring connection 1, poll 1, four
workers joining 356 (451 with the reaction dispatcher), four processes joining without workers 303.
This run was taken before the check of the handler's table moved after the final reading, so its
command and reaction cells still count that check's connection and query: two transactions per cell,
under 0.003 per job.
The table is the runner's output as printed.

| kind     | batch | slots | most running | jobs/s        | transactions/job    | bound jobs/s | load         |
| -------- | ----- | ----- | ------------ | ------------- | ------------------- | ------------ | ------------ |
| command  | 1     | 1     | 4            | 159 (159-159) | 12.82 (12.82-12.82) | 184          | 3.81 to 4.25 |
| command  | 10    | 10    | 32           | 448 (448-448) | 5.93 (5.93-5.93)    | 397          | 4.07 to 3.83 |
| command  | 50    | 50    | 32           | 454 (454-454) | 5.74 (5.74-5.74)    | 410          | 3.79 to 3.33 |
| reaction | 1     | 1     | 4            | 170 (170-170) | 15.78 (15.78-15.78) | 149          | 3.37 to 3.64 |
| reaction | 10    | 10    | 32           | 489 (489-489) | 5.90 (5.90-5.90)    | 399          | 4.56 to 4.63 |
| reaction | 50    | 50    | 32           | 474 (474-474) | 5.84 (5.84-5.84)    | 403          | 4.15 to 3.96 |
| effect   | 1     | 1     | 4            | 139 (139-139) | 16.43 (16.43-16.43) | 143          | 3.73 to 3.91 |
| effect   | 10    | 10    | 32           | 370 (370-370) | 6.53 (6.53-6.53)    | 361          | 4.48 to 5.73 |
| effect   | 50    | 50    | 32           | 368 (368-368) | 6.20 (6.20-6.20)    | 380          | 5.16 to 5.14 |

Calibration: 2355 transactions per second (one per round). Load average at end 4.53.

### Quiet-slot run: not taken yet

Not taken in this package because other work ran on the machine during its hours; the numbers will
be taken later and go here.

`pnpm --filter @keelwerk/spike-queue-real-handlers measure` without `quick`, with nothing else
running on the machine and no other PostgreSQL container, and with `uptime` before and after. Its
tables go here, headed by what ran beside them, and its numbers go into 9.5.7, 26.2 and 26.3.
