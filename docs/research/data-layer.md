> Note (2026-10-28): the project was renamed from pennestack to **keelwerk** on 2026-10-28; this
> research note keeps the old name as written at the time.

# Data-layer research

Date: 2026-10-08. Status: research input for the pennestack architecture; it recommends, it does
not decide. Requirements come from [brief.md](../brief.md). Package versions were checked against
the npm registry on 2026-10-08; server versions against the vendors' own release notes on the same
day. Where a page could not confirm a claim, the claim is marked as unverified.

## 1. What the brief asks of the data layer

- Plug-and-play databases: PostgreSQL, MySQL, a hosted service such as Supabase, query builders or
  ORMs such as Drizzle, "or anything else that fits the abstraction".
- Modules own entities and can be toggled independently, so tables, migrations and types must be
  owned per module as well.
- The types of what is in the database are "perfectly, live, generated", whatever connection is
  used, and the compiler and linter "always know what to do".
- Live data is structured like a collaborative document: nothing is truly deleted, everything is
  appended to a chain, several actors work online and offline at the same time.
- CQRS-style execution with live updates on everything; GraphQL, REST and tRPC derive from the same
  entity and action definitions.

Everything below is judged against those five points.

## 2. Survey

### Drizzle ORM (drizzle-orm 0.45.4 on `latest`, 1.0.0-rc.4 on `rc`; drizzle-kit 0.31.11)

Schema is TypeScript, but per dialect: `pgTable`, `mysqlTable` and `sqliteTable` come from
separate `pg-core`, `mysql-core` and `sqlite-core` packages. The 0.45.4 tarball ships `pg-core`,
`mysql-core`, `sqlite-core`, `singlestore-core` and `gel-core`; the 1.0 release candidate adds
`mssql-core` and `cockroach-core`. Types are inferred from the table objects (`typeof
users.$inferSelect`, `InferInsertModel`), so application code needs no codegen. drizzle-kit
`generate` diffs the TypeScript schema against a JSON snapshot and writes SQL files; `migrate`
applies them and records history in `__drizzle_migrations` (schema `drizzle`, both configurable);
`push` syncs a dev database without files; `pull` introspects. `tablesFilter` and `schemaFilter`
scope `push` and `pull`, and every dialect has a `*TableCreator` for prefixing, for example
``pgTableCreator((name) => `mod_${name}`)``. Transactions nest as savepoints, `tx.rollback()`
aborts, PostgreSQL accepts isolation level and access mode. Locking reads: `.for('update' | 'no key
update' | 'share' | 'key share', { skipLocked, noWait })`. Row-level security is modelled with
`pgPolicy`, `pgRole` and `enableRLS()`/`withRLS` (PostgreSQL only). There is no built-in
`tsvector`; the documented pattern is a `customType` plus a generated column calling
`to_tsvector`. Relational queries v2 (`defineRelations`) and the extra dialects live in the 1.0
line, still a release candidate.

### Prisma (@prisma/client 7.10.0 on `prev`, prisma 8.0.0-rc.22 on `latest`)

Prisma 7 (upgrade guide checked 2026-10-08) removed the Rust query engine, requires a driver adapter
(`@prisma/adapter-pg` 7.10.0), moved CLI configuration to `prisma.config.ts` and ships as ESM.
Prisma 8, at release-candidate stage, renames the schema a "contract" and allows writing it in
TypeScript: `defineContract({}, ({ field, model, rel }) => ...)` from
`@prisma/orm-postgres/contract-builder`, with `npx prisma contract emit` producing `contract.json`
and `contract.d.ts`. Prisma's docs still prefer PSL and recommend TypeScript only when models are
composed across packages or generated from data, which is exactly pennestack's situation. The
client is codegen in both forms. Multi-schema (`schemas` on the datasource, `@@schema` on models)
works on PostgreSQL, CockroachDB and SQL Server, not MySQL or SQLite. Migrations are `prisma
migrate dev/deploy` and `db push`.

### Kysely (0.29.6) and kysely-codegen (0.20.0)

