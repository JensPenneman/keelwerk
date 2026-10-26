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
   SQLite, PGlite and in memory); b) pg-boss on PostgreSQL only. Status: decided 2026-10-26: **a**, the kernel queue over every adapter's job store (as section 9.5
   and ADR 0025 specify); applied.
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
9. **Offline multi-actor sync timing.** a) ★ M8, after the mail server; b) earlier. Status: decided 2026-10-26: **a**, M8 after the mail server (Jens delegated the pick to the lead);
   applied (roadmap).
10. **Before-images** in every event from M1. a) ★ yes; b) no. Status: decided 2026-10-26: **a**, before-images from M1; applied (section 15.1).
11. **Collaborative fields.** a) ★ Loro documents from the first app that declares one; b) plain
    values until M9, then migrate. Status: decided 2026-10-26: **a**, Loro documents from the first declaring app; applied
    (section 15.3).
12. **MySQL.** a) ★ keep it (M7) and recommend PostgreSQL for multi-tenant production; b) drop it.
    Status: decided 2026-10-26: **a**, keep MySQL, with a sharpened rule (brief addendum 5): the
    framework is datastore-agnostic; a datastore's features never influence application code or
    whether an app can run; every adapter capability has a kernel fallback with a visible cost
    (doctor reports the fallbacks in use); `connect` refuses only a declared raw-SQL dialect mismatch.
    To apply: sections 14.3.3 (capabilities become accelerations with fallbacks), 14.3.8 (the SQL
    hatch declares its dialect and non-portability), 12, 26; ADR 0006. See section K.
13. **Drizzle.** a) ★ wait for Drizzle 1.0 and import existing schemas with
    `pennestack db introspect --drizzle`; b) build a Drizzle-based adapter now on 0.45.
    Status: decided 2026-10-26: **a**, and lowered: Drizzle was a passing thought, not a requirement;
    no Drizzle-backed adapter, and the schema import stays an optional later convenience (roadmap M7
    'Later'). The brief's mention of Drizzle is read as "any ORM-defined schema can be imported", not
    as a required integration. To apply: section 14.3.7, roadmap M7; see section K.
14. **External tables.** a) ★ introspected entity definitions with drift checks; b) declaration
    files generated from live introspection. Status: decided 2026-10-26: **a**, introspected entity definitions with drift checks; applied
    (section 14.8.4).
15. **oRPC beside tRPC.** a) ★ defer; b) include in the first release. Status: decided 2026-10-26: **b**, include oRPC in the first release (Jens is curious about its
    implementation and quality despite its age). To apply: section 16 (an oRPC transport subsection
    beside tRPC, same conformance suite), ADR 0011 (reverse 'oRPC deferred'), section 22 package
    list (`transport-orpc` already listed), roadmap M2; see section K.
16. **CLI namespace.** a) ★ action commands at the top level with 34 reserved names (`fleet` included) (29 plus
    `flags`, `new`, `rollout` and `surface` from addendum 3); b) under a verb (`pennestack run
    <module> ...`). Status: decided 2026-10-26: **b**, action commands under a verb; no name is ever reserved because of
    an integration, plugin or module. Verb to confirm (question 81). To apply: sections 16.9.3
    (no reserved module ids), 16.9.7, 23 (scaffold docs), ADR 0013; question 62 becomes pure naming;
    see section K.
17. **Operator impersonation** (`pennestack explain --as <principal>`). a) ★ evaluate everywhere,
    execute only in development; b) also execute in production, logged. Status: decided 2026-10-26: **a**, evaluate everywhere, execute only in development; applied
    (section 16.9).
18. **Protobuf field tags.** a) ★ allocate from day one; b) when the Connect transport arrives.
    Status: decided 2026-10-26: **a**, tags allocated from day one; applied (sections 4.2, 6.2).
19. **Instants.** a) ★ `Date` now behind `field.instant()`, `Temporal.Instant` once Node 26 is
    the baseline; b) Temporal with a polyfill from the start. Status: decided 2026-10-26: **b**, Temporal from the start with a polyfill until Node 26 is the
    baseline. To apply: sections 4.2 (`field.instant()` is `Temporal.Instant`, `field.date()` a
    `Temporal.PlainDate`, `field.timeZone()`), 6.4, 7.9 (the fixed clock is a Temporal.Instant), 13.2
    (polyfill package and version, verified), Appendix A; see section K.
20. **Licence.** a) ★ Apache-2.0; b) MIT. Due before the repository becomes public. Status: open; researched 2026-10-26 by a Fable agent at maximum effort (docs/research/licensing.md,
    3,383 words, primary sources). Options now (replacing a/b): a) ★ FSL-1.1-ALv2 (source-available,
    non-compete, each version becomes Apache-2.0 after two years); b) BUSL-1.1 (production use allowed
    unless competitive with Jens's products, four years, then MPL-2.0); c) AGPL-3.0-only plus a
    commercial licence sold by Jens; d) Apache-2.0 open core. Honest limit: no licence protects the
    idea; keep docs/architecture.md private until code exists. Briefed in chat 2026-10-26.
