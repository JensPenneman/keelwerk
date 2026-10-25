# pennestack roadmap

Date: 2026-10-25 (first version 2026-10-11; addendum 3 and Jens's decisions of 2026-10-24
merged; the jobs, nodes and autoscaling design and the design of encrypted personal data merged on
2026-10-25). Status: proposal, awaiting Jens's approval together with the architecture.

This document orders the work of [architecture.md](architecture.md) into milestones, from the
repository toolchain (M0) to the first platform running (the Launchway backend ported, M3) and the
mail server for `jenspenneman.com` (M5 and M6). Every milestone delivers named packages and modules,
ends with exit criteria that a test or a demonstration can check, and leaves the repository in a
usable state. [brief.md](brief.md) remains the requirements source; nothing it asks for is dropped
here: what comes after the mail server is listed under later milestones.

## 1. Rules for the plan

- Each milestone is usable on its own: its exit criteria run in CI or on the home server, not in a
  plan.
- Stored formats are final from M1 (section 14.1 of the architecture): later milestones add tables,
  columns and protocols, never a rewrite of stored events, positions or tokens.
- An ADR exists before the milestone that first depends on its decision (ADR 0001). Section 5 lists
  the ADRs still to be written and when.
- Every milestone keeps the CI checks of architecture.md section 13.8 green and adds its own
  conformance cases; the adapter matrix grows with the adapters a milestone ships.

## 2. Gates

