# 13. One `pennestack` CLI generated from the surface, and a generate-and-check development loop

Date: 2026-10-11 (revised after review the same day, and on 2026-10-24 for addendum 3)

## Status

Proposed. The reservation of framework command names as module ids (item 2) is decision point 16
for Jens (architecture.md section 26.1); if action commands move under a verb instead, item 2
changes before the ADR is accepted. Scaffold edits of assembly files (item 7) are decision point
61.

## Context

The brief says a CLI may be built first and may live in this repository, that a later user
interface must be fully pluggable, that the types of what is in the database must always be live,
and that every piece must be plug and play with the compiler, the linter and the rest of the
toolchain. The first draft of [architecture.md](../architecture.md) named Stricli 1.3.0 for a CLI whose route map is
generated from the registry plus framework commands (section 16), one generated TypeScript file and
`pennestack generate --check` (section 13.1), and the toolchain: TypeScript 7.0.2 with project
references, Node 24 with type stripping, pnpm, Biome 2.5.15, Vitest 5.0.3 with type tests, attest on
TypeScript 6 (section 13.2). It also listed `isolatedDeclarations` among the options of every
package. The review of 2026-10-11 added that inferred module values make declaration emit grow
with every dependency until TypeScript refuses (TS7056), and that the CLI's wire lived in an
optional module, so apps without it could not be administered.

Facts checked on 2026-10-10 and 2026-10-11:

- TypeScript 7.0.2 rejects `export const accounts = defineModule(...)` and `export const app =
  defineApp(...)` under `isolatedDeclarations` with TS9010 and TS9013, because their types come from
  inference (checked with the builder form of the time; the literal form is inferred the same way).
- Vitest 5.0.3's type checker runs on TypeScript 7.0.2; TypeScript 7.0.2 reports instantiation
  counts with `--extendedDiagnostics` and writes traces with `--generateTrace`.
