# Authorization models for pennestack

Date: 2026-10-08. Status: research note. It feeds the architecture specification and the
authorization ADR; it decides nothing on its own. Every library version and documented limit
below was checked on 2026-10-08 against the npm registry, the GitHub repository or the primary
documentation listed in section 6.

## 1. What the brief requires

The brief asks for "an authorization framework in the style of CASL: in code, per action,
expressing which action is allowed for which user under which conditions", explicitly rejects
plain role-based access control, and requires everything about it to be configurable. Other
requirements in the brief constrain the design just as much:

- Modules are toggleable and influence each other in a typed way, so several modules will add
  rules for one entity, and a rule may reference a relation that exists only while another
  module is on.
- GraphQL, REST and tRPC derive from the same definitions, so enforcement sits in the action
  layer, below every transport.
- The data layer is pluggable (PostgreSQL, MySQL, hosted PostgreSQL, Drizzle, or anything
  else), so compiled filters must target an abstraction, not one ORM.
- Live updates and an append-only, multi-actor data model mean one condition must run both as
  a database filter and in memory (is a changed row pushed to this subscriber, may an offline
  operation be applied).
- Database types are generated live, so the authorization layer can know every entity's fields
  and relations at compile time. CASL cannot; that difference drives the recommendation.

Criteria used below: (a) policies per action in TypeScript with typed entities and actions;
(b) compiling conditions into data-layer filters; (c) field-level read and write masks;
(d) relationship-based needs (ownership, membership, delegation) across toggleable modules;
(e) composition when several modules add rules for one entity; (f) performance;
(g) auditability and explainability; (h) testability.

## 2. Candidates

### 2.1 CASL

Checked: `@casl/ability` 7.0.1 (7.0.0 released 2026-05-21, 7.0.1 on 2026-06-10),
`@casl/prisma` 2.0.2, `@casl/mongoose` 9.0.2, `@ucast/core` 2.0.0, `@ucast/sql` 0.2.0. MIT.
One primary author; the repository is active (last push 2026-10-08).

Model. An `Ability` holds rules `{ action, subject, conditions?, fields?, inverted?, reason? }`
built with `AbilityBuilder` or `defineAbility` (`can`, `cannot`, `.because()`), with `manage`
and `all` as wildcards. Conditions are a MongoDB-query subset interpreted by `@ucast/mongo2js`
(`$eq $ne $lt $lte $gt $gte $in $nin $all $size $regex $elemMatch $exists`, dot paths). Direct
rules combine with OR, inverted rules with AND, and later rules take precedence; the guide
says "always remember to put inverted rules after the direct one!". Version 7 renamed
`PureAbility` to `Ability`, replaced `rulesToQuery` with `rulesToCondition`, and made
`rulesFor` return `readonly Rule[]`.

Typing. `createMongoAbility<[Actions, Subjects], MongoQuery>()`; a union of tuples
(`['read', 'User'] | [CRUD, 'Article']`) constrains actions per subject; `MongoQuery<T>` types
conditions against an interface; `AbilityBuilder` infers condition keys and field names from
the subject type. Instances are detected by `constructor.modelName`, then `constructor.name`
(unsafe under minification); plain rows need `subject('Article', row)` tagging or a custom
`detectSubjectType`. The `@casl/prisma` README states that there is "no easy way to automate
this".

Filters. `rulesToAST(ability, action, subjectType)` returns a ucast `Condition | null`;
`rulesToCondition(rules, convert, { and, or, empty })` flattens the priority order: each `can`
branch is OR-ed and bounded by the `cannot` conditions above it. `@casl/prisma` uses Prisma
`WhereInput` as its condition language, offers `accessibleBy(ability, action).ofType('Post')`
and ships `createCaslExtension()` so that "no access" yields an empty result instead of a
rejected query. Its in-memory interpreter skips equality on JSON and list columns and requires
an explicit relation operator (`some`, `every`, `none`, `is`, `isNot`). `@ucast/sql`
compiles the AST to SQL for `pg`, `mysql`, `sqlite`, `oracle` and `mssql`, using `EXISTS`
subqueries for `some/none/every`, with integrations for Sequelize, Objection, TypeORM and
MikroORM only. There is no first-party Drizzle or Kysely adapter; the community package
`@noxify/casl-drizzle` 0.3.1 (2026-08-03) requires `drizzle-orm` 1.0.0-rc.4 (the `latest`
tag is 0.45.4) and documents inverted results for nested `none()`.

