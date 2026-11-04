# Decision register

Date: 2026-10-23 (updated 2026-10-24; the M0 spike outcomes of section M, the M1 plan gaps of section N and the M1 follow-ups of section O added 2026-11-04). Status: open. This register lists every open question of the architecture in
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
   applied (roadmap). M8 is M6 since the reorder of 2026-10-28 (roadmap section 6).
10. **Before-images** in every event from M1. a) ★ yes; b) no. Status: decided 2026-10-26: **a**, before-images from M1; applied (section 15.1).
11. **Collaborative fields.** a) ★ Loro documents from the first app that declares one; b) plain
    values until M9, then migrate. Status: decided 2026-10-26: **a**, Loro documents from the first declaring app; applied
    (section 15.3). M9 is M7 since the reorder of 2026-10-28 (roadmap section 6).
12. **MySQL.** a) ★ keep it (M7) and recommend PostgreSQL for multi-tenant production; b) drop it.
    Status: decided 2026-10-26: **a**, keep MySQL, with a sharpened rule (brief addendum 5): the
    framework is datastore-agnostic; a datastore's features never influence application code or
    whether an app can run; every adapter capability has a kernel fallback with a visible cost
    (doctor reports the fallbacks in use); `connect` refuses only a declared raw-SQL dialect mismatch.
    To apply: sections 14.3.3 (capabilities become accelerations with fallbacks), 14.3.8 (the SQL
    hatch declares its dialect and non-portability), 12, 26; ADR 0006. See section K. M7 is M5 since
    the reorder of 2026-10-28 (roadmap section 6).
13. **Drizzle.** a) ★ wait for Drizzle 1.0 and import existing schemas with
    `keelwerk db introspect --drizzle`; b) build a Drizzle-based adapter now on 0.45.
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
    `flags`, `new`, `rollout` and `surface` from addendum 3); b) under a verb (`keelwerk run
    <module> ...`). Status: decided 2026-10-26: **b**, action commands under a verb; no name is ever reserved because of
    an integration, plugin or module. Verb to confirm (question 81). To apply: sections 16.9.3
    (no reserved module ids), 16.9.7, 23 (scaffold docs), ADR 0013; question 62 becomes pure naming;
    see section K.
17. **Operator impersonation** (`keelwerk explain --as <principal>`). a) ★ evaluate everywhere,
    execute only in development; b) also execute in production, logged. Status: decided 2026-10-26: **a**, evaluate everywhere, execute only in development; applied
    (section 16.9).
18. **Protobuf field tags.** a) ★ allocate from day one; b) when the Connect transport arrives.
    Status: decided 2026-10-26: **a**, tags allocated from day one; applied (sections 4.2, 6.2).
19. **Instants.** a) ★ `Date` now behind `field.instant()`, `Temporal.Instant` once Node 26 is
    the baseline; b) Temporal with a polyfill from the start. Status: decided 2026-10-26: **b**, Temporal from the start; with the Node 26 baseline of 28a no
    polyfill is needed (verified 2026-10-27: Node 26.12.1 has `Temporal` natively). To apply: sections 4.2 (`field.instant()` is `Temporal.Instant`, `field.date()` a
    `Temporal.PlainDate`, `field.timeZone()`), 6.4, 7.9 (the fixed clock is a Temporal.Instant), 13.2
    (polyfill package and version, verified), Appendix A; see section K.
20. **Licence.** a) ★ Apache-2.0; b) MIT. Due before the repository becomes public. Status: decided 2026-10-27: **FSL-1.1-ALv2** (option a of the researched set; Functional Source License, Version 1.1, Apache-2.0
    Future License), Licensor Jens Penneman; LICENSE.md added to the repository; applied (section 22,
    README).
21. **Outbound mail from the home connection.** a) ★ relay through an external host first (direct
    delivery is built anyway); b) a second keelwerk process with the `smtp-out`
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
    pools (needs container isolation on shared Docker hosts). Status: decided 2026-10-27: **a**, tenant-owned nodes; applied (section 17.3).
26. **A separate domain for untrusted apps and previews.** a) ★ a separate registrable domain;
    b) subdomains of jenspenneman.com with cookie hardening only. Status: decided 2026-10-27: **b** for now, subdomains of jenspenneman.com with cookie hardening (no
    extra spending); a separate domain stays the recommended future step and must remain a
    configuration change (the preview base domain is a setting). To apply: section 17.5.2 (the
    separate domain becomes 'recommended, not required'; the hardening list is mandatory); see section K.
27. **Ledger and control store at home.** a) ★ two PostgreSQL instances plus the ledger file;
    b) one instance plus the ledger file. Status: decided 2026-10-27: **a**, two PostgreSQL instances plus the ledger file; applied
    (section 17.5.2).
## B. Lead's own flags (not in section 26)

28. **Toolchain baseline.** a) ★ TypeScript 7.0 and Node 24 type stripping (no decorators, no
    enums, `.ts` import extensions, no build step for sources); b) TypeScript 5.9/6 with a build
    step and no syntax restrictions. Status: decided 2026-10-27: **a**, with the baseline raised: always the latest and greatest, so
    TypeScript 7 and **Node 26** (26.12.1 released 2026-10-21; LTS promotion due the last week of
    October 2026) with type stripping; the baseline follows each new major; older runtimes or APIs
    come back only through explicit backfills or polyfills. To apply: sections 13.2, 13.3, 22 and
    Appendix A (Node 26 baseline, engines field); Node 26 ships Temporal natively, so 19b needs no polyfill;
    see section K.
29. **History default.** a) ★ `history: 'chain'` for every entity, opt-out with a reason;
    b) `history: 'state'` by default, opt-in per entity. Status: decided 2026-10-27: **a**, `chain` by default, `state` opt-out with a reason; applied
    (section 6.6).
30. **SQL family.** a) ★ Kysely underneath the SQL adapters; b) Drizzle underneath (overlaps
    with 13). Status: decided 2026-10-26: **a**, Kysely as internal plumbing of the SQL adapters, never visible to
    app code; applied (section 14.3).
## C. Spike questions (section 26.2; answers optional, the M0 spike decides the rest)

31. **Composition error form.** a) ★ the `Check` property form (missing property with a literal
    type); b) a rest-parameter form, if it reads better in the editor. Status: decided 2026-10-27: **a**, the `Check` property form; the spike may still report if the
    rest-parameter form reads better. Applied (section 4.7). Confirmed by the spike 2026-11-04: the
    rest-parameter form only says "Expected 2 arguments, but got 1." (entry 108).
32. **Optional modules in `ctx.data`.** a) ★ `| undefined`; b) a `Maybe` object with
    `.ifPresent()`. Status: decided 2026-10-27: **b** for now (Jens: not sold yet), a `Maybe`-style accessor for optional
    modules; to be revisited after the M0 spike writes the auth module against it. To apply: sections
    3.4, 7.6, 7.9.3 (the accessor must compose with `yield*`: `yield* ctx.load.accounts.ifPresent(a =>
    a.profile.byId(id))` answering `Profile | undefined`), 26.2; see section K. Confirmed by the spike
    2026-11-04: it composes with `yield*` and `ctx.all` at the cost of `| undefined`; the accessor
    gets a short named type per module so its error message stays short (entry 108).
## D. Questions by area (section 26.3)

Data:

33. **Mail partitions and search.** Which mail entities declare `partition: 'accountId'` beyond
    `email` and `mailboxEntry`; must mail search work on SQLite (fts5) or only on PostgreSQL?
    a) ★ PostgreSQL only for mail search; partitions decided per entity in M4. Status: parked 2026-10-26: Jens defers the mail server until he has a stable, permanent deployment
    option; the design stays in the architecture, the decision waits.
34. **Clock-skew bound for offline clients.** a) ★ 5 minutes; b) another value. Status: decided 2026-10-27: **a**, 5 minutes; applied (section 15.3).
35. **Hash-chain anchoring.** Anchor chain heads outside the database later? a) ★ not in the
    first releases; revisit with the audit module. Status: decided 2026-10-27: **b**, chain heads anchored from the start: per scope, the latest head
    (position, hash) is appended to the deployment's ledger sinks (the ledger file and later sinks) at
    a configurable cadence (default every commit batch of the notifier, at most once per second per
    scope), and `keelwerk db verify` compares heads with the anchors. To apply: sections 15.1.8,
    14.7.6, 17.5.2, 16.9 (verify), ADR 0007; see section K.
36. **GraphQL for operator work.** a) ★ operator work stays on the invocation protocol and the
    CLI; b) also an operator GraphQL schema at the operator endpoint. Status: decided 2026-10-27: **a**, operator work on the invocation protocol and the CLI; applied
    (section 16.8).
37. **GraphQL operation limits.** a) ★ own validation rules; b) depend on graphql-armor (last
    published 2025-12-29). Status: decided 2026-10-27: **a**, own validation rules, with a first rule from Jens: an entity type
    never appears twice on one selection path (no `project -> deployments -> project -> ...`); related
    data is selected at the highest level where it is needed, or in a separate query. Siblings of the
    same type at one level stay allowed. Applies to GraphQL selections and to REST `include`
    expansions alike; configurable per backend; may change once the implementation goes deeper. To
    apply: sections 16.4 (includes) and 16.5 (GraphQL rules: depth, aliases, batch, cost from the
    surface, plus the no-repeat rule); see section K.
38. **Blob uploads.** a) ★ resumable uploads plus JMAP's upload endpoint, designed with ADR 0020
    (M4); b) multipart only. Status: decided 2026-10-27: **a**, resumable uploads (JMAP's upload endpoint when mail comes);
    designed with ADR 0020.
39. **Connect transport.** When is the runtime-descriptor spike scheduled? a) ★ after M6, with
    the Connect transport; b) earlier. Status: decided 2026-10-27: **a**, with the Connect transport, after M3 (mail parked); applied
    (roadmap, later milestones).
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
    webmail until keelwerk has its own UI. Status: parked 2026-10-26: Jens defers the mail server until he has a stable, permanent deployment
    option; the design stays in the architecture, the decision waits.
45. **One login for Launchway and mail.** a) ★ separate realms per tenant first, an OpenID
    Connect provider module later; b) the provider module from the start. Status: decided 2026-10-27: **a**, separate realms by default, an optional OpenID Connect provider
    module later; applied (section 17.2, roadmap 'Further').
46. **DMARC rollout.** a) ★ `p=none` with reports, then `quarantine`, then `reject` after a clean
    month; b) `reject` from the start. Status: parked 2026-10-26: Jens defers the mail server until he has a stable, permanent deployment
    option; the design stays in the architecture, the decision waits.
47. **Retention defaults.** 30 days for Trash, Junk and archived mail, 30 days for deployment
    logs, 7 days for closed previews, 90 days for delivery attempts. a) ★ accept; b) other
    values. Status: decided 2026-10-27: **c**, keep all data forever (deployment records, logs, preview
    records, analytics later; Jens wants to look back in five years); no purge suggestions for
    Launchway data. Only runtime artefacts are reclaimed: the containers, images, volumes and build
    caches of a closed preview or a superseded deployment go, their rows, events and logs stay. Mail
    suggestions parked. To apply: sections 14.7.1 (no suggested rules for Launchway entities),
    17.3.6 (preview teardown reclaims runtime only), roadmap M3; see section K.
48. **Where Launchway's modules live.** a) ★ `examples/launchway` in this repository until the
    framework is public, then the Launchway repository; b) the Launchway repository from the
    start. Status: decided 2026-10-27: **c**, neither: every app built on keelwerk lives in its own
    repository and depends only on the published packages (never on the keelwerk repository); the
    keelwerk repository keeps a minimal example app for its own CI. Rules from Jens: nothing is
    sequential (apps are rebuilt while the framework grows, on 0.x pre-releases pinned to exact
    versions); the framework and every app stay in beta until Jens, and only Jens, declares them
    stable; Trail is rebuilt first, Launchway second; the design documents are public from the
    start, with the licence applied from the first commit. To apply: roadmap (M3 Trail in its own
    repository, M4 Launchway in its own repository, mail parked after; a 'beta' section), sections
    17 (Launchway modules no longer under examples/), 22, 24, README; see section K.
49. **Outbound webhooks.** a) ★ part of Launchway's first keelwerk release (M3, now M4); b) later.
    Status: decided 2026-10-27: **a**, outbound webhooks ship with Launchway's rebuild (M4 after the
    reorder); applied (roadmap).
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
    Reopened and confirmed 2026-10-28 (Jens: keep a). Ergonomic variant to test in the M0 spike:
    no separate `prepare` member; `decide` may perform inline effects only before its first load,
    the kernel opens the unit at the first load and refuses later inline effects with a clear error.
## F. Addendum 3 (2026-10-23): versioning, rollouts, flags and project layout

The designs landed on 2026-10-24 as architecture.md sections 18 to 20 and 23 (ADRs 0021 to 0024);
section 26.1 lists the same points under the same numbers. The jobs, nodes and autoscaling design
(section 21) is still in progress.

Versioning, rollouts and flags:

51. **Where flags live.** Where do feature flags live? a) ★ framework core: `defineFlag`, typed
    `ctx.flags`, gates and provenance, with experiments as an optional module
    (`@keelwerk/module-experiments`), because flags are needed in rules, `admit`, transports,
    jobs and the kernel's own rollouts, and only the core reaches all of them; b) a flags module
    that other modules require or list as optional; c) only in the apps built on the framework.
    Status: decided 2026-10-28: **a**, flags in the framework core, experiments as a module; applied
    (section 20, ADR 0023).
52. **API version naming.** How are app API versions named and served? a) ★ dated versions pinned
    per request, credential, tenant and backend, served from one head by version-change
    transforms; integer majors only for wire protocols; b) integer majors per app (v1, v2) in a
    header, each major a separate surface; c) no versions: continuous evolution with deprecation
    only. Status: decided 2026-10-28: **a**, dated API versions with version-change transforms; applied
    (section 18, ADR 0021).
53. **Support window.** How long must an API version stay supported? a) ★ at least 12 months after
    a newer one exists, then retirement only after its sunset and 30 days of zero use (or a logged
    `--force`); for a personal deployment the usage counters matter more than the calendar; b) 24
    months, as GitHub promises; c) until usage reaches zero, however long that takes. Status: decided 2026-10-28: **12 months of deprecation, then support is dropped**, without the
    zero-use condition: a version is marked deprecated the day a newer one exists, its sunset is 12
    months later, and after the sunset it is retired regardless of use (clients get
    `core.api_version_retired`); usage counters stay as information. To apply: section 18.6, ADR 0021;
    see section K.
54. **Automatic finalization.** Is finalization of a rollout automatic? a) ★ automatic once every
    live process has run the target revision for a 600-second grace period, with a manual mode per
    deployment; contract steps stay manual because they destroy data; b) always manual
    (`keelwerk rollout finalize`). Status: decided 2026-10-28: **a**, automatic finalization after the grace period, contract steps
    manual; applied (section 19, ADR 0022).
55. **Field renames in production.** How are field renames handled in production? a) ★ keep the
    physical column recorded in the snapshot (a logical rename, no DDL); type changes and splits
    use the gated add, dual write, backfill and contract procedure; b) rename the column through
    add, dual write, backfill and drop. Status: decided 2026-10-28: **b**, a rename renames the column through expand (add the new column),
    dual write during the rollout, backfill, and contract (drop the old column), gated by
    finalization like every other contract step; physical names always equal the derived names.
    To apply: sections 14.4.2, 14.6.2, 14.6.4, 19 (the 'renamed fields keep their column' rule is
    reversed), ADR 0022; see section K.