- Node 24.21.0 type-strips a workspace package reached through a `node_modules` link, but refuses
  `.ts` files whose real path is under `node_modules`
  (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`); pnpm's `publishConfig.exports` replaces `exports`
  at pack time.
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
   otherwise from `/_pennestack/v1/surface`, cached by hash): `pennestack <module> <entity> <action>`,
   `pennestack <module> <action>`, `pennestack app <action>`, `pennestack core ...`. Flags come from
   field nodes (parsers per kind, enumerations, TypeID prefix checks, dotted flags for nested
   shapes, `@file`, secrets from a prompt), with `--input` for whole inputs; validation stays in the
   pipeline. There are no hand-written project commands. Subscription commands print NDJSON, resume
   by token and stop at the stream's `head` frame unless `--follow` is given. It connects in three
   ways: project (the deployment file `pennestack.config.ts`, or the file named by `--config`;
   in-process or the dev socket), the operator socket, and remote profiles over the invocation
   protocol, which the HTTP host serves for every app (ADR 0010); the CLI manifest artefact is produced
   by the CLI itself.
2. **Reserved names.** Framework commands share the first level with module ids, so their 33
   names (`app`, `backend`, `build`, `call`, `completion`, `consumers`, `core`, `db`, `dev`,
   `doctor`, `domain`, `explain`, `flags`, `generate`, `help`, `init`, `introspect`, `jobs`, `keys`,
   `login`, `logout`, `migrate`, `module`, `new`, `operator`, `profile`, `rollout`, `start`,
   `surface`, `tenant`, `version`, `watch`, `x`) are reserved module ids, frozen per major version;
   `flags`, `rollout`, `surface` (ADRs 0021 to 0023) and `new` (ADR 0024) were added on 2026-10-24,
   before the list is frozen. New framework commands go under an existing group or under `x`.
3. **Outputs and exit codes.** Human output on a terminal, JSON otherwise (`--output` for text,
   table, JSON, YAML, NDJSON); subscriptions as NDJSON with automatic resume; exit codes 3 to 11 per
   error kind, 1 for internal errors, 2 for usage errors and 130 for interrupts. Profiles and
   credentials are separate XDG files, credentials with mode 0600; `pennestack login` uses actions
   that carry a `cli.login` hint, so the CLI never knows which module authenticates.
4. **Framework commands**: `init`, `dev`, `build`, `start`, `generate`, `migrate` (an alias of
   `db apply`), `db` (`plan`, `generate`, `apply`, `status`, `check`, `introspect`, `retire`,
   `rebuild`, `verify`, `restore`, with the semantics of architecture.md section 14), `consumers`,
   `jobs`, `keys`, `operator token`, `introspect` (whose `diff` is an alias of `surface diff`),
   `surface diff|version new|usage|retire` (ADR 0021), `rollout status|finalize|abort` (ADR 0022),
   `flags list|get|set|history|explain|stale` (ADR 0023), `new <kind> <reference>` for module,
   entity, action, flag, policy, reaction, service, error, schedule, stream, topic, contribution,
   condition, version-change, lib, shape, app and script (ADR 0024), `module new|rename|retire`
   (`module new` an alias of `new module`), `backend`, `tenant` and `domain` aliases, `call`,
   `watch`, `explain`, `doctor`, `login`, `logout`, `profile`, `completion`.
5. **Development loop.** `pennestack dev` supervises `tsc -b --watch` (TypeScript 7.0.2), a
   fresh-process probe per change that writes only changed artefacts, the data layer's development
   database synchronisation, and an app process restarted on change with the dev operator socket and
   the explain stream. Workspace packages run from source through the export condition
   `@pennestack/source` (Node `--conditions`, TypeScript `customConditions`); published manifests
   drop the condition through `publishConfig.exports`; production runs emitted JavaScript.
6. **Committed artefacts.** The generated TypeScript file (with type fragments from transports), the
   surface, the OpenAPI document, the SDL and the CLI manifest are deterministic, committed, and
   checked by `generate --check`; migrations come only from explicit `db generate` runs. Documents
   derived from the surface exist per API version. CI also runs the conformance suite, the type
   budget with `--extendedDiagnostics` on TypeScript 7.0.2, and `surface diff` against the base
   branch.
7. **Toolchain rules.** `isolatedDeclarations` is enabled only in packages with explicitly typed
   exports; every package sets `rootDir`. Every exported module and app value has a named type
   (`ModuleType`, `ModuleBaseType`, `AppType`; ADR 0003), which `pennestack new module` scaffolds and a GritQL rule
   enforces; CI builds both proof apps under the pnpm layout and fails on TS7056, TS2742, TS4023 and
   declaration sizes above the spike's budget. `@pennestack/biome-config` publishes a Biome 2.5.15 preset
   (the rules above as errors, package-kind import boundaries through `overrides`) and GritQL
   plugins for what syntax can catch: declaration merging on framework modules, exported module and
   app values without a named type, literal `null` in rule conditions, `asSystem` without a reason,
   impure deciders, malformed error codes, and for the layout of ADR 0024 a second exported value,
   import side effects and functions in assembly files. Checks that need the registry run at
   `defineApp` and boot; checks that need paths run in the layout pass of `pennestack doctor`.
   Type tests use Vitest's type checker, and `@pennestack/testing/types` ships assertion helpers.
   `pennestack new <kind> <reference>` scaffolds one part and inserts one import and one entry into
   one assembly file, refusing files it does not recognise; `pennestack new module` writes a
   package with `src/base.ts`, `src/module.ts` (the entry), `src/module.test-d.ts` with the
   toggle-case type tests, and `test/`. `pennestack init` creates the canonical layout and
   `knip.json`. `pennestack doctor` checks the environment, the TypeScript and package
   configuration, artefact freshness, the layout and the deployment.

## Consequences

- The CLI always matches the selected backend's app exactly, and needs no release when a module adds
  an action; startup costs one conditional request to revalidate the cached surface.
- Reserving command names takes 31 identifiers away from module ids beyond the core's `core` and
  `app`, a small and permanent constraint; the alternative (`pennestack run <module> ...`) would
  avoid it at the cost of a longer command for every daily use.
- Every interface change shows up in review as a diff of committed artefacts, and CI fails on drift
  and on any breaking change to a supported API version.
- Editing any workspace package is live in `pennestack dev` without a build, while published
  packages remain plain JavaScript with declarations.
- Dropping `isolatedDeclarations` from module and app packages refines the first draft; declaration
  emit for those packages needs the full checker, which TypeScript 7's parallel builds absorb, and
  named module types keep its output proportional to each package.
- The project owns a Biome preset and a handful of GritQL plugins that must be maintained with Biome
  upgrades, especially for the nursery rules.