A typed SQL query builder with no schema of its own: queries are built against a `DB` interface and
compiled from an `OperationNode` tree. A `Dialect` is four factories: `createAdapter`,
`createDriver`, `createIntrospector`, `createQueryCompiler`. The 0.29.6 tarball contains `postgres`,
`mysql`, `sqlite`, `mssql` and `pglite` dialects, plus `helpers/{postgres,mysql,sqlite,mssql}` with
`jsonArrayFrom` and `jsonObjectFrom`, and `JSONColumnType`. Plugins implement
`transformQuery(args): RootOperationNode` and `transformResult`, which is a clean place for tenant
scoping or table prefixing. `ControlledTransaction` (`db.startTransaction().execute()`) exposes
`savepoint`, `rollbackToSavepoint` and `releaseSavepoint` with savepoint names tracked in the type.
Selects have `forUpdate`, `forNoKeyUpdate`, `skipLocked`, `noWait`. Migrations are hand-written
`up`/`down` functions run by `Migrator` (alphanumeric order, database-level lock,
`allowUnorderedMigrations`); there is no diffing. kysely-codegen introspects PostgreSQL, MySQL,
SQLite, MSSQL and LibSQL into a `DB` interface with `Generated<T>` columns.

### MikroORM (7.2.4)

Version 7 is ESM-only, requires Node 22.17 and TypeScript 5.8, replaced Knex with Kysely as the
query runner (`@mikro-orm/sql`, `em.getKysely()`) and promotes `defineEntity` with
`InferEntity<typeof Book>` for inference without decorators. Drivers: PostgreSQL, MySQL/MariaDB,
SQLite (better-sqlite3), MSSQL, MongoDB. Migrations are diffed from entity metadata with a snapshot
file and run transactionally (MySQL DDL cannot be rolled back). It is the closest existing thing to
"entity-first, multi-dialect, diff-based migrations on a SQL AST", at the cost of a unit-of-work
and identity-map model that fights CQRS.

### Payload database adapters (3.90.2)

Payload's `BaseDatabaseAdapter` is a document-level contract: `find`, `findOne`, `create`,
`updateOne`, `updateMany`, `upsert`, `deleteOne`, `deleteMany`, `count`, `findDistinct`,
`batchProcessing`, version and global methods, id-based `beginTransaction`/`commitTransaction`/
`rollbackTransaction`, `connect`/`init`/`destroy`, and the migration set (`createMigration`,
`migrate`, `migrateDown`, `migrateFresh`, `migrateRefresh`, `migrateReset`, `migrateStatus`). The
Postgres and SQLite adapters build Drizzle tables from collection config at `init`; MongoDB uses
Mongoose. Development defaults to Drizzle `push`; production needs migrations, each in its own
transaction. `payload generate:types` writes `payload-types.ts`, which augments `GeneratedTypes`
inside `declare module 'payload'`. This is the best-documented example of "one adapter interface,
Drizzle underneath for SQL, a different engine for documents".

### Keystone (@keystone-6/core 8.1.0)

Keystone generates `schema.prisma`, `schema.graphql` and `generated/keystone/types` from its list
definitions; `db.provider` is `postgresql`, `mysql` or `sqlite`, `prismaClientOptions` must supply
a driver adapter, `extendPrismaSchema` patches the generated schema, and `idField` offers `cuid`,
`uuid`, `nanoid`, `ulid` or `autoincrement`. `keystone dev` regenerates the files, runs `prisma db
push` and watches; `keystone build --frozen` fails when committed generated files drift from the
config; production runs `prisma migrate deploy` separately. Types are codegen on top of codegen
(Keystone to Prisma to client), the pattern to avoid.

### Supabase (supabase-js 2.117.3, CLI 2.120.0)

Supabase is PostgreSQL with PostgREST, Realtime and tooling around it. Types are introspection
codegen: `supabase gen types typescript --local | --project-id | --db-url` emits a `Database`
interface (`Tables.<name>.Row/Insert/Update`) passed to `createClient<Database>()`. Realtime
"Postgres Changes" is a logical-replication consumer: tables join the `supabase_realtime`
publication, old values need `REPLICA IDENTITY FULL`, RLS is applied per subscriber except on
`DELETE`, processing is single-threaded and the docs point to Broadcast beyond roughly 3,000
subscribers. Declarative schemas (`supabase/schemas/*.sql`, `supabase db schema declarative sync
-f`) generate migrations from desired-state SQL; DML is never captured. For a backend framework
Supabase is a PostgreSQL adapter target (direct connection through its pooler) with optional
extras; PostgREST is not needed server-side.

