# 6. Data adapter boundary: units on namespaces, declared capabilities, Kysely for SQL, migrations in tracks

Date: 2026-10-11 (revised after review the same day)

## Status

Proposed

## Context

The brief asks for a data layer with plug-and-play databases (PostgreSQL, MySQL, a hosted service
such as Supabase, query builders or ORMs such as Drizzle, "or anything else that fits the
abstraction"), for tenant data placement that is pluggable and invisible to application code, for
types that are always live whatever the connection, and for modules that can be toggled
independently. The first draft of architecture.md section 14 fixed the outline: a mandatory entity-operation contract
plus declared optional capabilities validated at `connect`, Kysely as the first SQL substrate,
Supabase as the PostgreSQL adapter, Drizzle permitted, migrations diffed per module with per-module
snapshots and one history keyed by module, foreign keys only towards hard dependencies, disabling
never dropping data, and the condition AST of section 8.3 hosted unchanged.

The research (data-layer.md) compared Payload's document-level adapter contract with Kysely's
SQL-AST dialects, found Drizzle schemas per dialect, MikroORM 7 running on Kysely, row-level security
as a second line of defence, schema-per-tenant multiplying the migration problem, and no schemas
inside a MySQL database. Writing the specification exposed five problems the outline leaves open:

- where tenancy is applied, and how a transaction relates to placements and tenants;
- how two apps sharing a placement avoid colliding physical tables, since the same entity can have
  different columns in different apps (contributions depend on the selection);
- how migrations work when a contribution makes a table's shape depend on which modules are
  selected;
- where the semantics of conditions are fixed, so that the compiled and the in-memory interpreter
  agree on nulls, collation and relations;
- how tables the framework does not own get types without a second mechanism.

The review of 2026-10-11 added four: the unit had no operations for the framework's own tables
(consumers, tombstones, stream records), so the kernel could not implement them against the
contract; JMAP clients page by position, which keyset-only pagination cannot serve; a tenant
command's snapshot and atomicity depended on whether backend-level data happened to share its
database; and no job queue existed outside PostgreSQL, although both proof apps need one and the
plan runs CI on three databases.

## Decision

1. **Contract.** `DataAdapterFactory` creates a `DataAdapter` per placement, whose
   `unit(namespace, scope, fn)` runs one transaction on one namespace for one storage scope and
   exposes `rows`, `events`, `receipts`, `jobs`, `consumers`, `tombstones`, `streams`, `usage`,
   `keys`, `serials` and an optional `sql` hatch, plus schema operations, change-feed wake-ups, an
   optional `broadcast` channel and the cluster identity used to detect restores. The types live in `@pennestack/core`; implementations live in
   adapter packages. Archiving is a versioned row update the kernel issues after the `archived`
   event; planning migrations is framework work, adapters render and apply.
2. **Namespaces.** A namespace owns one event log, one position space, the framework tables and one
   copy of one app's tables. A shared-tables placement holds one namespace per app;
   schema-per-tenant and database-per-tenant placements hold one per tenant. All namespaces are
   provisioned and migrated in the `migrate` phase, so creating a backend or a shared tenant is a
   data operation.
3. **Physical names.** `<root>.<module>__<entity>` for module tables and `<root>.ps_<name>` for
   framework tables, snake-case columns, truncation with a hash suffix, every name recorded in the
   module snapshot. The root is a schema per app on PostgreSQL (`ps_<app>` on Supabase), a database
   or prefix on MySQL, a file or prefix on SQLite. A schema per module is an option on self-hosted
   PostgreSQL, not the default.
4. **Scope below everything.** The adapter adds the scope predicate to every statement and event
   read; primary and foreign keys include the scope; PostgreSQL row-level security is enabled and
   forced on every scoped table as a backstop; adversarial isolation tests run on every adapter. A
   unit spans one namespace and one scope; a backend-scope or deployment-scope unit refuses
   tenant-tenancy entities; namespace-scope units are kernel-only and never append events. Tenant
   commands read backend-level entities in a separate snapshot and reach other scopes' commands
   only after commit, so semantics never depend on placement.
5. **Capabilities.** Adapters declare capabilities (event store, savepoints, transactional DDL,
   placements, naming, unsupported conditions, partial indexes, change-feed level, row-level
   security, row locks, search, positional paging with a maximum offset, job taking, broadcast,
   SQL with its dialect, process model). They are checked at `connect`, at tenant creation and
   move, and when a plan or query is compiled; modules declare their data needs, including the SQL
   dialect they write (`{ sql: 'postgres' }`), which types `ctx.sql`.
6. **Conditions and pagination.** One semantics for both interpreters: two-valued logic,
   null-safe `ne` and `nin`, comparisons with `null` or `undefined` false (absence only through
   `isNull`), code-point string comparison over binary collations, membership for `contains` on
   collections, kind restrictions per field kind, and relation quantifiers always evaluated by the
   database through the unit. Pagination is keyset by default; positional paging and
   `countBefore` exist as a capability for the transports that request it (JMAP), bounded by a
   maximum offset and covered by the conformance suite.
7. **Substrate.** Kysely 0.29.6 carries the SQL family: PostgreSQL (with PGlite 0.5.8 for tests and
   `pennestack dev`) in M1; MySQL, SQLite on `node:sqlite` and the Supabase preset in M7 (roadmap).
   The in-memory adapter is the reference semantics. A Drizzle-based adapter is permitted and deferred
   until Drizzle 1.0; existing Drizzle schemas are imported by `pennestack db introspect --drizzle`.
8. **Columns.** Field kinds map to columns per dialect as architecture.md section 14.5.1 lists;
   decimals are exact strings, floats binary, integers 64-bit with safe-integer validation, unique
   fields unique among non-archived rows, and indexes may be partial.
9. **Migrations in tracks.** Dialect-neutral steps live in files per track: the module's own
   entities, each contribution (target and `when` list), and each conditional part, every track
   with its own snapshot and history key. Adapters render steps through Kysely's schema builder and
   apply them under a namespace lock. Tracks are ordered by dependencies; expand and contract steps
   are separated for rolling deploys; fields of contributions and conditional parts must be
   optional or defaulted; removing a module never drops anything and `retire` is the only drop;
   per-tenant namespaces are provisioned from snapshots. Every event records the shape (the active
   tracks and their versions) it was written with, and rebuilds pass through the values of
   inactive tracks.
10. **One type mechanism.** Entity definitions are the only source of types. Tables the framework
    does not own are described by definitions that `pennestack db introspect` writes (external or adopt
    mode), not by generated `.d.ts` files. Drift checks compare definitions, snapshots and live
    catalogues.
11. **Adapters are deployment infrastructure.** `defineDeployment` lists the adapter factories
    (ADR 0003); apps never list adapters.
12. **One job store per adapter.** Every adapter implements a job store (`ps_jobs`) in the unit,
    taking jobs with `FOR UPDATE SKIP LOCKED` on PostgreSQL and MySQL and through the single writer
    on SQLite, PGlite and the in-memory adapter, so the kernel queue of ADR 0015 works on every
    adapter and jobs commit with the work that causes them.

## Consequences

- Every database meets one contract, and application code never sees placements, strategies or
  physical names. Tenancy is enforced below the repositories and repeated by the database where it
  can be.
- Apps sharing a placement cannot collide, and toggling a module or a contribution preserves data.
  The price is a namespace per app on every placement (empty tables where an app has no tenants,
  limited by the placement's `apps` list) and a migration planner with tracks that the project must
  build.
- The two condition interpreters agree by construction on everything but field operators, which the
  dual-evaluation suite tests on every adapter.
- Kysely is pre-1.0 and pinned exactly; it stays inside the adapters except for the escape hatch's
  types.
- MySQL has no row-level security, so its isolation rests on the scoping plugin and tests;
  PostgreSQL is the recommended production database for multi-tenant backends.
- The job store and the stores for consumers, tombstones, stream records and usage counters are
  part of every adapter and of the conformance suite; an adapter costs more to write, and every
  deployment gets the same queue and the same isolation.
- The core changes this decision required are folded into architecture.md (sections 4.2, 5.6,
  12.3 and 14).
