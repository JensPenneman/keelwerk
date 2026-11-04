# 5. Authorization: a typed-native engine with CASL vocabulary, the invoked action as the unit, and separate conditions for the row acted on and the row produced

Date: 2026-10-08 (revised 2026-10-11 and 2026-10-24; amended 2026-10-25; notes of 2026-10-28)

## Status

Accepted (2026-11-04). Jens decided decision points 4 and 5 of architecture.md section 26 on 2026-10-24 as items
6 and 3 state them, adding the shape-stage row check of item 5. Item 6 is amended by
[ADR 0026](0026-pure-handlers-and-the-effect-interpreter.md) (decision 50a): loads and drafts
replace repository calls, and the escalation is an effect. Since decision 60b (2026-10-28, ADR
0024) every rule is a file of its own, `defineRule(base, target, { ... })` in
`policies/<target>/<rule>.ts`, and its id comes from that path (`auth.credential.self`); the rules
still compose as one order-independent set (item 3). Since brief addendum 5 and decision 12a
(2026-10-26) an operator an adapter cannot compile is evaluated by the kernel rather than refused
(item 4; architecture.md section 14.3.3).

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

The review of 2026-10-11 found that the first version of this decision failed its own examples:

- One `where` per rule had to describe both the row acted on and the row produced, so a deny rule
  "already revoked" denied every successful revocation and an allow rule "drafts may be edited"
  forbade publishing; state-machine transitions are the most common policy pattern of both
  platforms.
- Repository calls inside handlers were authorized per entity under the caller's plan, so
  `accounts.register` and `auth.login` could not create rows, uniqueness checks narrowed silently
  to wrong answers, and reactions ran under whoever caused the event.
- Masked rows reached `decide`, making decisions depend on the caller's mask.
- An interpolated `null` subject matched every row whose owner was unset, because `eq: null` meant
  "is null".
- The generated `set` was one action, so "members edit, only admins archive" could not be written.

## Decision

1. The engine is built in `@keelwerk/core` and does not depend on `@casl/ability`. It keeps
   CASL's vocabulary: allow and deny rules per entity and action, conditions, field lists, a
   reason, serialisable rules.
2. Rules are typed against the registry: conditions name real fields and relations, field lists
   name real fields, action lists name the actions that exist for the entity, including the set
   operations `create`, `update`, `archive` and `restore`, the batch `set` (authorized item by
   item) and the aliases `read` and `write`. A rule may narrow the principal kind
   (`principal: 'user'`), which types the subject as a non-null `SubjectId`. Rule subjects may also
   match action kinds or transports across modules (gap G13). No subject tagging.
3. A rule has a `where` condition on the row acted on (the pre-image, and the rows read) and an
   optional `check` condition on the row produced (the post-image), as PostgreSQL separates
   `USING` from `WITH CHECK`. Reads use `where`. Creates use `check ?? where`. Updates and other
   instance commands require the target to be selected by some allow rule's `where` and by no deny
   rule without `check`, and the post-image to pass the `check` of an allow rule that selected the
   target (a rule without `check` places no constraint) and no deny rule's `check`. Decision
   algebra: allowed when some allow rule matches and no deny rule matches, default deny,
   order-independent; deny rules need a reason.
4. One condition AST (`eq`, `ne`, `lt`, `lte`, `gt`, `gte`, `in`, `nin`, `contains`, `startsWith`,
   `isNull`, `and`, `or`, `not`, `some`, `none`, `every`, `is`) owned by the core and shared with
   the data layer, the live feed and the sync protocol, with two-valued, null-safe semantics. In
   conditions written in code, a comparison with `null` or `undefined` is false and absence is
   tested only with `isNull`; the client filter format's bare `null` shorthand is normalised at the
   boundary. Adapters compile the AST; the engine interprets it in memory. A filter is never
   widened: an operator an adapter cannot compile is evaluated by the kernel over the rows the rest
   of the condition selects (brief addendum 5), and only what the field model does not allow (an
   undeclared operator on a personal field, a restricted kind) fails with `unsupported`.
