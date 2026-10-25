# 21. Dated API versions served by translation, with compatibility enforced in CI

Date: 2026-10-24

## Status

Proposed. Dated versions instead of integer majors, and the 12-month support window, are decision
points 52 and 53 for Jens (architecture.md section 26.1).

## Context

Addendum 3 of the brief (2026-10-23) requires that everything is versioned, that a version is never
implicit, and that backwards compatibility holds until a major version is deployed, through a
best-in-class mechanism. The specification had a hash per app surface (ADR 0010), track versions
and shape ids for stored events (ADRs 0006 and 0007), integer protocol majors, and
`pennestack introspect diff`, which classifies surface changes but lets a breaking change pass with
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
   `pennestack surface version new` records each version in a committed ledger.
3. **Translation in the invoker.** The pipeline gains `resolveVersion` in `Invoker.open` after
   `resolvePrincipal`, and `translate` after `validate` (input forward, oldest change first) and
   after `shape` (output, errors and items backward, newest first). `locate` maps older references
   and `validate` uses the requested version's schema; handlers, rules and masks see head shapes
   only. Projections and documents exist per supported version.
4. **Selection.** The session's version is the request's (`Pennestack-Version` or its carrier's
   equivalent), else the credential's, else the tenant's pin, else the backend's default. Pins are
   fields of `core.backend` and `core.tenant`, changed by reversible events and by no deploy except
   the floor rise. Typed clients send the head they were compiled with.
5. **Deprecation and retirement.** Deprecated versions and actions send `Deprecation` (RFC 9745),
   `Sunset` (RFC 8594) and a `deprecation` link, and usage is counted per tenant and version. A
   version stays supported at least 12 months after a newer one exists. The floor rises only after
   the version's sunset, with a major in the app's changelog and `pennestack surface retire`, which
   refuses unless 30 days of usage are zero or `--force` carries a logged reason; then the version
   is `not_found`, `core.api_version_retired` (REST 410).
6. **Enforcement.** `pennestack surface diff` replaces `introspect diff` in CI: it derives every
   version's surface on both sides and fails on a breaking difference, and each changed module
   package's own surface and declaration files must fit its semantic version bump.
7. **Protocols** keep integer majors, negotiated through `core.capabilities`; a new major runs
   beside the old until 30 days without use.
8. **No implicit version.** Whatever crosses a process boundary or outlives its writer names its
   version and is refused without one; new error codes fit existing kinds.

## Consequences

- One implementation serves every supported version; old shapes exist only as transforms at the
  edge.
- Every breaking change costs a version change with fixtures, and requests at old versions pay for
  translation; the chain of changes grows until the floor rises.
- Tenants and integrations upgrade independently, visible in usage counters.
- CI no longer lets a breaking change through with a changelog line, and module versions follow
  semantic versioning.
- Each supported version costs memory per mount.
- Two pipeline stages are a kernel change, recorded here as ADR 0001 requires; ADRs 0010 and 0013
  change accordingly.