56. **Mail listeners during upgrades.** How do the mail listeners survive upgrades on the home
    server? a) ★ their own container (a named process of gap G9), replaced by stop and start in
    seconds: SMTP senders retry and IMAP clients reconnect, and the HTTP container rolls blue-green
    behind Caddy; b) a TCP proxy in front that drains connections (no drops, one more component);
    c) keep them in the single keelwerk container and accept a restart. Status: parked 2026-10-26: Jens defers the mail server until he has a stable, permanent deployment
    option; the design stays in the architecture, the decision waits.
57. **Experiment statistics.** Which statistics does the first experiments module offer? a) ★
    fixed-horizon frequentist tests (two-proportion z-test, Welch's t-test, 95 % intervals) with a
    planned-size gate and a sample-ratio check; Bayesian, CUPED and sequential tests later, each
    with its own validation; b) Bayesian analysis from the start; c) sequential testing from the
    start; d) no analysis: export counts only. Status: decided 2026-10-28: **a**, fixed-horizon frequentist tests first; applied (section 20.8).
58. **File naming.** What case do file and directory names use, given that every file is named
    after its export? a) ★ kebab-case derived from the export by `kebab()` of architecture.md
    section 16.4.1 (`changePassword` -> `change-password.ts`): it matches module ids, CLI routes
    and REST paths and is safe on case-insensitive file systems; the file-to-export check runs in
    `keelwerk doctor`'s layout pass until a Biome JavaScript plugin can do it in the editor;
    b) the identifier's own case (`changePassword.ts`), which Biome 2.5.15 checks in the editor
    with `useFilenamingConvention` `filenameCases: ["export"]`; paths then mix kebab module
    directories with camelCase files, and case-only renames can slip past git on macOS and
    Windows. Status: decided 2026-10-28: **a**, kebab-case derived from the export; applied (section 23, ADR 0024).
59. **Module assembly.** How do a module's part files become the module value? a) ★ explicit:
    `base.ts` holds the module base and parts are typed against it through the part functions
    (`defineCommand(base, ...)` and the others); `module.ts` imports every part and mounts it in the
    module literal; scaffolds insert the import and the entry; no generator sits in the type path,
    and the API name is set in code; b) generated: `keelwerk generate` writes
    `module.generated.ts` from the directory conventions, and `generate --check` catches drift in
    CI; nothing needs registering by hand, but the types are stale until the generator runs and a
    file's path decides its action reference. Status: decided 2026-10-28: **b**, a generated manifest: `keelwerk generate` (and the dev server on
    every file change) writes `module.generated.ts`, a module literal assembled from the directory
    conventions (3b still holds: it is a literal, only written by a tool); `generate --check` fails CI
    on drift; an action's reference comes from its file name and its directory (entity or module
    mount), so moving a file changes the reference and `surface diff` reports it as breaking.
    `base.ts` stays hand-written. To apply: sections 23.5 to 23.9, 13.1 (generated files), 13.8,
    ADR 0024; question 61 becomes moot; see section K.
60. **Policy granularity.** How are authorization rules split into files? a) ★ one policy file per
    entity or module-level action (`policies/<target>.ts` exporting `<target>Policy`), holding all
    rules for that target so allows and denies are reviewed together; b) one rule per file
    (`policies/<entity>/<rule-id>.ts`), so the file name equals the rule id; many small files, and
    name clashes in `module.ts` need aliases. Status: decided 2026-10-28: **b**, one rule per file (`policies/<target>/<rule-id>.ts`, the file name
    is the rule id); the generated manifest merges them as a set (order-independent by 5a).
    To apply: sections 23.2, 23.5, 8.1 (rule ids derive from path), ADR 0024; see section K.
61. **Scaffold edits.** May scaffolds edit TypeScript sources? Section 16.9.8 used to say they never
    do. a) ★ narrow edits of assembly files only: scaffolds insert one import and one entry into
    the matching key of one assembly file (`base.ts`, `module.ts`, `app.ts` or `modules.ts`),
    refuse any file not in the canonical shape and print the lines instead, and offer `--dry-run`;
    b) keep the earlier rule: scaffolds only print the two lines for the author to paste.
    Status: closed 2026-10-28 by 59b: scaffolds create files only and never edit sources; the
    generated manifest does the wiring.
## G. Jobs, nodes and autoscaling (designed 2026-10-25; decision 6 above is the main choice)

62. **Fleet command name.** Launchway already has a module `nodes`, so the framework's command group
    for nodes, processes and scaling needs another name. a) ★ `keelwerk fleet` (list, show, watch,
    cordon, uncordon, drain, probe, forget, scale ...), one more reserved name (34); b) `keelwerk
    nodes` and rename Launchway's module; c) `keelwerk x nodes` until the next major. Status: decided 2026-10-28: **a**, `keelwerk fleet`; applied (sections 16.9, 21).
63. **When automatic scaling ships.** a) ★ M3: the scaler as a pure plan with the static provider
    (recommendations in `keelwerk fleet scale status`); M5: the opt-in docker provider for extra
    workers; b) the docker provider already in M3; c) recommendations only until a Kubernetes or
    cloud provider exists. Status: decided 2026-10-28: **a**, scaler with the static provider first, the docker provider one
    milestone later; Jens wants a Kubernetes (or similar) provider in the future, so the
    `nodeProviders` contract stays the only coupling and the roadmap keeps the Kubernetes provider
    as a named later milestone; applied (section 21, roadmap). Since the reorder of 2026-10-28 the
    scaler ships in M4 (Launchway's rebuild) and the docker provider in M5 (roadmap section 6).
64. **Docker provider on the home server.** The Docker engine is root on that host. a) ★ opt-in per
    deployment, held only by the scaler's named process, through a socket proxy limited to container
    create, start, stop, inspect and list; b) never: extra workers are started by hand; c) on by
    default. Status: decided 2026-10-28: **a**, opt-in, scaler-only, through a verb-limited socket proxy; applied
    (section 21.5).
## H. Encrypted personal data and queries (designed 2026-10-25, decision 7b)

65. **Equality index by default?** When does a personal field get its blind index? a) ★ only where a
    lookup is declared (`.unique()`, `.index()`, an entity index or `queries: ['eq']`); other
    personal fields support `isNull` only; b) every scalar personal field gets one, opt-out with
    `queries: []`. Status: decided 2026-10-28: **a**, blind indexes only where a lookup is declared; applied
    (section 14.7.9).
66. **Default normaliser for personal strings.** a) ★ NFC (composed and decomposed accents compare
    equal); e-mail fields declare `normalize: 'email'`, which makes uniqueness case-insensitive;
    b) exact code points; c) caseless by default. Status: decided 2026-10-28: **a**, NFC by default, `email` for e-mail fields; applied (section 14.7.9).
67. **Server-side mail search over personal text.** a) ★ a per-account keyed token index over
    subject, addresses and bodies (`search: 'full'`, switchable to `'headers'` or `'off'` per
    backend); b) headers only, bodies by bounded scans; c) no server-side search until keelwerk
    has its own client. Status: parked 2026-10-26: Jens defers the mail server until he has a stable, permanent deployment
    option; the design stays in the architecture, the decision waits.
68. **Mail search matching.** a) ★ word and stem matching for JMAP and IMAP (a documented deviation
    from IMAP's substring rule); b) exact substring through scans, only for mailboxes within the
    scan limit. Status: parked 2026-10-26: Jens defers the mail server until he has a stable, permanent deployment
    option; the design stays in the architecture, the decision waits.
69. **Ordering and ranges on personal fields.** a) ★ bounded scans only until M7, then
    order-revealing encryption tokens on PostgreSQL as an opt-in with a doctor warning; b) never,
    bounded scans only; c) an order-preserving encoding on every adapter now (more leakage).
    Status: decided 2026-10-28: **a**, bounded scans first, ORE tokens later as an opt-in on PostgreSQL;
    applied (section 14.7.9, roadmap). M7 is M5 since the reorder of 2026-10-28 (roadmap section 6).
70. **Key scope of search indexes.** a) ★ per data subject (the mailbox owner): tags of different
    accounts never match, erasure destroys the key; b) per tenant: operator search across accounts,
    but tags link words across accounts. Status: decided 2026-10-28: **a**, per data subject; applied (section 14.7.9).
71. **Bounded scans (unseal and evaluate in memory).** a) ★ custom queries only, with an explicit
    limit (default 2,000; adapter maximum, proposed 10,000 on PostgreSQL); b) also generated queries
    over transports, with a per-entity limit; c) nowhere. Status: decided 2026-10-28: **a**, bounded scans in custom queries only, explicit limit, never
    through transports; applied (section 14.7.9).
72. **Substring search defaults.** a) ★ trigram tags truncated to 12 bits, operands of at least 3
    characters, only fields with `maxLength` of at most 1,024; b) 16-bit tags (fewer false matches,
    sharper statistics for a thief); c) no `contains` on personal fields, word search only.
    Status: decided 2026-10-28: **a**, 12-bit trigram tags, 3-character minimum, fields up to 1,024
    characters; applied (section 14.7.9).
## I. Pure handlers and the effect interpreter (designed 2026-10-25, decision 50a)

73. **How a handler gets its data.** a) ★ generators: `decide`, `read` and `react` yield typed
    requests with `yield*`; dependent loads compose by delegation; plain functions stay allowed
    for handlers that need nothing; `ctx.all` batches parallel loads; b) declared loads: a
    `load(input, ctx)` member returns named load descriptions answered before `decide`, which
    becomes a plain function of (input, loaded, ctx), with a second stage for dependent loads;
    c) both, declared loads as the common form and generators only for dependent loads.
    Status: decided 2026-10-28: **a**, generators with `yield*`; applied (section 7.9.2, ADR 0026).
74. **Inline effects in `prepare`.** May a sync command call outside and wait for the answer?
    a) ★ yes, restricted: only in `prepare` of sync commands, only executors marked `inline` that
    need no capability, at most 30 seconds, no retries, recorded before and after (needed by OAuth
    and OpenID Connect logins, GitHub's manifest conversion, "test SMTP connection"); b) no, every
    effect is deferred and interactive flows become two steps. Status: decided 2026-10-28: **a**, with a reservation: Jens is not sold on the phase restrictions
    (`prepare`, `decide`, ...). They follow from 50a (no transaction waits on the network, every
    effect recorded); the M0 spike and the Trail rebuild test their ergonomics, and the split model
    of 50c stays the agreed fallback if they hurt. Applied (section 7.9.4, ADR 0026).
75. **Who retries outside calls.** a) ★ the rule: executor retries only for failures without
    domain meaning (lost lease, refused connection, 429 or 5xx honouring the idempotency key);
    everything with domain meaning, mail delivery included, is a state machine with timers and one
    effect per attempt; b) executor retries for everything, mail included; c) no executor retries
    at all. Status: decided 2026-10-28: **a**, executors retry mechanical failures, modules decide on answers
    with domain meaning; applied (section 7.9.5, ADR 0026).
76. **Logging inside pure handlers.** a) ★ `ctx.log` and `ctx.trace` stay write-only capabilities
    (return nothing, cannot influence a result, not part of the logbook); b) logs as returned or
    yielded values; c) no logging in handlers, the kernel logs decisions and effects itself.
    Status: decided 2026-10-28: **a**, write-only log and trace capabilities; applied (section 7.9.7).
77. **Clock, ids and randomness.** a) ★ the clock is the invocation's fixed time (equal to the
    events' `recordedAt`); ids and random values are yielded requests recorded in the decision
    record; b) all three recorded requests, each `now()` a fresh reading; c) all three derived from
    a recorded per-invocation seed (Restate's approach). Status: decided 2026-10-28: **a**, fixed clock per invocation, ids and random values as recorded
    requests; applied (section 7.9.3).
78. **Where effect records live.** a) ★ in the chain: one `core.effect` stream per effect
    (requested, settled), positioned and hashed with the scope's other events, attempts as stream
    records kept 90 days; b) a separate `kw_effects` table per namespace with its own retention,
    not hashed. Status: decided 2026-10-28: **a**, effect records in the chain (`core.effect` streams); applied
    (section 7.9.6). Note from 47c: attempt records are kept, not purged after 90 days, unless Jens
    adopts a rule; see section K.
79. **Command inputs in the logbook.** a) digest only (the receipt's fingerprint); b) ★ digest by
    default plus sealed inputs for actions that opt in (`trace: { input: 'sealed', retention }`),
    personal fields under the subject's key; c) sealed inputs for every command. Status: decided 2026-10-28: **b**, digest by default, sealed inputs by opt-in; applied
    (section 7.9.6, 7.3).
80. **Launchway's agents under the strict model.** a) ★ commands to agents are effects with an
    external performer: the agent pulls pending `agentCommand` effects over `nodes.channel` and
    settles them through `nodes.ack`, with a deadline and a continuation; b) keep the
    `nodes.command` rows and `nodes.command.ack` of section 17.3.4 as module data. Status: decided 2026-10-28: **a**, agents are external performers of `agentCommand` effects;
    applied (sections 7.9, 17.3.4).
## J. Editorial items from the merge passes (2026-10-25, for the lead and Jens)

- New names introduced by the final editor to make the strict sketches concrete, to confirm or
  rename: `ReadContext`, `SourceContext`, `KernelInvocationContext`, `TargetLoads`, `TargetRowOf`,
  `PrepareHandler`, `ExecutorSecrets`, `LiveSource`, `PendingEffect`, `EffectOptions`,
  `ctx.flagDetails`, `nodes.ack`, `settle({ effect, id, where }, outcome)`, the REST header
  `Keelwerk-Effects`, the GitHub effects `mirrorStatus`, `listReleases`, `convertManifest`, the
  relay probe shapes, the lib helper `combine`.
- Section 14.3.8 still lists scoping rules for update, delete and insert although the SQL escape
  hatch is read-only under 50a; kept as defence in depth, may be cut.
- Appendix A.7 licences are not re-checked; Kysely stays pinned at 0.29.6 (0.29.7 exists).
- Question 80 gates M2 (external performers ship in M2), not M3.

## I2. Follow-ups of decisions (2026-10-26)

81. **The verb for action commands** (from 16b). a) ★ `keelwerk call <module.entity.action>` with
    the dotted reference everyone already uses (`call deployments.deployment.run --project ...`);
    b) `keelwerk run <module> <entity> <action>` (words instead of dots; reads oddly for actions
    named run); c) `keelwerk do ...`. Status: decided 2026-10-26: **a**, `keelwerk call <module.entity.action>`; see section K (16b).
82. **The edge implementation** (asked 2026-10-26 after Jens wondered about a custom edge). a) ★ Caddy
    behind an `edgeProvider` contract owned by the `edge` module (`edge-caddy` now; a custom
    `edge-native` listener module, Traefik or Envoy later); b) a custom edge from the start (own TLS,
    ACME, proxy, routing; M3 grows by a milestone; no HTTP/3 on Node); c) Caddy hard-wired as today.
    Status: decided 2026-10-26: **a**. To apply: section 17.3.7 (edge module gains the provider
    contract and its desired-state model), section 22 (`@keelwerk/edge-caddy`), roadmap M3; see
    section K.

## I3. Licensing follow-ups (from the 2026-10-26 research; decision 20 is the main choice)

83. **When the repository goes public.** a) at M0, as the brief's constraint says; b) ★ when the M1
    slice runs, with docs/architecture.md kept private until the code exists (publication is
    irreversible under every licence; the architecture gives the idea away more than the code);
    c) only when Launchway runs on it. Status: revised 2026-10-27: the code and the design documents may be public from the start, at a
    moment Jens chooses, with the licence in every commit (history rewritten so LICENSE.md exists from
    the first commit).
