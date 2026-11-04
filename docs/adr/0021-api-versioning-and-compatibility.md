# 21. Dated API versions served by translation, with compatibility enforced in CI

Date: 2026-10-24 (revised in place on 2026-10-28 for decisions 52a, 53 and 23c)

## Status

Accepted (2026-11-04). Jens decided on 2026-10-28 for dated versions with version-change transforms (decision
52a) and for the support window of item 5 (decision 53): 12 months of deprecation, then retirement
regardless of use, without the zero-use condition first proposed.

## Context

Addendum 3 of the brief (2026-10-23) requires that everything is versioned, that a version is never
implicit, and that backwards compatibility holds until a major version is deployed, through a
best-in-class mechanism. The specification had a hash per app surface (ADR 0010), track versions
and shape ids for stored events (ADRs 0006 and 0007), integer protocol majors, and
`keelwerk introspect diff`, which classifies surface changes but lets a breaking change pass with
a changelog line. Module `version` was informational.

Wire names are pure functions of references (ADR 0010), so a version in the URL fits REST alone.
One build serves many backends and tenants, whose integrations move at different speeds. Modules
are compiled before any app exists (ADR 0004), so a module cannot know an app's versions.

The research note ([research/versioning-rollouts-flags.md](../research/versioning-rollouts-flags.md),
sections 1 to 3 and 7) compared URL and media-type majors, Stripe's dated versions with an account
pin and version change modules, GitHub's calendar versions with 24 months of support, GraphQL's
continuous evolution and JMAP's capability negotiation (RFC 8620).

## Decision

1. **Dated API versions per app.** `defineApiVersions` lists an app's versions (`YYYY-MM-DD`,
   strictly increasing) for `defineApp({ api })`. Handlers implement only the head, the code as
   written. Additive and neutral changes reach every supported version; clients ignore output
   members they do not know.
2. **Version changes.** A breaking change is a `defineVersionChange` value (one per file, listed
   under the `changes` key of the module literal, keyed by the change id the ledger records) with
   mechanical instructions (`renamedFrom`, `addedRequired`, `removed`),
   custom transforms, error-code mappings and fixtures. A module ships it in a major of its
   package; until an API version adopts it, it is translated for every version.
   `keelwerk surface version new` records each version in a committed ledger.
3. **Translation in the invoker.** The pipeline gains `resolveVersion` in `Invoker.open` after
   `resolvePrincipal`, and `translate` after `validate` (input forward, oldest change first) and
   after `shape` (output, errors and items backward, newest first). `locate` maps older references
   and `validate` uses the requested version's schema; handlers, rules and masks see head shapes
   only. Projections and documents exist per supported version.
4. **Selection.** The session's version is the request's (`Keelwerk-Version` or its carrier's
   equivalent), else the credential's, else the tenant's pin, else the backend's default. Pins are
   fields of `core.backend` and `core.tenant`, changed by reversible events and by no deploy except
   the floor rise. Typed clients send the head they were compiled with.
5. **Deprecation and retirement.** Deprecated versions and actions send `Deprecation` (RFC 9745),
   `Sunset` (RFC 8594) and a `deprecation` link, and usage is counted per tenant and version. A
   version is deprecated the day a newer one exists, and its sunset is 12 months later (decision
   53). After the sunset it is retired regardless of use: there is no zero-use gate and no
   `--force`. The floor rises only after the version's sunset, with a major in the app's changelog
   (the CI check is unchanged) and `keelwerk surface retire`, which records the retirement and
   refuses only before the sunset; usage counters stay as information, so that remaining callers
   can be told before the sunset. Then the version is `not_found`, `core.api_version_retired` (REST
   410).
6. **Enforcement.** `keelwerk surface diff` replaces `introspect diff` in CI: it derives every
   version's surface on both sides and fails on a breaking difference, and each changed module
   package's own surface and declaration files must fit its semantic version bump.
7. **Protocols** keep integer majors, negotiated through `core.capabilities`; a new major runs
   beside the old until 30 days without use. Launchway's agent has no protocol of its own since
   decision 23c: it is a typed client of the live carrier pinned to an API version, so its majors
   start at the new protocol and Launchway v0.3.0's protocol v1 is not served.
8. **No implicit version.** Whatever crosses a process boundary or outlives its writer names its
   version and is refused without one; new error codes fit existing kinds.

## Consequences

- One implementation serves every supported version; old shapes exist only as transforms at the
  edge.
- Every breaking change costs a version change with fixtures, and requests at old versions pay for
  translation; the chain of changes grows until the floor rises.
- Tenants and integrations upgrade independently, visible in usage counters, within a predictable
  window: a client that does not move within 12 months of a deprecation stops working at the
  sunset, which the calendar decides, not the counters.
- CI no longer lets a breaking change through with a changelog line, and module versions follow
  semantic versioning.
- Each supported version costs memory per mount.
- Two pipeline stages are a kernel change, recorded here as ADR 0001 requires; ADRs 0010 and 0013
  change accordingly.