### Gel, formerly EdgeDB (server 7.0 released 2025-11-05; npm `gel` 2.2.1, `@gel/generate` 0.7.1)

Renamed on 2025-02-25; schema lives in `.gel` files under `dbschema/`, migrations are `.edgeql`
files produced by `gel migration create`, which is interactive and asks for fill expressions when a
change is ambiguous; `gel migrate` applies, `gel watch --migrate` is the dev loop. The TypeScript
query builder is generated by `npx @gel/generate edgeql-js` from the live instance and must be
re-run after every schema change. Gel owns its schema language and migration planner; Drizzle's
`gel` dialect only `pull`s it. A pennestack adapter would translate the entity model into `.gel`
files and hand migrations to Gel's planner.

### Convex (1.46.0; `@convex-dev/migrations` 0.3.6)

`defineSchema`/`defineTable` with `v` validators in `convex/schema.ts`; every document gets `_id`
and `_creationTime`; indexes and `searchIndex` (one search field, up to 16 filter fields, scans at
most 1,024 results, reactive). `npx convex dev` watches the file system, pushes functions and the
schema (validated against existing documents on first push), and regenerates `convex/_generated`.
The generated `dataModel.d.ts` is a four-line template that delegates to inference:

```ts
import type { DataModelFromSchemaDefinition, DocumentByName, TableNamesInDataModel, SystemTableNames } from "convex/server";
import type { GenericId } from "convex/values";
import schema from "../schema.js";
export type DataModel = DataModelFromSchemaDefinition<typeof schema>;
export type TableNames = TableNamesInDataModel<DataModel>;
export type Doc<TableName extends TableNames> = DocumentByName<DataModel, TableName>;
export type Id<TableName extends TableNames | SystemTableNames> = GenericId<TableName>;
```

Queries are reactive and cached at one logical timestamp; mutations are serializable with
optimistic concurrency and retries. The backend is open source (FSL, Apache-2.0 after two years)
and self-hostable on SQLite, Postgres or MySQL. Convex is an execution model rather than a
database; the parts worth copying are the thin generated file and the dev loop.

### SurrealDB (server 3.0.0 released 2026-02-17, 3.3.x current; JS SDK `surrealdb` 2.1.0)

Multi-model with SurrealQL. `DEFINE TABLE ... SCHEMAFULL` rejects undeclared fields since 3.0,
`OVERWRITE` and `IF NOT EXISTS` make definitions re-runnable, `CHANGEFEED` records changes for
`SHOW CHANGES FOR`, and table `PERMISSIONS FOR select/create/update/delete` are evaluated per
record user. `LIVE SELECT` streams full records or `DIFF` as JSON Patch, is bound to the WebSocket
connection that started it, and in the Community Edition only sees writes on the node holding the
subscription. Full-text is `DEFINE INDEX ... FULLTEXT ANALYZER ... BM25 HIGHLIGHTS` with the `@@`
operator. There is no official TypeScript generation from the schema and no official migration
tool; schema evolution is re-running `DEFINE` statements.

### Comparison

| | Schema source | App types | Dialects | Migrations | Change feed | Full-text | Savepoints |
|---|---|---|---|---|---|---|---|
| Drizzle | TS, per dialect | inferred | PG, MySQL, SQLite, SingleStore, Gel (+MSSQL, Cockroach in 1.0 rc) | diffed SQL files + push | none (DB-level) | via customType | yes |
| Prisma 7/8 | PSL or TS contract | codegen client | PG, MySQL, SQLite, MSSQL, Cockroach, Mongo | diffed, shadow DB | none | `search` filter (MySQL; PG preview) | no nested |
| Kysely | none (DB interface) | inferred from interface; codegen optional | PG, MySQL, SQLite, MSSQL, PGlite + community | hand-written | none | raw SQL | typed |
| MikroORM 7 | TS `defineEntity` | inferred | PG, MySQL/MariaDB, SQLite, MSSQL, Mongo | diffed from metadata | none | `$fulltext` (PG, MySQL, SQLite FTS5, Mongo) | yes |
| Payload | collection config | codegen `payload-types.ts` | PG, SQLite (Drizzle), Mongo | diffed (push in dev) | none | none built in | id-based tx |
| Keystone | list config | codegen via Prisma | PG, MySQL, SQLite | Prisma | none | none built in | Prisma |
| Supabase | SQL (declarative files) | introspection codegen | PG | diffed from SQL | logical replication over WebSocket | PG | PG |
| Gel | `.gel` SDL | codegen from live DB | own engine on PG | interactive planner | none documented | `fts` module (since 4.0) | yes |
| Convex | TS `defineSchema` | thin generated file + inference | own engine | schema push, data via component | reactive queries | built-in index | serializable tx |
| SurrealDB | SurrealQL `DEFINE` | none official | own engine | none | `LIVE SELECT`, `CHANGEFEED` | BM25 index | `BEGIN TRANSACTION` |