Fields. Rules take a field list with glob patterns (`*`, `**`, `street*`);
`ability.can(action, subject, field)` checks one field; `permittedFieldsOf(ability, action,
subject, { fieldsFrom })` lists them but needs `fieldsFrom` because CASL does not know entity
shapes. A field check against a subject type answers "for at least one instance", a
documented trap.

Composition, performance, explainability, tests. Rules are one flat list with positional
precedence, so the order in which modules append rules changes outcomes. `RuleIndex` builds
`Map<subjectType, Map<action, rules>>` once, merges `manage`/`all` rules and memoises per
(subject, action); matchers compile lazily per rule; evaluation is in-process and cheap, and
`packRules`/`unpackRules` serialise rules for a client. `relevantRuleFor()` returns the
deciding rule and `ForbiddenError.from(ability).throwUnlessCan()` carries its `reason`; there
is no decision log. Tests are ordinary unit tests. The same rules run in `@casl/react` 7.0.1
and `@casl/vue` 3.0.1.

### 2.2 Oso (Polar) and Oso Cloud

The open-source `oso` library (npm 0.27.3) was deprecated with release 0.27.1 on 2023-12-18;
the project README says Oso is "not end-of-lifing" it and will "continue to provide support
and critical bug fixes", but no new features. It is not a candidate for a new framework.

Oso Cloud (`oso-cloud` 2.6.0) is a hosted decision service. Policies are Polar:
`actor User {}`, `resource Document { roles = [...]; permissions = [...]; relations = {
organization: Organization }; "read" if "viewer"; role if role on "organization"; "delete" if
"creator" on resource; }`. Facts live in Oso Cloud or, with "local authorization", stay in
your PostgreSQL or MySQL database: a YAML data binding maps fact signatures to `SELECT`
queries, `listLocal(actor, action, resourceType, column)` returns a SQL `WHERE` fragment,
`authorizeLocal` a boolean query and `actionsLocal` the action set. Documented limits: only
PostgreSQL and MySQL, no inequality comparisons between cloud and local data, no recursion
mixing both. `list()` is recommended up to roughly 10,000 authorised resources per user,
`listLocal` for millions. SDK 2.0.0 generates TypeScript types from the policy. Polar has
built-in tests (`test "name" { setup { ... } assert ...; assert_not ...; }`), the dashboard has
Logs and an Explain view listing the facts and rules behind a decision, and a Dev Server runs
locally ("Not for production use"). Deployment is SaaS, hybrid with a read-only Fallback node,
or self-hosted "for AWS-based environments" only.

Verdict: a well-designed ReBAC/ABAC hybrid with real list filtering, but policies are not
TypeScript, decisions leave the process, and a self-hosted platform would depend on a hosted
service. The `listLocal` shape (the engine emits a `WHERE` fragment, the database applies it)
is the pattern to copy.

### 2.3 Cerbos

Checked: Cerbos PDP v0.56.0 (2026-09-30), `@cerbos/grpc` 0.29.1, `@cerbos/core` 0.33.1,
`@cerbos/orm-prisma` 4.1.0, `@cerbos/orm-drizzle` 0.1.0. Apache-2.0.

Cerbos is a sidecar policy decision point. Policies are YAML with CEL conditions: resource
policies (rules with `actions`, `effect: EFFECT_ALLOW|EFFECT_DENY`, `roles`, `derivedRoles`,
`condition`, `name`, `output`), principal policies (per-user overrides, evaluated first; an
explicit effect settles the action), derived roles (`owner` when
`request.resource.attr.owner == request.principal.id`), role policies (an exhaustive allow
list that can only narrow) and scoped policies. Conflicts: for one role, DENY wins; across
roles, any ALLOW wins; default deny.

