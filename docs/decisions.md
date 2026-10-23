# Decision register

Date: 2026-10-23. Status: open. This register lists every open question of the architecture in
one place, numbered, so that Jens can answer them one by one in conversation. Each answer is
recorded here with its date and the section or ADR that applies it. The questions come from
[architecture.md](architecture.md) section 21 (decision points, spike questions, questions by
area), plus the lead's own flags and the points raised by the addendum 3 designs.

How to answer: by number and letter, for example `1a 5a 20b`. The starred option (★) is the
recommendation the specification currently assumes; a question left unanswered keeps the star.

Status values: `open`, `decided <date>` (with the answer), `applied` (with the section or ADR).

## A. Decision points (architecture.md section 21.1)

1. **Runtime module selection.** How does a backend get its modules? a) ★ from the apps compiled
   into the deployment, with per-backend variation through module configuration and feature
   flags; b) toggled per backend at runtime, with types that cannot follow the selection.
   Status: open.
2. **Toggling with requirements.** A module can only be switched off together with the modules
   that `require` it. a) ★ accept; keep hard dependencies for genuine needs; b) make every
   dependency optional and type every cross-module access as possibly absent. Status: open.
3. **DSL shape.** a) ★ builder chain whose callbacks receive typed contexts (Hono, Elysia, Better
   Auth style); b) one object literal with a hand-written context type on every handler.
   Status: open.
4. **Data access inside handlers.** a) ★ module authority, with an explicit `forCaller()` for
   caller-scoped reads; b) caller authority by default with typed grants per action. Status: open.
5. **Deny rules.** a) ★ allow and deny, deny requiring a reason; b) allow-only with `unless`
   conditions. Status: open.
6. **Job queue.** a) ★ a kernel queue over every data adapter's job store (works on MySQL,
   SQLite, PGlite and in memory); b) pg-boss on PostgreSQL only. Status: open.
7. **Personal data in state tables.** a) ★ plaintext state tables with crypto-shredding of the
   chain; b) encrypted state columns with blind indexes. Status: open.
8. **Operational buffer defaults** (transient change records 7 days, receipts 24 hours, inactive
   sync clients 90 days, without an adopted rule). a) ★ accept; b) the operator must adopt even
   these. Status: open.
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
16. **CLI namespace.** a) ★ action commands at the top level with 29 reserved names; b) under a
    verb (`pennestack run <module> ...`). Status: open.
17. **Operator impersonation** (`pennestack explain --as <principal>`). a) ★ evaluate everywhere,
    execute only in development; b) also execute in production, logged. Status: open.
18. **Protobuf field tags.** a) ★ allocate from day one; b) when the Connect transport arrives.
    Status: open.
19. **Instants.** a) ★ `Date` now behind `field.instant()`, `Temporal.Instant` once Node 26 is
    the baseline; b) Temporal with a polyfill from the start. Status: open.
20. **Licence.** a) ★ Apache-2.0; b) MIT. Due before the repository becomes public. Status: open.
21. **Outbound mail from the home connection.** a) ★ relay through an external host first (direct
    delivery is built anyway); b) a second pennestack process with the `outbound-mail`
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

## B. Lead's own flags (not in section 21)

28. **Toolchain baseline.** a) ★ TypeScript 7.0 and Node 24 type stripping (no decorators, no
    enums, `.ts` import extensions, no build step for sources); b) TypeScript 5.9/6 with a build
    step and no syntax restrictions. Status: open.
29. **History default.** a) ★ `history: 'chain'` for every entity, opt-out with a reason;
    b) `history: 'state'` by default, opt-in per entity. Status: open.
30. **SQL family.** a) ★ Kysely underneath the SQL adapters; b) Drizzle underneath (overlaps
    with 13). Status: open.

## C. Spike questions (section 21.2; answers optional, the M0 spike decides the rest)

31. **Composition error form.** a) ★ the `Check` property form (missing property with a literal
    type); b) a rest-parameter form, if it reads better in the editor. Status: open.
32. **Optional modules in `ctx.data`.** a) ★ `| undefined`; b) a `Maybe` object with
    `.ifPresent()`. Status: open.

The other spike items (instantiation and declaration-size budgets, the write-path measurement)
are measurements, not choices.

## D. Questions by area (section 21.3)

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

## E. Addendum 3 (2026-10-23): being designed

Versioning everywhere, smooth rollouts with backwards compatibility, feature flags and A/B
testing, and the single-purpose project layout are being designed. Their decision points are
appended here as questions 50 onwards when the design lands.
