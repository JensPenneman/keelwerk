# Versioning, rollouts and feature flags

Date: 2026-10-23. Status: research input for the sections "Versioning and compatibility",
"Rollouts" and "Feature flags and experiments" of the architecture and for ADRs 0021 to 0023; it
decides nothing by itself. Scope: brief addendum 3, items 1 to 3. Method: the existing
specification, eight web searches and three page fetches on 2026-10-23 (the search cap was
reached), npm versions checked with `npm view`, other tools checked on PyPI and GitHub releases the
same day. Statements marked "(not re-checked)" come from prior knowledge and were not verified
within the cap.

## 1. API versioning schemes

| Scheme | Example | How old clients are served | Fit for pennestack |
|---|---|---|---|
| Major version in the URL | `/v1/...`, `/v2/...` | a second route tree, often a second implementation | poor: REST paths are functions of references (16.4.1); GraphQL, tRPC and the CLI have no path; no per-tenant pin |
| Major version in a media type or header | `Accept: application/vnd.x.v2+json` | content negotiation per resource | partial: nothing for GraphQL schemas or CLI routes |
| Dated versions, account pin, version-change transforms (Stripe) | `Stripe-Version: 2024-09-30.acacia` | the current implementation, with transforms applied backwards per version | good: one head implementation, old shapes produced at the edge |
| Calendar versions in a header (GitHub REST) | `X-GitHub-Api-Version: 2022-11-28` | old version supported for at least 24 months; additive changes in all versions | good; the default is the oldest version, not a pin |
| Continuous evolution (GraphQL) | `@deprecated(reason: ...)`, removal by usage | one schema; fields removed once unused | good for GraphQL alone |
| Protocol majors with capability negotiation (JMAP, RFC 8620) | session `capabilities`, request `using` | server advertises, client declares | good for wire protocols |

Facts checked on 2026-10-23:

- Stripe: since `2024-09-30.acacia`, monthly versions without breaking changes and two named major
  releases a year (Acacia, Basil, Clover, Dahlia, Endive); requests use the account's default
  version unless `Stripe-Version` overrides it; additive changes (new resources, optional
  parameters, response properties) do not break code. Brandur Leach's 2017 article describes
  "version change modules" that transform the current representation backwards (not re-checked).
- GitHub REST: the version name is its release date; a request without the header gets
  2022-11-28; the previous version stays supported at least 24 months after a new one; 2026-03-10
  is the first version with breaking changes; additive changes reach every supported version; an
  unsupported version is answered with 410 Gone.
- Cadwyn 8.1.0 (PyPI, 2026-10-22) implements Stripe-style versioning for FastAPI with version-change
  classes that migrate requests forward and responses backward (existence and version checked;
  semantics not re-checked).

Recommendation: dated API versions per app with one head implementation; version changes declared
as typed transforms beside the actions they change and applied by the invoker; a default pin per
backend and per tenant with a per-request header; additive changes visible in every supported
version, as both Stripe and GitHub do. Integer majors stay for wire protocols, negotiated in the
JMAP manner.

## 2. Breaking-change detection

| Tool | Input | Classes | Notes |
|---|---|---|---|
| Buf (`@bufbuild/buf` 1.75.0, 2026-10-22) | protobuf | rule categories FILE, PACKAGE, WIRE_JSON, WIRE (not re-checked) | separates source, JSON and binary compatibility |
| oasdiff (v1.34.1, 2026-10-21) | OpenAPI | errors, warnings, information; deprecation and sunset checks (not re-checked) | Go binary |
| graphql-inspector (`@graphql-inspector/core` 8.0.1) | SDL | breaking, dangerous, non-breaking (not re-checked) | the classes section 13.8 already uses |
| Optic (`@useoptic/optic` 1.0.9, 2025-08-10) | OpenAPI | breaking-change rules and lint | no release in 2026 |
| `pennestack introspect diff` (section 13.8) | the API surface | breaking, dangerous, additive, neutral | covers every transport at once |