`CheckResources` batches up to 50 resources with 50 actions each. `PlanResources` answers
"which resources?" with `KIND_ALWAYS_ALLOWED`, `KIND_ALWAYS_DENIED` or `KIND_CONDITIONAL` plus
an operator/operand AST. The adapters translate that AST into ORM filters through a mapper
from `request.resource.attr.*` to columns and relations (to-one becomes `is`, to-many becomes
`some/every/none`, Drizzle gets correlated `EXISTS`). Their READMEs publish conformance tiers
against PDP 0.56.0 (Prisma: core 29/29, extended 76/98, adversarial 252/340; Drizzle: 29/29,
91/98, 309/340); unsupported shapes throw `UnsupportedQueryPlanError` rather than over-grant;
byte-exact collation is called an authorization requirement (PostgreSQL `"C"`, MySQL
`utf8mb4_0900_bin`); default scopes such as soft delete must be repeated in `subqueryFilter`.
Decision and access logs go to local, file, Kafka or hub backends keyed by `cerbosCallId`.
Tests are YAML suites (`*_test.yaml`) run by `cerbos compile`, which also validates policies.
There are no field-level masks.

Verdict: the best-engineered query-plan contract in this survey; the three-way plan result and
the refuse-rather-than-over-grant rule should be adopted. But policies live outside TypeScript,
every check crosses a process boundary, and the sidecar is operational weight the brief never
asks for.

### 2.4 Relationship-based: Zanzibar, OpenFGA, SpiceDB

Zanzibar (Pang et al., USENIX ATC 2019) stores relationship tuples `object#relation@subject`
in a dedicated service and derives permissions by walking the graph. OpenFGA v1.22.0
(2026-10-06; `@openfga/sdk` 0.9.7) and SpiceDB v1.56.2 (2026-09-11; `@authzed/authzed-node`
1.6.1) are the open-source implementations, both Apache-2.0.

Models are schemas, not code: SpiceDB `definition document { relation viewer: user |
group#member; permission view = viewer + parent->view }` with `+ & -` and arrows; OpenFGA's
DSL is equivalent. Both add attribute conditions in CEL (OpenFGA `condition
non_expired_grant(...) { ... }` attached as `[user with non_expired_grant]`; SpiceDB caveats
answering `CONDITIONAL_PERMISSION` with the missing context named). List filtering is
`ListObjects` or `LookupResources`: OpenFGA defaults to 1,000 results within a 3 s deadline,
and its "search with permissions" guide says an ID list "would not work" at thousands or tens
of thousands of results, recommending a local index built from the changes feed instead;
SpiceDB streams `LookupResources` with cursors and per-request consistency
(`minimize_latency`, `at_least_as_fresh` with ZedTokens, `fully_consistent`) to avoid the "New
Enemy Problem". Explainability: `Expand` and `zed permission check --explain`. Tests:
`fga model test --tests x.fga.yaml` (check and list assertions) and `zed validate` with
`assertTrue`, `assertFalse` and `assertCaveated`.

Verdict: strongest for deep hierarchies and large sharing graphs, but pennestack's relations
(owner, membership, delegation) already live in its entity graph, so a tuple store means dual
writes and a consistency problem the framework would have to solve itself. No field masks,
policies are not TypeScript, and list filtering returns IDs rather than a filter. The
relation-walk idea (`permission = relation | relation->permission`) is worth keeping as the
way derived relations are declared.

### 2.5 Cedar

Checked: `cedar-policy` 4.13.0 (crates.io, 2026-09-15), `@cedar-policy/cedar-wasm` 4.13.0.
Apache-2.0, a CNCF project.

Policies are `permit`/`forbid` statements over principal, action, resource and context:
`permit (principal is User in Group::"editors", action in [Action::"edit"], resource is
Document) when { resource.owner == principal } unless { resource.archived };`. Semantics are
fixed and order-independent: any satisfied `forbid` denies, otherwise any satisfied `permit`
allows, otherwise deny; a policy that errors is ignored. Responses carry
`Diagnostics { reason: PolicyId[], errors }`. A schema enables validation. The wasm package
exposes `isAuthorized`, `validate`, `checkParsePolicySet`, `formatPolicies`, `policyToJson`,
`schemaToJson` and `isAuthorizedPartial`, which returns `residuals: Record<string,
PolicyJson>` for unknown inputs. Partial evaluation sits behind the experimental
`partial-eval` feature; RFC 0095 (type-aware partial evaluation, opened 2025-01-30, acceptance
"TBD") names "translating the residuals to a SQL query" as a goal and requires `context` to be
fully known or fully unknown. No shipped adapter turns residuals into ORM filters, and the
caller must load the relevant entities into every request.