84. **Trademark "keelwerk".** a) ★ confirm the name is final, run a TMview check (a German
    "Pinestack GmbH" exists), file at BOIP in classes 9 and 42 (about €271); b) EU at EUIPO (about
    €900 for two classes); c) wait. keelwerk.com and keelwerk.dev were free on 2026-10-28 (checked with the registries' RDAP); no
    @keelwerk npm organisation exists yet. Status: decided 2026-10-27: **c**, wait; Jens looks into trademarks when it comes to that.
85. **Outside contributions.** a) ★ none for now (issues and discussions only) until a
    lawyer-reviewed CLA with an explicit right to relicense exists; b) DCO sign-off (contributors keep
    copyright; later relicensing needs their consent, which blocks dual licensing); c) CLA now,
    automated. Status: decided 2026-10-27: **a**, no outside contributions until a lawyer-reviewed CLA exists;
    applied (README).
86. **Who owns the IP.** a) ★ Jens personally for now; b) a company later with a written assignment
    (WER XI.167) drafted by a lawyer; tax via the accountant. Status: decided 2026-10-27: **a**, Jens personally for now.
87. **Licence of the platforms and future paid modules.** a) ★ the same FSL-1.1-ALv2 as the
    framework (or Launchway private until it ships); b) private until they ship; c) stricter
    (BUSL-1.1 or Elastic-2.0). Never looser than the framework. Status: decided 2026-10-27: **a**, the same FSL-1.1-ALv2 for the platforms and future modules.
## K. Edits applied

All 21 items of this section were applied by the editing pass of 2026-10-28 (architecture, 18 ADRs,
roadmap, README, api-sketch.ts). Milestone numbers changed in that pass: the register's references
to M8 (offline sync), M9 (collaborative fields) and M7 (data breadth, ORE) now read M6, M7 and M5;
roadmap section 6 maps old to new.

91. **The name.** Decided 2026-10-28: **keelwerk** (keel: the first beam of a ship; werk). Checked free
    on npm (package and scope), GitHub, .com and .dev; no company or product found by web search; a
    TMview check belongs to the deferred trademark step (84c). Every document, identifier prefix
    (`kw_` tables, `$kwe` envelope marker, `kws_` tokens, `KEELWERK_*` environment, `@keelwerk/*`
    packages, the `keelwerk` CLI, `keelwerk.config.ts`, `.keelwerk`-free: the per-repo directory stays
    `.launchway/` per 90c) was renamed on 2026-10-28. Status: applied.

## K2. Edits to apply at the next editing pass

Applied by the editing pass of 2026-11-04 (90c, the tour review's stale spots, and 16.5.8 as entry
119); nothing is pending.

## L. Questions raised by applying the decisions (2026-10-28)

88. **Where the edge module lives** (consequence of 82a). `@keelwerk/edge-caddy` is a keelwerk
    package, and a keelwerk package cannot fill an extension point of a module that lives in
    Launchway's repository. a) ★ the `edge` module becomes a shared keelwerk module
    (`@keelwerk/module-edge`: sites, routes, certificates policy, the `edgeProvider` extension
    point, `edge.apply` performed by the edge node's agent); Launchway's `domains` declares the
    sites it needs; b) the edge module stays in Launchway and the Caddy provider lives there too (no
    shared package; a second platform wanting an edge copies it). Status: decided 2026-10-28: **a**, `@keelwerk/module-edge` as a shared module; applied by the
    editing pass (sections 17.3, 22).
89. **Anchor content** (consequence of 35b; a stored format, needed before M1). a) ★ an anchor
    carries the scope's latest position and hash only; b) also a digest of every stream head in the
    scope, so a rewrite of one stream's history is detectable from the anchor alone, at the cost of
    larger anchors per scope. Status: decided 2026-10-28: **a**, position and hash only; applied (section 15.1.8; the 26.3 question
    is closed).
90. **Where a deployment definition lives now that every app has its own repository.** a) ★ each app
    repository carries its own `keelwerk.config.ts` and runs as its own deployment until
    Launchway is rebuilt (M4), after which one deployment can host several apps from published
    packages; b) one separate deployment repository from the start, importing the apps as packages.
    Status: decided 2026-10-28: **c**, Jens's shape: every app repository carries a `.launchway/`
    directory with its deployment configuration, and the rebuilt Launchway deploys the app from it.
    Concretely: `.launchway/deployment.ts` is the app's keelwerk deployment file
    (`defineDeployment`: the app, data stores and placements, ports, providers, scaling limits) and
    `.launchway/launchway.ts` holds what only the platform needs (domains and routes, previews,
    environment, node). The framework stays neutral: `keelwerk start --config <file>` with the
    default lookup `keelwerk.config.ts`, then `.launchway/deployment.ts`; `keelwerk init` writes
    the `.launchway/` directory. Before Launchway's rebuild (M4), Trail (M3) is deployed by the
    current Launchway from `.launchway/compose.yaml` running `keelwerk start --config
    .launchway/deployment.ts`. To apply: sections 16.9 (config lookup), 17.3 (Launchway reads
    `.launchway/`), 23 (app repository layout), roadmap M3 and M4; see section K2.
## J2. More editorial items (2026-10-28 editing pass; names to confirm or rename)

`defineRule`; ids of contributed rules (`auth.accounts.profile.self`); multi-action rules in
`policies/<rule>.ts` with the id `<module>.<rule>`; `open` instead of `public` in rule names (a
reserved word); `ifPresent`; `offload: { afterPerKey }`; `anchors: { every }`; `edge.site`,
`edge.apply`, `edge.channel`, `edge.ack`, `edge.reconcile`, `edge.config.performer`;
`nodes.node.publishLogs`; `OrpcRouterOf`; `serializer: 'json'`; the migration file's `renames` entry
and `copyColumn` step; the manifest format `keelwerk.module/1`. Roadmap choices proposed by the
editor: Trail (M3) scope and exit criteria; passkeys, outbound webhooks, the egress service and
package publication in M3; ADR due dates; `blobs-fs` in M4 for the log offload; the docker provider
in M5. 12a fallback table additions (serializable → one unit at a time per scope, unsupported
operators evaluated by the kernel, SQLite sort-key column). 19b: instants keep millisecond
precision (finer digits rounded down at validate). Appendix B's typing listing still types instants
as `Date` with a note.

## M. M0 spike outcomes (2026-11-04)

The composition-types spike (`spikes/composition-types/REPORT.md`, findings 1 to 16, "F") and the
write-path spike (`spikes/write-path/REPORT.md`, findings 1 to 10, "W") reported on 2026-11-04. The
lead decided every finding the same day; each entry names the sections the editing pass of
2026-11-04 changed.