Recommendation: one differ over the surface, run for every supported API version (an older
version's surface may only grow), with graphql-inspector and oasdiff used only as test oracles for
the GraphQL and REST projections. Differs per transport would disagree; the surface is the single
source every transport derives from (ADR 0010).

## 3. Compatibility rules

- Protobuf (not re-checked): field numbers are never reused, removed numbers and names are
  reserved, new fields are safe, and a rename is safe on the binary wire but breaks the JSON
  mapping, which is why Buf has WIRE and WIRE_JSON categories. `.tag(n)` in the field model
  (decision point 18) keeps this open for Connect.
- JSON: readers ignore unknown members (tolerant reader); within a version only additions; an
  output enum value or union member added is dangerous for exhaustive clients, as section 13.8 says.

Recommendation: state these rules per transport and per protocol, and make "readers ignore
unknown members and message types" a rule of every pennestack protocol from its first major.

## 4. Event versioning

| Approach | Source | pennestack today |
|---|---|---|
| New event type for a breaking change | Greg Young, *Versioning in an Event Sourced System*; Dudycz | allowed |
| Weak schema: tolerant mapping by name | Greg Young (not re-checked) | the generic evolve passes unknown fields through (15.1.9) |
| Upcasting on read | Dudycz; Marten 5.9; Emmett's `schemaVersion` | per track by shape id (15.1.9) |
| Downcasting for older consumers | Dudycz, "Parse, Don't Guess" | missing; needed while an older build still runs |
| Stream copy-and-transform | Greg Young; Dudycz's stream transformation | not needed: stored events are never rewritten |
| Publishing both schemas | Dudycz | not needed internally |

Recommendation: keep upcasting by shape id; add the writer rule of a rolling upgrade: while an
older build runs, the newer build writes only shapes the older build reads (renames under the old
name, type changes through a declared downcaster), and switches after finalization.

## 5. Zero-downtime schema change

| Tool | Mechanism | Phases | Limits |
|---|---|---|---|
| Expand and contract ("parallel change", Danilo Sato on martinfowler.com) | add, migrate, remove | expand, migrate, contract | discipline only |
| pgroll v0.16.3 (2026-09-08) | a schema of views per version over the physical tables; clients choose with `search_path`; triggers propagate writes between old and new columns; batched backfill (10,000 rows) | `start`; `complete` "once no clients use the old version"; `rollback` before completion | PostgreSQL 14 or later; trigger write overhead |
| Reshape (repository active, last push 2026-09-26) | views and triggers, the same idea (not re-checked) | start, complete, abort | PostgreSQL only |
| gh-ost v1.1.11 (2026-08-17) | triggerless copy into a ghost table from the binary log, then a cut-over (not re-checked) | copy, cut-over | MySQL; rebuilds a table, no multi-version reads |

Recommendation: keep the neutral steps split into expand and contract (section 14.6.4) and gate
contract steps on a process registry, which turns pgroll's "once no clients use the old version"
from a promise into a check. Versioned schemas of views do not fit MySQL and SQLite, would need
row-level security on every view and multiply per-tenant namespaces; they stay a possible
PostgreSQL adapter option.

## 6. Rolling upgrades

| Practice | Rule | Checked |
|---|---|---|
| Rolling update (Kubernetes deployments) | replace instances gradually behind readiness checks | not re-checked |
| Blue-green, canary (martinfowler.com bliki) | two environments and one switch; a small share first | not re-checked |
| Version skew (Kubernetes) | components may differ by a bounded number of minor versions | not re-checked |
| CockroachDB finalization | binaries are replaced node by node (reversible); finalization runs migrations that cannot be rolled back and enables new features; auto-finalization (the default) starts when every live node runs the new version, verified against the node list; afterwards rollback means restoring a backup | yes |
| Linear's sync engine | a reverse-engineered description, endorsed by Linear's CTO, shows a client schema hash that triggers a local migration and full bootstraps when models are outdated | yes; a server-enforced minimum client version could not be confirmed |

Recommendation: CockroachDB's two-phase model. Builds of two adjacent levels coexist; a process
registry in the control store records each process's build; finalization happens when the registry
shows no older process; contract steps and new write formats wait for it; rollback is supported
only before it. Blue-green and canary remain operator choices at the edge; progressive exposure
of behaviour uses flags. Clients learn about retirement through a frame that asks them to reload,
the general form of a forced refresh.

## 7. Deprecation signalling

- RFC 9745 (March 2025, Standards Track): `Deprecation: @1688169599`, an RFC 9651 Date, in the
  past (deprecated since) or the future (deprecated from); a `Link` with `rel="deprecation"`
  points to human documentation; `Sunset` (RFC 8594, an HTTP-date) must not be earlier than the
  deprecation date. Example: `Deprecation: @1688169599` with `Sunset: Sun, 30 Jun 2024 23:59:59 UTC`.
- GitHub sends deprecation information before a version's end of support and 410 afterwards.
- GraphQL: `@deprecated` on fields, arguments, input fields and enum values; schema registries
  check removals against recorded operations (not re-checked).

Recommendation: both headers on every response at a deprecated API version or of a deprecated
action, usage counters per version and tenant, and 410 for a retired version.

## 8. Feature flags

| | OpenFeature | flagd | Unleash | GrowthBook | PostHog (not re-checked) |
|---|---|---|---|---|---|
| Value kinds | boolean, string, number, object | named variants with JSON values | boolean, variants | typed feature values | boolean, multivariate, payloads |
| Context | targeting key and attributes | OpenFeature context | context fields | attributes | distinct id, properties, groups |
| Targeting | provider's | JSONLogic, `fractional`, semantic-version and string operations | strategies, constraints | force, rollout and experiment rules | release conditions |
| Bucketing | provider's | murmur3 of `[flagKey, targetingKey]`, relative weights, sticky; hashing changed in v0.18.0 | murmur3 of `groupId:stickiness` modulo 100 (not re-checked) | fnv32a, hash version 2 recommended, seed, bucket ranges | SHA-1 of flag key and distinct id |
| Exposure | hooks; tracking API | provider events | impression data | tracking callback | `$feature_flag_called` |
| Staleness | none | none | types with expected lifetimes: release and experiment 40 days, operational 7, kill switch and permission permanent; then "potentially stale" | none found | none found |

OpenFeature's resolution details carry value, variant, reason (`STATIC`, `DEFAULT`,
`TARGETING_MATCH`, `SPLIT`, `CACHED`, `DISABLED`, `UNKNOWN`, `STALE`, `ERROR`), error code
(`TARGETING_KEY_MISSING` among them) and metadata (checked). Pete Hodgson's four categories
(release, experiment, ops, permission toggles; not re-checked) match Unleash's types.

