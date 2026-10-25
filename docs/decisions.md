# Decision register

Date: 2026-10-23 (updated 2026-10-24). Status: open. This register lists every open question of the architecture in
one place, numbered, so that Jens can answer them one by one in conversation. Each answer is
recorded here with its date and the section or ADR that applies it. The questions come from
[architecture.md](architecture.md) section 26 (decision points, spike questions, questions by
area), plus the lead's own flags and the points raised by the addendum 3 designs.

How to answer: by number and letter, for example `1a 5a 20b`. The starred option (★) is the
recommendation the specification currently assumes; a question left unanswered keeps the star.
When a question needs more context, the lead briefs it from the architecture in conversation
(the relevant sections are quoted and explained); nobody has to read the whole specification.

Status values: `open`, `decided <date>` (with the answer), `applied` (with the section or ADR).

## A. Decision points (architecture.md section 26.1)

1. **Runtime module selection.** How does a backend get its modules? a) ★ from the apps compiled
   into the deployment, with per-backend variation through module configuration and feature
   flags; b) toggled per backend at runtime, with types that cannot follow the selection.
   Status: applied (sections 4.5 and 26). Decided 2026-10-25: **a**, the compiled catalogue; condition from Jens: development always
   has the full, exact types of the app being built (section 4.5 guarantees it per app).
2. **Toggling with requirements.** A module can only be switched off together with the modules
   that `require` it. a) ★ accept; keep hard dependencies for genuine needs; b) make every
   dependency optional and type every cross-module access as possibly absent. Status: applied (sections 5.2 and 26). Decided 2026-10-25: **a**, hard dependencies stay; a module switches off together with
   its dependants.
3. **DSL shape.** a) ★ builder chain whose callbacks receive typed contexts (Hono, Elysia, Better
   Auth style); b) one object literal with a hand-written context type on every handler.
   Status: applied (decided 2026-10-24: **b**, always object literals, no builder chain).
   Consequence: a module is a manifest literal (id, dependencies, config, entities) plus a module
   literal that lists its parts; action files import the manifest and their entity, so handlers
   are typed without a chain. Applied as the module base (`defineModuleBase`), parts typed against
   it and the module literal (`defineModule(base, { ... })`) in architecture.md sections 4.1, 4.3
   to 4.5, 4.7, 5.3 to 5.6, 7.2, 7.6, 7.7, 9.5, 13.9, 17 and 23.5, ADRs 0003, 0004, 0015, 0021,
   0023 and 0024, and api-sketch.ts.
4. **Data access inside handlers.** a) ★ module authority, with an explicit `forCaller()` for
   caller-scoped reads; b) caller authority by default with typed grants per action. Status:
   applied (decided 2026-10-24: **a**, module authority with explicit `forCaller()`, plus the
   shape-stage check of every entity row leaving the invoker against the caller's plan;
   development: error; production: dropped and logged). Applied in architecture.md section 8.4
   (code `core.row_outside_plan`, section 10) and ADR 0005.
5. **Deny rules.** a) ★ allow and deny, deny requiring a reason; b) allow-only with `unless`
   conditions. Status: applied (decided 2026-10-24: **a**, allow and deny rules, deny requiring a
   reason, default deny): architecture.md section 8.2 as written, ADR 0005.
6. **Job queue.** a) ★ a kernel queue over every data adapter's job store (works on MySQL,
   SQLite, PGlite and in memory); b) pg-boss on PostgreSQL only. Status: open; researched and designed 2026-10-25 (docs/research/jobs-nodes-autoscaling.md,
   architecture sections 9.5 and 21, ADR 0025); options now: a) ★ the kernel queue over every
   adapter's job store with fair lanes, caps, leases and effect jobs; b) pg-boss 12.38.0 (PostgreSQL
   and PGlite only); c) a broker (NATS JetStream or Redis Streams) behind JobQueue with an outbox
   relay; d) a durable execution engine (Temporal, Restate, DBOS, Inngest, Trigger.dev). Briefed in
   chat on 2026-10-25.
   follows.
7. **Personal data in state tables.** a) ★ plaintext state tables with crypto-shredding of the
   chain; b) encrypted state columns with blind indexes. Status: applied (section 14.7.9, ADR 0027). Decided 2026-10-25: **b**, personal fields encrypted in the state tables as well (blind
   indexes and whatever else the research finds), with a research mandate from Jens: an agent
   investigates searching, filtering, ordering, uniqueness and full-text search over encrypted
   personal data (mail search included) and designs the operator support matrix. Designed 2026-10-25:
   docs/research/encrypted-queries.md, architecture section 14.7.9, ADR 0027; its
   decision points are questions 65 to 72.
