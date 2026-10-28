# 13. One `pennestack` CLI generated from the surface, and a generate-and-check development loop

Date: 2026-10-11 (revised after review the same day, on 2026-10-24 for addendum 3, on 2026-10-25
for ADRs 0025, 0026 and 0027, and in place on 2026-10-28 for decisions 16b, 81a, 59b, 62a and 28a)

## Status

Proposed. Items 1 and 2 follow decisions 16b and 81a (2026-10-26): action commands sit under one
verb, `pennestack call <module.entity.action>`, and no module id is reserved because of the CLI, an
integration, a plugin or a module. Item 7 follows decision 59b (2026-10-28): scaffolds create files
only, and the generated manifest does the wiring (question 61 closed). The `fleet` command group is
decision 62a. The toolchain follows decision 28a: Node 26 and TypeScript 7.
[ADR 0026](0026-pure-handlers-and-the-effect-interpreter.md) (decision 50a) adds lint rules and
scaffold kinds to item 7 and `explain --dry-run`, `--trace` and `--redecide` to the framework
commands.

## Context

The brief says a CLI may be built first and may live in this repository, that a later user interface
must be fully pluggable, that the types of what is in the database must always be live, and that
every piece must be plug and play with the compiler, the linter and the rest of the toolchain. The
first draft of [architecture.md](../architecture.md) named Stricli 1.3.0 for a CLI whose route map
is generated from the registry plus framework commands (section 16), one generated TypeScript file
and `pennestack generate --check` (section 13.1), and the toolchain: TypeScript 7.0.2 with project
references, Node 24 with type stripping, pnpm, Biome 2.5.15, Vitest 5.0.3 with type tests, attest on
TypeScript 6 (section 13.2); decision 28a (2026-10-27) raised the baseline to Node 26, the latest
major, which the baseline follows from then on. It also listed `isolatedDeclarations` among the
options of every package. The review of 2026-10-11 added that inferred module values make
declaration emit grow with every dependency until TypeScript refuses (TS7056), and that the CLI's
wire lived in an optional module, so apps without it could not be administered.

Facts checked on 2026-10-10 and 2026-10-11:

- TypeScript 7.0.2 rejects `export const accounts = defineModule(...)` and `export const app =
  defineApp(...)` under `isolatedDeclarations` with TS9010 and TS9013, because their types come from
  inference (checked with the builder form of the time; the literal form is inferred the same way).
- Vitest 5.0.3's type checker runs on TypeScript 7.0.2; TypeScript 7.0.2 reports instantiation
  counts with `--extendedDiagnostics` and writes traces with `--generateTrace`.