5. The invoked action is the unit of authorization. Stages inside the invoker: the gate (action
   rules, principal kinds, scope level), the plan (`always`, `never` or `conditional { where,
   check, fields }`), target selection by the plan's `where` for instance commands (outside it,
   `not_found`), the item check on the post-image together with the entity invariant, and output
   shaping. `decide`, `evolve` and handlers receive full rows; field masks apply to values leaving
   the invoker, to `filter` and `sort` inputs, and to the fields a write changes. The shape stage
   also checks every entity row leaving the invoker against the caller's read plan: a row the plan
   does not select is an `internal` error (`core.row_outside_plan`) in development and tests, and in
   production it is dropped from the output and logged.
6. Inside handlers, repository calls run with the module's own authority over its own entities and
   read access to its declared dependencies; writes to another module's entity are limited to the
   fields the module contributed. Reads on behalf of the caller are explicit (`forCaller()`, and
   `ctx.target` in entity-mounted queries). A denied operation throws `forbidden`; nothing narrows
   silently. Reactions, timers and schedules run under the module service principal
   `<module>.system`, governed by rules (a module may invoke its own actions by default), with the
   triggering actor recorded as causation. `asSystem(reason)` is the only escalation to the system
   principal and is logged. Amended by ADR 0026: handlers yield loads (`ctx.load`, with the same
   module authority and `forCaller()`) and return drafts checked against the same write boundary,
   and the escalation is the effect `invoke(action, input, { as: system(reason) })`, logged with the
   reason.
7. Field masks govern only fields declared `.maskable()`; only those may appear in the field lists
   of read rules and of runtime rule sources, so every other field keeps its declared type in
   `Readable<App, 'module.entity'>` and in client types. Hidden fields never appear in rules.
8. Principals are a discriminated union resolved by ordered resolvers and enriched by a set of
   enrichers, once per session; the plan is memoised per invocation only. Jobs and receipts store a
   principal reference that is resolved again when the job runs.
9. Every decision carries matched rule ids and reasons; a decision-log hook, `explain`, and three
   test suites (table-driven with transition cases, type-level, dual-evaluation of `where` and
   `check` against every adapter) are part of the engine. Effective rules are exported in CASL
   raw-rule shape through `core.me`; rules with relation quantifiers arrive with their relations
   resolved to id sets for the principal, or marked server-only.
10. Tenant isolation is outside the rule set: the scope resolved in the pipeline is applied by the
    data layer before any plan, scope levels are checked at the gate, backend-scope units refuse
    tenant entities, and deployment-scope actions exist only at the operator endpoint.
11. Configurability: app-level mode, decision log, disable, add and replace of rules; runtime rule
    sources validated against the registry; replaceable evaluator and compilers; optional
    generated PostgreSQL row-level security as a backstop.

## Consequences

- Cross-module composition is safe: toggling a module adds or removes its fragment without
  changing the meaning of other rules.
- State-machine transitions are expressible: deny rules guard the state an action starts from,
  `check` guards the state it produces.
- Handlers see true data: uniqueness checks, quotas and existence tests never narrow to a wrong
  answer, and listings that must show only what the caller may read say so in one call.
- A handler that returns a row it read with the module's authority, which the caller may not read,
  fails in development and never reaches the caller in production; the check costs one in-memory
  evaluation of the read plan per row that leaves the invoker.
- Rules fail closed on optional owner fields and with principals that have no subject.
- One AST with two interpreters risks semantic divergence (null handling, collation, nested
  `none`); the small operator set, fail-closed compilation and the dual-evaluation suite from the
  first adapter are the mitigation.
- The project owns an evaluator and compilers; the typed parts would have been new work with any
  library, and the runtime parts are a few hundred lines.
- Deny rules reintroduce reasoning complexity; they require a reason and should stay rare.
- Deep relation chains compile to nested `EXISTS` subqueries; performance must be measured on
  the two proof apps before adding deeper derived relations.
- A later UI can reuse CASL's client packages through the exported raw rules, within the limit
  that relation-based rules are resolved for the principal or evaluated only on the server.
