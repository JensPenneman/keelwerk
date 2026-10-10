# 5. Authorization: a typed-native engine with CASL vocabulary, order-independent rules and compiled conditions

Date: 2026-10-08

## Status

Accepted

## Context

The brief asks for authorization "in the style of CASL: in code, per action, expressing which
action is allowed for which user under which conditions", explicitly not plain role-based access
control, with everything configurable. Other requirements constrain it: rules will come from
several toggleable modules; enforcement must sit below every transport; conditions must compile
to a pluggable data layer and run in memory for live events and offline operations; tenants must
be isolated regardless of policy mistakes.

The research (authorization.md) examined CASL 7.0.1 with its Prisma and SQL adapters, Oso Cloud,
Cerbos 0.56.0, OpenFGA and SpiceDB, Cedar 4.13.0, Keystone and Payload access functions, and
PostgreSQL 18 row-level security. CASL's mental model fits; its mechanics do not: subjects are
detected by constructor name or manual tagging, precedence is positional (fragile when modules
contribute rules), conditions are MongoDB or Prisma queries, field masks need `fieldsFrom`, and
there is no first-party adapter for a query builder. Cedar, Cerbos and PostgreSQL RLS show that
order-independent semantics compose; Cerbos shows the three-way plan with fail-closed
compilation; Keystone shows the gate, filter and item stages and that read masks must also
govern filtering and ordering; Payload shows two defaults to avoid (silent discard of forbidden
writes, internal calls bypassing policy).

## Decision

1. The engine is built in `@pennestack/core` and does not depend on `@casl/ability`. It keeps
   CASL's vocabulary: allow and deny rules per entity and action, conditions, field lists, a
   reason, serialisable rules.
2. Rules are typed against the registry: conditions name real fields and relations, field masks
   name real fields, action lists name the actions that exist for the entity. No subject tagging.
3. Decision algebra: `allowed = (some allow rule matches) and not (any deny rule matches)`,
   default deny, order-independent. Modules contribute rule fragments as a set; a contribution's
   rules may reference relations only from modules in its `when` list, which the types enforce.
4. One condition AST (`eq`, `ne`, `lt`, `lte`, `gt`, `gte`, `in`, `nin`, `contains`,
   `startsWith`, `isNull`, `and`, `or`, `not`, `some`, `none`, `every`, `is`) owned by the core and
   shared with the data layer, the live feed and the sync protocol. Adapters compile it; the
   engine interprets it in memory. An adapter that cannot express a shape fails with
   `unsupported`, never a wider filter.
5. Three stages inside the invoker: gate (boolean), plan (`always`, `never` or `conditional
   { where, fields }`, applied to every read, to update and archive target selection and to live
   events), item check (condition against the loaded row for reads, against the resulting row for
   creates and updates). Field masks also apply to `filter` and `sort` inputs. Forbidden field
   writes are an error by default, with a configurable strip mode.
6. Principals are resolved by ordered resolvers and enriched (roles, memberships) by a set of
   enrichers, once per invocation; the principal's plan is memoised per invocation only.
7. Every decision carries matched rule ids and reasons; a decision-log hook, `explain`, and three
   test suites (table-driven, type-level, dual-evaluation against every adapter) are part of the
   engine. Effective rules can be exported in CASL raw-rule shape for later clients.
8. Tenant isolation is outside the rule set: the scope resolved in the pipeline is applied by the
   data layer before any plan, and scope levels are checked at the gate.
9. Configurability: app-level mode, decision log, disable, add and replace of rules; runtime rule
   sources validated against the registry; replaceable evaluator and compilers; optional
   generated PostgreSQL row-level security as a backstop.

## Consequences

- Cross-module composition is safe: toggling a module adds or removes its fragment without
  changing the meaning of other rules.
- One AST with two interpreters risks semantic divergence (null handling, collation, nested
  `none`); the small operator set, fail-closed compilation and the dual-evaluation suite from the
  first adapter are the mitigation.
- The project owns an evaluator and compilers; the typed parts would have been new work with any
  library, and the runtime parts are a few hundred lines.
- Deny rules reintroduce reasoning complexity; they require a reason and should stay rare.
- Deep relation chains compile to nested `EXISTS` subqueries; performance must be measured on
  the two proof apps before adding deeper derived relations.
- A later UI can reuse the CASL client packages unchanged through the exported raw rules.
