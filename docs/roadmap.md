# keelwerk roadmap

Date: 2026-11-04 (first version 2026-10-11; addendum 3 and Jens's decisions of 2026-10-24
merged; the jobs, nodes and autoscaling design, the design of encrypted personal data and the
pure-handler design of decision 50a merged on 2026-10-25; reordered on 2026-10-28 for decision 48c,
with Trail rebuilt first, Launchway second and the mail server parked; the M0 spikes recorded and
the `.launchway/` directory of decision 90c applied on 2026-11-04, and M1's limits from the M1
plan's specification gaps, register section N, added the same day). Status: approved with the
architecture on 2026-11-04 (section 2); M0 in progress.

This document orders the work of [architecture.md](architecture.md) into milestones, from the
repository toolchain (M0) to the first apps running on keelwerk: Trail's backend rebuilt in the
Trail repository (M3) and Launchway's backend rebuilt in the Launchway repository (M4). The mail
server for `jenspenneman.com` is designed in full and parked until Jens has a stable, permanent
deployment option (2026-10-26): its three milestones keep their scope and get numbers when he
unparks them. Every milestone delivers named packages and modules, ends with exit criteria that a
test or a demonstration can check, and leaves the repository in a usable state.
[brief.md](brief.md) remains the requirements source; nothing it asks for is dropped here: what
comes after the platforms is listed under later milestones, and the parked mail milestones are
listed in full.

## 1. Rules for the plan

- Each milestone is usable on its own: its exit criteria run in CI or on the home server, not in a
  plan.
- Stored formats are final from M1 (section 14.1 of the architecture): later milestones add tables,
  columns, members of the adapter contract and protocols, never a rewrite of stored events,
  positions or tokens. A contract member joins with its first user, so no adapter ships a stub
  (architecture.md section 14.3.2).
- An ADR exists before the milestone that first depends on its decision (ADR 0001). Section 5 lists
  the ADRs still to be written and when.
- Every milestone keeps the CI checks of architecture.md section 13.8 green and adds its own
  conformance cases; the adapter matrix grows with the adapters a milestone ships.
- Every app built on keelwerk lives in its own repository and depends only on the published
  packages, never on this repository, which keeps `examples/portal` for its own CI (decision 48c).

**Beta policy** (decision 48c, 2026-10-27). The framework and every app built on it stay in beta
until Jens, and only Jens, declares them stable. Until then every package is published as a 0.x
pre-release, every app pins exact versions (no ranges), and an upgrade is a deliberate change in the
app's repository. Nothing is sequential: the apps are rebuilt while the framework grows, each on the
pre-release it pins, and framework work lands where an app shows the need (architecture.md section
24). The code and the design documents are public from the start, at a moment Jens chooses, with the
licence (FSL-1.1-ALv2, `LICENSE.md`) in every commit (decisions 20 and 83).

## 2. Gates

Every decision a milestone depends on is taken; the gates list them, so that each milestone shows
what it builds on. Only the mail server's questions are open, and they are parked with it.

| Gate | Before | What |
|---|---|---|
| Architecture approval | M1 | Passed on 2026-11-04: Jens approved the architecture and the ADRs are `Accepted`; the name keelwerk was settled on 2026-10-28 (decision 91); trademarks wait (decision 84c). Publication does not wait for this gate: the code and the design documents may be public from the start, at a moment Jens chooses, with the licence in every commit (decisions 20 and 83, revised 2026-10-27). |
| Decisions for M1 | M1 | Taken: 1 (the compiled app catalogue), 2 (hard dependencies), 3 (object literals), 4 (module authority), 5 (deny rules), 6 (the kernel job queue: the job store is part of the adapter contract from M1 and its stored format is final there), 7 (personal fields encrypted in state tables, ADR 0027), 8 (buffer defaults and `asOf`), 10 (before-images), 12 (datastore agnosticism: the kernel's fallbacks ship with the adapter contract), 16 and 81 (`keelwerk call`), 17 (`explain --as`), 18 (protobuf tags), 19 (Temporal from the start), 20 (the licence), 28 (TypeScript 7 and Node 26), 29 (`chain` by default), 30 (Kysely), 31 (the `Check` form), 32 (the Maybe accessor, revisited after the spike), 35 (anchors from M1), 50 (strict pure handlers, ADR 0026), 52 (dated API versions, because pins and the ledger ship in M1), 58 to 61 (kebab names, the generated manifest, one rule per file, scaffolds that only create files), 65 and 66 (blind indexes only where declared, NFC), and 73, 76, 77, 78 and 79 (generators, logging, the fixed clock, effect records in the chain, command inputs as a digest), because the interpreter, the decision record in `kw_events.meta` and the `core.effect` format ship in M1; and 121 to 182, the M1 plan's specification gaps (register section N), of which 144 (asynchronous work without workers) and 160 (sign-up) are built as decided unless Jens objects. None is pending. |
| Decisions for M2 | M2 | Taken: 15 (oRPC beside tRPC), 36 (operator work stays on the invocation protocol and the CLI, no operator GraphQL schema), 37 (own operation limits with the no-repeat rule), 51 (flags in the core), 53 (12 months of deprecation, then retirement), 74 (inline effects in `prepare`), 75 (executor retries only without domain meaning) and 80 (external performers), because effect jobs, executors, continuations, external performers and the other transports ship in M2. Taken on 2026-11-10: Jens's go on M2 and its plan (entry 475), and the M2 plan's gap decisions, of which the scope moves, the defaults Jens saw and the lead's decisions of the day are register section Q (entries 475 to 493); the specification and the rest of the register follow at the next editing pass. None is pending. |
| Decisions for M3 | M3 | Taken: 48 (Trail in its own repository, on exact-pinned 0.x pre-releases) and 74 with its reservation (Trail's rebuild tests the phase restrictions). None is pending; Trail's own product choices are made in the Trail repository. |
| Decisions for M4 | M4 | Taken: 23 (a clean break with agent protocol v1), 24 (the edge through the agent), 25 (tenant-owned nodes), 26 (subdomains with mandatory hardening), 27 (two PostgreSQL instances and the ledger file), 38 (resumable uploads, ADR 0020), 45 (separate realms), 47 (keep all data), 49 (outbound webhooks), 54 (automatic finalization), 55 (renames through expand and contract), 62 (`keelwerk fleet`), 63 (the scaler with the static provider), 71 (bounded scans), 72 (substring defaults) and 82 (the edge provider contract). None is pending. |
| Decisions for M5 | M5 | Taken: 12 (MySQL kept), 13 (no Drizzle adapter), 14 (introspected external tables), 63 and 64 (the opt-in docker provider) and 69 (order tokens on PostgreSQL). None is pending. |
| Decisions for M6 and M7 | M6, M7 | Taken: 9 (offline sync after the platforms), 11 (Loro documents from the first declaring app) and 34 (5 minutes of clock skew). None is pending. |
| Decision for the experiments module | after M4 | Taken: 57 (fixed-horizon statistics first). |
| Decisions for the mail milestones | when Jens unparks the mail server | Parked on 2026-10-26: 21 (outbound relay), 22 (own IMAP listener), 33 (mail partitions and search), 40 (ACME client), 41 (home connection probes), 42 (shared mailboxes), 43 (Sieve), 44 (webmail), 46 (DMARC rollout), 56 (the mail listeners' own container), 67 (server-side mail search) and 68 (word matching); decided and waiting with them: 70 (search keys per data subject). |

## 3. Milestones

### M0. Repository toolchain and spikes

Scope: the workspace every later package builds in, and the two spikes the review asked for before
any M1 code: the type model and the write path.

Status (2026-11-04): the toolchain is in place, and both spikes are done, with their reports in
`spikes/composition-types/REPORT.md` and `spikes/write-path/REPORT.md`. Their findings are decided
and applied (architecture.md section 26.2, register section M). Exit criteria met: 2 (the
type-model checklist passes on TypeScript 7.0.2, the budgets are recorded in architecture.md section
13.11, and the pnpm-layout build has no TS7056, TS2742, TS4023 or TS2883 at 3, 12, 25 and 40
modules), 3 (`docs/api-sketch.ts` type-checks against the spike with no errors), 4 (no
cross-tenant waiting, the single-tenant ceiling per round trip, wake-ups outside writer
transactions, the fair take's p95 against lanes and batch, and positioned loads against one
snapshot per decision, all recorded), the Maybe half of 5 (decision 32b confirmed) and 6 (the
approval gate passed on 2026-11-04). The GritQL plugins of `@keelwerk/biome-config` shipped with
their fixtures the same day, which closes M0's deliverables. Neither spike covered the `prepare` comparison or the
Node 26 re-checks of criterion 5; architecture.md section 26.2 records them as open. M1 delivers
the `prepare` prototype and its report (register entry 150); M3's criterion 3 repeats it on Trail's code.
(Amended 2026-11-05: the Node 26 re-checks passed on 2026-11-04; the `prepare` prototype ran the same
day, `spikes/prepare-variant/REPORT.md`, and recommends keeping the separate `prepare`, which Jens
decides, register entry 358 and open point 469; the interpreter's overhead per request was measured
on 2026-11-05, `spikes/interpreter-overhead/REPORT.md`, register entry 380. Criterion 5 is met but
for Jens's choice on the variant.)

Packages and artefacts:

- Root workspace on Node 26 (decision 28a; pinned by `.nvmrc`, `packageManager` and the CI Node
  setup rather than by `engines` fields, which Dependabot's updater refuses while it runs Node 24,
  see the note in `.github/dependabot.yml`): pnpm 11 workspace,
  TypeScript 7.0.2 with project references and the base configuration of architecture.md section
  13.3, Biome 2.5.15, Vitest 5.0.3 with type checking, CI on GitHub Actions on Node 26 (the
  repository private or public, as Jens chooses, decision 83), branch protection that requires
  signed commits, `LICENSE.md` from the first commit, `CONTRIBUTING.md` (signed commits; no outside
  contributions until a contributor licence agreement exists, decision 85), and release and
  changelog tooling for 0.x pre-releases.
- `@keelwerk/biome-config`: the preset with the layout rules of architecture.md section 13.9
  and the GritQL plugins `named-module-types`, `as-system-reason`, `no-null-in-conditions`,
  `pure-parts` (replacing `pure-deciders`), `no-module-state`, `no-await-in-parts`,
  `error-code-format`, `no-selection-augmentation`, `one-export`, `no-import-effects` and
  `wiring-only-assembly`, with fixtures; Biome's `noNodejsModules` and `noRestrictedImports`
  configured for module packages (allowed under `src/executors/`), and `noProcessEnv`,
  `noProcessGlobal` and `noGlobalAssign` everywhere (allowed in `keelwerk.config.ts`), with
  fixtures (architecture.md section 7.9.6). Modules are object literals (decision 3 of
  2026-10-24), so no plugin guards a builder chain.
- The root workspace gets `knip.json`, and CI runs knip after `biome ci`.
- Empty, building packages `@keelwerk/core`, `@keelwerk/data` and `@keelwerk/testing`.
- `spikes/composition-types`: the checklist of architecture.md section 4.7 (the module base and
  the module literal, module-local contexts compiled with no app in scope, every field flag through
  every modifier, own references, generated actions with a typed `watch`, `defineApp` options,
  `AppActionTree` with input, output, error and event types from the field model, `Insert`,
  `Patch` and `OfflinePatch`), declaration emit under the pnpm layout, instantiation counts on
  synthetic apps of 25 and 40 modules, and `docs/api-sketch.ts` compiled as the acceptance test.
  The checklist adds the pure handlers of architecture.md section 7.9: generator handlers typed per
  request through `yield*`, a compile error for an `async` `decide`, `ctx.all` tuple answers with
  `const` type parameters, `outcomeOf` continuation inputs and the `effects` and `executors` mounts;
  `docs/api-sketch.ts`, now strict and with its `hooks` module, stays the acceptance test.
  The spike covers the base and module split: parts built with the part functions over the base in
  separate files, the module literal that the generator writes as `module.generated.ts` from the
  directories and that produces the same module type as the module written in one file (decision
  59b), rules one per file (60b), own actions invoked by value, and the instantiation cost of typing
  each part against the base. A fixture module in the canonical layout of architecture.md section
  23 sits beside `docs/api-sketch.ts`. It also writes the auth module against the Maybe accessor
  and against `| undefined` (decision 32b), and prototypes the two command forms of decision 50a's
  variant, a separate `prepare` and inline effects before the first load, on Trail's position
  ingest and on GitHub's connection flow (architecture.md section 26.2, items 4 and 5).
- `spikes/write-path`: the per-scope commit tail, the coalescing notifier and the job store's fair
  take (take p95 against the number of lanes and the batch size, to replace the planning figure of
  2,000 jobs per second per placement; architecture.md sections 9.5.3 and 9.5.7) on a networked
  PostgreSQL 18 (testcontainers), with concurrent writers in many tenants; and the interpreter's
  costs (architecture.md section 7.9.4): the per-load scope-counter read that positions every load
  and the overhead per request, against one `REPEATABLE READ` snapshot per decision.
- Node 26 re-checks: type stripping of linked workspace packages and its refusal under
  `node_modules`, `node:sqlite`, `crypto.argon2` and the Unicode version behind the normalisers,
  recorded in architecture.md section 13.2 and Appendix B (section 26.2, item 8).

Exit criteria:

1. A fresh clone runs `pnpm install`, `biome ci`, `tsc -b` and `vitest run` green in CI.
2. Every item of the type-model checklist passes on TypeScript 7.0.2; the instantiation budget for
   apps of 25 and 40 modules and the declaration-size budget per module are recorded in
   architecture.md section 13.11; no TS7056, TS2742, TS4023 or TS2883 occurs.
3. `docs/api-sketch.ts` type-checks against the spike types, or every difference is recorded as a
   change to architecture.md.
4. The write-path measurement shows that writers of one tenant never wait on another tenant's
   commit tail, records the single-tenant ceiling on networked PostgreSQL, shows notifications
   leaving writer transactions untouched, records the fair take's p95 against the number of
   lanes and the batch size, and records the cost of positioning every load against one snapshot
   per decision.
5. The Maybe accessor and the `prepare` variant are compared and reported to Jens, and the Node 26
   re-checks are recorded (architecture.md section 26.2, items 4, 5 and 8).
6. The architecture approval gate is passed.

### M1. Thin vertical slice

Scope: the smallest end-to-end system: the core, the in-memory and PostgreSQL adapters (with PGlite
for development), one transport (REST), the accounts and authentication modules, and the CLI,
runnable from a fresh checkout.

Packages and modules:

- `@keelwerk/core`: the DSL as object literals (`defineModuleBase`, the part functions with
  `defineRule` for one rule per file, `defineModule`, `defineEntity`, the field model for the M1
  kinds with `Temporal` instants and dates, `defineApp`, `defineDeployment` with infrastructure and
  the anchor cadence), the module-manifest generator (`module.generated.ts`, decision 59b), chain
  anchors to the ledger sinks (decision 35b), compose checks with their named errors, the API
  surface, the invoker with sessions and the full pipeline, the authorization engine (rules with
  `where` and `check`, maskable fields, principal narrowing, set operations and aliases, module
  authority and `forCaller()`), the condition AST and its in-memory interpreter, the error taxonomy
  with `toWire`, the key service (master, deployment, backend and tenant keys, subject and value
  keys, index root keys), the encryption of personal fields in state tables (sealed state columns,
  blind indexes with normalisers for the `eq` family, `isNull` and uniqueness, and the kernel's
  encryption planner; architecture.md section 14.7.9), the kernel write path (repositories, `decide`
  and `evolve`, item checks, invariants, receipts with the pending row), inline reactions and module
  service principals, the interpreter of architecture.md section 7.9 (`decide`, `read` and `react`
  in plain and generator forms, requests answered in the unit, kernel effects, automatic retries for
  every command), decision records in `kw_events.meta` from M1 (a stored format final from M1, like
  `writer` and `flags`), the `core.effect` entity in its final stored format, the `ctx.compute` pool
  with Argon2id, `@keelwerk/core/crypto`, and `keelwerk explain --dry-run` and `--trace`, the
  `core` module (backends, tenants, domains, placements, namespaces, command receipts, operator
  tokens, `core.introspect`, `core.composition`, `core.me`, `core.capabilities`), the generated
  entity actions with `changes`, `queryChanges`, state tokens and the disclosure rule (tokens final
  from M1; `watch` comes with `@keelwerk/live` in M2), `startRuntime`, and the `wire` and `ledger`
  subpaths.
- API versions in the core: `Keelwerk-Version` resolution and pins per backend, tenant and
  credential, `defineApiVersions` with a first version, the ledger, and `keelwerk surface diff`
  as CI step 9 (architecture.md sections 18.2, 18.3 and 18.6). The stored formats that must be
  final from M1 are written from the start: `writer` and `flags` in `kw_events.meta` (and in the
  chain's content), `build`, `revision` and `apiVersion` on jobs, `apiVersion` on receipts, the
  queue tables with every `JobSpec` column, `kw_scope_keys`, the ledger file's format and the token
  format (register entries 127, 142, 152, 154, 175 and 180).
- `@keelwerk/data`: the Kysely SQL family, the migration planner with tracks and snapshots, the
  in-memory adapter, PGlite wiring, the kernel's paths for capabilities an adapter lacks
  (architecture.md section 14.3.3, brief addendum 5) and the adapter conformance kit.
- `@keelwerk/adapter-postgres`: shared-tables placements with forced row-level security, the event
  log with per-scope positions, the notifier, partial unique indexes, the job store tables in their
  final stored format (`kw_jobs` with the `scheduled` state, lanes with split lane counters, groups
  and `kw_job_history`; architecture.md section 9.5.2).
- `@keelwerk/transport-http` (the host, the invocation protocol, the operator socket, cookies and
  origin checks) and `@keelwerk/transport-rest` (REST, OpenAPI 3.1, problem details).
- `@keelwerk/client` and `@keelwerk/cli` (`init`, `dev` with PGlite, `generate`, `db plan`,
  `db generate`, `db apply`, `db status`, `db check`, `db verify`, `introspect`, `surface diff`,
  `surface version new`, `backend`, `tenant`, action commands under `keelwerk call` (decisions
  16b and 81a), `login`, `operator token`, `doctor`). The CLI gains `keelwerk new
  module|entity|action|rule|flag` and the other kinds, which only create files (question 61, closed
  by 59b), the generator with its drift check, and the layout pass of `keelwerk doctor`, run by
  `keelwerk build`, CI and `keelwerk dev`; `keelwerk init` creates the canonical layout
  (architecture.md section 23).
- `@keelwerk/module-accounts` and `@keelwerk/module-auth` as specified in architecture.md
  section 17.2, written in the module layout of section 23 and in the strict forms of section 7.9,
  with passwords, opaque session tokens, expiry and rotation, re-authentication,
  password resets and rate limits on the shared token buckets of the quota model (passkeys follow in
  M3, for Trail; until the reaction dispatcher of M2 exists, `auth` sets `lastLoginAt` inline at
  login).
- `@keelwerk/testing`: the harness, the local client, policy matchers, the adapter and transport
  conformance suites (REST and the invocation protocol), dual evaluation (with the unsealing oracle
  for personal fields), the adversarial isolation suite, and `drive` and in-memory runs for pure
  handlers, with answers as data (architecture.md section 7.9.6).
- `examples/portal`: an app of `accounts`, `auth` and `rest` in the canonical layout, the
  end-to-end fixture: a project root with `.launchway/` and `apps/portal/`, the private package
  `@keelwerk-examples/app-portal`, and `modules/` once it has modules of its own; the workspace
  lists `packages/*`, `examples/*/apps/*`, `examples/*/modules/*` and `spikes/*` (register entry
  165).
- `packages/type-budgets` (private): the attest benchmarks on their own exact TypeScript 6.0.3,
  beside the gate in `scripts/type-budgets/` (register entries 136 and 138).

What M1 ships of designs that span milestones (register section N; architecture.md is the design,
these are M1's limits):

- Adapter contract: `Unit` has `rows`, `events`, `receipts`, `jobs`, `usage`, `buckets`, `keys`,
  `serials`, `nested`, `afterCommit` and, on deployment-scope units, `scopeKeys`; `JobStore` is
  complete except `schedules()`; `EventStore` lacks `compact`, `purgeStream`, `purgeTransient` and
  `redact`. Adapter conformance cases 5 (stream records), 10 (consumers, tombstones, streams and the
  queue scenarios with workers) and 11 wait for M2 (entry 123); since 2026-11-10 the tombstone
  part of case 10 waits for M4 (entry 477).
- Asynchronous work without workers (entry 144, for Jens to confirm): M1 writes job rows, timers,
  `core.effect` `requested` records and `accepted` receipts in their final form and runs no worker.
  `execution: 'async'`, and `either` with a preference for async, answer `{ commandId, status:
  'accepted' }`; compose refuses async reactions with `asyncReactionsUnavailable`, so `auth`'s
  `recordLogin` is inline; the session resolver's idle extension is enqueued in a short unit after
  `open`, so sessions slide only once M2 runs the keyed job; boot and `keelwerk doctor` list every
  queue with work and no worker. The minimal action-job worker in M1 was the alternative, not taken.
- `prepare` is typed in full and runs with loads only; `ctx.perform` fails with `internal`,
  `core.request_not_allowed`, until inline effects ship in M2 (entry 125). The `prepare` variant
  prototype and its report are an M1 deliverable that leaves `@keelwerk/core` unchanged (entry 150);
  delivered on 2026-11-04 (entry 358). In M1 `prepare` runs in one read-only unit, and its reads are
  not recorded (entry 347).
- `onTenantCreated` hooks run in their own tenant-scope unit right after the creating unit commits;
  a failure is logged and listed by `keelwerk doctor` (entry 147).
- `defineDeployment` is typed in full and validated; M1 uses `apps`, `infrastructure`, `control`,
  `placements`, `tenantResolution`, `operator`, `keys`, `anchors` and `queues.<q>.running` (entry
  132). Tenant resolution: `byHostname` over `core.domain` and `byHeader`; `byScopeKey` and `byPath`
  are refused at boot with `scopeDirectoryUnavailable` (entry 140).
- Flags: `defineFlag` as a typed declaration listed by bases; every flag request answers the
  declared default with reason `default`, recorded in `meta.flags`; providers, targeting and
  `core.flag` are M2 (entry 143).
- Personal fields: adapters declare `encryptedQueries: { equality: true, tagSets: false, order:
  false, maxScan }` and write equality tags only; `accounts.profile.email` keeps `queries:
  ['prefix']`, and its `startsWith` runs as the kernel's bounded scan, listed by `keelwerk doctor`;
  M4 adds prefix tags through a reindex; no M1 module declares `contains`, `order` or `search`
  (entry 157).
- Rate buckets take one token at a time from the shared `kw_rate_buckets` row; per-process
  allowances come with M2's quota model (entry 156).
- Restore detection: `connect` compares each scope's head with its newest anchor and logs a rewound
  scope, `keelwerk doctor` lists it and `keelwerk db verify` fails on it; the epoch bump and the
  control store's mark tables are M2's (entry 155).
- Rollouts: `core.rollout` does not exist yet, so the revision is 1 and `keelwerk db apply
  --contract` applies only while every live `core.process` runs the same build id; no M1 migration
  has a contract step (entries 142 and 164).
- The invocation protocol mounts `/invoke`, `/batch`, `/surface` and `/capabilities`; `wait` is
  ignored, and the client's `subscribe` and `waitForEffects` reject with `unavailable`,
  `core.live_unavailable` (entry 182).
- The transport conformance suite runs values, errors, pagination, masks, async acceptance (202 and
  the stored receipt), idempotent replay, concurrent duplicates, optimistic concurrency and the
  browser scenarios; the streaming and selection-limit scenarios are written and skipped under the
  marker `m2` (entry 159).
- Packages carry no `engines` field; `keelwerk doctor` checks Node 26 or later, and the lead
  decides before the first publish (entry 121, criterion 12).

Status (2026-11-10): complete. All 65 work packages were merged on 2026-11-05 (main at `6e88cc4`),
and the exit-gate run on main was green the same day: exit criteria 1 to 11 are met, each mapped to
a named CI step by WP-65. Their follow-ups are register sections O and P (decisions 184 to 314 and
327 to 449, open points 315 to 326 and 450 to 474). Criterion 12 is met by writing the `engines`
field at publish time: the sources carry none, so Dependabot's updater keeps running, and every
published manifest carries `"engines": { "node": ">=26" }`. It closes with the first publish, which
M2's first-publish work package carries (register entry 484).

Exit criteria:

1. From a fresh clone, `keelwerk dev` starts the portal example on PGlite with no database
   installed, and the generated file, migrations and OpenAPI document are written and pass
   `keelwerk generate --check`.
2. Over the operator socket, the CLI creates a backend and a tenant at runtime, without a restart.
3. A user registers and logs in over REST, with a `__Host-` cookie and with a bearer token; a stale
   cookie does not lock the login page; `keelwerk login` stores a token and `keelwerk call`
   runs an action against the running deployment.
4. The same scenario passes in CI against PostgreSQL 18 (testcontainers) and on the in-memory
   adapter; the adversarial isolation suite passes for two tenants on both, including backend-scope
   units refused on tenant entities.
5. The adapter conformance suite (codecs, conditions, pagination, units, isolation, event store,
   serials, migrations, toggle-then-rebuild) and the transport conformance suite pass.
6. A dump of the test database contains no former password hash, no plaintext secret and no
   plaintext personal value.
7. Type tests, declaration-emit checks and instantiation budgets pass in CI.
8. Every handler of the M1 scenario re-runs in tests from its recorded answers (its decision record
   and the chain) and reproduces its events.
9. `keelwerk db verify` checks every scope's chain against its anchors in the ledger file and
   detects a test database rewound behind its newest anchor (decision 35b).
10. The scenario passes on PostgreSQL with the accelerations M1 ships switched off (row locks and
    `notify` wake-ups), with the same results through the kernel's paths, and `keelwerk doctor`
    lists the fallbacks and their cost (brief addendum 5); every later milestone adds such a case for
    each acceleration it ships.
11. Moving a part file changes its reference in the generated manifest and `keelwerk surface diff`
    reports the change as breaking; a stale manifest fails `keelwerk generate --check`.
12. The published packages carry `"engines": { "node": ">=26" }` again before the first publish:
    Dependabot's updater runs Node 26 by then, or the lead decides between the `engines` field and
    Dependabot's version updates.

### M2. Execution and live updates

Scope: queued work, reactions and live updates on everything, the other two transports the brief
names, and the shared modules both platforms need next.

Packages and modules:

- The kernel job queue over the job store on PostgreSQL, PGlite and the in-memory adapter
  (ADRs 0015 and 0025): asynchronous commands, durable timers, schedules, the reaction dispatcher
  with keyed jobs and process managers, fair lanes with caps and weights, the queued cap with
  backpressure, groups with rates, priority classes, leases with (worker, attempt) fencing, dead
  letters and `keelwerk jobs` (with `stats`, `lanes`, `explain`, `pause` and `resume`).
- Effects (architecture.md section 7.9, ADR 0026): effect jobs with `defineEffect` and
  `defineEffectExecutor` (capabilities, groups, retries), continuations, inline effects in
  `prepare`, the `core.effectAttempt` stream (kept until a rule is adopted, decision 47c), external
  performers (`ctx.live.effects`, `settle`, deadlines), `keelwerk explain --redecide`, and the
  re-enqueue of unsettled effects after a restore.
- `@keelwerk/events`: consumers with per-scope checkpoints and parking, the retention worker for
  operational buffers, erasure (`core.subjects.erase`) with ledger sinks and restore detection at
  `connect`.
- `@keelwerk/live`: the hub, SSE and WebSocket carriers, the `watch` generator, pokes, stream
  tickets, revalidation on revocation events, streams and topics (`defineStream`, `defineTopic`,
  gap G6), and the `broadcast` capability on PostgreSQL.
- `@keelwerk/transport-graphql` (with its own operation limits, the no-repeat rule first, decision
  37a), `@keelwerk/transport-trpc` and `@keelwerk/transport-orpc` (decision 15b), with oRPC's
  OpenAPI handler compared against the own emitter (architecture.md section 16.7.7).
- `@keelwerk/module-api-keys` (scopes and transports, gap G13), `@keelwerk/module-members`
  (roles and invitations), `@keelwerk/module-audit` (`observes: 'all'`, gap G12).
- Core additions: extension-point cardinality (G14), tenant-editable configuration (G10), the quota
  model of architecture.md section 12.2.
- Version changes (architecture.md section 18.2): `defineVersionChange` with `translate`,
  fixtures and per-version projections; deprecation headers, `core.apiUsage` and retirement at the
  sunset, 12 months after deprecation (decision 53).
- Flags in the core (architecture.md section 20): `defineFlag`, `ctx.flags`, the `flagProviders`
  chain, `core.flag` targeting, gates, `core.suspension`, the stale report and `keelwerk flags`.
- What M1 left to M2 (register section N): workers for the job rows M1 writes, so sessions slide
  and `auth`'s `recordLogin` becomes the async reaction of the sketch; `onTenantCreated` hooks on the
  queue; the contract members `consumers`, `streams`, `JobStore.schedules()` and, of the event
  store's maintenance members, `purgeTransient`, whose user is the retention worker, with their
  tables (`kw_consumers`, `kw_parked`, `kw_stream_records`, the schedule table) and adapter
  conformance cases 5, 10 (without its tombstone part) and 11; the epoch bump and the control
  store's mark tables; the `erasure` and `keyTombstone` ledger records; `/subscribe`, `/live`,
  `--wait` and `waitForEffects`; the transport suite's `m2` scenarios.
- Moved out of M2 on 2026-11-10 (register entries 476 and 477), because a contract member joins with
  its first user, so no adapter ships a stub: `Unit.tombstones`, the event store's `compact` and
  `purgeStream`, the table `kw_tombstones` and the tombstone part of conformance case 10 join in M4
  with the operator-adopted rules that purge archived rows and compact history; `redact` joins in M5
  with operator redaction; deployment-wide job groups are M5's, as architecture.md section 9.5.5
  states. Until then compose refuses `scope: 'deployment'` groups with
  `deploymentGroupsUnavailable`, and `core.retention.set` refuses history rules with
  `not_implemented`.

Exit criteria:

1. A subscription resumes after a process restart from its stream token with no gap and no
   duplicate beyond at-least-once; a revoked session ends a live connection within a second.
2. In a test with two tenants, a reaction that fails and retries with backoff for one tenant never
   delays the other tenant's reactions.
3. The queue scenarios (keys, coalescing, FIFO under concurrency, groups, retries, heartbeats,
   dead letters, schedules ticking once per scope) pass on PostgreSQL, PGlite and in-memory.
4. GraphQL, tRPC and oRPC pass the transport conformance suite, including subscriptions with
   control frames and the selection limits (a selection path that repeats an entity type is
   refused).
5. An erased subject's marker values are absent from a database dump; a restore made with
   `pg_restore` is detected at `connect`, bumps the scope epochs and resets old tokens.
6. Quota tests: a tenant over its request rate gets `rate_limited` with `Retry-After`; a tenant
   over its storage quota gets `core.quota_exceeded`; the other tenant is unaffected.
7. After a breaking change with a version change, a client pinned to the older API version still
   works over REST, GraphQL, tRPC, oRPC and the invocation protocol.
8. While one tenant enqueues 10,000 jobs, another tenant's job starts within one take interval, and
   no lane exceeds its cap.
9. A worker killed mid-job loses its lease, the job is requeued within 30 seconds, and no database
   effect is duplicated.
10. An executor killed mid-attempt is retried with the same idempotency key, or its effect is
    settled as `abandoned`; a rebuild from the chain reproduces the state rows and the effect
    states.
11. oRPC's typed client type-checks against `OrpcRouterOf<App>`, and the comparison of oRPC's
    OpenAPI document with the own emitter's is recorded in architecture.md section 16.7.7.

### M3. Trail on keelwerk, in the Trail repository

Scope: the first app built on keelwerk outside this repository (decision 48c, 2026-10-27).
Trail, Jens's self-hosted location history (tracking apps on phones post their positions; people
sign in with passkeys and follow live updates), has its backend rebuilt in the Trail repository on
the published 0.x packages. It is smaller than Launchway and tests the framework from the outside:
published packages and exact pins, the layout, the generator and the tooling of architecture.md
section 23 in another repository, and the strict model of section 7.9 on real code, whose phase
restrictions Jens wants tested before he is sold on them (decision 74a). Trail's own product
choices (its public API, its data migration) are made in the Trail repository.

ADRs due before M3: the `ctx.secrets` requests and the executors' reveal (ADR 0017, gap G4).

Packages and modules:

- Publication: the release tooling publishes every package as a 0.x pre-release to the npm
  registry, with provenance, and every release publishes all packages of the lockstep version or
  none (register entry 484). The npm scope is chosen first (architecture.md section 26.3). The Trail
  repository pins exact versions (the beta policy of section 1), takes every update within a day
  once its checks pass, and verifies the packages' signatures in every check (register entry 493).
- Apps built on keelwerk ship their checks as package scripts and never a workflow file:
  `keelwerk init` and the preset write none, and a test keeps `init` from writing a `.github`
  directory. The deployment platform runs the checks from those scripts (register entry 493).
- `@keelwerk/module-auth` gains passkeys (`@simplewebauthn/server`, architecture.md section
  17.2.2), because Trail signs in with passkeys only; the device authorization flow follows in M4.
- `@keelwerk/transport-webhooks` (gap G8): receivers for requests that are not JSON actions (raw
  bodies, query-string protocols, non-JSON answers), which Trail's tracking-app endpoints need and
  GitHub's webhooks use in M4.
- The egress service (architecture.md section 12.3) for the executors that call out, Trail's first,
  Launchway's GitHub calls in M4.
- Whatever Trail's rebuild finds missing lands as framework work in a 0.x release, through the
  procedure of architecture.md section 24; what M3 cannot fix is recorded in section 26.3.
- In the Trail repository: the app package and its modules in the layout of architecture.md
  section 23.1, its `.launchway/` directory (decision 90c; architecture.md sections 4.6 and 17.3.1)
  with `deployment.ts` (Trail's own deployment), `launchway.ts` and `compose.yaml`, from which the
  current Launchway deploys Trail by running `keelwerk start --config .launchway/deployment.ts` until
  M4's rebuild, and its checks as package scripts with the keelwerk preset.
- Trail's health contract is data in its own repository (paths, the expected status and JSON
  fields, a soak), updated in the pull request that changes its health or configuration endpoints.
  The image check runs the image's own `CMD` and `HEALTHCHECK`, so `keelwerk start` needs no change
  for it (register entry 493).

Exit criteria:

1. The Trail repository installs the `@keelwerk` pre-releases from the registry, pinned to exact
   versions, with no other dependency on this repository; the checks the deployment platform runs
   from its package scripts run `biome ci`, `tsc -b`, `vitest run`, `keelwerk generate --check`,
   `keelwerk doctor --layout` and the conformance suites on Node 26.
2. Trail serves its users from its keelwerk backend: passkey sign-in, the tracking apps' position
   ingest and the live views run through keelwerk actions, and Trail's own acceptance tests pass
   against it.
3. The comparison of `prepare` with inline effects before the first load (decision 50a's variant)
   and of the Maybe accessor (decision 32b) is written up from Trail's code and reported to Jens,
   and architecture.md sections 7.9.4 and 3.4 record the outcome.
4. Every framework gap Trail found is fixed in a published pre-release or recorded in
   architecture.md section 26.3.

### M4. The deployment platform: Launchway's backend on keelwerk, in the Launchway repository

Scope: Launchway's control plane is rebuilt as the `launchway` app in the Launchway repository on
the published packages (decision 48c) and replaces the hand-wired API of Launchway v0.3.0 on the
home server, with a new agent and a new UI at one cutover (decision 23c: a clean break). The old
installation stays in place as the rollback until the new one is verified.

ADRs due before M4: the scope directory (ADR 0016, gap G2), singleton leases (ADR 0018, part of gap
G9), the decision of ADR 0022 together with ADR 0018, ADR 0025 for nodes and the scaler, and blob
storage (ADR 0020, gap G5), which long deployment logs need (section 5).

Packages and modules:

- `@keelwerk/module-dns`, `dns-cloudflare`, `dns-manual` (the `applyRecord` effect with its
  executor and the continuation `applied`); the device authorization flow in `auth`;
  operator-adopted retention rules, with no suggested defaults for Launchway's entities (decision
  47c).
- History maintenance, moved from M2 on 2026-11-10 (register entry 477): `purgeArchived` and
  `compactHistory`, the operator-adopted rules that first use them, bring `Unit.tombstones`, the
  table `kw_tombstones`, the event store's `compact` and `purgeStream`, and the tombstone part of
  adapter conformance case 10.
- Calendar schedule expressions (M2 ships `every` durations with `jitter` only), whose first users
  are the `automation` module's daily release train and the `checks` module's scheduled pass.
- `@keelwerk/module-edge` and `@keelwerk/edge-caddy` (decision 82a): the desired state of the
  edge, the `providers` extension point and the Caddy provider, with the `edge.apply` effect that
  the edge node's agent performs (decision 24a; architecture.md section 17.3.7).
- `@keelwerk/module-outbound-webhooks` (decision 49a): Standard Webhooks deliveries for deployment
  notifications (architecture.md section 16.13).
- `@keelwerk/blobs-fs`: staging, per-blob keys, range reads, resumable uploads (decision 38a) and
  the collector bounded by the backup retention; stream offload into it, which deployment logs use
  past 50,000 lines (decision 47c).
- Launchway's project model reads each app repository's `.launchway/` directory (decision 90c;
  architecture.md section 17.3.1): `deployment.ts` is the app's deployment and `launchway.ts` its
  domains and routes, previews, environment and node, replacing today's per-project `composeFiles`
  setting; Trail moves from its interim `compose.yaml` to that path.
- In the Launchway repository, Launchway's modules as packages in `modules/<id>/`
  (`@launchway/module-<id>`): `projects`, `nodes` (with the agent channel; the agent is the
  external performer of `agentCommand` effects), `deployments` (with the log stream, kept and
  offloaded), `domains` (which declares the edge's sites), `github` (the GitHub effects: the status
  mirror with mechanical retries, release reads, and the manifest conversion inline in `prepare`),
  `previews` (whose teardown reclaims runtime artefacts only), `checks` (check items per app,
  commit statuses, same-tree copies, the scheduled pass) and `automation` (automatic merging of
  dependency updates and the daily release train, built as decide handlers that yield effects, with
  its seven action types as effect executors and its runs as the module's entity; register entry
  493); the app gets `apps/launchway/src/modules.ts` and `src/app.ts`.
- The new agent, a typed client over the live carrier pinned to an API version, holding
  `nodes.channel` and, on the edge node, `edge.channel`; the new UI against the generated API. No
  compatibility transport and no `/api/v1` paths (decision 23c; architecture.md section 17.3.4).
- Rollouts (architecture.md section 19): the build manifest and revisions, the process registry,
  the N-1 rule, expand, data and contract steps gated by finalization, renames through those steps
  (decision 55b), `keelwerk rollout status|finalize|abort`, and blue-green on the home server.
- The home-server topology of architecture.md section 17.5.2: the keelwerk container on a Node 26
  base image, separate PostgreSQL instances for the control store and the placement, the ledger
  volume with the erasure ledger and the chain anchors, backups.
- Nodes and scaling (architecture.md section 21): `core.node`, named processes with slots and
  placements, the connection budget, drains on `SIGTERM`, `keelwerk fleet`, and the scaler as a
  pure plan with the static provider (recommendations only; decision 63a).
- Encrypted queries for Launchway's admin search (architecture.md section 14.7.9): prefix and
  trigram (`contains`) indexes with verification and page filling, bounded scans, the personal-data
  pass of `keelwerk doctor`, `keelwerk db reindex` and `keelwerk keys rotate --index`.

Exit criteria:

1. On the home server, keelwerk serves `deploy.jenspenneman.com` instead of Launchway v0.3.0's
   API; the operator created the backend and the tenant over the operator socket.
2. The new agents, redeployed on every node, deploy a project from a GitHub release and from a
   push; a GitHub delivery repeated two days later does not deploy twice; no v1 agent connects.
3. Pull-request previews open and close; the limit of 10 per project holds under concurrent opens;
   a closed preview's containers, images, volumes and build caches are gone from its node, while its
   row, events and log remain.
4. A domain becomes active through the edge configuration that the edge node's agent applies
   (`edge.apply`, rendered by `edge-caddy`).
5. The new UI works against the generated API (REST with OpenAPI types) with live updates.
6. A node that stops sending heartbeats is marked offline by `nodes.system` after 45 seconds, and a
   process restart in between does not lose the timer.
7. A backup and restore drill on the home server restores the data without bringing back an erased
   subject, clients resynchronise, and `keelwerk db verify` confirms the restored chains against
   the anchors in the ledger file.
8. An upgrade with a field rename and a field type change runs while the agents and the UI are
   connected, and no request, job or event is lost.
9. A blue-green switch drains the old container without losing jobs, and
   `keelwerk fleet scale explain` matches the plan for a synthetic backlog.
10. A deployment log of more than 50,000 lines reads back in full from its start, the older lines
    from the blob store.
11. An outbound webhook endpoint receives a signed deployment notification, and a repeat after a
    restart is deduplicated by its webhook id.
12. Deployments keep three behaviours the release train relies on: a build from the checked-out
    ref for services that declare a build, a manual deployment of any ref that is never
    deduplicated (a rollback), and the failure classes build, pull and up.
13. The old Launchway installation is retired only after criteria 1 to 9 hold and Trail's checks
    and release train also run on the new platform; until then it stays in place as the rollback
    and keeps serving them.

### The mail server (parked)

The mail milestones are parked until Jens has a stable, permanent deployment option (2026-10-26).
They keep their scope as designed, wait with their questions (section 2), and get numbers when he
unparks them. Two things changed around them: the mail server's modules will live in a repository
of their own (decision 48c), and blob storage already ships in M4.

#### Mail foundations (parked)

Scope: what the mail server needs from the framework before its own modules: listeners, blobs,
search, positional paging, partitions and serials, certificates and JMAP.

ADRs due before it: the listener contract with the deployment-level certificate directory (ADR
0019, gap G1); blob storage (ADR 0020) is written for M4; process capabilities are part of ADR 0025
(section 5).

Packages and modules:

- The listener contract, port bindings, connection sessions, SASL carriers and per-connection
  admission in the core.
- On the blob store of M4: uploads and downloads in the transports, JMAP's upload endpoint among
  them (decision 38a).
- The data capabilities `search` (PostgreSQL `tsvector`, for plaintext search indexes) with
  `searchIndexes`, `positionPaging` with `countBefore`, entity partitions and `field.serial`, each
  with the kernel's path on adapters without it (decision 12a); for personal fields, the keyed token
  index in place of `tsvector` (per-subject keys, stemming with `@orama/stemmers`; architecture.md
  section 14.7.9.9).
- Capability probes (`smtp-public`, `smtp-out`) and the unplaceable-work checks (architecture.md
  section 21.2), before the mail listeners.
- `@keelwerk/transport-jmap` (session resource, method calls, result references, push).
- `@keelwerk/module-certificates` (ACME DNS-01, question 40) and the certificate directory;
  `mail-domains` with scope-key claims (the `claimScopeKey` effect) and quarantine.
- The effect-side choices the mail modules need before the mail server: where the inbound checks
  run (inline effects in `acceptInbound`'s `prepare`, or listener steps) and how DKIM signing fits
  the strict model (questions of architecture.md section 26.3).

Exit criteria:

1. Conformance cases pass for search combined with plans (plaintext and keyed token search, also
   with positional paging), positional paging (negative positions and anchors included),
   per-partition tokens, serials under concurrency, blob range reads and purge by key destruction.
2. A JMAP test client (`jmap-jam`) queries a fixture mailbox by position, fetches parts by range and
   receives push for changes.
3. Certificates are issued through DNS-01 in a test zone and picked up by a listener without a
   restart.
4. The sizes of the token index and of the other personal indexes, the over-fetch budget and the
   scan default are measured on a fixture mailbox and recorded in architecture.md section 14.7.9.

#### The mail server: receive, submit, deliver, JMAP (parked)

Scope: a mail server for `jenspenneman.com` that a person can live on with JMAP clients.

Packages and modules (packages in `modules/<id>/` of the mail server's repository,
`@mail/module-<id>`): `mail-store`, `smtp-in`, `smtp-submission`, `mail-delivery` (relay mode, and
direct mode for tests and later nodes; the `smtpDeliver` effect with the submission's state machine
of `recordAttempt`, `retryDomain`, the delay notice and `bounce`; `mail-delivery.testRelay` with the
inline effect `smtpProbe`), `sender-auth` (SPF, DKIM, DMARC, ARC with `mailauth`, as inline effects
or listener steps per the choice of the mail foundations), `spam` (rspamd), `mta-sts`,
`autoconfig`; app passwords through `api-keys`; DNS records for the domain; the mail-store
declarations of personal fields and the JMAP `unsupportedFilter` and `unsupportedSort` mapping
(architecture.md sections 14.7.9.9 and 14.7.9.13); extra delivery workers through the opt-in
docker provider of M5 (architecture.md section 21.5). The mail listeners run in their own container
(architecture.md section 17.5.2, question 56).

Exit criteria:

1. `jenspenneman.com`'s MX points at the home server; mail from major providers is received,
   authenticated, scored and filed, and unknown recipients are refused at `RCPT TO`.
2. A JMAP client reads, flags and moves mail and receives push.
3. Mail submitted on 587 and 465 with an app password reaches external inboxes through the relay
   with DKIM signatures and DMARC alignment.
4. Delivery retries survive restarts and give up after the configured horizon with a delivery status
   notification; a sender's retry days later does not store a message twice.
5. Erasing a mail account turns its messages into tombstones and leaves no message text in the
   event log and no index entries of the account.
6. A listener handover during an upgrade loses no accepted message.
7. A 2,000-mail burst gets extra delivery capacity within the configured limits, never more than
   2 connections per destination domain, and the extra capacity drains after the down window.

#### IMAP (parked)

Scope: the own IMAP listener for desktop and mobile clients (question 22).

Packages and modules: the `imap` listener module (IMAP4rev2 and IMAP4rev1, CONDSTORE, QRESYNC,
QUOTA, IDLE through `mail-store.mailbox.idle`) and its `SEARCH` mapping (word semantics,
`HEADER Message-ID` on the plaintext field, other `HEADER` keys by bounded scan with `NO [LIMIT]`;
architecture.md section 14.7.9.9).

Exit criteria:

1. imaptest passes the agreed profile in CI against the listener.
2. Thunderbird, Apple Mail and iOS Mail synchronise, flag, move, search and idle against the home
   server, and MODSEQ and UIDs stay consistent with JMAP states.

## 4. Later milestones

Nothing below is dropped; it follows Launchway's rebuild unless Jens reorders it. The numbers were
given on 2026-10-28: data breadth was M7, offline sync M8 and collaborative fields M9 (section 6).

| Milestone | Scope | Exit criterion |
|---|---|---|
| M5. Data breadth | `adapter-mysql`, `adapter-sqlite`, the Supabase preset; schema-per-tenant and database-per-tenant placements; tenant move; projection entities with online rebuilds; operator redaction, with the event store's `redact` (moved from M2, register entry 477); `keelwerk db introspect` (external, adopt); the SQL escape hatch as the `ctx.load.sql` read request, with its declared dialect; index tables for personal fields on MySQL and SQLite; the ORE order capability on PostgreSQL, after a spike on operator-class installation and a review of the implementation; job groups with `scope: 'deployment'` (moved from M2, register entry 476); wake-ups through the control store for per-tenant namespaces; `@keelwerk/provider-docker`, the opt-in docker node provider for extra workers, one milestone after the scaler (decisions 63a and 64a); a bounded candidate set for the fair take's lane pick in placements with thousands of lanes (register entry 114) | Trail's and Launchway's apps pass their CI on PostgreSQL, MySQL and SQLite, queues included, with `keelwerk doctor` listing the kernel paths each adapter takes; a synthetic backlog on the home server gets extra workers from the docker provider within the configured limits, and they drain after the down window. |
| M6. Offline sync | merge state, `lww`, `counter` and `set` merges, the `sync` module, `@keelwerk/sync-client` | Property tests show convergence for permutations of concurrent offline mutations; rejected mutations are reported, never lost. |
| M7. Collaborative fields | Loro codec protocols, presence, client-side prediction of custom offline commands | Two clients editing one rich-text field offline converge with each other and with the server. |
| Experiments (after M4) | `@keelwerk/module-experiments` (architecture.md section 20.8): experiments, metrics, exposures through `flagObservers`, tallies and fixed-horizon results | An experiment on a test app reports per-variant results with 95 % intervals, reads "inconclusive" before the planned sample size, and marks a planted sample ratio mismatch invalid. |
| Kubernetes node provider | the Kubernetes node provider (a Deployment scaled through `@kubernetes/client-node`, or desired replicas published for KEDA's Metrics API scaler or an HPA external metric; architecture.md section 21.5), a named later milestone because Jens wants one (decision 63a) | A synthetic backlog scales a Deployment within its limits, and scale-down drains (architecture.md section 21.6). |
| Further | `transport-static` for a user interface, cloud node providers, the NATS JetStream dispatch tier of the job queue (only after a measured need), Connect with its runtime-descriptor spike (decision 39a), an OpenID Connect provider module (decision 45a), `blobs-s3`, Sieve and ManageSieve, DMARC reports; `keelwerk db introspect --drizzle`, the optional import of Drizzle schemas (decision 13a); the OpenFeature provider adapter and an OpenFeature remote-evaluation route; Bayesian, CUPED and sequential analysis for experiments; the file-to-export name check moved into a Biome JavaScript plugin once a pinned Biome release ships them outside developer preview (introduced in 2.6.0 on 2026-10-21) | Each lands as a module or an adapter (architecture.md section 24). |

The Loro codec itself ships with the first app that declares a collaborative field, so the stored
form of such fields is final from that moment.

## 5. ADRs still to be written

| ADR | Decision | Due before |
|---|---|---|
| 0016 | Scope directory: claims, release quarantine, atomicity between the control store and the owning row (gap G2; decision 50a makes claims kernel effects whose records are the outbox, architecture.md section 7.9.5) | M4 |
| 0017 | The `ctx.secrets` requests and the executors' reveal: reveal, issue, verify, sealing at append (gap G4) | M3 |
| 0018 | Singleton leases with fencing epochs (gap G9); process capabilities moved to ADR 0025 | M4 |
| 0019 | Listener contract, connection sessions, port bindings and the certificate directory (gap G1) | the mail foundations (parked) |
| 0020 | Blob storage: field kind, stores, staging, keys, collection and resumable uploads (gap G5, decision 38a); deployment logs offload into it (decision 47c) | M4 |

ADRs written with addendum 3 (status `Proposed`, written 2026-10-24), and the milestone each must be
decided before:

| ADR | Decision | Due before |
|---|---|---|
| 0021 | API versioning and compatibility: dated versions, translation, `surface diff`, retirement at the sunset 12 months after deprecation (decision 53) | M1 |
| 0022 | Rolling upgrades: build revisions, the process registry, the N-1 rule, gated contract steps, renames through expand and contract (decision 55b) | M4, together with ADR 0018 |
| 0023 | Feature flags in the kernel, experiments as a module | M2 |
| 0024 | Project layout: one definition per file, one rule per file, a package per module, a generated manifest over a hand-written module base (decisions 58a, 59b and 60b) | the M0 preset work and the M1 module packages |

ADRs written on 2026-10-25 (status `Proposed`), and the milestone each must be decided before:

| ADR | Decision | Due before |
|---|---|---|
| 0025 | Nodes, capacity and autoscaling over fair lanes of the kernel job queue (amends ADR 0015) | M1 (the job store format), M4 (nodes and the scaler), the mail foundations (process capabilities) |
| 0026 | Pure handlers and the effect interpreter (decision 50a; amends ADR 0004, gives ADRs 0015 and 0025 their effect contract; architecture.md section 7.9) | M1 (the interpreter, decision records, the `core.effect` format), M2 (effect jobs, continuations, external performers) |
| 0027 | Encrypted personal data and queries: sealed state columns, declared capabilities (amends ADR 0009) | M1 |

ADRs 0002 to 0015 and 0021 to 0027 exist and become `Accepted` at the architecture approval
gate. On 2026-10-28 they were edited in place for the decisions taken since they were written, as
ADR 0001 allows during the architecture phase: 0006 (datastore agnosticism, 12a), 0007 (anchors,
35b), 0011 (oRPC and own operation limits, 15b and 37a), 0013 (`keelwerk call` and no reserved
module ids, 16b and 81a), 0021 (the support window, 53), 0022 (renames, 55b) and 0024 (the
generated manifest and one rule per file, 59b and 60b), with notes in the ADRs that mention the
changed forms.

## 6. Where the earlier plans went

- The reorder of 2026-10-28 (decision 48c and the parked mail server): the former M3 (Launchway) is
  M4; a new M3 rebuilds Trail first; the former M4 to M6 (mail foundations, the mail server, IMAP)
  are parked under their names; the former M7, M8 and M9 are M5, M6 and M7. Decisions recorded
  before the reorder name the old numbers: the M8 of decision 9a is M6, the M9 of 11a is M7, and the
  M7 of 12a and 69a is M5.
- The data designer's milestones map as follows: its M1 is split between M1 (storage, positions,
  tokens, keys) and M2 (consumers, retention of buffers, erasure); its M2 between M4 (retention
  rules), the mail foundations (search) and M5 (other adapters and placements); its M3 is M6 and its
  M4 is M7.
- The interfaces designer's build order (core surface, host and invocation protocol, CLI, REST,
  live, GraphQL, tRPC and webhooks, scaffolding, later interfaces) is spread over M1 to M4, with
  JMAP in the mail foundations.
- The platform gaps G1 to G16 land as listed in architecture.md section 17.7 and section 5 above.