21. **Outbound mail from the home connection.** a) ★ relay through an external host first (direct
    delivery is built anyway); b) a second pennestack process with the `smtp-out`
    capability on a host with a clean address; c) direct delivery from home. Status: parked 2026-10-26: Jens defers the mail server until he has a stable, permanent deployment
    option; the design stays in the architecture, the decision waits.
22. **IMAP.** a) ★ an own IMAP listener after JMAP (M6); b) JMAP only; c) an external IMAP server
    with its own storage. Status: parked 2026-10-26: Jens defers the mail server until he has a stable, permanent deployment
    option; the design stays in the architecture, the decision waits.
23. **Launchway compatibility.** a) ★ a compatibility transport for agent protocol v1 plus the
    generated API for the UI; b) keep the `/api/v1` paths through hints; c) a clean break.
    Status: decided 2026-10-26: **c**, a clean break at M3: new agent protocol (the agent as external
    performer, 80a) and new UI ship together; no v1 compatibility transport, no legacy paths. To apply:
    sections 17.3.4, 17.5, 18 (protocol majors start at the new protocol), roadmap M3 exit criteria
    (agents are redeployed, not kept); see section K.
24. **Edge configuration.** a) ★ through the edge node's agent; b) a shared admin socket with a
    process on the edge host. Status: decided 2026-10-26: **a**, through the edge node's agent (an effect performed by the agent);
    applied (section 17.3.7), with the provider contract of 82a.
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
    with 13). Status: decided 2026-10-26: **a**, Kysely as internal plumbing of the SQL adapters, never visible to
    app code; applied (section 14.3).
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
    a) ★ PostgreSQL only for mail search; partitions decided per entity in M4. Status: parked 2026-10-26: Jens defers the mail server until he has a stable, permanent deployment
    option; the design stays in the architecture, the decision waits.
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
    Status: parked 2026-10-26: Jens defers the mail server until he has a stable, permanent deployment
    option; the design stays in the architecture, the decision waits.
41. **Home connection probes.** Are inbound 25, 465, 587 and 993 and outbound 25 open, and does
    Docker Desktop keep client source addresses? a) ★ the lead probes from LVJ before M4;
    b) Jens knows the provider's policy. Status: parked 2026-10-26: Jens defers the mail server until he has a stable, permanent deployment
    option; the design stays in the architecture, the decision waits.
42. **Shared mailboxes.** a) ★ one owner per mail account in the first release; b) account
    sharing (RFC 9670) from the start. Status: parked 2026-10-26: Jens defers the mail server until he has a stable, permanent deployment
    option; the design stays in the architecture, the decision waits.
43. **Sieve.** a) ★ only the JMAP vacation response in the first release; b) Sieve and
    ManageSieve from the start. Status: parked 2026-10-26: Jens defers the mail server until he has a stable, permanent deployment
    option; the design stays in the architecture, the decision waits.
44. **Webmail before a UI exists.** a) ★ a third-party JMAP web client is acceptable; b) no
    webmail until pennestack has its own UI. Status: parked 2026-10-26: Jens defers the mail server until he has a stable, permanent deployment
    option; the design stays in the architecture, the decision waits.
45. **One login for Launchway and mail.** a) ★ separate realms per tenant first, an OpenID
    Connect provider module later; b) the provider module from the start. Status: open.
46. **DMARC rollout.** a) ★ `p=none` with reports, then `quarantine`, then `reject` after a clean
    month; b) `reject` from the start. Status: parked 2026-10-26: Jens defers the mail server until he has a stable, permanent deployment
    option; the design stays in the architecture, the decision waits.
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
    c) keep them in the single pennestack container and accept a restart. Status: parked 2026-10-26: Jens defers the mail server until he has a stable, permanent deployment
    option; the design stays in the architecture, the decision waits.
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
    has its own client. Status: parked 2026-10-26: Jens defers the mail server until he has a stable, permanent deployment
    option; the design stays in the architecture, the decision waits.
68. **Mail search matching.** a) ★ word and stem matching for JMAP and IMAP (a documented deviation
    from IMAP's substring rule); b) exact substring through scans, only for mailboxes within the
    scan limit. Status: parked 2026-10-26: Jens defers the mail server until he has a stable, permanent deployment
    option; the design stays in the architecture, the decision waits.
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

## I2. Follow-ups of decisions (2026-10-26)

81. **The verb for action commands** (from 16b). a) ★ `pennestack call <module.entity.action>` with
    the dotted reference everyone already uses (`call deployments.deployment.run --project ...`);
    b) `pennestack run <module> <entity> <action>` (words instead of dots; reads oddly for actions
    named run); c) `pennestack do ...`. Status: decided 2026-10-26: **a**, `pennestack call <module.entity.action>`; see section K (16b).