Verdict: the cleanest decision semantics and diagnostics in the survey, but no TypeScript
authoring, no stable path to data-layer filters, and no field masks.

### 2.6 Keystone access control

Checked: `@keystone-6/core` 8.1.0. Each list has `access: { operation, filter, item }`.
`operation.query` (with `kind: 'one' | 'many' | 'count'`), `create`, `update` and `delete`
return booleans before any query runs. `filter.query/update/delete` return a boolean or a
GraphQL `where` filter that Keystone ANDs with the user's filter, or with the item's id for
mutations; there is no `filter.create`. `item.create/update/delete` receive `inputData` and
the stored `item` and return booleans. Field `access.read` has kinds `item`, `filter` and
`order`, so hidden fields cannot be filtered or sorted on; `create` and `update` are booleans.
Denied queries treat items as nonexistent; denied mutations return `null` with an error.

Verdict: the closest existing shape to the brief, in code and per operation; its three stages
(gate, filter, item) are the right decomposition. Weaknesses: bound to Prisma and the Keystone
schema, no composition across modules, field rules cannot return filters, no reasons or
decision log.

### 2.7 Payload access functions

Checked: `payload` 3.90.2. Collection `access.create/read/update/delete` (plus `admin`,
`unlock`, `readVersions`) receive `req`, `id` and `data`; `read`, `update` and `delete` may
return a `Where` query, `create` is boolean only. Field `access.create/read/update` are
boolean only ("Field Access Control does not support returning Query constraints"); a denied
`read` omits the property, a denied `update` silently keeps the old value. Defaults: any
logged-in user passes, and the Local API skips access control unless `overrideAccess: false`.

Verdict: the same family as Keystone with a looser type model, and two defaults pennestack must
not copy: silent discard of forbidden writes, and an internal API that bypasses policy by
default.

### 2.8 PostgreSQL row-level security as a backstop

Checked against the PostgreSQL 18 documentation. `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`
plus `CREATE POLICY name ON table [FOR SELECT|INSERT|UPDATE|DELETE|ALL] [TO role] USING (expr)
[WITH CHECK (expr)]`. `USING` filters existing rows, `WITH CHECK` validates new or modified
rows and defaults to `USING`. Permissive policies OR together, `AS RESTRICTIVE` policies AND;
a table with RLS enabled and no policy denies everything. Owners bypass unless `FORCE ROW LEVEL
SECURITY`; superusers and `BYPASSRLS` roles always bypass; referential-integrity checks bypass
and the manual warns about covert channels. The principal reaches a policy through
`current_setting('pennestack.principal', true)`, set per
transaction with `set_config(name, value, true)`. Performance: "expressions that use only the
current row are the simplest and best-performing case", and sub-selects inside policies race
under `READ COMMITTED`. MySQL has no equivalent feature.

Verdict: valuable defence in depth for tenant isolation on PostgreSQL deployments, generated
from the same conditions, never the primary mechanism: it cannot express field masks, actions
beyond the four SQL commands, or cross-module composition, and it is not portable across the
data layers the brief lists.

## 3. Comparison