8. **Operational buffer defaults** (transient change records 7 days, receipts 24 hours, inactive
   sync clients 90 days, without an adopted rule). a) ★ accept; b) the operator must adopt even
   these. Status: applied (decided 2026-10-24: **a** for the three buffers). Jens's underlying
   requirement: point-in-time recovery far back, with configurable retention of the change
   history. Already covered by the chain (every change is an event with the changed fields and
   their before-images; history is kept forever until a `compactHistory` rule per entity or module
   folds events older than a configurable horizon into a snapshot). Addition: `asOf` on the
   generated `get` and `history` reads of chain entities, so a row can be read as it was at a
   moment in time. Receipts stay idempotency bookkeeping (24 hours); the event already records the
   command id, actor and causation. Applied in architecture.md sections 6.7, 14.7.1 (an `asOf`
   before the compaction horizon is `not_found`, `core.history_compacted`) and 14.8.1.
9. **Offline multi-actor sync timing.** a) ★ M8, after the mail server; b) earlier. Status: open.
10. **Before-images** in every event from M1. a) ★ yes; b) no. Status: open.
11. **Collaborative fields.** a) ★ Loro documents from the first app that declares one; b) plain
    values until M9, then migrate. Status: open.
12. **MySQL.** a) ★ keep it (M7) and recommend PostgreSQL for multi-tenant production; b) drop it.
    Status: open.
13. **Drizzle.** a) ★ wait for Drizzle 1.0 and import existing schemas with
    `pennestack db introspect --drizzle`; b) build a Drizzle-based adapter now on 0.45.
    Status: open.
14. **External tables.** a) ★ introspected entity definitions with drift checks; b) declaration
    files generated from live introspection. Status: open.
15. **oRPC beside tRPC.** a) ★ defer; b) include in the first release. Status: open.
16. **CLI namespace.** a) ★ action commands at the top level with 34 reserved names (`fleet` included) (29 plus
    `flags`, `new`, `rollout` and `surface` from addendum 3); b) under a verb (`pennestack run
    <module> ...`). Status: open.
17. **Operator impersonation** (`pennestack explain --as <principal>`). a) ★ evaluate everywhere,
    execute only in development; b) also execute in production, logged. Status: open.
18. **Protobuf field tags.** a) ★ allocate from day one; b) when the Connect transport arrives.
    Status: open.
19. **Instants.** a) ★ `Date` now behind `field.instant()`, `Temporal.Instant` once Node 26 is
    the baseline; b) Temporal with a polyfill from the start. Status: open.
20. **Licence.** a) ★ Apache-2.0; b) MIT. Due before the repository becomes public. Status: open.
21. **Outbound mail from the home connection.** a) ★ relay through an external host first (direct
    delivery is built anyway); b) a second pennestack process with the `smtp-out`
    capability on a host with a clean address; c) direct delivery from home. Status: open.
22. **IMAP.** a) ★ an own IMAP listener after JMAP (M6); b) JMAP only; c) an external IMAP server
    with its own storage. Status: open.
23. **Launchway compatibility.** a) ★ a compatibility transport for agent protocol v1 plus the
    generated API for the UI; b) keep the `/api/v1` paths through hints; c) a clean break.
    Status: open.
24. **Edge configuration.** a) ★ through the edge node's agent; b) a shared admin socket with a
    process on the edge host. Status: open.
25. **Node ownership.** a) ★ tenant-owned nodes in the first release; b) operator-run shared
    pools (needs container isolation on shared Docker hosts). Status: open.
26. **A separate domain for untrusted apps and previews.** a) ★ a separate registrable domain;
    b) subdomains of jenspenneman.com with cookie hardening only. Status: open.
27. **Ledger and control store at home.** a) ★ two PostgreSQL instances plus the ledger file;
    b) one instance plus the ledger file. Status: open.

## B. Lead's own flags (not in section 26)

28. **Toolchain baseline.** a) ★ TypeScript 7.0 and Node 24 type stripping (no decorators, no
    enums, `.ts` import extensions, no build step for sources); b) TypeScript 5.9/6 with a build
    step and no syntax restrictions. Status: open.