## 3. What a pennestack adapter boundary must implement

The survey shows two viable shapes: Payload's document-level contract (small, portable, no SQL
leaks) and Kysely's SQL-AST contract (expressive, SQL only). pennestack needs both layers, because
transports, authorization and CQRS handlers must compile to something dialect-neutral, while the
mail server and the deployment platform will need real SQL for queues and reports.

```ts
// Sketch, not an API. Everything is typed from the entity definitions of the enabled modules.
interface DataAdapter<Caps extends Capabilities = Capabilities> {
  readonly capabilities: Caps;          // checked at boot against what enabled modules require
  connect(): Promise<void>; close(): Promise<void>;
  transaction<T>(fn: (tx: Unit) => Promise<T>, opts?: { isolation?: Isolation; readOnly?: boolean }): Promise<T>;
  // Unit = the same operations bound to one transaction; nested transaction() = savepoint.
  find<E>(entity: E, q: Query<E>): Promise<Page<Row<E>>>;      // filter AST, sort, projection, keyset cursor
  findOne<E>(entity: E, q: Query<E>): Promise<Row<E> | null>;
  insert<E>(entity: E, rows: Insert<E>[]): Promise<Row<E>[]>;
  update<E>(entity: E, q: Query<E>, patch: Patch<E>, opts?: { expectVersion?: number }): Promise<number>;
  delete<E>(entity: E, q: Query<E>): Promise<number>;         // hard delete; tombstones are a module concern
  count<E>(entity: E, q: Query<E>): Promise<number>;
  lock?<E>(tx: Unit, entity: E, q: Query<E>, mode: 'update' | 'share', opts?: { skipLocked?: boolean; noWait?: boolean }): Promise<Row<E>[]>;
  search?<E>(entity: E, index: string, text: string, q?: Query<E>): Promise<Page<Row<E>>>;
  changes?(subscription: ChangeSubscription): AsyncIterable<ChangeEvent>; // listen/notify, logical decoding, polling
  schema: { plan(from: Snapshot, to: Snapshot): MigrationPlan; apply(plan: MigrationPlan, tx: Unit): Promise<void>; introspect(): Promise<Snapshot> };
  sql?: SqlEscapeHatch;                 // Kysely instance for SQL adapters; absent elsewhere
}
```

Point by point:

- Query abstraction. A filter AST (`and`/`or`/`not`, comparison, `in`, `like`, JSON path, null
  checks) over entity fields, plus sort and projection. It compiles to Kysely nodes for SQL, to
  Convex-style index scans or SurrealQL elsewhere, and it is what CASL-style conditions compile to
  as well, so authorization can be pushed into the query instead of filtered afterwards.
- Pagination. Keyset by default with an opaque cursor built from the sort columns plus the id, as
  Drizzle's guide recommends ("cursor should be unique and sequential"); offset only as an explicit
  capability for admin tables. Convex's `paginate` (`continueCursor`, `isDone`, reactive) is the
  reference shape; Payload and PostgREST use page/limit or ranges.
- Transactions. A callback-based unit of work, nested calls become savepoints (Drizzle and Kysely
  both support this; MySQL cannot roll back DDL), isolation level and read-only flags as options. An
  adapter without transactions declares it and the framework refuses modules that require them.
- Migrations. The adapter plans and applies; the framework owns snapshots and history (section 5).
- JSON columns. A `json<T>()` field type with a validator; PostgreSQL `jsonb` with GIN indexes,
  MySQL `JSON` with functional key parts (`CAST(... AS CHAR(n)) COLLATE utf8mb4_bin`) or multi-valued
  indexes (`CAST(... AS ... ARRAY)`), SQLite JSON built in since 3.38.0 and `JSONB` since 3.45.0
  (2024-01-15). JSON-path filtering is an optional capability.