| | CASL 7.0.1 | Oso Cloud 2.6.0 | Cerbos 0.56.0 | OpenFGA 1.22.0 / SpiceDB 1.56.2 | Cedar 4.13.0 | Keystone 8.1.0 | Payload 3.90.2 | PostgreSQL RLS |
|---|---|---|---|---|---|---|---|---|
| Policy lives in | TypeScript rules | Polar, deployed to a service | YAML + CEL, sidecar | Schema DSL + tuples, service | Cedar language | TypeScript functions | TypeScript functions | SQL policies |
| Typed entities and actions | Tuple unions, manual tagging of rows | Generated TS types from policy | JSON schemas for attributes | Model validation only | Schema validation | Per list, from Prisma | Loose `Where` | None |
| List pre-filtering | `rulesToAST`; Prisma, Mongoose, `@ucast/sql` | `listLocal` SQL fragment (PostgreSQL, MySQL) | `PlanResources` + adapters (Prisma, Drizzle, ...) | ID lists (1,000 / 3 s defaults) or local index | Experimental residuals, no adapter | Filter object, ANDed | `Where`, read/update/delete only | Native, `USING` |
| Field masks | Yes, with globs; needs `fieldsFrom` | No | No | No | No | Read/create/update booleans; read covers filter and order | Booleans; silent discard on write | No |
| Relationship conditions | Via query operators on relations | Relations and `on` rules | Attributes and relation mappers | Native graph walk | Entity hierarchy via `in` | Via nested filters | Via nested `Where` | Sub-selects |
| Cross-module composition | Positional precedence, fragile | Single policy | Policy files per resource, scopes | Single schema | Order-independent policy set | None | None | Permissive OR, restrictive AND |
| Runtime | In process | Network call (or local SQL) | Network call to sidecar | Network call | In process (wasm) | In process | In process | In database |
| Explainability | `relevantRuleFor`, `reason` | Logs + Explain view | Decision logs, `effectiveDerivedRoles` | `Expand`, `--explain` | `Diagnostics.reason` | None | None | None |
| Policy tests | Unit tests | Polar `test` blocks | `cerbos compile` YAML suites | `fga model test`, `zed validate` | Validator, unit tests | Unit tests | Unit tests | SQL tests |

## 4. Cross-cutting findings

1. Order-independent semantics compose; positional semantics do not. Cedar, Cerbos within a
   role, and PostgreSQL RLS all define the result as a function of the set of matching rules
   (deny overrides, default deny). CASL defines it by list position, which works for one
   author but not for rules contributed by independently toggleable modules.
2. A plan has three outcomes. Cerbos's `ALWAYS_ALLOWED | ALWAYS_DENIED | CONDITIONAL` lets the
   caller skip the filter entirely, short-circuit to an empty result, or apply a condition.
   CASL's `null` for "nothing allowed" and `@casl/prisma`'s empty-condition marker are the same
   idea with a weaker contract.
3. Conditions must run in both directions: compiled into the data layer for lists, and
   interpreted in memory for a loaded row, a mutation's resulting row, a changed row headed
   to a subscriber, or an offline operation. CASL (via ucast), `@casl/prisma` and Cerbos's
   adapters prove that a neutral AST with two interpreters works; their documented gaps (JSON
   and list equality, nested `none`, collation) show where the two drift apart when nobody
   tests them against each other.
4. Field masks must also govern filtering and ordering (Keystone's `read.filter` and
   `read.order`), or a hidden field leaks through `where` and `orderBy`.
5. Refuse rather than over-grant. Cerbos's adapters throw `UnsupportedQueryPlanError` for
   shapes the target store cannot express; the alternative is a silently wider filter.
6. Compute relationships from the entity graph, not from a copied tuple store, as long as the
   graph is in one database. The Zanzibar family is the right answer only when relationships
   span systems or hierarchies are deep enough that `EXISTS` chains no longer perform.
7. Explainability is rule identity plus reason. Cedar's `reason: PolicyId[]`, Cerbos's rule
   `name` and `cerbosCallId`, and CASL's `because()` all attach a stable identifier and a
   human sentence to the deciding rule. A decision log is a hook over that record.
8. The strongest test is dual evaluation: run the compiled filter against fixture rows and
   compare with the in-memory decision row by row, which is what Cerbos's conformance tiers
   do.

## 5. Recommendation

### 5.1 The model

Adopt a typed-native ability engine with a CASL-like mental model: rules are written in
TypeScript, per entity and per action, as allow and deny rules whose conditions are query
objects over the entity's own fields and relations. Four decisions depart from CASL on
purpose:

- Entities and actions come from the module definitions, not from constructor names or
  tagging. Because the data layer generates entity types, a rule's condition is typed against
  the entity's fields and relations, and the set of valid actions for an entity is the set the
  module declared (entity actions plus module and application actions). No `subject()` helper.
- Decision semantics are set-based and order-independent: `allowed = (some allow rule
  matches) and not (any deny rule matches)`, default deny. Modules contribute rule fragments;
  the engine unions them, and toggling a module adds or removes its fragment without changing
  anything else's meaning. Deny rules are for genuine overrides (suspended accounts, archived
  records) and should stay rare.
- Conditions are a small neutral AST shared with the data layer (field comparisons, `and`,
  `or`, `not`, relation quantifiers `some`, `none`, `every`, `is`). The same AST compiles to
  each data adapter's filter and is interpreted in memory. Operators outside the set an adapter
  can express make the plan fail closed with an error, never a wider filter.
- Field masks are first class and derived from the entity's field list, so `readableFields`
  and `writableFields` need no `fieldsFrom`; read masks also apply to filter and order inputs.

Enforcement follows Keystone's three stages inside the action layer: a cheap gate (is the
action possible at all for this principal), a plan (`always`, `never`, or `conditional` with a
condition and a field mask, applied to list queries and to the target selection of updates and
deletes), and an item check (the condition interpreted against the loaded row for reads, and
against the resulting row for creates and updates, which is the `WITH CHECK` idea). Forbidden
writes to masked fields are an error by default, with a configurable strip mode.

Relationship-based needs are relation conditions on the entity graph
(`{ team: { members: { some: { userId: ctx.user.id } } } }`); reusable ones are declared once
as named derived relations (`owner`, `member`, `delegate`) in the module that owns the
relation. A module that extends another entity registers its fragment with a dependency on
both modules, so the type checker rejects a condition that references a relation whose module
is not part of the platform.

### 5.2 Sketch

```ts
// A condition is a serialisable AST typed against an entity's shape.
type Condition<E> =
  | { kind: 'field'; path: FieldPath<E>; op: 'eq' | 'ne' | 'in' | 'nin' | 'lt' | 'lte' | 'gt' | 'gte' | 'isNull'; value: unknown }
  | { kind: 'relation'; path: RelationPath<E>; op: 'some' | 'none' | 'every' | 'is'; where: Condition<RelatedEntity<E, RelationPath<E>>> }
  | { kind: 'and' | 'or'; conditions: Condition<E>[] }
  | { kind: 'not'; condition: Condition<E> };

interface Rule<E extends Entity, A extends ActionOf<E>> {
  id: string;                       // stable, module-prefixed: 'teams.projects.read.member'
  effect: 'allow' | 'deny';
  entity: E;
  actions: A[];
  where?: (ctx: PrincipalContext) => Condition<E> | boolean; // omitted = unconditional
  fields?: FieldMask<E>;            // omitted = all fields
  reason?: string;                  // shown in ForbiddenError and decision logs
}

// Written by the module that owns `projects`.
export const projectsPolicy = definePolicy(projects, (rule) => [
  rule.allow('read', { where: () => ({ visibility: 'public' }) }),
  rule.allow(['read', 'update', 'delete', 'deploy'], { where: (ctx) => ({ ownerId: ctx.user.id }) }),
  rule.allow('update', { where: (ctx) => ({ ownerId: ctx.user.id }), fields: ['name', 'description'] }),
  rule.deny('deploy', { where: () => ({ archived: true }), reason: 'Archived projects cannot be deployed.' }),
]);

// Written by the teams module, only active when both modules are on.
export const teamProjectsPolicy = extendPolicy(projects, { requires: [teams] }, (rule) => [
  rule.allow('read', { where: (ctx) => ({ team: { members: { some: { userId: ctx.user.id } } } }) }),
]);

// Engine API used by the action layer and the live-update module.
interface Authorizer {
  plan<E extends Entity>(ctx: PrincipalContext, action: ActionOf<E>, entity: E):
    | { kind: 'always'; fields: FieldMask<E> }
    | { kind: 'never'; reason?: string }
    | { kind: 'conditional'; where: Condition<E>; fields: FieldMask<E> };
  check<E extends Entity>(ctx: PrincipalContext, action: ActionOf<E>, entity: E, row: RowOf<E>, field?: FieldOf<E>):
    { allowed: boolean; matched: Array<{ ruleId: string; effect: 'allow' | 'deny'; reason?: string }> };
}
```