- Node 24.21.0 type-strips a workspace package reached through a `node_modules` link, but refuses
  `.ts` files whose real path is under `node_modules`
  (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`); pnpm's `publishConfig.exports` replaces `exports`
  at pack time. The M0 spike repeats the check on the Node 26 baseline.
- Biome 2.5.15 extends shared configurations from installed packages, scopes settings with
  `overrides`, and loads GritQL plugins that report through `register_diagnostic`; the rules
  `noExplicitAny`, `noConsole`, `noImportCycles`, `noProcessEnv`, `noEnum`, `noNamespace`,
  `noParameterProperties`, `useImportExtensions`, `noRestrictedImports` exist, and
  `noFloatingPromises` and `noMisusedPromises` are still in the nursery group.
- Stricli 1.3.0 builds route maps and commands from plain objects, injects a typed context into
  commands, offers `proposeCompletions`, and lets the application decide exit codes.

## Decision

1. **One binary, built from the surface.** `@pennestack/cli` provides `pennestack` on Stricli 1.3.0.
   Its action commands are generated from the API surface (from the local registry in a project,
   otherwise from `/_pennestack/v1/surface`, cached by hash), all under one verb with the dotted
   action reference as its argument (decisions 16b and 81a): `pennestack call
   <module.entity.action>`, `pennestack call <module.action>`, `pennestack call app.<action>`,
   `pennestack call core....`; `pennestack watch <ref>` is `call --follow` for subscriptions. Flags
   come from field nodes (parsers per kind, enumerations, TypeID prefix checks, dotted flags for
   nested shapes, `@file`, secrets from a prompt), with `--input` for whole inputs; validation stays
   in the pipeline. There are no hand-written project commands. Subscription commands print NDJSON,
   resume by token and stop at the stream's `head` frame unless `--follow` is given. It connects in
   three ways: project (the deployment file `pennestack.config.ts`, or the file named by `--config`;
   in-process or the dev socket), the operator socket, and remote profiles over the invocation
   protocol, which the HTTP host serves for every app (ADR 0010); the CLI manifest artefact is
   produced by the CLI itself.
2. **No reserved module ids.** Because action commands sit under `call`, framework commands and
   module ids never share a level, and no name is reserved because of an integration, a plugin or a
   module (decision 16b). This item first reserved the 34 framework command names as module ids,
   frozen per major version; that list is gone. The framework's commands (`backend`, `build`,
   `call`, `completion`, `consumers`, `db`, `dev`, `doctor`, `domain`, `explain`, `fleet`, `flags`,
   `generate`, `help`, `init`, `introspect`, `jobs`, `keys`, `login`, `logout`, `migrate`, `module`,
   `new`, `operator`, `profile`, `rollout`, `start`, `surface`, `tenant`, `version`, `watch`, `x`)
   may grow in a minor version, since none can shadow an action, and the only reserved module ids
   are `core` and `app`, which action references use.
3. **Outputs and exit codes.** Human output on a terminal, JSON otherwise (`--output` for text,
   table, JSON, YAML, NDJSON); subscriptions as NDJSON with automatic resume; exit codes 3 to 11 per
   error kind, 1 for internal errors, 2 for usage errors and 130 for interrupts. Profiles and
   credentials are separate XDG files, credentials with mode 0600; `pennestack login` uses actions
   that carry a `cli.login` hint, so the CLI never knows which module authenticates.
4. **Framework commands**: `init`, `dev`, `build`, `start`, `generate`, `migrate` (an alias of `db
   apply`), `db` (`plan`, `generate`, `apply`, `status`, `check`, `introspect`, `retire`, `rebuild`,
   `verify`, `restore`, `reindex` (ADR 0027), with the semantics of architecture.md section 14),
   `consumers`, `jobs` (with `stats`, `lanes`, `explain`, `pause` and `resume` from ADR 0025),
   `fleet` (nodes, processes and scaling, ADR 0025), `keys`, `operator token`, `introspect` (whose
   `diff` is an alias of `surface diff`), `surface diff|version new|usage|retire` (ADR 0021),
   `rollout status|finalize|abort` (ADR 0022), `flags list|get|set|history|explain|stale` (ADR
   0023), `new <kind> <reference>` for module, entity, action, flag, rule, reaction, service, error,
   schedule, stream, topic, contribution, condition, version-change, lib, shape, app and script (ADR
   0024), `module new|rename|retire` (`module new` an alias of `new module`), `backend`, `tenant`
   and `domain` aliases of `call core....`, `call`, `watch`, `explain`, `doctor`, `login`, `logout`,
   `profile`, `completion`.
5. **Development loop.** `pennestack dev` supervises `tsc -b --watch` (TypeScript 7.0.2), a
   fresh-process probe per change that writes only changed artefacts, the data layer's development
   database synchronisation, and an app process restarted on change with the dev operator socket and
   the explain stream. Workspace packages run from source through the export condition
   `@pennestack/source` (Node `--conditions`, TypeScript `customConditions`); published manifests
   drop the condition through `publishConfig.exports`; production runs emitted JavaScript.
6. **Committed artefacts.** The module manifests (`module.generated.ts`, decision 59b), the
   generated TypeScript file of each app (with type fragments from transports), the
   surface, the OpenAPI document, the SDL and the CLI manifest are deterministic, committed, and
   checked by `generate --check`; migrations come only from explicit `db generate` runs. Documents
   derived from the surface exist per API version. CI also runs the conformance suite, the type
   budget with `--extendedDiagnostics` on TypeScript 7.0.2, and `surface diff` against the base
   branch.
7. **Toolchain rules.** `isolatedDeclarations` is enabled only in packages with explicitly typed
   exports; every package sets `rootDir`. Every exported module and app value has a named type
   (`ModuleType`, `ModuleBaseType`, `AppType`; ADR 0003), which the generator writes and a GritQL
   rule enforces in hand-written files; CI builds the portal example and the synthetic apps here,
   and each platform's repository builds its app, under the pnpm layout and fails on TS7056,
   TS2742, TS4023 and declaration sizes above the spike's budget. `@pennestack/biome-config`
   publishes a Biome 2.5.15 preset (the rules above as errors, package-kind import boundaries
   through `overrides`) and GritQL plugins for what syntax can catch: declaration merging on
   framework modules, exported module and app values without a named type, literal `null` in rule
   conditions, `asSystem` without a reason (since ADR 0026 `system()` without one), impure deciders
   (since ADR 0026 `pure-parts`, `no-module-state` and `no-await-in-parts`, with Biome's
   `noNodejsModules`, `noProcessEnv`, `noProcessGlobal` and `noGlobalAssign`), malformed error
   codes, and for the layout of ADR 0024 a second exported value, import side effects and functions
   in assembly files. Checks that need the registry run at `defineApp` and boot; checks that need
   paths run in the layout pass of `pennestack doctor`. Type tests use Vitest's type checker, and
   `@pennestack/testing/types` ships assertion helpers. `pennestack new <kind> <reference>` creates
   one part's file where its reference puts it and never edits a source; the generated manifest
   mounts it, and for what only a hand-written file holds (a declaration in `base.ts`, an app-level
   part, a module in `modules.ts`) it prints the lines to add (decision 59b). `pennestack new
   module` writes a package with `src/base.ts`, `src/module.generated.ts` (the entry, written by the
   generator), `src/module.test-d.ts` with the toggle-case type tests, and `test/`. `pennestack
   init` creates the canonical layout and `knip.json`. `pennestack doctor` checks the environment,
   the TypeScript and package configuration, artefact freshness, the layout and the deployment.

## Consequences

- The CLI always matches the selected backend's app exactly, and needs no release when a module adds
  an action; startup costs one conditional request to revalidate the cached surface.
- No module id is lost to the CLI: only `core` and `app` stay reserved. The price is one more word
  for every daily action command (`pennestack call accounts.profile.deactivate ...` instead of
  `pennestack accounts profile deactivate ...`), which completion offsets, and the dotted reference
  is the one name every other part of the framework already uses.
- Every interface change shows up in review as a diff of committed artefacts, and CI fails on drift
  and on any breaking change to a supported API version.
- Editing any workspace package is live in `pennestack dev` without a build, while published
  packages remain plain JavaScript with declarations.
- Dropping `isolatedDeclarations` from module and app packages refines the first draft; declaration
  emit for those packages needs the full checker, which TypeScript 7's parallel builds absorb, and
  named module types keep its output proportional to each package.
- The project owns a Biome preset and a handful of GritQL plugins that must be maintained with Biome
  upgrades, especially for the nursery rules.