- Change feed. Three levels: `notify` (PostgreSQL `LISTEN/NOTIFY`: delivered on commit, payload
  under 8,000 bytes, identical payloads folded within one transaction, so it carries keys, never
  rows), `stream` (PostgreSQL logical replication with `wal_level = logical`, a publication and a
  replication slot, consumed by Electric, Zero, PowerSync and Supabase Realtime; MySQL's row-based
  binlog, read by Debezium and PowerSync; SurrealDB `LIVE SELECT`), and `poll` (a sequence column
  on an outbox table, works everywhere).
- Full-text. A `searchIndex` declaration on the entity; PostgreSQL `tsvector` generated column with
  GIN, MySQL InnoDB `FULLTEXT`, SQLite FTS5, SurrealDB `FULLTEXT ANALYZER`, Convex `searchIndex`.
  Adapters that lack it declare so; the framework can fall back to `like` with a warning.
- Locking. Pessimistic row locks (`FOR UPDATE`, `FOR NO KEY UPDATE`, `SKIP LOCKED`, `NOWAIT`; MySQL
  8.4 documents the same options for queue-like tables) for job queues, plus optimistic concurrency
  through a `version` column on every mutable entity, which is the only mechanism non-SQL adapters
  can honour.

## 4. How multi-dialect support is achieved elsewhere

- Drizzle: separate packages per dialect; schemas are not portable, so a framework must emit
  per-dialect table objects, as Payload does at `init`.
- Kysely: one AST, one `Dialect` interface with four factories; dialect differences live in
  `QueryCompiler` and `DialectAdapter`; community dialects exist for many engines.
- Prisma: dialect-neutral schema plus driver adapters; dialect differences surface as unsupported
  features (multi-schema on three engines only).
- MikroORM 7: per-driver packages on top of Kysely; schema diffing per driver.
- Payload: per-adapter packages, each free to choose its engine (Drizzle for SQL, Mongoose for
  MongoDB).

For pennestack the entity model must be dialect-neutral (like Prisma and MikroORM) and the SQL
family should share one implementation. Kysely is the better substrate: it has no opinion about
schema, so the entity model stays the single source; its `Dialect` interface is small;
`transformQuery` plugins give a hook for tenant predicates and table prefixes; MikroORM 7 adopting
it as query runner shows it can carry an ORM; and the built-in `pglite` dialect gives in-process
PostgreSQL for tests. A Drizzle-backed adapter stays possible (standalone `QueryBuilder`,
`getTableConfig`) and the brief names Drizzle, so the boundary must not assume Kysely; it is the
recommended first implementation, not the only one.

## 5. Migrations when every module owns its tables

- Namespacing. PostgreSQL gets one schema per module (`pgSchema`-style, `auth.users`,
  `accounts.profiles`); MySQL has no schemas inside a database (`CREATE SCHEMA` is a synonym for
  `CREATE DATABASE` in the 8.4 manual) and SQLite has none, so those dialects use a table prefix
  (`auth_users`). The adapter maps `{ module, table }` to a physical name; nothing else knows which
  strategy is in use. Supabase's data API exposes only schemas listed under "Exposed schemas"
  (`public` by default) and needs `GRANT USAGE` for others, an argument for prefixes as the
  default on hosted PostgreSQL.
- Per-module snapshots and files. Each module carries `migrations/<module>/NNNN-name.sql` plus a
  JSON snapshot of its own entities, generated by diffing (as drizzle-kit and MikroORM do). The
  history table is global (`pennestack_migrations(module, name, applied_at, checksum)`), so one
  database can host any selection of modules.
- Ordering. Modules declare dependencies already (the brief wants cross-module influence explicit);
  migrations run in topological order of the enabled modules, then by name within a module, with
  Kysely's `allowUnorderedMigrations` behaviour as the model for parallel branches.
- Cross-module references. Foreign keys only towards hard dependencies; a reference to an optional
  module is a typed id column whose integrity the framework enforces (with a hook when the target
  module is disabled), otherwise toggling one module would drop constraints in another.
- Toggling. Disabling a module never drops its tables; data stays until an explicit `retire`
  command runs the module's `down` migrations. Re-enabling a module runs only the migrations missing
  from the history table for that module.
