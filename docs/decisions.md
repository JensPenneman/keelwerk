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
20. **Licence.** a) ★ Apache-2.0; b) MIT. Due before the repository becomes public. Status: decided 2026-10-27: **a**, FSL-1.1-ALv2 (Functional Source License, Version 1.1, Apache-2.0
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
    rest-parameter form reads better. Applied (section 4.7).
32. **Optional modules in `ctx.data`.** a) ★ `| undefined`; b) a `Maybe` object with
    `.ifPresent()`. Status: decided 2026-10-27: **b** for now (Jens: not sold yet), a `Maybe`-style accessor for optional
    modules; to be revisited after the M0 spike writes the auth module against it. To apply: sections
    3.4, 7.6, 7.9.3 (the accessor must compose with `yield*`: `yield* ctx.load.accounts.ifPresent(a =>
    a.profile.byId(id))` answering `Profile | undefined`), 26.2; see section K.
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
49. **Outbound webhooks.** a) ★ part of Launchway's first keelwerk release (M3); b) later.
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
    as a named later milestone; applied (section 21, roadmap).
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
    applied (section 14.7.9, roadmap).
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

All 21 items of this section were applied by the editor pass of 2026-10-28 (architecture, 18 ADRs,
roadmap, README, api-sketch.ts). Milestone numbers changed in that pass: the register's references
to M8 (offline sync), M9 (collaborative fields) and M7 (data breadth, ORE) now read M6, M7 and M5;
roadmap section 6 maps old to new.

91. **The name.** Decided 2026-10-28: **keelwerk** (keel: the first beam of a ship; werk). Checked free
    on npm (package and scope), GitHub, .com and .dev; no company or product found by web search; a
    TMview check belongs to the deferred trademark step (84c). Every document, identifier prefix
    (`kw_` tables, `$kwe` envelope marker, `kws_` tokens, `KEELWERK_*` environment, `@keelwerk/*`
    packages, the `keelwerk` CLI, `keelwerk.config.ts`, `.keelwerk`-free: the per-repo directory stays
    `.launchway/` per 90c) was renamed on 2026-10-28. Status: applied.

## K2. Edits to apply at the next editor pass

- 90c: the `.launchway/` directory convention (deployment.ts + launchway.ts + compose.yaml for the
  interim), the CLI's config lookup order, Launchway's project model reading it (replacing the
  `composeFiles` setting of today's Launchway), app repository layout in 23, roadmap M3/M4.

## L. Questions raised by applying the decisions (2026-10-28)

88. **Where the edge module lives** (consequence of 82a). `@keelwerk/edge-caddy` is a keelwerk
    package, and a keelwerk package cannot fill an extension point of a module that lives in
    Launchway's repository. a) ★ the `edge` module becomes a shared keelwerk module
    (`@keelwerk/module-edge`: sites, routes, certificates policy, the `edgeProvider` extension
    point, `edge.apply` performed by the edge node's agent); Launchway's `domains` declares the
    sites it needs; b) the edge module stays in Launchway and the Caddy provider lives there too (no
    shared package; a second platform wanting an edge copies it). Status: decided 2026-10-28: **a**, `@keelwerk/module-edge` as a shared module; applied by the
    editor pass (sections 17.3, 22).
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
## J2. More editorial items (2026-10-28 editor pass; names to confirm or rename)

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
