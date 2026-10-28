# 23. Feature flags in the kernel, experiments as a module

Date: 2026-10-24

## Status

Proposed. Jens decided on 2026-10-28 that flags live in the framework core with experiments as a
module (decision 51a) and that the first statistics are fixed-horizon frequentist tests (decision
57a), as this ADR assumed.

## Context

Addendum 3 of the brief (2026-10-23) requires feature flags and A/B testing and leaves open whether
they belong to the framework or only to the APIs built with it, leaning towards the framework.
Behaviour is decided in handlers, policy rules, the `admit` stage, rules over transports (gap G13),
reactions, jobs and the kernel's own rollouts (ADR 0022). Decision point 1 keeps module selection
compiled and leaves runtime variation to configuration, which holds durable settings without an
owner, a target group or an expiry.

Three placements were considered:

- `@keelwerk/core`, with typed `ctx.flags` in every module;
- a module providing a `flags` contract that others list in `requires` or `optional`, so
  `ctx.flags` may be absent and the kernel's own stages cannot rely on it;
- only the apps, each wiring a flag SDK into handlers, which leaves rules, `admit`, transports and
  the kernel without flags and repeats exposure tracking per app.

The research note ([research/versioning-rollouts-flags.md](../research/versioning-rollouts-flags.md),
sections 8 and 9) found that every tool keeps targeting as data while definitions in code give
types and ownership; OpenFeature's vocabulary of variants, reasons and error codes; Unleash's flag
types with expected lifetimes; and GrowthBook's hash-based assignment with a sample ratio mismatch
check at p < 0.001.

## Decision

1. **Flags are a kernel concept.** `defineFlag` declares a flag in code (kind, default, level,
   purpose, expiry for release and experiment flags, client visibility), one per file, listed under
   the `flags` key of its module base (keys `<module>.<name>`) or by `defineApp({ flags })`.
   `ctx.flags` is typed from the module base; the default keeps established behaviour.
2. **Evaluation** runs through the deployment-level ordered extension point `flagProviders`:
   `core.targeting` (always present), optionally `openFeatureFlags(provider)` for an OpenFeature
   server provider (`@openfeature/server-sdk` 1.23.0), and `env` for development and tests; the
   first resolution wins, else the default. Resolutions carry OpenFeature's reasons and error
   codes. `ctx.flags` is synchronous, with one snapshot per invocation; an error serves the default
   and never fails the invocation.
3. **Targeting is data.** `core.flag` (chain-backed, in the control store) holds per backend, plus
   a deployment-wide one for backends without their own, ordered rules over listed tenants,
   principals and conditions of the condition AST, each serving a variant or a split. Splits hash
   `SHA-256(salt ‖ ':' ‖ targetingKey)`, so raising a percentage never removes a key; every change
   is an event with an actor and a required reason.
4. **Gates.** An action's `gate` names a boolean flag of its module, and the action runs only while
   it is true: otherwise `forbidden`, `core.feature_disabled`, through a generated deny rule at
   `authorize`, or for kill switches `unavailable`, `core.feature_suspended`, at `admit`. Policies
   may read flags, and the token check includes their values. Gated actions stay in the surface.
   Operators suspend any action with a `core.suspension` row.
5. **Provenance.** Every appended event records its writer's build and the flags its invocation
   read; spans and counters carry flag, variant and reason. Stale reports cover expiry, one value
   for everyone for 14 days, 30 days without evaluation and targeting that no build defines.
6. **Experiments are a module**, `@keelwerk/module-experiments`: experiments and metrics at
   backend level, exposures and tallies in each tenant's namespace, exposures recorded through the
   `flagObservers` extension point, tallies updated by an `observes: 'all'` reaction, and results
   from two-proportion z-tests and Welch's t-tests with 95 % intervals, inconclusive before the
   planned sample size and invalid on a sample ratio mismatch (p < 0.001).

## Consequences

- Every module, rule and kernel stage can read flags with exact types, and the chain shows which
  flag state produced each change.
- The kernel grows by an evaluator, three extension points and two control entities that every app
  carries; without targeting, evaluation returns defaults.
- Flags never change the surface, which depends only on the app and the API version.
- Results are fixed-horizon tests that refuse conclusions before the planned size; Bayesian
  analysis, CUPED and sequential tests come later.
- The experiments reaction sees every event, whose cost is an open point of gap G12.
- OpenFeature providers plug in on the server; clients read only `client: true` flags, through
  `core.flag.evaluate`.