A plan compiles to the active data adapter through `compile(condition)`; the first adapters
are the query builder the data-layer research selects and an in-memory interpreter. Policies
are compiled once at boot into an index keyed by entity and action (the CASL `RuleIndex`
idea), the principal context (user, roles, memberships) is resolved once per request, and
plans are memoised per request by (entity, action). Each decision exposes the matched rule ids
and reasons; an optional decision-log hook feeds the audit module, and `explain(plan)` renders
the resolved condition for support work.

Testing: table-driven policy tests in TypeScript (`expect(authz).toAllow(ctx, 'read',
projects, row)`), type-level tests that a fragment cannot reference fields or relations its
required modules do not provide, and a dual-evaluation suite that inserts fixture rows,
runs the compiled plan as a real query on every supported database, and asserts equality with
the in-memory decision row by row. PostgreSQL RLS is an optional generator: conditions that
compile to plain SQL over the row become `USING`/`WITH CHECK` policies with
`current_setting('pennestack.principal', true)`, enabled per table as a backstop.

Clients: because rules are serialisable, the engine can export a principal's effective rules
in CASL's raw-rule shape (`{ action, subject, conditions, fields, inverted, reason }`) so a
later UI can use `@casl/react` or `@casl/vue` unchanged. That keeps the CASL mental model
where it is strongest, on the client, without binding the backend to it.

### 5.3 Depend on CASL or build?

Build the engine; do not depend on `@casl/ability` on the server. The reasons, in order of
weight:

1. Subject typing. CASL identifies subjects by constructor or by tagging each row; pennestack
   already knows the entity of every row from the data layer. The tagging step is exactly the
   kind of accidental complexity the brief's "plug and play with the compiler" rules out.
2. Composition. Positional precedence cannot be made order-independent without reimplementing
   the evaluator, and `rulesToCondition` exists precisely to flatten that order for queries.
3. Condition language. CASL's conditions are MongoDB queries (or Prisma `WhereInput` with
   `@casl/prisma`); pennestack needs a typed AST owned by its data layer, with adapters for
   whatever the data-layer research chooses. The first-party SQL path (`@ucast/sql` 0.2.0)
   supports Sequelize, Objection, TypeORM and MikroORM, not Drizzle or a plain builder.
4. Field masks need entity shapes, which CASL does not have and pennestack does.
5. Maintenance surface. CASL is a single-maintainer project with a 7.0 breaking release on
   2026-05-21; its ESM runtime is about 16 KB plus `@ucast/mongo2js`, so reimplementing the
   parts pennestack needs (index, matcher, rule algebra) is a few hundred lines, while the
   typed parts are new work either way.

What to take from CASL anyway: the vocabulary (`can`, `cannot`, actions, conditions, fields,
`because`), the per-rule `reason`, the `RuleIndex` layout, the `rulesToAST` contract, and the
raw-rule serialisation for clients. `@ucast/core` 2.0.0 is a reasonable reference for the AST
shape but too small to be worth a dependency.

### 5.4 Risks

- Writing an evaluator and compilers invites subtle divergence between in-memory and SQL
  semantics (null handling, collation, nested `none`). Mitigation: a small operator set, the
  dual-evaluation suite from day one, and fail-closed compilation.
- Deep relation chains compile to nested `EXISTS` subqueries; performance must be measured on
  the Launchway and mail-server schemas before adding deeper derived relations.
- Deny rules reintroduce reasoning complexity. Keep them rare and always with a `reason`.

### 5.5 Open questions for the ADR

- Is the condition AST owned by the data layer or by the authorization package? The sketch
  assumes one shared AST; the data-layer research must confirm its filter model can host it.
- How does the principal context get its roles and memberships (authentication module, accounts
  module, a cache), and what is its lifetime relative to the append-only data chain?
- Are deny rules part of the first version, or do allow rules with `unless` conditions cover
  the two platforms?