92. **Principal references** (F1). Principal refs are typed by the module that resolves the
    principal, through `principalRef` on its base; auth's user principal ref is `{ credentialId:
    Id<'auth.credential'>; sessionId: Id<'auth.session'> }`, and logout passes
    `ctx.principal.ref?.sessionId`. Status: decided by the lead 2026-11-04, applied (sections 4.1,
    7.4, 8.5, 17.2.4; api-sketch.ts; the spike's principal types).
93. **`asSubject` returns `SubjectId`** (F2). Status: decided by the lead 2026-11-04, applied
    (sections 4.2, 8.5; api-sketch.ts).
94. **The readable row** (F3). `Readable<App, 'module.entity'>`, because maskability is a field flag a
    row type has lost; module-local views compute it from the fields. Status: decided by the lead
    2026-11-04, applied (sections 4.7, 6.2, 8.1, 13.10, 14.7.9, 14.8.1, 15.4.2, 16.2.3, 16.4.5;
    api-sketch.ts; spike comments).
95. **Contracts without an interface type argument** (F4). `defineContract('live', 'app')`; the
    contract's shape comes from the module that provides it; no curried form. Status: decided by
    the lead 2026-11-04, applied (section 5.2, with the stale `defineModule({ id, requires })`
    snippet of K2 now `defineModuleBase`).
96. **Extension points per mode** (F5). `extensionPoint.single<T>()`, `.set<T>()` and
    `.ordered<T>()` replace `extensionPoint<T>({ mode })`; a `single` point reads as `T`. Status:
    decided by the lead 2026-11-04, applied (sections 4.1, 5.5, 16.5.8, 17.3.7, 17.3.13, 17.4.13,
    17.7 G14; api-sketch.ts; the spike's extension points and fixtures).
97. **`continueWith`** (F6). The continuation option `then` made the options object a thenable;
    it is `continueWith` everywhere. Status: decided by the lead 2026-11-04, applied (sections 2,
    7.6, 7.9.5, 7.9.8, 17.3.4, 17.3.13, 17.7, 23.5, 26.3; api-sketch.ts; overview; the spike's
    fixture, its `biome-ignore` removed).
98. **Where the named module checks run** (F7). `refsOutsideRequirements` and
    `contributedFieldsNeedDefault` move to `defineModuleBase`; new checks
    `contributionsOutsideDependencies` and `unknownConditionTargets` (base), `unknownContributionTargets`
    also at `defineContribution`, `executorsWithoutEffect` (`defineModule`) and
    `unknownConditionFields` (`defineRule`). Status: decided by the lead 2026-11-04, applied
    (section 4.7: the table of named checks and cases 9 and 10).
99. **Condition keys checked by name** (F8). Rules infer the returned condition and check its keys
    (`unknownConditionFields`; shallow plus `or`, `and`, `not`; relation sub-conditions not deep),
    because TypeScript does not excess-check object literals returned from callbacks. Status:
    decided by the lead 2026-11-04, applied (sections 4.4, 8.3, 13.10).
100. **Nested const-generic calls** (F9). No DSL function that may be nested inside another
     const-generic call infers a defaulted literal type parameter; such functions take the whole
     literal as one type parameter and defaulted parameters use `NoInfer` (measured: an inline
     `defineContribution` got `when: readonly Dependency[]` and was silently inactive). Status:
     decided by the lead 2026-11-04, applied (sections 4.7, 13.11).
101. **TS2883 and the core's exports** (F10). CI fails on TS2883 too; the core entry exports every
     type that can appear in a part or module type (about 120 names in the spike). Status: decided
     by the lead 2026-11-04, applied (sections 4.7, 13.11; roadmap M0).
102. **Part return types written out** (F11). Declared return types of part functions are
     `ActionPart<...>` with computed types, never an alias with raw arguments (21 KB to 12.3 KB per
     module). Status: decided by the lead 2026-11-04, applied (section 13.11).
103. **Named entity types and the budgets** (F12). `export interface Profile extends
     EntityType<typeof profile> {}`; 6 KB per `module.generated.d.ts`, 16 KB per module package;
     instantiations: fold 450,000 at 25 modules and 960,000 at 40, whole program 1,550,000 and
     2,600,000; the listing's old figures replaced by the measured ones. Status: decided by the lead
     2026-11-04, applied (sections 4.2, 4.7, 13.11, 23.5).
104. **The core module's hand-written type** (F13). `CoreBase` and `Core`, because the named-type
     pattern fails under `isolatedDeclarations` (TS9010). Status: decided by the lead 2026-11-04,
     applied (section 13.3).
105. **Rule actions and policy keys checked at `defineModule`** (F14). `unknownRuleActions` and
     `unknownPolicyTargets`; the spike typed both as strings, so the core adds them in M1. Status:
     decided by the lead 2026-11-04, applied (sections 4.4, 4.7, 8.1).
106. **Contributed fields in module-local rows** (F15). `ctx.write` and dependency rows carry the
     module's contributed fields that are active in the part (`when` lists honoured). Status:
     decided by the lead 2026-11-04, applied (section 7.6).
107. **Type-only files and the empty object type** (F16). A type-only file exports its main type
     plus the helper types its definition names, and the single-purpose rule counts the main type;
     `noBannedTypes` stays on, the core defines `type Empty = Record<never, never>` once and uses
     it; no preset relaxation. Status: decided by the lead 2026-11-04, applied (sections 13.9, 23.3).
108. **Decisions 31a and 32b confirmed by the spike.** The `Check` property form stays; the Maybe
     accessor stays and gets a short named type per module, so its error message no longer prints
     the whole loads type. Status: decided by the lead 2026-11-04, applied (sections 3.4, 4.7, 7.6,
     26.1; questions 31 and 32).
109. **A locked load's position** (W1). Read after the lock is held, from the first statement the
     unit sends after the lock (the adapter may fold it into the versioned state update's
     `returning`), never from a subselect in the locking statement (measured: a stale position in
     100 of 100 commits on a hot row). Status: decided by the lead 2026-11-04, applied (sections
     7.9.4, 7.9.6, 15.1.6; ADRs 0007 and 0026).
110. **Isolation of command units** (W2). Closed: `READ COMMITTED` with positioned loads; one
     `REPEATABLE READ` snapshot per decision is rejected (36 to 77 % of units fail after three
     retries, because every unit updates the scope counter). Status: decided by the lead
     2026-11-04, applied (sections 14.3.6, 26.1, 26.2, 26.3; ADR 0007).
111. **The row-level security cast** (W3). `nullif(current_setting('keelwerk.tenant_id', true),
     '')::uuid`, because a pooled connection keeps the setting as `''` after a tenant unit. Status:
     decided by the lead 2026-11-04, applied (section 14.3.7; ADR 0007).
112. **The commit tail and the per-scope ceiling** (W4). One statement (counter update, event
     insert and the lane's `enqueued` counter in one CTE); the ceiling is per round trip, about
     1,000 to 1,400 units per second per scope within 0.2 ms of the database and 110 to 150 at
     2.8 ms; the adapter keeps the database within about 1 ms of the writers or plans the
     sequencer; beyond about four writers a scope only queues. Status: decided by the lead
     2026-11-04, applied (section 15.1.4; ADR 0007 consequences, with the dated "Measured" entry).
113. **Lanes per take and skipped lanes** (W5). `$lanes` defaults to the batch size, configurable per
     queue (written `queues.<q>.takeLanes`, confirmed by the lead 2026-11-04); the take reports lanes skipped as
     locked separately from "no work", and a fetcher that saw skipped lanes retries at once with
     jitter. Status: decided by the lead 2026-11-04, applied (sections 9.5.3, 9.5.6, 14.3.9).
114. **The lane pick sorts every eligible lane** (W6). A known limit (take p95 1.6 to 4.8 ms from 1
     to 1,000 lanes); a bounded candidate set for placements with thousands of lanes follows in M5.
     Status: decided by the lead 2026-11-04, applied (section 9.5.3; roadmap M5).
115. **Job throughput** (W7). The take delivers 417 to 718 jobs per second at batch 1, 4,020 to
     5,500 at batch 10 and 16,067 to 20,899 at batch 50 (four takers); a placement's job rate is
     bounded by its unit rate (1,757 to 2,519 units per second across eight tenants measured); the
     default take batch is 10. Status: decided by the lead 2026-11-04, applied (sections 9.5.7, 26.3).
116. **DDL of the queue tables** (W8). `kw_jobs`, `kw_job_lanes`, `kw_job_lane_counts` and
     `kw_job_groups` as the spike built them; `kw_job_lane_counts` carries the lane's scope column,
     because under forced row-level security a counter row the unit cannot see is updated zero times
     without an error. Status: decided by the lead 2026-11-04, applied (sections 9.5.2, 14.3.9).
117. **`$vmin` and the retry jitter** (W9). `$vmin` is the least virtual time of lanes with
     available work, read in the take's unit; unit retries use full jitter over 2, 4 and 8 ms for
     three attempts, then the unit fails. Status: decided by the lead 2026-11-04, applied (sections
     9.5.3, 14.3.6).
118. **The take on PostgreSQL 18** (W10). It runs unmodified (the numeric `limit` is accepted).
     Status: decided by the lead 2026-11-04, applied (section 9.5.3).
119. **Receiver identity** (K2, 16.5.8). Receivers keep one fixed service principal; a receiver's
     `verify` resolver may attach typed claims, declared by the receiver (Trail's device id), to the
     principal's context, and rules may condition on those claims; never a per-request identity.
     Status: decided by the lead 2026-11-04, applied (section 16.5.8; overview chapter 13).

120. **App sources count as module sources for the purity plugins** (found by the plugin fixtures,
     section 13.9 against 23.1). `pure-parts`, `no-module-state` and `no-await-in-parts` also run
     on `**/apps/*/src/**`, since an app's `src/actions/` and `src/policies/` hold parts like a
     module's. Status: decided by the lead 2026-11-04, applied (section 13.9, the preset).

## N. M1 plan gaps (2026-11-04)

The M1 plan (the work-package plan for roadmap M1) listed 62 places where the specification was
silent or contradicted itself, S-01 to S-62, each with a decision. The lead decided all of them on
2026-11-04 and the specification pass of the same day wrote them into architecture.md, the roadmap,
api-sketch.ts and ADRs 0006, 0007, 0014 and 0015; each entry names the plan's number and the
sections it touched.

121. **No `engines` field before the first publish** (S-01). Packages carry no `engines` field in
     M1, because Dependabot's updater refuses `"node": ">=26"`; `keelwerk doctor` checks Node 26 or
     later, and the lead decides between the field and Dependabot's version updates before the first
     publish (roadmap M1, criterion 12). Status: decided by the lead 2026-11-04 (M1 plan S-01),
     applied (sections 13.2, 22; roadmap M1).
122. **Types the code blocks named without defining** (S-02). `StoredJobSpec`, `StoredJob`,
     `JobAttempt`, `JobOutcome`, `JobId`, `Receipt`, `ReceiptOutcome`, `DataKey`, `SealedValue`,
     `TrackSnapshot`, `TableSpec`, `ColumnSpec`, `IndexSpec`, `ForeignKeySpec`, `Catalogue`,
     `AppliedMigration`, `ShapeRef`, `RelationDescriptor`, `IndexDescriptor`, `DerivedIndexField`,
     `SearchIndexDescriptor`, `ExternalMapping`, `NormalizerRef`, `PersonalParams`,
     `FieldConstraints`, `Carrier`, `ActorRef`, `Tracer`, `Telemetry`, `SecretResolver`,
     `StateToken` and `Scope` are defined at the code blocks that use them (`WorkClassStats` and
     `CommandReceipt` were defined in sections 21.4 and 4.7). `Scope` is `Exclude<StorageScope, {
     level: 'namespace' }>`, while a principal's own `scope` stays `{ backend, tenant }`. Status:
     decided by the lead 2026-11-04 (M1 plan S-02), applied (sections 7.7, 8.5, 9.2, 14.3.2, 14.3.9,
     14.6.2, 14.6.7, 14.7.4, 15.1.7, 16.3.2).
123. **The adapter contract grows by members** (S-03). Each interface carries the members its
     release implements, so no adapter ships a stub: M1's `Unit` has `rows`, `events`, `receipts`,
     `jobs`, `usage`, `buckets`, `keys`, `serials`, `nested`, `afterCommit` and, on deployment-scope
     units, `scopeKeys`; `JobStore` lacks only `schedules()`, and `EventStore` lacks `compact`,
     `purgeStream`, `purgeTransient` and `redact`. M2 adds `consumers`, `tombstones`, `streams`,
     `schedules()` and those members with their users and tables, and conformance cases 5 (stream
     records), 10 (consumers, tombstones, streams, the worker scenarios) and 11 join then. Status:
     decided by the lead 2026-11-04 (M1 plan S-03), applied (section 14.3.2; roadmap sections 1 and
     3 (M1, M2)).
124. **Section 23 wins over the spike's layout** (S-04). Ported fixtures and the generator follow
     section 23: entity actions under `actions/<entity>/`, import aliases only on a clash, fills
     named `<point>Fill`, and the generated header of section 23.5. Status: decided by the lead
     2026-11-04 (M1 plan S-04), applied (no text change (sections 23.2 to 23.5 already state it)).
125. **`prepare` with loads only in M1** (S-05). The `prepare` types are complete in M1, the M1
     runtime runs `prepare` with loads only, and a `ctx.perform` request fails with `internal`,
     `core.request_not_allowed`; inline effects ship in M2. Status: decided by the lead 2026-11-04
     (M1 plan S-05), applied (section 7.9.3; roadmap M1).
126. **`core.request_not_allowed`** (S-06). One new core code, `core.request_not_allowed`
     (`internal`), names the request and the reason when a part makes a request it may not make once
     types are bypassed, or one the running release does not answer. Refusals at compose and at boot
     are named problems, never codes (`asyncReactionsUnavailable`, `scopeDirectoryUnavailable`).
     Status: decided by the lead 2026-11-04 (M1 plan S-06), applied (sections 7.6, 7.9.3, 7.9.6,
     10).
127. **The rest of the queue tables** (S-07). `kw_jobs` adds `kind`, `principal`, `causation`,
     `build_id`, `api_version`, `ordering`, `group_spec`, `retry`, `heartbeat_seconds`,
     `expire_in_seconds`, `dead_letter`, `created_at` and the state `dead`; priority and capability
     set are the lane's and `onConflict` is not stored. `kw_job_history` gets its DDL without input,
     `kw_job_groups` adds `scope_id`, `rate`, `tokens` and `refilled_at` under a policy that admits
     rows whose `scope_id` is null or the unit's scope, and the enqueuing unit upserts its lane and
     its two count rows; deployment-wide groups arrive in M2. Stored format final from M1. Status:
     decided by the lead 2026-11-04 (M1 plan S-07), applied (sections 9.5.2, 14.3.9; ADR 0015).
128. **Module packages compile from the package root** (S-08). Module packages and fixture modules
     with migrations compile with `rootDir: "."` and `include: ["src", "migrations"]`; `"."` exports
     `src/module.generated.ts` under the source condition and `dist/src/module.generated.js`
     otherwise; the manifest carries `migrations: new URL('../migrations/', import.meta.url)`.
     Status: decided by the lead 2026-11-04 (M1 plan S-08), applied (sections 13.3, 13.4, 23.2; ADR
     0006).
129. **The control store's root** (S-09). The control store's physical root is `kw__control`; app
     ids follow the module id pattern, so no app id maps to a name with two consecutive underscores.
     Status: decided by the lead 2026-11-04 (M1 plan S-09), applied (sections 5.1, 14.2, 14.4.2,
     14.4.4).
130. **Where the PostgreSQL SQL lives** (S-10). All PostgreSQL SQL (codecs, unit statements, DDL,
     row-level security, the commit tail, the fair take) lives in `data/src/sql/postgres/` and
     serves `adapter-postgres` and PGlite; `@keelwerk/adapter-postgres` keeps the `pg` driver,
     pools, the notifier, the cluster identity and error mapping. Status: decided by the lead
     2026-11-04 (M1 plan S-10), applied (sections 14.3.1, 14.3.7, 22).
131. **The core module's layout** (S-11). The core module's parts follow the module layout under
     `core/src/core-module/`; `core-module/module.ts` is hand-written and annotated `Core` in place
     of a generated manifest, and the layout pass treats it like a sugar module's `module.ts`.
     Status: decided by the lead 2026-11-04 (M1 plan S-11), applied (sections 13.3, 23.9).
132. **`defineDeployment` members ahead of their subsystems** (S-12). The types are complete; a
     runtime validates and keeps every member, and M1 uses `apps`, `infrastructure`, `control`,
     `placements`, `tenantResolution`, `operator`, `keys`, `anchors` and `queues.<q>.running`.
     Status: decided by the lead 2026-11-04 (M1 plan S-12), applied (section 4.6; roadmap M1).
133. **Where fixtures live** (S-13). Runtime fixtures in
     `packages/testing/src/fixtures/modules/<id>/{src,migrations}` and `.../apps/<id>/src`, exported
     through `@keelwerk/testing/fixtures`; the DSL type fixtures in
     `packages/core/test/fixtures/modules/<id>/src`; none are packages, and the layout pass treats
     `**/fixtures/modules/*` as module roots and `**/fixtures/apps/*` as app roots. Status: decided
     by the lead 2026-11-04 (M1 plan S-13), applied (sections 16.3.8, 23.8).
134. **Row-level security on PGlite** (S-14). Provisioning creates a `NOSUPERUSER NOBYPASSRLS` role
     and every PGlite unit runs `SET LOCAL ROLE` to it, because PGlite's superuser bypasses
     row-level security; migrations run as the owner. Status: decided by the lead 2026-11-04 (M1
     plan S-14), applied (section 14.3.7).
135. **Conformance kit and suites** (S-15). The kit (oracle, descriptors with every kind, fast-check
     arbitraries, the unsealing oracle) is `@keelwerk/data/conformance`; the scenario suites and
     `describeAdapterConformance({ name, factory, placement, networked })` are in
     `@keelwerk/testing`. Status: decided by the lead 2026-11-04 (M1 plan S-15), applied (sections
     14.10, 22).
136. **Budgets for the portal and the conformance app** (S-16). Apps with other module counts get
     their counts at their first green build plus 15 %, recorded in
     `scripts/type-budgets/budgets.json`. Status: decided by the lead 2026-11-04 (M1 plan S-16),
     applied (section 13.11).
137. **TS2883 fails CI with the other three** (S-17). Step 8 of CI fails on TS7056, TS2742, TS4023
     and TS2883 (decision 101). Status: decided by the lead 2026-11-04 (M1 plan S-17), applied
     (section 13.8).
138. **The type-budgets package** (S-18). attest runs in the private package
     `packages/type-budgets/` with its own exact `typescript` 6.0.3; the CLI imports the compiler
     API as `typescript-6` (`npm:typescript@6.0.3`), so the workspace's `tsc` stays 7.0.2. Status:
     decided by the lead 2026-11-04 (M1 plan S-18), applied (sections 13.2, 13.8, 13.11, 22; roadmap
     M1).
139. **Positioned loads in the row store** (S-19). `RowQuery.positioned?: true` makes the adapter
     read the scope counter in the same statement and return `RowPage.position`; the kernel issues
     positioned single loads as `find` with `first: 1`, and a locked load reads its position with
     `EventStore.head()` in a statement after the lock. Status: decided by the lead 2026-11-04 (M1
     plan S-19), applied (section 14.3.2).
140. **Tenant resolvers in M1** (S-20). M1 resolves `byHostname` (over `core.domain`) and
     `byHeader`; `byScopeKey` and `byPath` are typed and refused at boot with the named problem
     `scopeDirectoryUnavailable` until the scope directory of gap G2 exists. Status: decided by the
     lead 2026-11-04 (M1 plan S-20), applied (gap G2; roadmap M1).
141. **Drafts built from an id** (S-21). A draft built from an id carries no expected version: the
     kernel loads and locks the row at apply, uses its version and records that load in `reads`; a
     missing row is `not_found`, and such a draft never answers `core.version_mismatch`. No new
     syntax. Status: decided by the lead 2026-11-04 (M1 plan S-21), applied (sections 8.5, 15.1.6).
142. **Build ids and revisions before rollouts** (S-22). The build id is the SHA-256 of a minimal
     build manifest (package versions, migration checksums per track, API versions); the revision is
     1 until `core.rollout` exists; `connect` registers the pair in `core.process`. Stored format
     final from M1. Status: decided by the lead 2026-11-04 (M1 plan S-22), applied (sections 15.1.3,
     19.1; ADR 0007).
143. **Flags in M1** (S-23). M1 ships `defineFlag` as a typed declaration listed by bases; a flag
     request answers the declared default with reason `DEFAULT` (written `default` until decision
     185), recorded in `meta.flags`; providers, targeting and `core.flag` are M2. Status: decided by
     the lead 2026-11-04 (M1 plan S-23), applied (section 20.2; roadmap M1).
144. **Asynchronous work without workers in M1** (S-24). M1 writes job rows, timers, `core.effect`
     `requested` records and `accepted` receipts in final form and runs no worker: `execution:
     'async'` (and `either` preferring async) answers `{ commandId, status: 'accepted' }`, compose
     refuses async reactions with `asyncReactionsUnavailable` (auth's `recordLogin` is inline in
     M1), and a resolver's effects run in a short unit right after `open`, so sessions slide only
     once M2 runs the keyed job. Boot and `keelwerk doctor` list every queue with work and no
     worker; the minimal action-job worker in M1 is not taken. Status: decided by the lead
     2026-11-04 (M1 plan S-24), applied (sections 7.4, 7.7, 9.2, 9.5.6, 13.12, 17.2.3; roadmap M1
     and M2; ADR 0015). Confirmed by Jens 2026-11-04.
145. **`asOf` by position stays kernel-internal** (S-25). Re-decides read `asOf` a position inside
     the kernel; the generated `get` and `history` keep `asOf` by instant in M1, and the question of
     section 26.3 stays open for later. Status: decided by the lead 2026-11-04 (M1 plan S-25),
     applied (sections 7.9.6, 26.3).
146. **The control entities' fields** (S-26). `core.backend` has `name` (unique), `app`,
     `placement`, `apiVersion`, `config` and `status`; `core.tenant` has `backendId`, `name`,
     `placement` (optional), `apiVersion`, `domains` and `status`; both are created by the generated
     `create`, so the sketch's `core.tenant.create` calls stay valid. A core inline reaction keeps
     `core.domain` rows in step with `domains` (a held host name fails with `conflict`), and the
     runtime writes `core.placement` and `core.namespace` at `connect` and `migrate`. Status:
     decided by the lead 2026-11-04 (M1 plan S-26), applied (sections 3.1, 5.1, 17.5.4;
     api-sketch.ts unchanged).
147. **Tenant hooks in their own unit** (S-27). The kernel runs each `onTenantCreated` hook in its
     own tenant-scope unit right after the creating unit commits; a failure is logged and listed by
     `keelwerk doctor`; M2 moves hooks onto the queue. Status: decided by the lead 2026-11-04 (M1
     plan S-27), applied (sections 3.3, 12.3, 13.12; roadmap M2).
148. **Generated documents per version everywhere** (S-28). Every surface-derived artefact is
     written per version: `generated/<kind>/<app>/<version>.json` (`.graphql` for SDL). Status:
     decided by the lead 2026-11-04 (M1 plan S-28), applied (sections 16.5.7, 16.6.7, 16.9.9).
149. **`core.composition` in M1** (S-29). `core.composition` ships in M1, because `keelwerk
     introspect` reads it. Status: decided by the lead 2026-11-04 (M1 plan S-29), applied (roadmap
     M1).
150. **The `prepare` comparison** (S-30). M1 delivers the prototype of both forms and its report
     without changing `@keelwerk/core`; M3 repeats the comparison on Trail's code. Status: decided
     by the lead 2026-11-04 (M1 plan S-30), applied (sections 7.9.4, 26.2; roadmap M0 and M1).
151. **Generated `changes` and `queryChanges` in M1** (S-31). `changes`, `queryChanges` and the
     disclosure rule are generated on every entity in M1, with tokens final from M1; `watch` stays
     with `@keelwerk/live` in M2. Status: decided by the lead 2026-11-04 (M1 plan S-31), applied
     (roadmap M1).
152. **The token format** (S-32). `<prefix>_<public id>_<secret>` in lower-case base32, a 128-bit
     public id and a 256-bit secret, the prefix from `ctx.secrets.issue({ prefix })` (`pss` for auth
     sessions); the verifier is HMAC-SHA-256 of the secret under HKDF-SHA-256 of the scope's key
     (tenant key; backend key for backend-scope tokens), info `keelwerk/token-verifier/1/<prefix>`,
     stored as `field.verifier()`. Stored format final from M1. Status: decided by the lead
     2026-11-04 (M1 plan S-32), applied (section 17.2.2; ADR 0014).
153. **The core's own API versions** (S-33). A framework-maintained `defineApiVersions` in the core,
     whose first version is the date of the first 0.x publish, versions the operator endpoint; the
     question of section 26.3 is closed. Status: decided by the lead 2026-11-04 (M1 plan S-33),
     applied (sections 18.3, 26.1, 26.3).
154. **The ledger file's format** (S-34). JSON lines of RFC 8785 canonical JSON, each with a `type`
     (`anchor` in M1; `erasure` and `keyTombstone` from M2), synced to disk per batch, append only;
     readers skip unknown types. Stored format final from M1. Status: decided by the lead 2026-11-04
     (M1 plan S-34), applied (section 14.7.6).
155. **Rewind detection in M1** (S-35). In M1, `connect` compares each scope's head with its newest
     anchor and logs a rewound scope, `keelwerk doctor` lists it and `keelwerk db verify` fails on
     it; the epoch bump and the control store's mark tables come in M2. Status: decided by the lead
     2026-11-04 (M1 plan S-35), applied (sections 13.12, 14.7.6; roadmap M1).
156. **Rate buckets** (S-36). Table `kw_rate_buckets (scope_id, bucket, tokens, refilled_at)` under
     forced row-level security and `Unit.buckets: BucketStore` with `take(bucket, cost, { capacity,
     refillPerSecond })`; an admission rule's `BucketDemand` names buckets charged at `admit` and
     buckets charged only after a declared error (auth's failed attempts), taken in a short unit
     after the outcome. M1 takes one token at a time from the shared row (per-process allowances
     come with M2's quota model), and a bucket key is stored as an HMAC under a key derived from the
     scope's key (info `keelwerk/bucket/1`). Status: decided by the lead 2026-11-04 (M1 plan S-36),
     applied (sections 12.2, 14.2, 14.3.1, 14.3.2, 17.2.6; roadmap M1).
157. **Prefix queries without tags in M1** (S-37). M1 adapters declare `encryptedQueries: {
     equality: true, tagSets: false, order: false, maxScan }` and write equality tags only; a field
     keeps its `prefix` declaration, and `startsWith` on it takes the kernel's bounded in-memory
     scan (past `maxScan`, `core.scan_limit`), listed by `keelwerk doctor`; M4 adds the tags through
     a reindex. No M1 module declares `contains`, `order` or `search`. Status: decided by the lead
     2026-11-04 (M1 plan S-37), applied (sections 14.3.3, 14.7.9.10, 14.7.9.13; roadmap M1).
158. **Trusted proxies** (S-38). `httpHost({ trustedProxies })`, a list of CIDR ranges, empty by
     default. Status: decided by the lead 2026-11-04 (M1 plan S-38), applied (section 16.4.10).
159. **The transport fixture in M1** (S-39). M1 runs values, errors, pagination, masks, async
     acceptance (202 and the stored receipt), idempotent replay, concurrent duplicates, optimistic
     concurrency and the browser scenarios; the streaming and selection-limit scenarios are written
     and skipped under the marker `m2`. Status: decided by the lead 2026-11-04 (M1 plan S-39),
     applied (section 16.3.8; roadmap M1).
160. **Sign-up** (S-40). `auth.signUp` (public, rate-limited; `identifier`, `password`, optional
     `displayName`) creates a password credential under a fresh opaque subject and records the
     domain event `auth.credential.signedUp` with the display name (`auth.identifier_taken` when the
     identifier has an active password credential). With accounts selected, the inline reaction
     `register-profile` on `signedUp` invokes `accounts.register`, and `link-profile` on
     `accounts.profile.created` sets the credential's `profileId` and makes the profile id its
     subject, re-sealing its personal values, all in one unit. The specification pass moved
     `register-profile` from the plan's `auth.credential.created` to `signedUp`, because `created`
     carries no display name and also fires for credentials added later. Status: decided by the lead
     2026-11-04 (M1 plan S-40), applied (sections 17.2.1, 17.2.2, 17.2.6, 17.2.8, 23.2;
     api-sketch.ts; ADR 0014). Confirmed by Jens 2026-11-04.
161. **`optional` modules are regular dependencies** (S-41). A module listed in `optional` is a
     regular dependency of the package in M1 (`module-auth` depends on `module-accounts`), decided
     before the first publish; the question of section 26.3 is closed. Status: decided by the lead
     2026-11-04 (M1 plan S-41), applied (sections 23.7, 26.1, 26.3).
162. **`http://` profiles for loopback only** (S-42). Profiles accept `http://` URLs for loopback
     hosts only, which is how `keelwerk login` reaches `keelwerk dev`. Status: decided by the lead
     2026-11-04 (M1 plan S-42), applied (sections 16.9.1, 16.9.6).
163. **Reset tokens and the reset link** (S-43). `auth.resetToken` (`history: 'state'`,
     `dataSubject: 'subject'`: `subject`, `credentialId`, `publicId` unique, `tokenVerifier`,
     `expiresAt`, `usedAt`) holds the reset token, and the operator command `auth.issueResetLink`,
     inside an entered tenant, returns the one-time token and its expiry. Status: decided by the
     lead 2026-11-04 (M1 plan S-43), applied (sections 17.2.2, 17.2.5, 17.2.8).
164. **`db apply --contract` before rollouts** (S-44). In M1 `--contract` applies only while every
     live `core.process` runs the same build id, else `core.rollout_not_finalized`; no M1 migration
     has a contract step. Status: decided by the lead 2026-11-04 (M1 plan S-44), applied (section
     14.6.4; roadmap M1).
165. **The portal's layout** (S-45). `examples/portal/` is a project root in the layout of section
     23.1 (`.launchway/`, `apps/portal/` as the private package `@keelwerk-examples/app-portal`,
     `modules/` once it has own modules); the workspace lists `packages/*`, `examples/*/apps/*`,
     `examples/*/modules/*` and `spikes/*`. Status: decided by the lead 2026-11-04 (M1 plan S-45),
     applied (sections 22, 23.1, 23.9; roadmap M1).
166. **Who provides the pino logger** (S-46). `@keelwerk/cli` provides the pino logger for `keelwerk
     start` and `keelwerk dev`; the core's default is a no-op logger. Status: decided by the lead
     2026-11-04 (M1 plan S-46), applied (sections 11, 16.11.3, 22).
167. **One development database** (S-47). One PGlite directory, `.keelwerk/dev-db`, holds the
     control root and each app's root, and the ledger file is `.keelwerk/ledger.log`, so the
     doctor's shared-cluster warning stays silent. Status: decided by the lead 2026-11-04 (M1 plan
     S-47), applied (sections 13.6, 14.3.7).
168. **The cookie hint applies to browsers only** (S-48). The `http.cookie` hint applies only to
     browser requests (a `Sec-Fetch-Site` or `Origin` header present) under host-based tenant
     resolution, on every HTTP transport: then the cookie is set and `omitFromBody` applies; every
     other request gets the full output and no cookie, so bearer clients and `keelwerk login`'s
     `tokenField` receive the token. Status: decided by the lead 2026-11-04 (M1 plan S-48), applied
     (sections 16.4.10, 16.9.6, 17.2.7).
169. **`startRuntime`** (S-49). `startRuntime(deployment: DeploymentDefinition, options:
     RuntimeOptions): Promise<Runtime>` with `RuntimeOptions { role, listen, apps?, logger?, clock?
     }` and `Runtime { invoker, surface(appId, version?), registry(appId), host?, stop(deadlineMs)
     }`; `listen: false` serves the CLI's project mode and tests, and `defineDeployment` returns a
     subtype of `DeploymentDefinition`. Status: decided by the lead 2026-11-04 (M1 plan S-49),
     applied (section 3.3).
170. **Runtime values of requests, drafts and effects** (S-50). One frozen plain object per kind
     with a `kind` discriminant, built only by the DSL's context constructors: requests `load`,
     `maybe`, `ask`, `all`, `flag`, `id`, `random`, `secret`, `compute` and `perform`; drafts
     `create`, `update`, `archive`, `restore` and `event`; effects `invoke`, `enqueue`, `setTimer`,
     `cancelTimer`, `settle` and `external`. Status: decided by the lead 2026-11-04 (M1 plan S-50),
     applied (section 7.9.2).
171. **Where the fallbacks live** (S-51). Choosing the kernel path is core code (planner, write
     path, feed); what runs below the contract (the polling feed, capability masks, the fallback
     report's rows and costs) is in `data/src/fallbacks/`. Status: decided by the lead 2026-11-04
     (M1 plan S-51), applied (sections 14.3.3, 22).
172. **The transport suite takes `fetch`** (S-52). The transport conformance suite takes a `fetch`
     function and a codec from the caller, so `@keelwerk/testing` depends on no transport. Status:
     decided by the lead 2026-11-04 (M1 plan S-52), applied (sections 16.8.5, 22).
173. **Unix sockets in the client** (S-53). The subpath `@keelwerk/client/unix-socket` exports
     `unixSocketFetch` over `node:http` with `socketPath`; the main entry stays browser-safe.
     Status: decided by the lead 2026-11-04 (M1 plan S-53), applied (sections 16.8.4, 22).
174. **How adapters report retryable failures** (S-54). Adapters throw `RetryableUnitError`
     (kernel-internal, never on the wire) for serialization failures and deadlocks; version
     conflicts stay `conflict` `core.version_mismatch`. Status: decided by the lead 2026-11-04 (M1
     plan S-54), applied (section 14.3.6).
175. **Wrapped scope keys** (S-55). `kw_scope_keys (scope_id, level, version, wrapped, created_at,
     retired_at, primary key (scope_id, version))` in the control root, reached through
     `Unit.scopeKeys` on deployment-scope units. Stored format final from M1. Status: decided by the
     lead 2026-11-04 (M1 plan S-55), applied (sections 14.2, 14.3.1, 14.3.2, 14.4.4, 14.7.4).
176. **The migration file's export** (S-56). Each migration file exports `migration: MigrationFile`;
     migration files are exempt from the name-after-export rule. Status: decided by the lead
     2026-11-04 (M1 plan S-56), applied (sections 14.6.2, 23.3).
177. **No changelog per package** (S-57). One root `CHANGELOG.md` for the lockstep packages; no
     package has its own. Status: decided by the lead 2026-11-04 (M1 plan S-57), applied (sections
     22, 23.2).
178. **The binary inside the workspace** (S-58). `bin` points at `dist/bin/keelwerk.js`; the root
     script `keelwerk` runs `node --conditions=@keelwerk/source packages/cli/src/bin/keelwerk.ts`.
     Status: decided by the lead 2026-11-04 (M1 plan S-58), applied (section 16.9.1).
179. **Physical names in the core** (S-59). Because physical names equal the derived names (decision
     55b), `physicalTableName` and `physicalColumnName` are pure functions of the core, used by the
     registry and by the planner, which records them in snapshots. Status: decided by the lead
     2026-11-04 (M1 plan S-59), applied (sections 6.1, 14.3.2, 14.4.2; ADR 0006).
180. **`writer` and `flags` in the chain** (S-60). Yes: `writer` and `flags` enter the hash-chain
     content, as section 15.1.8 lists; the question of section 26.3 is closed. Stored format final
     from M1. Status: decided by the lead 2026-11-04 (M1 plan S-60), applied (sections 15.1.8, 26.1,
     26.3; ADR 0007).
181. **`displayName` stays plaintext** (S-61). `accounts.profile.displayName` is plaintext in M1, as
     the sketch has it; making it personal later is a migration of section 14.6.4. The question of
     section 26.3 is closed. Status: decided by the lead 2026-11-04 (M1 plan S-61), applied
     (sections 17.2.1, 26.1, 26.3).
182. **Endpoints without the live module** (S-62). M1 mounts `/invoke`, `/batch`, `/surface` and
     `/capabilities`; `wait` is ignored as section 16.4.7 allows, and the client's `subscribe` and
     `waitForEffects` are typed and reject with `unavailable` `core.live_unavailable`. Status:
     decided by the lead 2026-11-04 (M1 plan S-62), applied (sections 16.4.7, 16.8.2, 16.8.4;
     roadmap M1).
183. **Unicode version of Node 26** (Node 26 re-checks). `process.versions.unicode` is 17.0 on Node
     26.13.0, the same as on Node 24.21.0, and NFKC followed by lower case of U+1E9E U+0130 gives
     `ßi̇` on both. The question of section 26.3 is closed: `keelwerk doctor` warns on a mismatch and
     `keelwerk db reindex` rebuilds. Status: decided by the lead 2026-11-04, applied (sections
     14.7.9.3, 26.1, 26.3).

## O. M1 follow-ups from work packages 01–34 (2026-11-04)

The M1 work packages 01 to 34 settled rules the specification left open or stated otherwise. The
lead decided each at the package's review or merge (STATE entries marked SPEC FOLLOW-UP, the plan's
lead decisions and the change notes of its frozen interfaces), and the specification pass of
2026-11-04 wrote them into architecture.md, where section 26.1 lists them by number. Points that
only needed the architecture text brought in line with an entry of section N get no entry here. The
open points at the end are questions for the packages named; the architecture text describes what is
built until they are answered.

184. **Write shapes by level** (WP-05). The field-level write shapes are `InsertOf<F, Owner>`,
     `PatchOf<F, Owner>` and `OfflinePatchOf<F, Owner>` over a set of fields (serial fields never
     appear; the offline patch also leaves out exclusive and unique fields), and the app-level
     `Insert<App, Ref>`, `Patch<App, Ref>` and `OfflinePatch<App, Ref>` of section 4.7 apply them to
     the entity's non-hidden fields; module-local drafts use the field-level names. Status: decided
     by the lead 2026-11-04 (M1 plan, WP-05). Applied in: sections 4.7 and 14.8.1.
185. **Upper-case flag reasons** (WP-07). Flag reasons are the upper-case OpenFeature reasons
     everywhere, in `FlagResolution`, in `meta.flags` and in `explain`: M1's answer of the declared
     default has reason `DEFAULT` (provider `default`), which amends the text of entry 143. Status:
     decided by the lead 2026-11-04 (M1 plan, WP-07). Applied in: sections 20.2 and 26.1 (row 143);
     entry 143.
186. **What a personal field's flag leaks** (WP-05). `PersonalFlags.leaks` always lists `presence`,
     then one leak per declared capability (`LeakOf`), and never `length`, because every sealed
     value shows its padded length whatever the field declares. Status: decided by the lead
     2026-11-04 (M1 plan, WP-05). Applied in: section 14.7.9.2.
187. **Custom normalisers** (WP-05). A custom normaliser is `{ id, version, normalize: (value:
     string) => string }`; changing its id or version rebuilds the field's indexes. Status: decided
     by the lead 2026-11-04 (M1 plan, WP-05). Applied in: section 14.7.9.2.
188. **`parseTypeId` returns `undefined`** (WP-05). `parseTypeId(text, prefix)` returns the
     canonical lower-case UUID, or `undefined` for malformed text, another prefix or an overflowing
     suffix; the caller raises the error. Status: decided by the lead 2026-11-04 (M1 plan, WP-05).
     Applied in: section 6.4.
189. **The runtime view of a deployment** (WP-06). `startRuntime` takes `DeploymentDefinition`, of
     which `defineDeployment` returns a subtype: `apps` as `{ id }[]`, open `control` and
     `placements` entries, `operator?`, `keys?`, `tenantResolution?` and the other members listed in
     section 4.6, with members an adapter or provider reads left open. Status: decided by the lead
     2026-11-04 (M1 plan, WP-06). Applied in: section 4.6.
190. **Cookies and cache of a principal resolution** (WP-06). A `PrincipalResolution` is `{
     principal, effects?, clearCookies?, cache? }`: `clearCookies` names the cookies the host clears
     for a stale session (copied to `InvocationSession.clearCookies`), and `cache` (`{ key, entity,
     id }`) is what the kernel caches the session under and whose change record drops it; the
     session also records `resolvedBy`. Status: decided by the lead 2026-11-04 (M1 plan, WP-06).
     Applied in: sections 16.3.4 and 17.2.4.
191. **Effects and command ids in the invocation envelope** (WP-06, WP-24). `InvokeResponse`'s ok
     branch carries `commandId?` (for every command, batch items included) and `effects?` (the
     deferred effect ids), so the invocation protocol reports what REST puts in
     `Keelwerk-Command-Id` and `Keelwerk-Effects`. Status: decided by the lead 2026-11-04 (M1 plan,
     WP-06, WP-24). Applied in: sections 16.4.7, 16.4.8 and 16.8.2.
192. **Separate backend and tenant header selectors** (WP-06). The header tenant resolver is
     `byHeader(tenantHeader, { backendHeader? })`: the tenant from one header and, when the tenant
     does not imply its backend, the backend from a second; the typed client and the CLI send
     `x-keelwerk-backend` and `x-keelwerk-tenant`. Status: decided by the lead 2026-11-04 (M1 plan,
     WP-06). Applied in: section 16.8.2.
193. **API version statuses in the capabilities document** (WP-06). `CapabilitiesDocument` is `{
     protocols, apiVersions }`, each version with `status: 'current' | 'deprecated' | 'retired'` and
     `deprecated?: { at, sunset }`. Status: decided by the lead 2026-11-04 (M1 plan, WP-06). Applied
     in: section 18.7.
194. **The resolver's clock is a parameter** (WP-06). `PrincipalResolver.resolve(carrier, { scope,
     clock })`: a resolver reads the invocation's time from the clock it is handed, never ambient
     time, for expiry checks and the idle extension. Status: decided by the lead 2026-11-04 (M1
     plan, WP-06). Applied in: sections 17.2.3 and 17.2.4.
195. **Relation paths in the condition tree** (WP-09). A nested relation path in the object form is
     one plain object per step and normalises to one quantifier node with a dotted `relation`
     (`'team.members'`), which compilers and the in-memory matcher resolve hop by hop. Status:
     decided by the lead 2026-11-04 (M1 plan, WP-09). Applied in: section 8.3.
196. **Absent values in `in` and `nin` lists are rejected** (WP-09, WP-16). A `null` or `undefined`
     entry in an `in` or `nin` list is rejected at normalisation instead of matching nothing, so a
     deny rule never fails open: `validation`, `core.malformed_request` on the wire, `internal`,
     `core.internal` when a rule produced it. Status: decided by the lead 2026-11-04 (M1 plan,
     WP-09, WP-16). Applied in: sections 8.3 and 14.3.4.
197. **Decimals and wide integers compare by value** (WP-09). Decimal fields compare numerically,
     not as text (the interpreter learns the kind through `EvaluateOptions.kindOf`), and a `bigint`
     and a `number` compare exactly, equal only when the number is an integer of the same value.
     Status: decided by the lead 2026-11-04 (M1 plan, WP-09). Applied in: section 14.3.4.
198. **Kind-level error codes** (WP-08). Every error kind has a registered core code `core.<kind>`
     (`core.validation`, `core.conflict`, `core.internal` and the others), the code of the
     kind-level factories and of the adapters' unique violations. Status: decided by the lead
     2026-11-04 (M1 plan, WP-08). Applied in: section 10.
199. **`toWire` returns the body without the request id** (WP-08). `toWire(error, audience)` returns
     `Omit<WireError, 'requestId'>` and the transport host adds `requestId`; `KeelwerkError` and
     `WireError` carry the deciding deny rule's `reason?`. Status: decided by the lead 2026-11-04
     (M1 plan, WP-08). Applied in: sections 10 and 16.4.6.
200. **The operator audience** (WP-08). The `operator` audience of `toWire` sees exactly what
     `development` sees (rule ids, unredacted `internal` messages with issues and details); only the
     public audience gets the redacted form. Status: decided by the lead 2026-11-04 (M1 plan,
     WP-08). Applied in: sections 10 and 16.4.6.
201. **Injective physical names** (WP-08, WP-12). Entity names are snake-cased into table names like
     field names into columns, and entity and field names are camelCase without consecutive capitals
     (`invalidEntityName` at `defineModuleBase`, `invalidFieldName` at `defineEntity`); injectivity
     rests on that naming rule together with compose's `tableCollisions` and `columnCollisions`.
     Status: decided by the lead 2026-11-04 (M1 plan, WP-08, WP-12). Applied in: sections 4.7, 5.1
     and 14.4.2.
202. **UUIDv8 part encoding** (WP-08). `deriveUuidV8(...parts)` hashes each part as a 4-byte
     big-endian length followed by its UTF-8 bytes; the encoding is irreversible, because receipt
     ids and external stream ids depend on it. Status: decided by the lead 2026-11-04 (M1 plan,
     WP-08). Applied in: section 14.5.2.
203. **Hybrid clock overflow** (WP-08). A counter overflow within one millisecond advances the
     clock's millisecond part by one and restarts the counter, without waiting for the wall clock.
     Status: decided by the lead 2026-11-04 (M1 plan, WP-08). Applied in: section 14.5.3.
204. **Definition refusals are named problems** (WP-12). `defineEntity`, `defineModuleBase` and
     `defineModule` refuse with a `KeelwerkError` `internal`, `core.internal` whose `details` is the
     `CompositionProblem`: `invalidTypeIdPrefix`, `uniquePersonalFieldTruncatedTags`,
     `uniquePersonalFieldSubjectKeys`, `containsNeedsMaxLength`, `invalidFieldName`,
     `invalidEntityName` and `partMountedTwice`. Status: decided by the lead 2026-11-04 (M1 plan,
     WP-12). Applied in: section 4.7.
205. **The module value's behaviour members** (WP-12). The module value and `ModuleOf` carry
     `effects`, `executors`, `policies`, `reactions`, `fills` (from the literal's
     `extensionPoints`), `schedules`, `lifecycle`, `topics` and `changes`, contributed and
     conditional entries their own `actions`, `policies`, `reactions` and `fills`, and
     `defineModule` stamps each mounted part's reference as `ref`. Status: decided by the lead
     2026-11-04 (M1 plan, WP-12). Applied in: section 4.1.
206. **Row-level security settings and policy sets** (WP-11). A deployment-scope unit sets
     `keelwerk.deployment_id`, which admits control-root rows and `kw_scope_keys`; app roots admit
     `scope_id = coalesce(<tenant>, <backend>)`; namespace-scope units reach the queue tables
     through the `take` policy set and every other scoped table through the `maintenance` set.
     Status: decided by the lead 2026-11-04 (M1 plan, WP-11). Applied in: section 14.3.7.
207. **Composite lane links** (WP-11). `kw_job_lanes` has `unique (id, scope_id)`, and `kw_jobs` and
     `kw_job_lane_counts` link to it by `foreign key (lane_id, scope_id)`, because foreign-key
     checks bypass row-level security; this departs from the DDL of entry 116 by these constraints
     only. Status: decided by the lead 2026-11-04 (M1 plan, WP-11). Applied in: section 9.5.2.
208. **Columns of the remaining framework tables** (WP-11). `kw_serials` keys on `(scope_id, entity,
     field, partition)` with `partition` the canonical JSON of the `per` values; `kw_subject_keys`
     has `key_id text`, `purpose` `data` or `index` and the key `(scope_id, key_id)`;
     `kw_value_keys` keys on `(scope_id, key_id)`; `kw_usage(scope_id, dimension, value)`;
     `kw_migrations.checksum` is hex text; the non-key columns of `kw_rate_buckets` and
     `kw_scope_keys` are `not null`. Stored format final from M1. Status: decided by the lead
     2026-11-04 (M1 plan, WP-11). Applied in: sections 12.2, 14.6.3, 14.7.4 and 15.1.4.
209. **Grants of the application role** (WP-11). The application role gets `select, insert` only on
     the append-only `kw_events` and `kw_shapes`, `select, insert, update, delete` on the other
     framework tables and `select` on `kw_migrations`; creating the role belongs to provisioning,
     not to the DDL. Status: decided by the lead 2026-11-04 (M1 plan, WP-11). Applied in: section
     14.3.7.
210. **A read's position** (WP-10). A read's position is `kw_positions.next - 1`, the last position
     committed in the scope, and 0 for a scope that never appended (with entry 139). Status: decided
     by the lead 2026-11-04 (M1 plan, WP-10). Applied in: section 15.1.4.
211. **How a relation's keys read** (WP-10). In a relation descriptor `by` is the field on the
     related rows and `to` the field of the owning row it matches, for to-one and to-many relations
     alike. Status: decided by the lead 2026-11-04 (M1 plan, WP-10). Applied in: sections 6.3 and
     14.3.2.
212. **Quantifiers ignore archived rows** (WP-10). Relation quantifiers (`some`, `none`, `every`,
     `is`) do not count archived related rows, in both interpreters. Status: decided by the lead
     2026-11-04 (M1 plan, WP-10). Applied in: section 14.3.4.
213. **The scoping plugin covers `insert ... select`** (WP-10). An `insert ... select` into a scoped
     table must list the scope column and select the unit's value as a bound value, else
     `forbidden`; its inner query and an upsert's update branch carry the scope predicate. Status:
     decided by the lead 2026-11-04 (M1 plan, WP-10). Applied in: section 14.4.3.
214. **The logger's signature** (WP-20). `Logger` methods take `(message, fields?)`, the message
     first, and `child(bindings)` returns a logger that adds the bindings to every line; the CLI's
     pino logger is adapted to it. Status: decided by the lead 2026-11-04 (M1 plan, WP-20). Applied
     in: section 11.
215. **Control entity fields and the `invocation` tenancy** (WP-20). `core.placement`,
     `core.namespace`, `core.operatorToken`, `core.process`, `core.commandReceipt` and `core.effect`
     have the fields of the table in section 3.1, backend and tenant `status` is `active` or
     `suspended`, and `core.commandReceipt` and `core.effect` use the core-only tenancy
     `invocation`, riding in the scope of the unit that writes them. Status: decided by the lead
     2026-11-04 (M1 plan, WP-20). Applied in: sections 3.1, 4.2, 14.3.2 and 16.2.2.
216. **Processes and scaling members** (WP-20). `processes.<name>` is a `ProcessDefinition`
     (`roles`, `capabilities?`, `slots?`, `placements?`, `provider?`, `scale?: { min?, max?,
     maxPerNode? }`, `drainSeconds?`), and `scaling` is `DeploymentScaling` (`maxProcesses?`,
     `maxCostPerHour?`, `providers?: { [name]: { max? } }`). Status: decided by the lead 2026-11-04
     (M1 plan, WP-20). Applied in: section 4.6.
217. **Contributions to the implicit core** (WP-20). Contributions to `core` are always active and
     need no dependency: `contributionsOutsideDependencies` exempts `core`;
     `defineTransportModule`'s `requires` is optional, and an `extensionPoints` mount takes a list
     of values as well as a `defineFill` part. Status: decided by the lead 2026-11-04 (M1 plan,
     WP-20). Applied in: section 5.6.
218. **Runtime members of the app value** (WP-20, WP-27). The app value carries `kind`, `id`,
     `modules` (core first), `execution`, `appActions`, `authorization`, `policies`, `api`, `flags`
     and `registry`, the composed `Registry` built once at definition, with the derived types under
     the optional type-only key `'~types'`. Status: decided by the lead 2026-11-04 (M1 plan, WP-20,
     WP-27). Applied in: section 4.5.
219. **Typed outputs that are not shapes** (WP-20, WP-33). `output: typedOutput<T>()` types a result
     by `T` alone; the registry holds a permissive schema marked as typed output and the surface
     describes it as an open object (`core.introspect` and `core.capabilities` use it). Status:
     decided by the lead 2026-11-04 (M1 plan, WP-20, WP-33). Applied in: section 4.3.
220. **Generated files stay under Biome** (WP-21). `*.generated.ts` files stay under Biome's check
     (only `generated/` directories are excluded), so generators sort imports as Biome's organizer
     does, and drift checks ignore the producer's version. Status: decided by the lead 2026-11-04
     (M1 plan, WP-21). Applied in: section 13.7.
221. **Generator aliases and contributed references** (WP-21). Import aliases are the camel case of
     scope, target and export (`credentialSelf`, `accountsProfileSelf`), a part with neither adding
     its kind (`postEffect`); a contributed part's reference is `<module>.<target
     module>.<entity>.<name>`; the literal gets `migrations` only when the package has the
     directory; the Node-only generator entry points are on `@keelwerk/core/manifest`. Status:
     decided by the lead 2026-11-04 (M1 plan, WP-21). Applied in: sections 13.7, 22 and 23.5.
222. **A deny rule with fields is field-level only** (WP-16). A deny rule that lists `fields` hides
     those fields from the rows it matches, or forbids writes that change them (tested on the
     pre-image), and never denies the row or the action. Status: decided by the lead 2026-11-04 (M1
     plan, WP-16). Applied in: section 8.1.
223. **Deny rules apply to public actions** (WP-16). `auth: { public: true }` removes the need for
     an allow rule, never the deny rules: a deny whose `when` holds, or whose `where` covers every
     row, stops a public action at the gate. Status: decided by the lead 2026-11-04 (M1 plan,
     WP-16). Applied in: sections 7.3 and 8.2.
224. **Deployment actions for operators only** (WP-16). Deployment-scope actions are reachable by
     operator principals only; the system principal is refused too, and the earlier widening to
     system principals is withdrawn. Status: decided by the lead 2026-11-04 (M1 plan, WP-16).
     Applied in: section 8.8.
225. **`relation.through`** (WP-16, WP-22). `relation.through(module, entity, { join, by, to, via
     })` (and `.own`) joins the join rows whose `by` equals the owner's `to`, then the target rows
     whose `id` equals the join rows' `via`; the descriptor keeps `keys: { by, to }` and `through: {
     module, entity, by, to, via }`. Status: decided by the lead 2026-11-04 (M1 plan, WP-16, WP-22).
     Applied in: sections 6.3 and 14.3.2.
226. **Policy overrides** (WP-16, WP-27). The engine applies `PolicyOverrides { disable?, add?,
     replace? }` (`applyPolicyOverrides`); a disabled rule stays in the set marked disabled, and the
     problems are `unknownDisabledRule`, `unknownReplacedModule`, `duplicateRuleId` and
     `invalidAddedRules`. Status: decided by the lead 2026-11-04 (M1 plan, WP-16, WP-27). Applied
     in: sections 4.7 and 8.7.
227. **Relation operators by cardinality** (WP-16). `RelationOps` follows cardinality: `some`,
     `none` and `every` over a to-many relation, `is` over a to-one relation. Status: decided by the
     lead 2026-11-04 (M1 plan, WP-16). Applied in: section 8.3.
228. **Capability sets as text** (WP-13). A lane's capability set is stored as the job's
     capabilities, distinct, sorted and joined by a comma, and the empty string for none. Status:
     decided by the lead 2026-11-04 (M1 plan, WP-13). Applied in: section 14.3.9.
229. **Dead letters write history** (WP-13). A job made dead also writes its `kw_job_history` row
     (outcome `dead`), beside keeping its input in `kw_jobs` until replayed or discarded. Status:
     decided by the lead 2026-11-04 (M1 plan, WP-13). Applied in: section 14.3.9.
230. **What a job key does** (WP-13). Keys act on a pending job of the same key and lane: `keep`
     returns it, `coalesce` keeps it and moves its `runAt` to the earlier time (available at once
     when due), and `replace` finishes it as `cancelled`, with history, and enqueues the new job.
     Status: decided by the lead 2026-11-04 (M1 plan, WP-13). Applied in: section 14.3.9.
231. **`readAll`'s next position** (WP-13). `EventStore.readAll(after)` returns `next` as the
     position of the last event returned, or `after` when none was. Status: decided by the lead
     2026-11-04 (M1 plan, WP-13). Applied in: section 15.1.11.
232. **The shape of a new event and the envelope's scope** (WP-13). `NewEvent` carries `shape`, the
     shape id of its payload, and the envelope's `scope` is the appending unit's `Scope`, the
     deployment form included, never a fake id. Status: decided by the lead 2026-11-04 (M1 plan,
     WP-13). Applied in: sections 15.1.3 and 15.1.11.
233. **`count` and `exists` leave archived rows out** (WP-13). `RowStore.count` and
     `RowStore.exists` agree with `find`: archived rows are left out. Status: decided by the lead
     2026-11-04 (M1 plan, WP-13). Applied in: section 14.3.2.
234. **Acknowledged receipts are kept** (WP-13). `ReceiptStore.acknowledge` sets `acknowledgedAt`
     and deletes nothing; an acknowledged receipt stays until it expires. Status: decided by the
     lead 2026-11-04 (M1 plan, WP-13). Applied in: section 15.1.7.
235. **In-memory units and timeouts** (WP-13). The in-memory adapter runs one read-write unit per
     namespace at a time, and a unit that waits longer than its `timeoutMs` fails with
     `unavailable`, `core.timeout`. Status: decided by the lead 2026-11-04 (M1 plan, WP-13). Applied
     in: sections 10, 14.3.6 and 14.3.7.
236. **Runtime composition problems** (WP-27). `defineApp` names the runtime problems
     `invalidModuleIds`, `invalidAppId`, `camelCaseCollisions`, `dependencyCycles`,
     `duplicateNames`, `duplicateActions`, `duplicateReactions`, `reservedActionNames`,
     `reservedEventNames`, `reservedFieldNames`, `invalidActionName`, `invalidRelationName`,
     `invalidEventName`, `columnCollisions`, `tableCollisions`, `offlineCommands`,
     `prepareNeedsSyncExecution`, `readRuleFields`, `unknownExtensionPoints`,
     `singleExtensionPointFillers`, `unknownScheduleActions`, `unresolvedPartReferences`,
     `inlineExecutorCapabilities`, `unknownHooks` and `asyncReactionsUnavailable`;
     `emptyExtensionPoints` is a compose warning and a boot error; the app is refused with the first
     error. Status: decided by the lead 2026-11-04 (M1 plan, WP-27). Applied in: sections 3.3, 4.7,
     5.1, 5.5, 7.3, 7.9.6, 8.1, 9.5.6 and 14.4.2.
237. **Track ids in the registry** (WP-27). `TrackRef.track` is the 14.6.1 track id: the owner
     module's id for its own fields, the contributor's track for contributed ones. Status: decided
     by the lead 2026-11-04 (M1 plan, WP-27). Applied in: section 14.6.1.
238. **Tags per track** (WP-27). An omitted `.tag(n)` is allocated per track, from 1 in declaration
     order and skipping declared tags, so switching a contribution or conditional part off never
     shifts another track's tags. Status: decided by the lead 2026-11-04 (M1 plan, WP-27). Applied
     in: section 4.2.
239. **PGlite's own driver** (WP-14). PGlite runs Kysely's PostgreSQL dialect over an own driver
     (the stock one wraps `begin` in `pglite.transaction()` and destroys the instance), which
     refuses transactions the unit does not own; one session means one unit at a time, `jobs:
     'single-writer'`, and no enforced `statement_timeout`. Status: decided by the lead 2026-11-04
     (M1 plan, WP-14). Applied in: sections 14.3.6 and 14.3.7.
240. **Cross-scope reads as nested savepoints** (WP-14, WP-22). `Unit.nested(fn, { as?, readOnly?
     })`: the only `as` allowed is a tenant unit's own backend with `readOnly: true`, anything else
     is `forbidden`, `core.forbidden`, on every adapter; a single-session adapter reads backend
     entities that way, with the scope settings swapped and restored. Status: decided by the lead
     2026-11-04 (M1 plan, WP-14, WP-22). Applied in: sections 14.3.2 and 14.3.6.
241. **The deployment's wake-up id** (WP-14). A deployment-scope unit's wake-up names the scope by
     the deployment's id. Status: decided by the lead 2026-11-04 (M1 plan, WP-14). Applied in:
     section 15.2.5.
242. **The deployment id reaches adapters** (WP-15). The runtime hands every adapter the
     deployment's id as `AdapterEnvironment.deploymentId`; it is no member of the deployment file
     and no factory option, and deployment-scope units are scoped to it. Status: decided by the lead
     2026-11-04 (M1 plan, WP-15). Applied in: sections 4.6 and 14.3.2.
243. **Pool timeouts** (WP-15). The PostgreSQL pool sets `idle_in_transaction_session_timeout` to 30
     seconds and a connect timeout of 10 seconds, the placement options `idleInTransactionTimeoutMs`
     and `connectionTimeoutMs`; unknown option keys are refused. Status: decided by the lead
     2026-11-04 (M1 plan, WP-15). Applied in: section 14.3.6.
244. **Minimum PostgreSQL 18** (WP-15). `connect` refuses a PostgreSQL server older than 18, the
     only major verified. Status: decided by the lead 2026-11-04 (M1 plan, WP-15). Applied in:
     section 14.3.7.
245. **Statement timeouts** (WP-15). A cancelled statement (SQLSTATE 57014) is `unavailable`,
     `core.timeout`, like every exceeded unit timeout. Status: decided by the lead 2026-11-04 (M1
     plan, WP-15). Applied in: sections 10 and 14.3.6.
246. **Schemas of `json` nodes** (WP-18). A `json` field node carries `input` and `output` JSON
     Schemas (`schema` repeats `output`), and `field.json` over a `shape` is projected as that
     shape's `shape` node. Status: decided by the lead 2026-11-04 (M1 plan, WP-18). Applied in:
     section 16.2.3.
247. **Decimal nodes carry precision and scale** (WP-18). The `decimal` field node carries the
     field's `precision` and `scale`. Status: decided by the lead 2026-11-04 (M1 plan, WP-18).
     Applied in: section 16.2.3.
248. **Merge types `max` and `min`** (WP-18, WP-27). The merge types of the field model include
     `max` and `min`, so `FieldDescriptor.merge` and `FieldNodeBase.merge` list them (their offline
     rule is an open point below). Status: decided by the lead 2026-11-04 (M1 plan, WP-18, WP-27).
     Applied in: sections 14.3.2 and 16.2.3.
249. **Serial fields are read-only** (WP-18). A `serial` field node has access `read`: it is never
     an input, and its JSON Schema is `readOnly`. Status: decided by the lead 2026-11-04 (M1 plan,
     WP-18). Applied in: section 16.2.3.
250. **Maskable members in output schemas** (WP-18). In derived output schemas a `maskable` member
     is not `required`, because a rule may hide it from a row. Status: decided by the lead
     2026-11-04 (M1 plan, WP-18). Applied in: section 16.2.3.
251. **`void` has no wire form** (WP-18, WP-26). A `void` input means the request carries no body
     and is never read; a `void` output answers without one (REST: 204). Status: decided by the lead
     2026-11-04 (M1 plan, WP-18, WP-26). Applied in: sections 16.2.3 and 16.5.2.
252. **Sealed column padding** (WP-17). A sealed value is padded with `0x80` then zeros to a
     multiple of 16 bytes, so it takes its length plus one rounded up to 16, plus 45 bytes. Stored
     format final from M1. Status: decided by the lead 2026-11-04 (M1 plan, WP-17). Applied in:
     section 14.7.9.6.
253. **Length-prefixed associated data and HKDF info** (WP-17). Every `‖` list of associated data
     and HKDF info is encoded as parts each prefixed with a 4-byte big-endian length, with
     parameters as canonical JSON. Stored format final from M1. Status: decided by the lead
     2026-11-04 (M1 plan, WP-17). Applied in: sections 14.7.4 and 14.7.9.7.
254. **Wrapped scope keys** (WP-17). A wrapped scope key is a format byte, the master key version (4
     bytes), a 12-byte nonce and the ciphertext with its tag, bound by its associated data to level,
     scope id and version (refines entry 175). Status: decided by the lead 2026-11-04 (M1 plan,
     WP-17). Applied in: section 14.7.4.
255. **The `SecretRef` text** (WP-17). A sealed value's `SecretRef` text is `kwv1.<key
     id>.<nonce>.<ciphertext>`, nonce and ciphertext in base64url. Status: decided by the lead
     2026-11-04 (M1 plan, WP-17). Applied in: sections 14.7.4 and 17.7 (G4).
256. **Argon2id hashes as PHC strings** (WP-17). Password hashes are PHC strings
     `$argon2id$v=19$m=…,t=…,p=…$<salt>$<tag>` (unpadded base64), so verification reads its
     parameters from the hash. Stored format final from M1. Status: decided by the lead 2026-11-04
     (M1 plan, WP-17). Applied in: section 17.2.2.
257. **Token details** (WP-17). The token verifier is the HMAC of the secret's base32 text under
     HKDF with an empty salt, stored as 64 hex characters; a prefix matches `[a-z][a-z0-9]{0,15}`
     and a secret has 16 to 128 bytes (refines entry 152). Status: decided by the lead 2026-11-04
     (M1 plan, WP-17). Applied in: section 17.2.2.
258. **The event-loop rule, measured** (WP-17). The computation pool's 5 ms rule is asserted on the
     main thread's CPU bursts, not on wall-clock event-loop lag, which machine load distorts.
     Status: decided by the lead 2026-11-04 (M1 plan, WP-17). Applied in: section 17.2.2.
259. **`--wait` with an optional value** (WP-19). `--wait` and `--wait-effects` take an optional
     value through Stricli's `inferEmpty`; the bare flag waits without a limit. Status: decided by
     the lead 2026-11-04 (M1 plan, WP-19). Applied in: section 16.9.4.
260. **The credentials file** (WP-19). `credentials.json` is `{ "credentials": { "<key>": { "token":
     "<token>" } } }`, keyed by the profile's `credential`, else the profile name. Status: decided
     by the lead 2026-11-04 (M1 plan, WP-19). Applied in: section 16.9.6.
261. **Deployment file lookup** (WP-19). Project mode looks for the deployment file from the working
     directory upwards, taking the nearest directory that holds `keelwerk.config.ts` or
     `.launchway/deployment.ts`, the former first (refines entry 90). Status: decided by the lead
     2026-11-04 (M1 plan, WP-19). Applied in: section 16.9.1.
262. **CLI exit codes for an unreachable deployment and an interrupt** (WP-19). A deployment the CLI
     cannot reach is `unavailable`, `cli.unreachable`, tried three times and then exit code 10; an
     interrupt exits with 130. Status: decided by the lead 2026-11-04 (M1 plan, WP-19). Applied in:
     section 16.9.5.
263. **The receipt table** (WP-22). `core__command_receipt` stores the command's scope in `scope_id`
     (tenant, backend or deployment id), primary key `(scope_id, id)`, unique `(scope_id,
     command_id)`, with the entity's system columns and `acknowledged_at`; its policy admits the
     unit's tenant, backend or deployment id. Status: decided by the lead 2026-11-04 (M1 plan,
     WP-22). Applied in: section 15.1.7.
264. **Key material through the adapter's key wrapper** (WP-22). The SQL adapters wrap subject and
     value key material through the key wrapper the core's key service provides (`keyWrapper`),
     bound to the key id; without it their key stores refuse. Status: decided by the lead 2026-11-04
     (M1 plan, WP-22). Applied in: section 14.7.4.
265. **Bucket key bytes** (WP-22). `kw_rate_buckets.bucket` holds the UTF-8 bytes of the HMAC text
     the kernel passes to `BucketStore.take` (refines entry 156). Status: decided by the lead
     2026-11-04 (M1 plan, WP-22). Applied in: section 12.2.
266. **Derived column names** (WP-23). A personal field's derived columns are named `<field
     column>__<query>` (`__eq`, `__prefix`, `__contains`, `__order`). Status: decided by the lead
     2026-11-04 (M1 plan, WP-23). Applied in: section 14.7.9.6.
267. **Track directories and contract files** (WP-23). A track's directory derives from its id
     (`own`, `to-<target>`, `when-<module>`, `to-<target>.when-<module>`, several `when` modules
     joined with `+` in sorted order), and a change with contract steps is split into `NNNN-<name>`
     and `NNNN-<name>-contract`. Status: decided by the lead 2026-11-04 (M1 plan, WP-23). Applied
     in: section 14.6.1.
268. **JSON artefacts carry no comment header** (WP-23, WP-26, WP-33). JSON artefacts carry no
     comment header: the API surface document is the surface itself (sorted keys, two-space
     indentation), a snapshot names its format in `format`, and the OpenAPI document carries the
     header as `x-keelwerk-generated` with `producerVersion`, which drift checks ignore. Status:
     decided by the lead 2026-11-04 (M1 plan, WP-23, WP-26, WP-33). Applied in: section 13.7.
269. **A required column added later** (WP-23). A required column added to an existing table is
     added nullable and tightened by an `alterColumn` in the contract file, instead of carrying a
     database default until a contract step. Status: decided by the lead 2026-11-04 (M1 plan,
     WP-23). Applied in: section 14.6.4.
270. **One `dropColumn` per column** (WP-23). The planner writes one `dropColumn` step per column.
     Status: decided by the lead 2026-11-04 (M1 plan, WP-23). Applied in: section 14.6.2.
271. **The owner connection** (WP-23). Migrations and provisioning connect as the owner role through
     `PostgresAdapterOptions.ownerUrl`; without it `schema.apply` and `schema.provision` refuse with
     `unsupported`. Status: decided by the lead 2026-11-04 (M1 plan, WP-23). Applied in: sections
     14.3.7 and 14.6.6.
272. **`loadMigrations` in the data package's main entry** (WP-23). `loadMigrations` stays in
     `@keelwerk/data`'s main entry, a Node package; PGlite has the subpath `/pglite`. Status:
     decided by the lead 2026-11-04 (M1 plan, WP-23). Applied in: section 22.
273. **A method an endpoint does not take** (WP-24). A method an endpoint does not take answers 405
     with `Allow`, kind `unsupported`, code `core.unsupported`. Status: decided by the lead
     2026-11-04 (M1 plan, WP-24). Applied in: section 16.4.6.
274. **Response compression in M2** (WP-24). The host's compression of non-streaming responses
     arrives in M2; M1 sends responses uncompressed. Status: decided by the lead 2026-11-04 (M1
     plan, WP-24). Applied in: section 16.3.3.
275. **The own-host origin match** (WP-24). An `Origin` matches the request's own host only over
     `https:`, unless the request came over plain HTTP or the host is loopback; only a bearer token
     exempts a cookie request from the origin check. Status: decided by the lead 2026-11-04 (M1
     plan, WP-24). Applied in: section 16.4.10.
276. **The deprecation link** (WP-24, WP-25). The host's `Link` with `rel="deprecation"` for a
     deprecated API version points at `</_keelwerk/v1/capabilities>`, REST's for a deprecated action
     at its `/docs` page, and both are appended to other links. Status: decided by the lead
     2026-11-04 (M1 plan, WP-24, WP-25). Applied in: section 18.5.
277. **Development comes from the mount context** (WP-25). `MountContext.development` is set by the
     runtime in development, and transports take the `development` error audience and their docs
     page from it, never from a static option. Status: decided by the lead 2026-11-04 (M1 plan,
     WP-25). Applied in: sections 16.3.2 and 16.3.5.
278. **Idempotent replays are marked** (WP-25). The invoker sets `replayed: true` on the outcome of
     an idempotent replay, which REST reports as `Idempotent-Replayed: true`. Status: decided by the
     lead 2026-11-04 (M1 plan, WP-25). Applied in: sections 16.4.8 and 16.8.2.
279. **Receipt ids and the receipt `Location`** (WP-25). A receipt's id is the `rcpt_` TypeID of the
     UUIDv8 of scope id and command id (`commandReceiptId`), and an accepted REST command answers
     202 with `Location: <mount path>/core/command-receipts/<receipt id>`. Status: decided by the
     lead 2026-11-04 (M1 plan, WP-25). Applied in: sections 14.5.2 and 15.1.7.
280. **What `HttpContext.basePath` means** (WP-25). `basePath` is the tenant path prefix the host
     consumed during scope resolution; the host hands the request on with its URL unchanged, and a
     transport joins `basePath` with its own prefix and never strips a prefix itself. Status:
     decided by the lead 2026-11-04 (M1 plan, WP-25). Applied in: section 16.3.3.
281. **Cookie names** (WP-25). A cookie hint whose name does not start with `__Host-` is the
     transport check problem `cookieName`. Status: decided by the lead 2026-11-04 (M1 plan, WP-25).
     Applied in: section 16.4.10.
282. **Strong `If-Match`** (WP-25). `If-Match` compares strongly: exactly one strong tag holding a
     version, or `*`; a weak tag or several tags are `core.malformed_request`. Status: decided by
     the lead 2026-11-04 (M1 plan, WP-25). Applied in: section 16.4.9.
283. **Type budgets at measured plus 15 %** (WP-28). The instantiation budgets are the counts the
     core's synthetic apps measured on 2026-11-04 plus 15 % (fold 590,000 and 1,265,000, whole
     program 1,840,000 and 3,180,000 at 25 and 40 modules), with the reason in `budgets.json`,
     replacing the spike-derived figures of entry 103; the core's DSL type fixtures are exempt from
     the declaration limits. Status: decided by the lead 2026-11-04 (M1 plan, WP-28). Applied in:
     section 13.11.
284. **Exclusive problem schemas** (WP-26). Each declared error's `oneOf` is discriminated by
     `code`, and its generic `Problem` member excludes the declared codes, so the `oneOf` is
     exclusive; OpenAPI 3.2 adds `discriminator.defaultMapping`. Status: decided by the lead
     2026-11-04 (M1 plan, WP-26). Applied in: section 16.5.5.
285. **The client's attempt result** (WP-29). `attempt` returns, on success, the `commandId` it sent
     and the `effects` the envelope reported, beside the value; `waitForEffects` takes those
     references. Status: decided by the lead 2026-11-04 (M1 plan, WP-29). Applied in: section
     16.8.4.
286. **No body for `GET` and `DELETE`** (WP-26). Instance commands on `GET` and `DELETE` (the
     generated archive) carry no body and take their members from the query string. Status: decided
     by the lead 2026-11-04 (M1 plan, WP-26). Applied in: section 16.5.2.
287. **Instance queries by representability** (WP-26). An entity instance query is `GET
     /{m}/{c}/{id}/{a}` when its input is query-string representable, otherwise `POST` (and `QUERY`
     with OpenAPI 3.2). Status: decided by the lead 2026-11-04 (M1 plan, WP-26). Applied in: section
     16.5.1.
288. **A missing reference target** (WP-34). A write whose `ref` points at a missing target is
     `conflict`, `core.reference_missing`, on every adapter: the SQL adapters map foreign-key
     violation 23503 to it, the in-memory adapter checks the target in the same unit; the core
     registers the code. Status: decided by the lead 2026-11-04 (M1 plan, WP-34). Applied in:
     section 10.
289. **Concurrent units are the caller's flag** (WP-32). `AdapterCapabilities` has no member for
     concurrent units in M1; `runRead`'s `concurrentUnits?: boolean`, absent meaning `false` (the
     savepoint path), says so until the invoker supplies it. Status: decided by the lead 2026-11-04
     (M1 plan, WP-32). Applied in: section 14.3.6.
290. **The Maybe accessor's inner generator** (WP-32). When the function given to `ifPresent`
     returns a generator or a value instead of a request, it is kept beside the `MaybeRequest` and
     driven by its answerer. Status: decided by the lead 2026-11-04 (M1 plan, WP-32). Applied in:
     section 7.9.3.
291. **Plans of the caller's views** (WP-32). `ctx.target` and `forCaller()` on the entity the
     invoked action is mounted on use that action's own plan; `forCaller()` on any other entity uses
     the plan of its generated `query`. Status: decided by the lead 2026-11-04 (M1 plan, WP-32).
     Applied in: section 7.3.
292. **The `queryState` seam** (WP-32). The read path renders a `query` load's `queryState` through
     `runRead`'s `queryState?: QueryStateEncoder`, the decimal position by default, where the signed
     token of section 15.2.6 plugs in. Status: decided by the lead 2026-11-04 (M1 plan, WP-32).
     Applied in: section 15.2.6.
293. **Flag keys** (WP-32). A flag request's key is `<module id>.<flag>`. Status: decided by the
     lead 2026-11-04 (M1 plan, WP-32). Applied in: section 7.9.3.
294. **No history loads in M1** (WP-32). `ctx.load.<m>.<e>.history` fails with `internal`,
     `core.request_not_allowed` in M1 (entry 126). Status: decided by the lead 2026-11-04 (M1 plan,
     WP-32). Applied in: section 7.9.3.
295. **What `ctx.ask` reaches** (WP-32). `ctx.ask` reaches query actions of the asking module and of
     the modules it requires or lists as optional, never generated actions. Status: decided by the
     lead 2026-11-04 (M1 plan, WP-32). Applied in: section 7.9.3.
296. **Contributed fields reach their contributor only** (WP-32). A contributed field reaches only
     its contributor's parts, whichever module loads the row, and hidden and verifier fields only
     their owner's; reads apply no `when` gating, because the registry materialises only active
     contributions. Status: decided by the lead 2026-11-04 (M1 plan, WP-32). Applied in: section
     14.8.1.
297. **Bare job group ids** (WP-31). A job group's id is the bare declared key, the scope is its
     `scope_id` column, and `kw_job_groups` has no primary key but `unique nulls not distinct
     (scope_id, id)`; the take's group check joins on `g.scope_id is not distinct from j.scope_id
     and g.id = j.group_id` (amends entries 116 and 127). Status: decided by the lead 2026-11-04 (M1
     plan, WP-31). Applied in: sections 9.5.2 and 9.5.3.
298. **Shape ids as bytes** (WP-31). `kw_events.shape_id` and `kw_shapes.shape_id` hold the 32 hash
     bytes (`bytea`), hex on the API. Status: decided by the lead 2026-11-04 (M1 plan, WP-31).
     Applied in: sections 15.1.2 and 15.1.11.
299. **Unknown stream types are refused** (WP-31). Every adapter refuses an append to a stream type
     that is not an entity the unit knows, with `internal`. Status: decided by the lead 2026-11-04
     (M1 plan, WP-31). Applied in: section 15.1.2.
300. **The end of a SQL unit** (WP-15, WP-31). A SQL unit ends with a probe statement (so a
     swallowed error never reports a commit that was rolled back), then the work registered with the
     session's `beforeCommit` in order with the commit tail last, then `commit`; work registered in
     a rolled-back savepoint is discarded. Status: decided by the lead 2026-11-04 (M1 plan, WP-15,
     WP-31). Applied in: section 14.3.6.
301. **The event's schema version is stored** (WP-31). `kw_events.schema_version integer not null`
     is a column, the envelope and `StoredEvent` carry `schemaVersion`, the hash covers it and
     upcasters select by it. Stored format final from M1. Status: decided by the lead 2026-11-04 (M1
     plan, WP-31). Applied in: sections 15.1.2 and 15.1.3.
302. **Namespace job groups** (WP-31). A job group that spans the namespace (`scope_id` null) is
     created and re-limited only by `JobStore.provisionGroup` in a namespace-scope or provisioning
     unit; tenant units only read it, so tenants never wait on each other, and enqueueing into an
     unprovisioned one fails with `internal`. Status: decided by the lead 2026-11-04 (M1 plan,
     WP-31). Applied in: sections 9.5.2, 14.3.9 and 15.1.4.
303. **Stream-version conflicts in the commit tail** (WP-31). The commit tail inserts events with
     `on conflict on constraint ... do nothing returning position`, because forced row-level
     security hides a 23505's detail, and fails the unit with `conflict`, `core.version_mismatch`
     for the events whose positions did not come back. Status: decided by the lead 2026-11-04 (M1
     plan, WP-31). Applied in: sections 15.1.2 and 15.1.4.
304. **Rule conditions in the composition report** (WP-33). The composition report lists a rule's
     conditions only by which callbacks it has (`where`, `check`, `when`), because rendering them
     needs a principal. Status: decided by the lead 2026-11-04 (M1 plan, WP-33). Applied in: section
     16.2.6.
305. **Introspection answered by the runtime** (WP-33). `core.introspect` has no `read` of its own;
     the runtime answers it from the derived surface, open to user, service and operator principals
     by its default rule. Status: decided by the lead 2026-11-04 (M1 plan, WP-33). Applied in:
     section 16.2.5.
306. **Actions newer than a version** (WP-33). An action whose `since` is later than a surface's API
     version is absent from that version's surface; the core module's actions are in every version.
     Status: decided by the lead 2026-11-04 (M1 plan, WP-33). Applied in: section 16.2.4.
307. **Derivation errors refuse the app** (WP-33). `defineApp` derives the surface of every API
     version before it composes and refuses on any derivation error problem (an undescribable
     schema, `undefinedErrors`, `conflictingErrors`). Status: decided by the lead 2026-11-04 (M1
     plan, WP-33). Applied in: section 16.2.4.
308. **Track activity is not a schema state** (WP-34). `SchemaOperations` has no operation that
     marks a track inactive and read-time defaults are kernel behaviour, so the adapter conformance
     toggle-then-rebuild cases cover provisioning and rebuilding only. Status: decided by the lead
     2026-11-04 (M1 plan, WP-34). Applied in: section 14.6.5.
309. **`countBefore` with a vanished anchor** (WP-34). `countBefore` counts the query's rows before
     the anchor, also when the anchor is outside the filtered result; for an anchor whose row no
     longer exists the contract defines no answer. Status: decided by the lead 2026-11-04 (M1 plan,
     WP-34). Applied in: sections 14.3.2 and 14.3.5.
310. **In-memory instants at milliseconds** (WP-34). The in-memory adapter keeps instants at
     millisecond precision, as the columns store them. Status: decided by the lead 2026-11-04 (M1
     plan, WP-34). Applied in: sections 14.3.7 and 14.5.3.
311. **Kernel misuse of a unit** (WP-34). A write inside a read-only unit and an event append in a
     namespace-scope unit are `internal`, `core.internal`, with a message naming the cause. Status:
     decided by the lead 2026-11-04 (M1 plan, WP-34). Applied in: sections 14.3.6 and 15.1.2.
312. **The admission input** (WP-06). An admission rule receives `AdmissionInput { action, scope,
     principal, request, input }`, `input` being the wire form before `validate`, and returns an
     `AdmissionVerdict` (`charge` with a `BucketDemand`, or `refuse`). Status: decided by the lead
     2026-11-04 (M1 plan, WP-06). Applied in: section 12.2.
313. **Lifecycle hook names** (WP-27). The lifecycle hooks are `onBackendCreated`, `onTenantCreated`
     and `onTenantArchived`, the names of the `lifecycle` mount; another name is `unknownHooks`.
     Status: decided by the lead 2026-11-04 (M1 plan, WP-27). Applied in: section 3.3.
314. **The decision record's JSON encoding** (WP-31). In `kw_events.meta` a recorded read's `at` is
     decimal text and a sealed input's bytes are base64url, pinned by a golden test of the commit
     tail. Stored format final from M1. Status: decided by the lead 2026-11-04 (M1 plan, WP-31).
     Applied in: section 7.9.6.

Open points raised by the same packages, for their owners:

315. **Completions without `@stricli/auto-complete`** (WP-19). The CLI depends on
     `@stricli/auto-complete` but no command uses it yet: a) the completion scripts of section
     16.9.9 use it; b) the CLI writes its own and drops the dependency. WP-58 decides. Status: open,
     for WP-58 (concerns sections 16.9.1 and 16.9.9).
316. **The scaffold's module test** (WP-30). `keelwerk new module` writes `test/alone.test.ts`
     composing with `defineApp`, because `createLocalClient` arrives with the harness; it moves to
     `createLocalClient` as section 16.9.8 specifies. Status: open, for WP-39 (concerns section
     16.9.8).
317. **Layouts for transport and adapter modules** (WP-30). Sections 16.9.8 and 23.14 give no layout
     for `keelwerk new module --kind transport|adapter`, and only domain modules are scaffolded; the
     layout of the other two kinds is to decide. Status: open, for WP-61 (concerns sections 16.9.8
     and 23.14).
318. **The licence of a scaffolded package** (WP-30). A scaffolded `package.json` has no `license`
     member (the templates are pure): a) a `--license` flag; b) inherit the root package's licence.
     To decide before the first publish. Status: open, for the lead (concerns section 16.9.8).
319. **Custom inputs that are not shapes** (WP-33). A custom action whose input is not a shape
     reaches the registry as a permissive schema (`action-entry-of.ts` drops the original) and
     surfaces as an open `foreign` node, which the REST check refuses; keeping the original schema
     is the registry owner's question. Status: open, for WP-27's owner (concerns section 16.2.2).
320. **The introspection setting** (WP-33). The backend setting that makes `core.introspect` public
     or operator-only, and the runtime's answer to the action, arrive with the core module's
     runtime. Status: open, for WP-43 (concerns section 16.2.5).
321. **Two forms of `SecretRef`** (WP-17, WP-32). The key service reads a sealed value's reference
     `kwv1.<key id>.<nonce>.<ciphertext>`, while a row loaded by a part carries `{ ref:
     '<entity>/<id>/<field>' }`; how a reveal resolves the row form to the sealed value is WP-48's
     to settle. Status: open, for WP-48 (concerns sections 14.7.4, 14.8.1 and 17.7 (G4)).
322. **The command receipt entity** (WP-22). `core.commandReceipt` declares `commandId` and `status`
     (`accepted`, `succeeded`, `failed`), while the receipt store and table use `pending`,
     `accepted`, `completed` and `failed` and the full field list of section 15.1.7; the entity's
     fields and the column of a backend command's receipt in a tenant namespace are open. Status:
     open, for WP-38, WP-43 (concerns section 15.1.7).
323. **The offline rule of `max` and `min`** (WP-18). The field model and the descriptors carry the
     merge types `max` and `min`, for which section 15.3.4 states no ingest rule. Status: open, for
     the M6 sync design (concerns section 15.3.4).
324. **The server's clock node id** (WP-08). The node id of a server process's hybrid clock (`s`
     plus ten random base32 characters, section 14.5.3) is supplied by the runtime. Status: open,
     for WP-43 (concerns section 14.5.3).
325. **Issuing operator tokens** (WP-20). `core.operatorToken.issue` is left out of `Core` until the
     entity-command option for commands that create (no `InstanceInput`) exists. Status: open, for
     WP-56 (concerns section 3.1).
326. **The cost of the fold** (WP-28). WP-47 investigates the fold cost of `consume.ts`, and WP-63
     records the budgets of the portal and conformance apps (entry 136). Status: open, for WP-47,
     WP-63 (concerns section 13.11).
