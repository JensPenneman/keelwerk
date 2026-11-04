# keelwerk

keelwerk (named on 2026-10-28) is a backend framework written fully in TypeScript. An application is a
set of modules that own entities and the actions on them; transports (REST, GraphQL, tRPC, a CLI,
later others), authorization, live updates and data storage are all derived from those definitions,
and one deployment hosts several backends with many tenants each.

The framework is the product. Two platforms prove it and will run in one deployment:

1. a self-hosted deployment platform: the backend of the existing Launchway product, rebuilt on
   keelwerk;
2. a mail server for the domain `jenspenneman.com`, designed in full and parked until there is a
   stable, permanent deployment option for it.

Trail, a self-hosted location history, is the first app rebuilt on keelwerk, Launchway the
second; each lives in its own repository and depends only on the published packages.

## Status

Architecture phase, as of 2026-10-28. The architecture is complete: every question of the decision
register is decided, and only the mail server's questions are parked with it. Nothing is runnable
yet: the repository holds the requirements, the specification, the decision records, the research
and the plan. The design waits for Jens's approval and for the final name (keelwerk is a working
name); until then the ADRs are `Proposed`, and implementation starts with milestone M0 of the
roadmap.

The code and the design documents may be public on GitHub (JensPenneman/keelwerk) from the start,
at a moment Jens chooses, with the licence in every commit. Every commit is signed with the author's
personal identity.

## Beta policy

The framework and every app built on it stay in beta until Jens, and only Jens, declares them
stable. Every package is published as a 0.x pre-release, and every app pins exact versions, so an
upgrade is a deliberate change in the app's repository. Nothing is sequential: the apps are rebuilt
while the framework grows, Trail first and Launchway second. Applications built on keelwerk live
in their own repositories and depend only on the published packages, never on this repository,
which keeps a minimal example app for its own CI.

## Documents

- [Brief](docs/brief.md): the requirements, the source of truth. It is appended, never rewritten.
- [Architecture](docs/architecture.md): the specification. Sections 1 to 13 cover the kernel, the
  configuration model, actions (with the pure handlers and the effect interpreter of section 7.9),
  authorization, execution and the toolchain; sections 14 to 16 the
  data layer, events and sync, live updates, transports and the CLI; section 17 the accounts and
  authentication modules and both platforms; sections 18 to 20 versioning, rollouts and feature
  flags; section 21 nodes, capacity and autoscaling; section 23 the project layout; section 26 the
  decisions, the parked mail questions and the technical questions still open.
- [Decision register](docs/decisions.md): every question, numbered, with the answer Jens gave, its
  date and where it applies.
- [Architecture decision records](docs/adr/): why each significant choice was made, starting with
  [ADR 0001](docs/adr/0001-record-architecture-decisions.md).
- [API sketch](docs/api-sketch.ts): the DSL as an application author would write it, with every
  handler pure.
- [Research](docs/research/): the prior-art surveys behind the decisions:
  [module systems](docs/research/module-systems.md),
  [authorization](docs/research/authorization.md),
  [data layer](docs/research/data-layer.md),
  [events and sync](docs/research/events-and-sync.md),
  [interfaces and developer experience](docs/research/interfaces-and-devx.md),
  [versioning, rollouts and flags](docs/research/versioning-rollouts-flags.md),
  [project layout](docs/research/project-layout.md),
  [jobs, nodes and autoscaling](docs/research/jobs-nodes-autoscaling.md),
  [encrypted queries](docs/research/encrypted-queries.md),
  [pure handlers](docs/research/pure-handlers.md).
- [Roadmap](docs/roadmap.md): milestones from the repository toolchain (M0) to Trail's rebuild (M3)
  and Launchway's (M4), with the mail server's milestones parked, the beta policy and exit
  criteria.

## Licence

Functional Source License, Version 1.1, ALv2 Future License (FSL-1.1-ALv2): see
[LICENSE.md](LICENSE.md). You may use, copy, modify and redistribute keelwerk for any purpose
except offering it as a competing product; each version becomes Apache-2.0 two years after its
release. Licensor: Jens Penneman. Decided on 2026-10-27 (decision 20 in
[docs/decisions.md](docs/decisions.md)); a Belgian IP lawyer reviews the text before publication.

The code and the design documents are public from the moment Jens chooses; the licence applies
from the first commit, and the platforms and later modules carry the same licence. Outside
contributions are not accepted until a contributor licence agreement exists; issues and
discussions are welcome.

## Working on keelwerk

The repository is a pnpm workspace (`packages/*`, `examples/*`, `spikes/*`). You need the current
Node.js LTS (`.nvmrc` is `lts/*`, `engines.node` is `>=26`) and pnpm 11.21.0 (`corepack enable`
picks the version from `package.json`).

```sh
pnpm install   # dependencies and Git hooks
pnpm check     # biome ci, tsc -b, vitest run, knip
```

Single steps: `pnpm lint`, `pnpm format`, `pnpm build` (`tsc -b`), `pnpm test` (Vitest with type
checking) and `pnpm knip`. CI runs the same four checks in this order on every push and pull
request: `biome ci`, `tsc -b`, `vitest run`, `knip`. See [CONTRIBUTING.md](CONTRIBUTING.md) for
signed commits, Conventional Commits and the single-purpose file rule.