29. **History default.** a) ★ `history: 'chain'` for every entity, opt-out with a reason;
    b) `history: 'state'` by default, opt-in per entity. Status: open.
30. **SQL family.** a) ★ Kysely underneath the SQL adapters; b) Drizzle underneath (overlaps
    with 13). Status: open.

## C. Spike questions (section 26.2; answers optional, the M0 spike decides the rest)

31. **Composition error form.** a) ★ the `Check` property form (missing property with a literal
    type); b) a rest-parameter form, if it reads better in the editor. Status: open.
32. **Optional modules in `ctx.data`.** a) ★ `| undefined`; b) a `Maybe` object with
    `.ifPresent()`. Status: open.

The other spike items (instantiation and declaration-size budgets, the write-path measurement)
are measurements, not choices.

## D. Questions by area (section 26.3)

Data:

33. **Mail partitions and search.** Which mail entities declare `partition: 'accountId'` beyond
    `email` and `mailboxEntry`; must mail search work on SQLite (fts5) or only on PostgreSQL?
    a) ★ PostgreSQL only for mail search; partitions decided per entity in M4. Status: open.
34. **Clock-skew bound for offline clients.** a) ★ 5 minutes; b) another value. Status: open.
35. **Hash-chain anchoring.** Anchor chain heads outside the database later? a) ★ not in the
    first releases; revisit with the audit module. Status: open.

Interfaces:

36. **GraphQL for operator work.** a) ★ operator work stays on the invocation protocol and the
    CLI; b) also an operator GraphQL schema at the operator endpoint. Status: open.
37. **GraphQL operation limits.** a) ★ own validation rules; b) depend on graphql-armor (last
    published 2025-12-29). Status: open.
38. **Blob uploads.** a) ★ resumable uploads plus JMAP's upload endpoint, designed with ADR 0020
    (M4); b) multipart only. Status: open.
39. **Connect transport.** When is the runtime-descriptor spike scheduled? a) ★ after M6, with
    the Connect transport; b) earlier. Status: open.

Platforms:

40. **ACME client.** a) ★ a small own client on `node:crypto` and `fetch` (RFC 8555 DNS-01 only);
    b) `acme-client` 5.4.0 (no commit since 2024-07-17); c) the `@certd/acme-client` fork.
    Status: open.
41. **Home connection probes.** Are inbound 25, 465, 587 and 993 and outbound 25 open, and does
    Docker Desktop keep client source addresses? a) ★ the lead probes from LVJ before M4;
    b) Jens knows the provider's policy. Status: open.
42. **Shared mailboxes.** a) ★ one owner per mail account in the first release; b) account
    sharing (RFC 9670) from the start. Status: open.
43. **Sieve.** a) ★ only the JMAP vacation response in the first release; b) Sieve and
    ManageSieve from the start. Status: open.
44. **Webmail before a UI exists.** a) ★ a third-party JMAP web client is acceptable; b) no
    webmail until pennestack has its own UI. Status: open.
45. **One login for Launchway and mail.** a) ★ separate realms per tenant first, an OpenID
    Connect provider module later; b) the provider module from the start. Status: open.
46. **DMARC rollout.** a) ★ `p=none` with reports, then `quarantine`, then `reject` after a clean
    month; b) `reject` from the start. Status: open.
47. **Retention defaults.** 30 days for Trash, Junk and archived mail, 30 days for deployment
    logs, 7 days for closed previews, 90 days for delivery attempts. a) ★ accept; b) other
    values. Status: open.
48. **Where Launchway's modules live.** a) ★ `examples/launchway` in this repository until the
    framework is public, then the Launchway repository; b) the Launchway repository from the
    start. Status: open.
49. **Outbound webhooks.** a) ★ part of Launchway's first pennestack release (M3); b) later.
    Status: open.

## E. Addendum 4 (2026-10-24): pure functions