- Which decisions are logged by default (denials only, as Cerbos's `ignoreAllowAll` filter
  suggests, or everything), and does the record join the append-only chain?

## 6. Sources

All checked on 2026-10-08.

- CASL: https://casl.js.org/v6/en/guide/intro, https://casl.js.org/v6/en/guide/restricting-fields,
  https://casl.js.org/v6/en/advanced/ability-to-database-query, https://casl.js.org/v6/en/advanced/typescript,
  https://casl.js.org/v6/en/guide/subject-type-detection,
  https://github.com/stalniy/casl/blob/master/packages/casl-ability/CHANGELOG.md,
  `@casl/ability@7.0.1` and `@casl/prisma@2.0.2` type definitions and README from npm,
  https://github.com/stalniy/ucast (packages/sql), https://www.npmjs.com/package/@noxify/casl-drizzle
- Oso: https://github.com/osohq/oso (README deprecation notice),
  https://www.osohq.com/docs/oss/project/changelogs/2023-12-18.html,
  https://www.osohq.com/docs/develop/policies/overview, https://www.osohq.com/docs/reference/sdks/authorization-checks,
  https://www.osohq.com/docs/reference/sdks/local-authorization, https://www.osohq.com/docs/develop/enforce/list-filtering,
  https://www.osohq.com/docs/reference/polar/tests, https://www.osohq.com/docs/develop/troubleshooting/debugging,
  https://www.osohq.com/docs/develop/local-dev/oso-dev-server, https://www.osohq.com/docs/deploy/deployment-models,
  https://www.osohq.com/docs/reference/sdks/changelog/nodejs
- Cerbos: https://docs.cerbos.dev/cerbos/latest/api/index.html, https://docs.cerbos.dev/cerbos/latest/policies/resource_policies.html,
  https://docs.cerbos.dev/cerbos/latest/policies/principal_policies.html, https://docs.cerbos.dev/cerbos/latest/policies/derived_roles.html,
  https://docs.cerbos.dev/cerbos/latest/policies/role_policies.html, https://docs.cerbos.dev/cerbos/latest/policies/conditions.html,
  https://docs.cerbos.dev/cerbos/latest/policies/compile.html, https://docs.cerbos.dev/cerbos/latest/configuration/audit.html,
  https://github.com/cerbos/query-plan-adapters (prisma/README.md, drizzle/README.md), https://github.com/cerbos/cerbos/releases
- OpenFGA and SpiceDB: https://openfga.dev/docs/interacting/relationship-queries, https://openfga.dev/docs/interacting/search-with-permissions,
  https://openfga.dev/docs/modeling/conditions, https://openfga.dev/docs/modeling/testing, https://github.com/openfga/openfga/releases,
  https://authzed.com/docs/spicedb/concepts/schema, https://authzed.com/docs/spicedb/concepts/caveats,
  https://authzed.com/docs/spicedb/concepts/consistency, https://authzed.com/docs/spicedb/modeling/validation-testing-debugging,
  https://github.com/authzed/api/blob/main/authzed/api/v1/permission_service.proto, https://github.com/authzed/spicedb/releases,
  Zanzibar paper: https://www.usenix.org/conference/atc19/presentation/pang
- Cedar: https://docs.cedarpolicy.com/policies/syntax-policy.html, https://docs.cedarpolicy.com/auth/authorization.html,
  https://docs.cedarpolicy.com/overview/terminology.html, https://docs.rs/cedar-policy/latest/cedar_policy/,
  https://github.com/cedar-policy/rfcs/blob/main/text/0095-type-aware-partial-evaluation.md,
  `@cedar-policy/cedar-wasm@4.13.0` type definitions from npm, https://crates.io/crates/cedar-policy
- Keystone: https://keystonejs.com/docs/config/access-control
- Payload: https://payloadcms.com/docs/access-control/overview, https://payloadcms.com/docs/access-control/collections,
  https://payloadcms.com/docs/access-control/fields
- PostgreSQL: https://www.postgresql.org/docs/current/ddl-rowsecurity.html, https://www.postgresql.org/docs/current/functions-admin.html