- Dev versus production. Development uses push-style sync against a disposable database (Payload,
  Keystone and Gel's `watch --migrate` converge on this) with Gel-style confirmation of destructive
  steps; production applies files only and, like `keystone build --frozen`, refuses to start when
  files and snapshot disagree.

## 6. Types that are always live

Three mechanisms exist:

1. Entity-first inference. Types flow from the entity definitions through generics (Drizzle
   `$inferSelect`, MikroORM `InferEntity`, Convex `DataModelFromSchemaDefinition`). No generation;
   `tsc`, editors and linters see the same thing; it costs compile time on large schemas and only
   covers tables the framework itself defines.
2. Introspection codegen. kysely-codegen, `supabase gen types`, Gel's `@gel/generate`, Prisma's
   client. Correct for tables the framework does not own, but a file that can go stale. Keystone's
   `build --frozen` and Payload's `generate:types` show the mitigation: regenerate on watch, verify
   in CI.
3. A TypeScript language-service plugin. gql.tada uses one to type GraphQL documents; SafeQL uses
   an ESLint rule with a live PostgreSQL connection to type raw SQL. Two hard limits: the TypeScript
   wiki states plugins "aren't loaded during normal commandline typechecking or emitting, (so are
   not loaded by `tsc`)", and TypeScript 7.0 (released 2026-07-08, 7.0.2 on `latest`) "does not
   ship with an API"; the team recommends TypeScript 7 only "in scenarios where language server
   plugins are not required" and expects a new API in 7.1. A framework that depends on a plugin
   would be unusable with the current compiler.

Recommendation: inference first, a thin generated file second, lint third.

- The entity definitions are plain TypeScript values; `Row<typeof User>` and friends are inferred.
- The dev server writes one generated file in the style of Convex: it imports the application
  config and re-exports derived types (`DataModel`, `Doc<'auth.user'>`, `Id<...>`), so the rest of
  the code base never imports module internals and `tsc` sees the same types as the editor. It also
  writes `.d.ts` declarations for external tables a module maps onto (kysely-codegen style) and the
  derived artefacts of the transports (GraphQL SDL, OpenAPI document; tRPC needs no file).
- A `check` command (and the same code in CI) introspects the database, diffs it against the
  snapshot of the enabled modules and fails on drift, the way SafeQL validates against a live
  schema and Keystone's `--frozen` validates generated files.

What the dev server regenerates on each change: the generated types file; the migration plan for
the dev database (applied after confirmation when destructive); the drift report; transport
artefacts; and, for modules mapping external tables, their declarations. It runs `tsc --noEmit` in
watch mode on the result, so the compiler is the final judge.

## 7. Identifiers, time, deletion, tenancy

### Identifiers

RFC 9562 (May 2024) defines UUIDv7 as a 48-bit millisecond timestamp, version, 12 random bits,
variant, 62 random bits, with three monotonicity methods (dedicated counter, monotonic random,
sub-millisecond precision). PostgreSQL 18 (released 2025-09-25) has `uuidv7()`, `uuidv7(shift)`,
`uuid_extract_timestamp` and `uuid_extract_version`; MariaDB 11.7 has `UUID_v7()`; MySQL has none
(feature request 119729 is only "verified"). ULID is the same 48+80 bits in 26 Crockford base32
characters; TypeID (spec 0.3.0, `typeid-js` 1.2.0) is a lowercase prefix of at most 63 characters,
an underscore and a base32 UUIDv7. Recommendation: UUIDv7 generated in the application (`uuid`
14.0.2 `v7()`, which keeps a monotonic counter) so every dialect behaves identically; native `uuid`
on PostgreSQL, `BINARY(16)` on MySQL, text on SQLite; TypeID form at the API boundary (`usr_...`)
with the prefix derived from the entity, stored unprefixed.

### Timestamps and time zones