| Gate | Before | What |
|---|---|---|
| Architecture approval | M1 | Jens approves the architecture and the ADRs (they become `Accepted`), after the M0 spikes; the repository then becomes public on GitHub (JensPenneman/pennestack). Until then it stays private. |
| Decisions for M1 | M1 | Of the decision points in architecture.md section 26.1: 1 (app catalogue), 6 (job queue, with ADR 0025, because the job store is part of the adapter contract from M1 and its stored format is final there), 10 (before-images), 18 (protobuf tags), 19 (instants), 20 (licence, before the repository is public), 52 (dated API versions, because pins and the ledger ship in M1), 65 (equality indexes only where declared) and 66 (the default normaliser), because sealed state columns and blind indexes ship in M1; and the project-layout points of [decisions.md](decisions.md) section F: 58 (file naming), 59 (module assembly), 60 (policy granularity) and 61 (scaffold edits). Points 3 (DSL shape), 4 (handler data authority) and 5 (deny rules) were decided on 2026-10-24, and 7 (personal fields encrypted in state tables as well, ADR 0027) on 2026-10-25. |
| Decisions for M2 | M2 | 51 (flags in the core) and 53 (the 12-month support window). |
| Decisions for M3 | M3 | 23 (Launchway compatibility), 24 (edge through the agent), 25 (node ownership), 26 (separate domain for untrusted apps), 27 (ledger and control store at home), 54 (automatic finalization), 55 (renames that keep their column), 62 (the `fleet` command group), 63 (when automatic scaling ships), 71 (bounded scans) and 72 (substring defaults). |
| Decisions for M4 | M4 | 67 (server-side mail search), 68 (word matching) and 70 (the key scope of search indexes). |
| Decisions for M5 | M5 | 21 (outbound relay), 56 (the mail listeners' own container), 64 (the docker provider) and the open platform questions on DMARC rollout, account sharing and Sieve (section 26.3). |
| Decision for M6 | M6 | 22 (own IMAP listener). |
| Decision for M7 | M7 | 69 (order tokens on PostgreSQL). |
| Decision for the experiments module | after M3 | 57 (the first statistics). |

## 3. Milestones

### M0. Repository toolchain and spikes

Scope: the workspace every later package builds in, and the two spikes the review asked for before
any M1 code: the type model and the write path.

Packages and artefacts:

- Root workspace: pnpm 11 workspace, TypeScript 7.0.2 with project references and the base
  configuration of architecture.md section 13.3, Biome 2.5.15, Vitest 5.0.3 with type checking, CI
  on GitHub Actions in the private repository, branch protection that requires signed commits,
  `CONTRIBUTING.md`, release and changelog tooling.
- `@pennestack/biome-config`: the preset with the layout rules of architecture.md section 13.9
  and the GritQL plugins `named-module-types`, `as-system-reason`, `no-null-in-conditions`,
  `pure-deciders`, `error-code-format`, `no-selection-augmentation`, `one-export`,
  `no-import-effects` and `wiring-only-assembly`, with fixtures. Modules are object literals
  (decision 3 of 2026-10-24), so no plugin guards a builder chain.
- The root workspace gets `knip.json`, and CI runs knip after `biome ci`.
- Empty, building packages `@pennestack/core`, `@pennestack/data` and `@pennestack/testing`.
- `spikes/composition-types`: the checklist of architecture.md section 4.7 (the module base and
  the module literal, module-local contexts compiled with no app in scope, every field flag through
  every modifier, own references, generated actions with a typed `watch`, `defineApp` options,
  `AppActionTree` with input, output, error and event types from the field model, `Insert`,
  `Patch` and `OfflinePatch`), declaration emit under the pnpm layout, instantiation counts on
  synthetic apps of 25 and 40 modules, and `docs/api-sketch.ts` compiled as the acceptance test.
  The spike covers the base and module split: parts built with the part functions over the base in
  separate files, a module literal that mounts them and produces the same module type as the module
  written in one file, own actions invoked by value, and the instantiation cost of typing each part
  against the base. A fixture module in the canonical layout of architecture.md section 23 sits
  beside `docs/api-sketch.ts`.
- `spikes/write-path`: the per-scope commit tail, the coalescing notifier and the job store's fair
  take (take p95 against the number of lanes and the batch size, to replace the planning figure of
  2,000 jobs per second per placement; architecture.md sections 9.5.3 and 9.5.7) on a networked
  PostgreSQL 18 (testcontainers), with concurrent writers in many tenants.

Exit criteria:

1. A fresh clone runs `pnpm install`, `biome ci`, `tsc -b` and `vitest run` green in CI.
2. Every item of the type-model checklist passes on TypeScript 7.0.2; the instantiation budget for
   apps of 25 and 40 modules and the declaration-size budget per module are recorded in
   architecture.md section 13.11; no TS7056, TS2742 or TS4023 occurs.
3. `docs/api-sketch.ts` type-checks against the spike types, or every difference is recorded as a
   change to architecture.md.
4. The write-path measurement shows that writers of one tenant never wait on another tenant's
   commit tail, records the single-tenant ceiling on networked PostgreSQL, shows notifications
   leaving writer transactions untouched, and records the fair take's p95 against the number of
   lanes and the batch size.
5. The architecture approval gate is passed.

### M1. Thin vertical slice

Scope: the smallest end-to-end system: the core, the in-memory and PostgreSQL adapters (with PGlite
for development), one transport (REST), the accounts and authentication modules, and the CLI,
runnable from a fresh checkout.

Packages and modules:

- `@pennestack/core`: the DSL as object literals (`defineModuleBase`, the part functions,
  `defineModule`, `defineEntity`, the field model for the M1 kinds, `defineApp`, `defineDeployment`
  with infrastructure), compose checks with their named errors, the API surface, the invoker with
  sessions and the full pipeline, the authorization engine (rules with `where` and `check`, maskable
  fields, principal narrowing, set operations and aliases, module authority and `forCaller()`), the
  condition AST and its in-memory interpreter, the error taxonomy with `toWire`, the key service
  (master, deployment, backend and tenant keys, subject and value keys, index root keys), the
  encryption of personal fields in state tables (sealed state columns, blind indexes with
  normalisers for the `eq` family, `isNull` and uniqueness, and the kernel's encryption planner;
  architecture.md section 14.7.9), the kernel write path (repositories, `decide` and `evolve`, item
  checks, invariants, receipts with the pending row), inline reactions and module service
  principals, the `core` module (backends, tenants, domains, placements, namespaces, command
  receipts, operator tokens, `core.introspect`, `core.me`, `core.capabilities`), and the `wire` and
  `ledger` subpaths.
- API versions in the core: `Pennestack-Version` resolution and pins per backend, tenant and
  credential, `defineApiVersions` with a first version, the ledger, and `pennestack surface diff`
  as CI step 9 (architecture.md sections 18.2, 18.3 and 18.6). The stored formats that must be
  final from M1 are written from the start: `writer` and `flags` in `ps_events.meta`, `build`,
  `revision` and `apiVersion` on jobs, `apiVersion` on receipts.
- `@pennestack/data`: the Kysely SQL family, the migration planner with tracks and snapshots, the
  in-memory adapter, PGlite wiring and the adapter conformance kit.
- `@pennestack/adapter-postgres`: shared-tables placements with forced row-level security, the event
  log with per-scope positions, the notifier, partial unique indexes, the job store tables in their
  final stored format (`ps_jobs` with the `scheduled` state, lanes with split lane counters, groups
  and `ps_job_history`; architecture.md section 9.5.2).
- `@pennestack/transport-http` (the host, the invocation protocol, the operator socket, cookies and
  origin checks) and `@pennestack/transport-rest` (REST, OpenAPI 3.1, problem details).
- `@pennestack/client` and `@pennestack/cli` (`init`, `dev` with PGlite, `generate`, `db plan`,
  `db generate`, `db apply`, `db status`, `db check`, `introspect`, `surface diff`, `surface
  version new`, `backend`, `tenant`, action commands, `login`, `operator token`, `doctor`). The CLI
  gains `pennestack new module|entity|action|flag` and the other kinds with assembly-file
  insertion, and the layout pass of `pennestack doctor`, run by `pennestack build`, CI and
  `pennestack dev`; `pennestack init` creates the canonical layout (architecture.md section 23).
- `@pennestack/module-accounts` and `@pennestack/module-auth` as specified in architecture.md
  section 17.2, written in the module layout of section 23, with passwords, opaque session tokens, expiry and rotation, re-authentication,
  password resets and rate limits on the shared token buckets of the quota model (passkeys follow in
  M3; until the reaction dispatcher of M2 exists, `auth` sets `lastLoginAt` inline at login).
- `@pennestack/testing`: the harness, the local client, policy matchers, the adapter and transport
  conformance suites (REST and the invocation protocol), dual evaluation (with the unsealing oracle
  for personal fields) and the adversarial isolation suite.
- `examples/portal`: an app of `accounts`, `auth` and `rest` in the canonical layout, the
  end-to-end fixture.

Exit criteria:

1. From a fresh clone, `pennestack dev` starts the portal example on PGlite with no database
   installed, and the generated file, migrations and OpenAPI document are written and pass
   `pennestack generate --check`.
2. Over the operator socket, the CLI creates a backend and a tenant at runtime, without a restart.
3. A user registers and logs in over REST, with a `__Host-` cookie and with a bearer token; a stale
   cookie does not lock the login page; `pennestack login` stores a token and an action command
   runs against the running deployment.
4. The same scenario passes in CI against PostgreSQL 18 (testcontainers) and on the in-memory
   adapter; the adversarial isolation suite passes for two tenants on both, including backend-scope
   units refused on tenant entities.
5. The adapter conformance suite (codecs, conditions, pagination, units, isolation, event store,
   serials, migrations, toggle-then-rebuild) and the transport conformance suite pass.
6. A dump of the test database contains no former password hash, no plaintext secret and no
   plaintext personal value.
7. Type tests, declaration-emit checks and instantiation budgets pass in CI.

### M2. Execution and live updates

Scope: queued work, reactions and live updates on everything, the other two transports the brief
names, and the shared modules both platforms need next.

Packages and modules:

- The kernel job queue over the job store on PostgreSQL, PGlite and the in-memory adapter
  (ADRs 0015 and 0025): asynchronous commands, durable timers, schedules, the reaction dispatcher
  with keyed jobs and process managers, fair lanes with caps and weights, the queued cap with
  backpressure, groups with rates, priority classes, leases with (worker, attempt) fencing, dead
  letters and `pennestack jobs` (with `stats`, `lanes`, `explain`, `pause` and `resume`). Effect
  jobs land together with the decision 50a pass (ADR 0026).
- `@pennestack/events`: consumers with per-scope checkpoints and parking, the retention worker for
  operational buffers, erasure (`core.subjects.erase`) with ledger sinks and restore detection at
  `connect`.
- `@pennestack/live`: the hub, SSE and WebSocket carriers, the `watch` generator, pokes, stream
  tickets, revalidation on revocation events, streams and topics (`defineStream`, `defineTopic`,
  gap G6), and the `broadcast` capability on PostgreSQL.
- `@pennestack/transport-graphql` and `@pennestack/transport-trpc`.
- `@pennestack/module-api-keys` (scopes and transports, gap G13), `@pennestack/module-members`
  (roles and invitations), `@pennestack/module-audit` (`observes: 'all'`, gap G12).
- Core additions: extension-point cardinality (G14), tenant-editable configuration (G10), the quota
  model of architecture.md section 12.2.
- Version changes (architecture.md section 18.2): `defineVersionChange` with `translate`,
  fixtures and per-version projections; deprecation headers and `core.apiUsage`.
- Flags in the core (architecture.md section 20): `defineFlag`, `ctx.flags`, the `flagProviders`
  chain, `core.flag` targeting, gates, `core.suspension`, the stale report and `pennestack flags`.

Exit criteria:

1. A subscription resumes after a process restart from its stream token with no gap and no
   duplicate beyond at-least-once; a revoked session ends a live connection within a second.
2. In a test with two tenants, a reaction that fails and retries with backoff for one tenant never
   delays the other tenant's reactions.
3. The queue scenarios (keys, coalescing, FIFO under concurrency, groups, retries, heartbeats,
   dead letters, schedules ticking once per scope) pass on PostgreSQL, PGlite and in-memory.
4. GraphQL and tRPC pass the transport conformance suite, including subscriptions with control
   frames.
5. An erased subject's marker values are absent from a database dump; a restore made with
   `pg_restore` is detected at `connect`, bumps the scope epochs and resets old tokens.
6. Quota tests: a tenant over its request rate gets `rate_limited` with `Retry-After`; a tenant
   over its storage quota gets `core.quota_exceeded`; the other tenant is unaffected.
7. After a breaking change with a version change, a client pinned to the older API version still
   works over REST, GraphQL, tRPC and the invocation protocol.
8. While one tenant enqueues 10,000 jobs, another tenant's job starts within one take interval, and
   no lane exceeds its cap.
9. A worker killed mid-job loses its lease, the job is requeued within 30 seconds, and no database
   effect is duplicated.

### M3. The deployment platform: Launchway's backend on pennestack

Scope: the first platform running. Launchway's control plane is rebuilt as the `launchway` app and
replaces the hand-wired API of Launchway v0.3.0 on the home server.

ADRs due before M3: the scope directory (gap G2), the `ctx.secrets` interface (gap G4), singleton
leases (ADR 0018, part of gap G9), the decision of ADR 0022 together with ADR 0018, and ADR 0025 for
nodes and the scaler (section 5).

Packages and modules:

- `@pennestack/transport-webhooks` (gap G8) with receiver verification.
- `@pennestack/module-dns`, `dns-cloudflare`, `dns-manual`; passkeys and the device authorization
  flow in `auth`; the egress service; operator-adopted retention rules with suggested defaults.
- Launchway modules as packages in `examples/launchway/modules/<id>/` (`@launchway/module-<id>`):
  `projects`, `nodes` (with the agent channel), `agent-gateway` (protocol v1), `deployments` (with
  the log stream), `domains`, `edge`, `github`, `previews`; the app gets `src/modules.ts` and
  `src/app.ts`.
- Rollouts (architecture.md section 19): the build manifest and revisions, the process registry,
  the N-1 rule, expand, data and contract steps gated by finalization (moved from M7),
  `pennestack rollout status|finalize|abort`, and blue-green on the home server.
- The home-server topology of architecture.md section 17.5.2: the pennestack container, separate
  PostgreSQL instances for the control store and the placement, the ledger volume, backups.
- Nodes and scaling (architecture.md section 21): `core.node`, named processes with slots and
  placements, the connection budget, drains on `SIGTERM`, `pennestack fleet`, and the scaler as a
  pure plan with the static provider (recommendations only).
- Encrypted queries for Launchway's admin search (architecture.md section 14.7.9): prefix and
  trigram (`contains`) indexes with verification and page filling, bounded scans, the personal-data
  pass of `pennestack doctor`, `pennestack db reindex` and `pennestack keys rotate --index`.

Exit criteria:

1. On the home server, pennestack serves `deploy.jenspenneman.com` instead of Launchway v0.3.0's
   API; the operator created the backend and the tenant over the operator socket.
2. Existing v1 agents connect unchanged and deploy a project from a GitHub release and from a push;
   a GitHub delivery repeated two days later does not deploy twice.
3. Pull-request previews open and close; the limit of 10 per project holds under concurrent opens.
4. A domain becomes active through the edge configuration applied by the agent.
5. The UI works against the generated API (REST with OpenAPI types) with live updates.
6. A node that stops sending heartbeats is marked offline by `nodes.system` after 45 seconds, and a
   process restart in between does not lose the timer.
7. A backup and restore drill on the home server restores the data without bringing back an erased
   subject, and clients resynchronise.
8. An upgrade with a field type change runs while v1 agents and the UI are connected, and no
   request, job or event is lost.
9. A blue-green switch drains the old container without losing jobs, and
   `pennestack fleet scale explain` matches the plan for a synthetic backlog.

### M4. Mail foundations

Scope: what the mail server needs from the framework before its own modules: listeners, blobs,
search, positional paging, partitions and serials, certificates and JMAP.

ADRs due before M4: the listener contract with the deployment-level certificate directory (gap G1)
and blob storage (gap G5); process capabilities are part of ADR 0025 (section 5).

Packages and modules:

- The listener contract, port bindings, connection sessions, SASL carriers and per-connection
  admission in the core.
- `@pennestack/blobs-fs`: staging, per-blob keys, range reads, the collector bounded by the backup
  retention, uploads and downloads in the transports.
- The data capabilities `search` (PostgreSQL `tsvector`, for plaintext search indexes) with
  `searchIndexes`, `positionPaging` with `countBefore`, entity partitions and `field.serial`; for
  personal fields, the keyed token index in place of `tsvector` (per-subject keys, stemming with
  `@orama/stemmers`; architecture.md section 14.7.9.9).
- Capability probes (`smtp-public`, `smtp-out`) and the unplaceable-work checks (architecture.md
  section 21.2), before the mail listeners.
- `@pennestack/transport-jmap` (session resource, method calls, result references, push).
- `@pennestack/module-certificates` (ACME DNS-01) and the certificate directory; `mail-domains` with
  scope-key claims and quarantine.

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

### M5. The mail server: receive, submit, deliver, JMAP

Scope: a mail server for `jenspenneman.com` that a person can live on with JMAP clients.

Packages and modules (packages in `examples/mail/modules/<id>/`, `@mail/module-<id>`):
`mail-store`, `smtp-in`, `smtp-submission`, `mail-delivery` (relay mode, and direct mode for tests
and later nodes), `sender-auth` (SPF, DKIM, DMARC, ARC with `mailauth`), `spam` (rspamd),
`mta-sts`, `autoconfig`; app passwords through `api-keys`; DNS records for the domain; the
mail-store declarations of personal fields and the JMAP `unsupportedFilter` and `unsupportedSort`
mapping (architecture.md sections 14.7.9.9 and 14.7.9.13); `@pennestack/provider-docker` (opt-in)
for extra workers (architecture.md section 21.5). The mail listeners run in their own container
(architecture.md section 17.5.2).

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

### M6. IMAP

Scope: the own IMAP listener for desktop and mobile clients.

Packages and modules: the `imap` listener module (IMAP4rev2 and IMAP4rev1, CONDSTORE, QRESYNC,
QUOTA, IDLE through `mail-store.mailbox.idle`) and its `SEARCH` mapping (word semantics,
`HEADER Message-ID` on the plaintext field, other `HEADER` keys by bounded scan with `NO [LIMIT]`;
architecture.md section 14.7.9.9).

Exit criteria:

1. imaptest passes the agreed profile in CI against the listener.
2. Thunderbird, Apple Mail and iOS Mail synchronise, flag, move, search and idle against the home
   server, and MODSEQ and UIDs stay consistent with JMAP states.

## 4. Later milestones

Nothing below is dropped; it follows the mail server unless Jens reorders it.

| Milestone | Scope | Exit criterion |
|---|---|---|
| M7. Data breadth | `adapter-mysql`, `adapter-sqlite`, the Supabase preset; schema-per-tenant and database-per-tenant placements; tenant move; projection entities with online rebuilds; operator redaction; `pennestack db introspect` (external, adopt, Drizzle import); the SQL escape hatch with its dialect; index tables for personal fields on MySQL and SQLite; the ORE order capability on PostgreSQL, after a spike on operator-class installation and a review of the implementation; job groups with `scope: 'deployment'`; wake-ups through the control store for per-tenant namespaces | Both proof apps pass CI on PostgreSQL, MySQL and SQLite, queues included. |
| M8. Offline sync | merge state, `lww`, `counter` and `set` merges, the `sync` module, `@pennestack/sync-client` | Property tests show convergence for permutations of concurrent offline mutations; rejected mutations are reported, never lost. |
| M9. Collaborative fields | Loro codec protocols, presence, client-side prediction of custom offline commands | Two clients editing one rich-text field offline converge with each other and with the server. |
| Experiments (after M3) | `@pennestack/module-experiments` (architecture.md section 20.8): experiments, metrics, exposures through `flagObservers`, tallies and fixed-horizon results | An experiment on a test app reports per-variant results with 95 % intervals, reads "inconclusive" before the planned sample size, and marks a planted sample ratio mismatch invalid. |
| Further | `transport-static` for a user interface, outbound webhooks, the Kubernetes node provider (or desired replicas for KEDA's Metrics API scaler) and cloud node providers, the NATS JetStream dispatch tier of the job queue (only after a measured need), Connect, an OpenID Connect provider module, `blobs-s3`, Sieve and ManageSieve, DMARC reports; the OpenFeature provider adapter and an OpenFeature remote-evaluation route; Bayesian, CUPED and sequential analysis for experiments; the file-to-export name check moved into a Biome JavaScript plugin once a pinned Biome release ships them outside developer preview (introduced in 2.6.0 on 2026-10-21) | Each lands as a module or an adapter (architecture.md section 24). |

The Loro codec itself ships with the first app that declares a collaborative field, so the stored
form of such fields is final from that moment.

## 5. ADRs still to be written

| ADR | Decision | Due before |
|---|---|---|
| 0016 | Scope directory: claims, release quarantine, atomicity between the control store and the owning row (gap G2) | M3 |
| 0017 | The `ctx.secrets` interface: reveal, seal, issue, verify (gap G4) | M3 |
| 0018 | Singleton leases with fencing epochs (gap G9); process capabilities moved to ADR 0025 | M3 |
| 0019 | Listener contract, connection sessions, port bindings and the certificate directory (gap G1) | M4 |
| 0020 | Blob storage: field kind, stores, staging, keys and collection (gap G5) | M4 |

ADRs written with addendum 3 (status `Proposed`, written 2026-10-24), and the milestone each must be
decided before:

| ADR | Decision | Due before |
|---|---|---|
| 0021 | API versioning and compatibility: dated versions, translation, `surface diff` | M1 |
| 0022 | Rolling upgrades: build revisions, the process registry, the N-1 rule, gated contract steps | M3, together with ADR 0018 |
| 0023 | Feature flags in the kernel, experiments as a module | M2 |
| 0024 | Project layout: one definition per file, a package per module, explicit assembly over a module base | the M0 preset work and the M1 module packages |

ADRs written on 2026-10-25 (status `Proposed`), and the milestone each must be decided before:

| ADR | Decision | Due before |
|---|---|---|
| 0025 | Nodes, capacity and autoscaling over fair lanes of the kernel job queue (amends ADR 0015) | M1 (the job store format), M3 (nodes and the scaler), M4 (process capabilities) |
| 0027 | Encrypted personal data and queries: sealed state columns, declared capabilities (amends ADR 0009) | M1 |

ADRs 0002 to 0015, 0021 to 0025 and 0027 exist and become `Accepted` at the architecture approval
gate; ADR 0026 (decision 50a, pure functions) follows with the pure-handlers pass.

## 6. Where the earlier plans went

- The data designer's milestones map as follows: its M1 is split between M1 (storage, positions,
  tokens, keys) and M2 (consumers, retention of buffers, erasure); its M2 between M3 (retention
  rules), M4 (search) and M7 (other adapters and placements); its M3 is M8 and its M4 is M9.
- The interfaces designer's build order (core surface, host and invocation protocol, CLI, REST,
  live, GraphQL, tRPC and webhooks, scaffolding, later interfaces) is spread over M1 to M3, with
  JMAP in M4.
- The platform gaps G1 to G16 land as listed in architecture.md section 17.7 and section 5 above.