Packages checked on 2026-10-23: `@openfeature/server-sdk` 1.23.0 (2026-07-28), `@openfeature/core`
1.12.0 (2026-07-28), `@openfeature/flagd-provider` 0.18.0 (2026-10-22), `@openfeature/flagd-core`
5.0.0 (2026-10-15), `@openfeature/multi-provider` 0.1.3 (2025-10-24), `@openfeature/ofrep-provider`
0.2.5 (2026-06-01), `@growthbook/growthbook` 1.8.0 (2026-09-29), `unleash-client` 6.12.2
(2026-09-28), `posthog-node` 5.57.1 (2026-10-23); flagd core/v0.19.0 on GitHub (2026-10-15).

Flags as code or in a database: definitions in code give types, review and ownership; targeting
in a database gives change without a deploy. Every tool above keeps targeting as data.

Recommendation: definitions in code (typed, owned by a module, with a purpose and an expiry),
targeting rules as chain-backed rows in the control store (history for free), evaluation in the
kernel with OpenFeature's vocabulary of reasons and error codes, and an adapter that lets an
OpenFeature provider supply values. Bucketing by SHA-256 from `node:crypto`: no dependency, and
interoperable hashing is not needed because evaluation stays on the server. Stale reports from
purpose, expiry, rule shape and evaluation timestamps.

## 9. Experiments

GrowthBook (checked): assignment hashes an attribute with a seed into a number between 0 and 1
mapped to bucket ranges; a sample ratio mismatch check (chi-squared) warns below p = 0.001;
Bayesian and frequentist engines; the frequentist engine runs two-sample t-tests and offers CUPED
and sequential testing against repeated looks.

Recommendation for a first version: exposures as records, binomial and mean metrics, fixed-horizon
frequentist tests (two-proportion z-test, Welch's t-test) with 95 % intervals, results labelled
inconclusive before the planned sample size, and the sample ratio check at p < 0.001. Bayesian
analysis, CUPED and sequential tests come later, each with its own validation.

## Sources

- docs.stripe.com/api/versioning, docs.stripe.com/api-versions, docs.stripe.com/upgrades;
  stripe.com/blog/api-versioning (2017)
- docs.github.com/en/rest/about-the-rest-api/api-versions;
  github.blog/changelog/2026-03-12-rest-api-version-2026-03-10-is-now-available/
- pypi.org/project/cadwyn; rfc-editor.org/rfc/rfc9745; rfc-editor.org/rfc/rfc8594;
  rfc-editor.org/rfc/rfc8620
- buf.build/docs/breaking/rules; github.com/oasdiff/oasdiff; the-guild.dev/graphql/inspector;
  github.com/opticdev/optic; protobuf.dev/programming-guides/proto3/
- leanpub.com/esversioning; event-driven.io/en/how_to_do_event_versioning/;
  event-driven.io/en/simple_events_versioning_patterns/;
  event-driven.io/en/event_versioning_with_marten/; architecture-weekly.com/p/parse-dont-guess;
  github.com/event-driven-io/emmett/pull/418
- martinfowler.com/bliki/ParallelChange.html, /BlueGreenDeployment.html, /CanaryRelease.html;
  martinfowler.com/articles/feature-toggles.html
- github.com/xataio/pgroll; github.com/fabianlindfors/reshape; github.com/github/gh-ost
- cockroachlabs.com/docs/stable/upgrade-cockroach-version;
  github.com/cockroachdb/cockroach/blob/master/docs/RFCS/20180411_finalize_cluster_upgrade_automatically.md
- github.com/wzhudev/reverse-linear-sync-engine; linear.app/now/scaling-the-linear-sync-engine
- openfeature.dev/specification/types/, openfeature.dev/specification/sections/providers/;
  flagd.dev/reference/custom-operations/fractional-operation/; docs.getunleash.io/concepts/feature-flags;
  docs.growthbook.io/lib/build-your-own, docs.growthbook.io/statistics/overview,
  docs.growthbook.io/app/experiment-results; posthog.com/docs/feature-flags