50. **How strict is "pure"?** a) strict functional core: handlers never perform effects; commands
    declare or yield what to load and return events plus effect descriptions, queries return a
    query description, only the kernel, adapters, transports and listeners are imperative;
    b) pragmatic: handlers receive a context parameter and call its capabilities (data, invoke,
    egress) directly, with no globals, no module-level state, no ambient context and no
    environment reads outside the deployment file, enforced by lint; c) ★ split: a) for everything
    that decides (commands, reactions, process managers, policies, flag rules, version transforms,
    merge rules), b) for queries, services wrapping external systems, adapters, transports and
    listeners, with b)'s bans everywhere. Status: applied (section 7.9, ADR 0026, api-sketch.ts; questions 73 to 80 hold its open choices). Decided 2026-10-25: **a**, fully strict, c) kept as the fallback if a) becomes a burden in
    practice. Jens's motivation: trace every cause and effect, and rebuild the database and a full
    logbook from them. Consequences to design (next agent pass): handlers never perform effects;
    commands yield load requests and return events plus effect descriptions; queries return query
    descriptions; effects are executed by the kernel and recorded with their outcome, linked to the
    event and command that caused them; imperative code exists only in the kernel, adapters,
    transports, listeners and declared effect executors. To apply: sections 4.3, 7.3, 7.6, 8.4, 9.2,
    the layout section, api-sketch.ts, ADR 0004; new ADR 0026.

## F. Addendum 3 (2026-10-23): versioning, rollouts, flags and project layout

The designs landed on 2026-10-24 as architecture.md sections 18 to 20 and 23 (ADRs 0021 to 0024);
section 26.1 lists the same points under the same numbers. The jobs, nodes and autoscaling design
(section 21) is still in progress.

Versioning, rollouts and flags:

51. **Where flags live.** Where do feature flags live? a) ★ framework core: `defineFlag`, typed
    `ctx.flags`, gates and provenance, with experiments as an optional module
    (`@pennestack/module-experiments`), because flags are needed in rules, `admit`, transports,
    jobs and the kernel's own rollouts, and only the core reaches all of them; b) a flags module
    that other modules require or list as optional; c) only in the apps built on the framework.
    Status: open.
52. **API version naming.** How are app API versions named and served? a) ★ dated versions pinned
    per request, credential, tenant and backend, served from one head by version-change
    transforms; integer majors only for wire protocols; b) integer majors per app (v1, v2) in a
    header, each major a separate surface; c) no versions: continuous evolution with deprecation
    only. Status: open.
53. **Support window.** How long must an API version stay supported? a) ★ at least 12 months after
    a newer one exists, then retirement only after its sunset and 30 days of zero use (or a logged
    `--force`); for a personal deployment the usage counters matter more than the calendar; b) 24
    months, as GitHub promises; c) until usage reaches zero, however long that takes. Status: open.
54. **Automatic finalization.** Is finalization of a rollout automatic? a) ★ automatic once every
    live process has run the target revision for a 600-second grace period, with a manual mode per
    deployment; contract steps stay manual because they destroy data; b) always manual
    (`pennestack rollout finalize`). Status: open.
55. **Field renames in production.** How are field renames handled in production? a) ★ keep the
    physical column recorded in the snapshot (a logical rename, no DDL); type changes and splits
    use the gated add, dual write, backfill and contract procedure; b) rename the column through
    add, dual write, backfill and drop. Status: open.
56. **Mail listeners during upgrades.** How do the mail listeners survive upgrades on the home
    server? a) ★ their own container (a named process of gap G9), replaced by stop and start in
    seconds: SMTP senders retry and IMAP clients reconnect, and the HTTP container rolls blue-green
    behind Caddy; b) a TCP proxy in front that drains connections (no drops, one more component);
    c) keep them in the single pennestack container and accept a restart. Status: open.
57. **Experiment statistics.** Which statistics does the first experiments module offer? a) ★
    fixed-horizon frequentist tests (two-proportion z-test, Welch's t-test, 95 % intervals) with a
    planned-size gate and a sample-ratio check; Bayesian, CUPED and sequential tests later, each
    with its own validation; b) Bayesian analysis from the start; c) sequential testing from the
    start; d) no analysis: export counts only. Status: open.

Project layout:

58. **File naming.** What case do file and directory names use, given that every file is named
    after its export? a) ★ kebab-case derived from the export by `kebab()` of architecture.md
    section 16.4.1 (`changePassword` -> `change-password.ts`): it matches module ids, CLI routes
    and REST paths and is safe on case-insensitive file systems; the file-to-export check runs in
    `pennestack doctor`'s layout pass until a Biome JavaScript plugin can do it in the editor;
    b) the identifier's own case (`changePassword.ts`), which Biome 2.5.15 checks in the editor
    with `useFilenamingConvention` `filenameCases: ["export"]`; paths then mix kebab module
    directories with camelCase files, and case-only renames can slip past git on macOS and
    Windows. Status: open.
