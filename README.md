# pennestack

pennestack (a working name) is a backend framework written fully in TypeScript. An application is a
set of modules that own entities and the actions on them; transports (REST, GraphQL, tRPC, a CLI,
later others), authorization, live updates and data storage are all derived from those definitions,
and one deployment hosts several backends with many tenants each.

The framework is the product. Two platforms prove it and will run in one deployment:

1. a self-hosted deployment platform: the backend of the existing Launchway product, rebuilt on
   pennestack;
2. a mail server for the domain `jenspenneman.com`.

## Status

Architecture phase, as of 2026-10-25. Nothing is runnable yet: the repository holds the requirements,
the specification, the decision records, the research and the plan. The design waits for Jens's
approval; until then the ADRs are `Proposed`, and implementation starts with milestone M0 of the
roadmap.

The repository is private until Jens approves the architecture. It becomes public on GitHub
(JensPenneman/pennestack) after that approval. Every commit is signed with the author's personal
identity.

## Documents

- [Brief](docs/brief.md): the requirements, the source of truth. It is appended, never rewritten.
- [Architecture](docs/architecture.md): the specification. Sections 1 to 13 cover the kernel, the
  configuration model, actions (with the pure handlers and the effect interpreter of section 7.9),
  authorization, execution and the toolchain; sections 14 to 16 the
  data layer, events and sync, live updates, transports and the CLI; section 17 the accounts and
  authentication modules and both platforms; sections 18 to 20 versioning, rollouts and feature
  flags; section 21 nodes, capacity and autoscaling; section 23 the project layout; section 26 the
  decision points for Jens.
- [Decision register](docs/decisions.md): every open question, numbered, with the answers Jens has
  given and where they apply.
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
- [Roadmap](docs/roadmap.md): milestones from the repository toolchain (M0) to the deployment
  platform (M3) and the mail server (M5 and M6), with exit criteria.

## Licence

Functional Source License, Version 1.1, ALv2 Future License (FSL-1.1-ALv2): see
[LICENSE.md](LICENSE.md). You may use, copy, modify and redistribute pennestack for any purpose
except offering it as a competing product; each version becomes Apache-2.0 two years after its
release. Licensor: Jens Penneman. Decided on 2026-10-27 (decision 20 in
[docs/decisions.md](docs/decisions.md)); a Belgian IP lawyer reviews the text before publication.

The repository stays private until the M1 slice runs; the architecture document stays private
until code exists. Outside contributions are not accepted until a contributor licence agreement
exists; issues and discussions are welcome once the repository is public.