PostgreSQL `timestamp with time zone` is "stored internally as UTC, and the originally stated or
assumed time zone is not retained". MySQL "converts `TIMESTAMP` values from the current time zone to
UTC for storage" but not `DATETIME`, and `TIMESTAMP` ends at 2038-01-19. Recommendation: instants
only, in UTC: `timestamptz` on PostgreSQL, `DATETIME(6)` with the session forced to UTC on MySQL,
ISO-8601 text on SQLite; a separate IANA zone column where wall-clock meaning matters (calendar
things, not audit fields); `createdAt`/`updatedAt` set by the framework, not by database defaults,
so they are identical across dialects. In TypeScript, Temporal is at TC39 Stage 4 (March 2026,
per the proposal's README) and Node.js 26.0.0 (2026-05-05) enables it by default; until Node 26 is
the baseline, instants are ISO strings at the boundary and `Date` internally.

### Soft delete versus append-only

Soft delete (`deleted_at`) is a filter that every query, index and unique constraint must remember,
and the wrong model for the brief's collaborative chain. The append-only model stores, per entity,
an event log (`entity_id`, `seq`, `actor`, logical clock, `payload jsonb`) where a delete is a
tombstone, plus a materialised current-state table that queries and transports read. That is what
CQRS wants: the log is the write side, the state table the read side, the change feed the log
itself. Databases offer partial help: MariaDB system-versioned tables (`WITH SYSTEM VERSIONING`,
`FOR SYSTEM_TIME AS OF`, SQL:2011, since 10.3.4 per the knowledge-base revisions) and PostgreSQL
18's temporal constraints (`WITHOUT OVERLAPS`, `PERIOD`), but neither covers MySQL, SQLite or
concurrent offline actors, so the log must be a framework table. Whether its entries are CRDT
operations (Yjs 13.6.33, Automerge 3.5.0, Loro 1.16.4) or server-ordered commands belongs to
[events-and-sync.md](events-and-sync.md); the data layer needs insert-only tables, a per-entity
sequence and a change feed.

### Multi-tenancy

Row-per-tenant with a `tenant_id` column on every tenant-owned entity, injected by the adapter (a
Kysely plugin on every query), is portable to all dialects. PostgreSQL row-level security is the
second line of defence: `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`, policies on a session
setting, and `FORCE ROW LEVEL SECURITY` because "table owners normally bypass row security";
superusers and `BYPASSRLS` roles always bypass. Drizzle models this (`pgPolicy`, `pgRole`);
Supabase relies on it with its `anon`/`authenticated` roles. Schema-per-tenant multiplies the
per-module migration problem by the tenant count and does not exist on MySQL: an adapter option,
not the default.

## 8. Recommendations

1. Entity definitions in TypeScript are the single schema source; everything else (SQL DDL, GraphQL
   SDL, OpenAPI, validators, types) is derived. No PSL-style second language.
2. One dialect-neutral adapter contract (section 3) with declared capabilities checked at boot.
   Entity operations are mandatory; SQL escape hatch, search, locking and change feeds are optional
   capabilities.
3. First adapter family: SQL on Kysely 0.29.6 (PostgreSQL first, then MySQL and SQLite; PGlite for
   tests). Supabase is the PostgreSQL adapter plus an optional Realtime consumer. A Drizzle-backed
   adapter is allowed by the contract but is not the first implementation.
4. Migrations: diff-generated SQL per module with per-module snapshots, one global history table
   keyed by module, topological ordering by module dependencies, foreign keys only towards hard
   dependencies, disable never drops, `retire` does.
5. Types: entity-first inference, one Convex-style generated re-export file written by the dev
   server, `.d.ts` codegen only for external tables, drift check in CI. No language-service plugin.
6. UUIDv7 generated in the application, TypeID-style prefixes at the API, UTC instants, append-only
   event log plus materialised state as the default persistence shape for live entities, row-level
   tenancy enforced by the adapter with PostgreSQL RLS behind it.
7. Live updates: logical replication (PostgreSQL) or binlog (MySQL) where available, the
   framework's own outbox sequence everywhere else; `LISTEN/NOTIFY` only as a wake-up signal.

## 9. Open questions

- Does the mail server need anything the entity operations cannot express (mailbox search across
  large bodies, queue locking)? If so, the SQL escape hatch becomes mandatory for that module.
- Node 26 baseline for Temporal, or `Date` and ISO strings until Node 26 enters LTS?
- Per-module PostgreSQL schemas or prefixes as the default on hosted PostgreSQL?
- Kysely is pre-1.0 (0.29.6) and Drizzle 1.0 is a release candidate; which breakage policy is
  acceptable for the substrate under the adapter?
- Should the event log be CRDT operations or server-ordered commands (see
  [events-and-sync.md](events-and-sync.md))?