59. **Module assembly.** How do a module's part files become the module value? a) ★ explicit:
    `base.ts` holds the module base and parts are typed against it through the part functions
    (`defineCommand(base, ...)` and the others); `module.ts` imports every part and mounts it in the
    module literal; scaffolds insert the import and the entry; no generator sits in the type path,
    and the API name is set in code; b) generated: `pennestack generate` writes
    `module.generated.ts` from the directory conventions, and `generate --check` catches drift in
    CI; nothing needs registering by hand, but the types are stale until the generator runs and a
    file's path decides its action reference. Status: open.
60. **Policy granularity.** How are authorization rules split into files? a) ★ one policy file per
    entity or module-level action (`policies/<target>.ts` exporting `<target>Policy`), holding all
    rules for that target so allows and denies are reviewed together; b) one rule per file
    (`policies/<entity>/<rule-id>.ts`), so the file name equals the rule id; many small files, and
    name clashes in `module.ts` need aliases. Status: open.
61. **Scaffold edits.** May scaffolds edit TypeScript sources? Section 16.9.8 used to say they never
    do. a) ★ narrow edits of assembly files only: scaffolds insert one import and one entry into
    the matching key of one assembly file (`base.ts`, `module.ts`, `app.ts` or `modules.ts`),
    refuse any file not in the canonical shape and print the lines instead, and offer `--dry-run`;
    b) keep the earlier rule: scaffolds only print the two lines for the author to paste.
    Status: open.

## G. Jobs, nodes and autoscaling (designed 2026-10-25; decision 6 above is the main choice)

62. **Fleet command name.** Launchway already has a module `nodes`, so the framework's command group
    for nodes, processes and scaling needs another name. a) ★ `pennestack fleet` (list, show, watch,
    cordon, uncordon, drain, probe, forget, scale ...), one more reserved name (34); b) `pennestack
    nodes` and rename Launchway's module; c) `pennestack x nodes` until the next major. Status: open.
63. **When automatic scaling ships.** a) ★ M3: the scaler as a pure plan with the static provider
    (recommendations in `pennestack fleet scale status`); M5: the opt-in docker provider for extra
    workers; b) the docker provider already in M3; c) recommendations only until a Kubernetes or
    cloud provider exists. Status: open.
64. **Docker provider on the home server.** The Docker engine is root on that host. a) ★ opt-in per
    deployment, held only by the scaler's named process, through a socket proxy limited to container
    create, start, stop, inspect and list; b) never: extra workers are started by hand; c) on by
    default. Status: open.

## H. Encrypted personal data and queries (designed 2026-10-25, decision 7b)

65. **Equality index by default?** When does a personal field get its blind index? a) ★ only where a
    lookup is declared (`.unique()`, `.index()`, an entity index or `queries: ['eq']`); other
    personal fields support `isNull` only; b) every scalar personal field gets one, opt-out with
    `queries: []`. Status: open.
66. **Default normaliser for personal strings.** a) ★ NFC (composed and decomposed accents compare
    equal); e-mail fields declare `normalize: 'email'`, which makes uniqueness case-insensitive;
    b) exact code points; c) caseless by default. Status: open.
67. **Server-side mail search over personal text.** a) ★ a per-account keyed token index over
    subject, addresses and bodies (`search: 'full'`, switchable to `'headers'` or `'off'` per
    backend); b) headers only, bodies by bounded scans; c) no server-side search until pennestack
    has its own client. Status: open.
68. **Mail search matching.** a) ★ word and stem matching for JMAP and IMAP (a documented deviation
    from IMAP's substring rule); b) exact substring through scans, only for mailboxes within the
    scan limit. Status: open.
69. **Ordering and ranges on personal fields.** a) ★ bounded scans only until M7, then
    order-revealing encryption tokens on PostgreSQL as an opt-in with a doctor warning; b) never,
    bounded scans only; c) an order-preserving encoding on every adapter now (more leakage).
    Status: open.
70. **Key scope of search indexes.** a) ★ per data subject (the mailbox owner): tags of different
    accounts never match, erasure destroys the key; b) per tenant: operator search across accounts,
    but tags link words across accounts. Status: open.