82. **The edge implementation** (asked 2026-10-26 after Jens wondered about a custom edge). a) ★ Caddy
    behind an `edgeProvider` contract owned by the `edge` module (`edge-caddy` now; a custom
    `edge-native` listener module, Traefik or Envoy later); b) a custom edge from the start (own TLS,
    ACME, proxy, routing; M3 grows by a milestone; no HTTP/3 on Node); c) Caddy hard-wired as today.
    Status: decided 2026-10-26: **a**. To apply: section 17.3.7 (edge module gains the provider
    contract and its desired-state model), section 22 (`@pennestack/edge-caddy`), roadmap M3; see
    section K.

## I3. Licensing follow-ups (from the 2026-10-26 research; decision 20 is the main choice)

83. **When the repository goes public.** a) at M0, as the brief's constraint says; b) ★ when the M1
    slice runs, with docs/architecture.md kept private until the code exists (publication is
    irreversible under every licence; the architecture gives the idea away more than the code);
    c) only when Launchway runs on it. Status: open.
84. **Trademark "pennestack".** a) ★ confirm the name is final, run a TMview check (a German
    "Pinestack GmbH" exists), file at BOIP in classes 9 and 42 (about €271); b) EU at EUIPO (about
    €900 for two classes); c) wait. pennestack.com, .be and .io were free on 2026-10-26; no
    @pennestack npm organisation exists yet. Status: open.
85. **Outside contributions.** a) ★ none for now (issues and discussions only) until a
    lawyer-reviewed CLA with an explicit right to relicense exists; b) DCO sign-off (contributors keep
    copyright; later relicensing needs their consent, which blocks dual licensing); c) CLA now,
    automated. Status: open.
86. **Who owns the IP.** a) ★ Jens personally for now; b) a company later with a written assignment
    (WER XI.167) drafted by a lawyer; tax via the accountant. Status: open.
87. **Licence of the platforms and future paid modules.** a) ★ the same FSL-1.1-ALv2 as the
    framework (or Launchway private until it ships); b) private until they ship; c) stricter
    (BUSL-1.1 or Elastic-2.0). Never looser than the framework. Status: open.

## K. Edits to apply at the next editor pass (decisions taken after the merges)

- 82a: the edge module declares an `edgeProvider` extension point (desired state in, apply and
  status out); `edge-caddy` is the first provider; section 22 package list and roadmap M3 follow.
- 23c: remove the agent-protocol v1 compatibility transport and its 30-day retirement from 17.3.4,
  17.5 and the roadmap; M3's cutover redeploys the agent and the UI together; the old Launchway
  installation stays as rollback until the new one is verified.
- Mail server parked (2026-10-26): roadmap M4 to M6 marked 'parked until Jens chooses a stable,
  permanent deployment option'; M7 to M9 follow M3 directly; the gates for 21, 22 and the mail
  questions move with them; section 17's mail platform text stays as designed; README status line.
- 19b: Temporal from the start (`temporal-polyfill` or `@js-temporal/polyfill`, the editor
  verifies versions with npm view) behind `field.instant()`, `field.date()`, the fixed clock and the
  adapters' codecs; drop the 'Date now, Temporal later' text in 4.2, 6.4 and 13.2.
- 16b: the CLI's action commands move under one verb with the dotted action reference as the
  argument (`pennestack call deployments.deployment.run --project ...`, decision 81a); the reserved-name list
  of 16.9.3 and ADR 0013 disappears for module ids (framework commands and module ids no longer
  share a level); completion and docs follow.
- 15b: section 16 gains the oRPC transport (projection of the surface, typed client, its OpenAPI
  handler compared with the own emitter), ADR 0011 reversed on this point, roadmap M2 ships
  `@pennestack/transport-orpc` with GraphQL and tRPC.
- 13a: section 14.3.7 and roadmap M7 drop the Drizzle adapter option; `db introspect --drizzle`
  becomes an optional later item.
- 12a + addendum 5: section 14.3.3 adapter capabilities become optional accelerations, each with
  its kernel fallback (search: the keyed token index on every adapter; rowLocks: expected
  versions; positionPaging and countBefore: bounded scans; broadcast and notify: polling;
  encryptedQueries.order: bounded scans); `data: { needs }` stays only for `{ sql: dialect }`;
  `connect` never refuses for a missing acceleration; `pennestack doctor` lists fallbacks in use
  and their cost; sections 12 and 26 and ADR 0006 follow; brief traceability row in section 25.