71. **Bounded scans (unseal and evaluate in memory).** a) ★ custom queries only, with an explicit
    limit (default 2,000; adapter maximum, proposed 10,000 on PostgreSQL); b) also generated queries
    over transports, with a per-entity limit; c) nowhere. Status: open.
72. **Substring search defaults.** a) ★ trigram tags truncated to 12 bits, operands of at least 3
    characters, only fields with `maxLength` of at most 1,024; b) 16-bit tags (fewer false matches,
    sharper statistics for a thief); c) no `contains` on personal fields, word search only.
    Status: open.

## I. Pure handlers and the effect interpreter (designed 2026-10-25, decision 50a)

73. **How a handler gets its data.** a) ★ generators: `decide`, `read` and `react` yield typed
    requests with `yield*`; dependent loads compose by delegation; plain functions stay allowed
    for handlers that need nothing; `ctx.all` batches parallel loads; b) declared loads: a
    `load(input, ctx)` member returns named load descriptions answered before `decide`, which
    becomes a plain function of (input, loaded, ctx), with a second stage for dependent loads;
    c) both, declared loads as the common form and generators only for dependent loads.
    Status: open.
74. **Inline effects in `prepare`.** May a sync command call outside and wait for the answer?
    a) ★ yes, restricted: only in `prepare` of sync commands, only executors marked `inline` that
    need no capability, at most 30 seconds, no retries, recorded before and after (needed by OAuth
    and OpenID Connect logins, GitHub's manifest conversion, "test SMTP connection"); b) no, every
    effect is deferred and interactive flows become two steps. Status: open.
75. **Who retries outside calls.** a) ★ the rule: executor retries only for failures without
    domain meaning (lost lease, refused connection, 429 or 5xx honouring the idempotency key);
    everything with domain meaning, mail delivery included, is a state machine with timers and one
    effect per attempt; b) executor retries for everything, mail included; c) no executor retries
    at all. Status: open.
76. **Logging inside pure handlers.** a) ★ `ctx.log` and `ctx.trace` stay write-only capabilities
    (return nothing, cannot influence a result, not part of the logbook); b) logs as returned or
    yielded values; c) no logging in handlers, the kernel logs decisions and effects itself.
    Status: open.
77. **Clock, ids and randomness.** a) ★ the clock is the invocation's fixed time (equal to the
    events' `recordedAt`); ids and random values are yielded requests recorded in the decision
    record; b) all three recorded requests, each `now()` a fresh reading; c) all three derived from
    a recorded per-invocation seed (Restate's approach). Status: open.
78. **Where effect records live.** a) ★ in the chain: one `core.effect` stream per effect
    (requested, settled), positioned and hashed with the scope's other events, attempts as stream
    records kept 90 days; b) a separate `ps_effects` table per namespace with its own retention,
    not hashed. Status: open.
79. **Command inputs in the logbook.** a) digest only (the receipt's fingerprint); b) ★ digest by
    default plus sealed inputs for actions that opt in (`trace: { input: 'sealed', retention }`),
    personal fields under the subject's key; c) sealed inputs for every command. Status: open.
80. **Launchway's agents under the strict model.** a) ★ commands to agents are effects with an
    external performer: the agent pulls pending `agentCommand` effects over `nodes.channel` and
    settles them through `nodes.ack`, with a deadline and a continuation; b) keep the
    `nodes.command` rows and `nodes.command.ack` of section 17.3.4 as module data. Status: open.

## J. Editorial items from the merge passes (2026-10-25, for the lead and Jens)

- New names introduced by the final editor to make the strict sketches concrete, to confirm or
  rename: `ReadContext`, `SourceContext`, `KernelInvocationContext`, `TargetLoads`, `TargetRowOf`,
  `PrepareHandler`, `ExecutorSecrets`, `LiveSource`, `PendingEffect`, `EffectOptions`,
  `ctx.flagDetails`, `nodes.ack`, `settle({ effect, id, where }, outcome)`, the REST header
  `Pennestack-Effects`, the GitHub effects `mirrorStatus`, `listReleases`, `convertManifest`, the
  relay probe shapes, the lib helper `combine`.
- Section 14.3.8 still lists scoping rules for update, delete and insert although the SQL escape
  hatch is read-only under 50a; kept as defence in depth, may be cut.
- Appendix A.7 licences are not re-checked; Kysely stays pinned at 0.29.6 (0.29.7 exists).
- Question 80 gates M2 (external performers ship in M2), not M3.
