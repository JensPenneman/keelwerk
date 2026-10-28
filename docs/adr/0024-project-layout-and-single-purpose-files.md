# 24. Project layout: one definition per file, one rule per file, a package per module, a generated manifest over a module base

Date: 2026-10-24 (revised in place on 2026-10-28 for decisions 58a, 59b, 60b and 16b)

## Status

Proposed. Jens decided the points this ADR left open on 2026-10-28: kebab-case names derived from
the export (decision 58a, item 3), a generated manifest instead of explicit assembly (decision 59b,
item 4), one rule per file instead of one policy file per target (decision 60b, items 2 and 3), and,
through 59b, scaffolds that create files only (question 61 closed, item 7). The reserved command
name `new` of the first version is gone with decision 16b.

## Context

Brief addendum 3, item 4, asks that every file has a single purpose, in a structure designed for
this framework rather than copied from file-based frameworks, and enforced by its tooling.

Constraints: a module is object literals, never a builder chain (Jens's decision 3b of
2026-10-24; [architecture.md](../architecture.md) section 4.1); definitions are values with
inferred types (principle 1), and `tsc` must see what the editor sees, with no language-service
plugin (principle 10); module packages compile before any app exists (section 3.4). A part in its
own file cannot import the module it belongs to, because the module imports the part.

Facts checked on 2026-10-24 ([research/project-layout.md](../research/project-layout.md)):

- Biome 2.5.15, the pinned version, has `useFilenamingConvention` (with a case `export`),
  `noBarrelFile`, `noReExportAll`, `noNamespaceImport`, `noExportedImports`, `useExportsLast` and
  `noExcessiveLinesPerFile`, and scopes GritQL plugins with `includes`; GritQL cannot read the file
  path. Biome 2.6.0 (2026-10-21) adds JavaScript plugins that can, as a developer preview.
- React Router needs a type generator because its route list names files by path; TanStack Router
  and AdonisJS generate committed manifests of imports; Medusa, Nitro and Encore.ts discover parts.
- knip 6.43.0 reports unused files and exports.

The first version of this ADR chose explicit assembly: a hand-written `module.ts` importing every
part and mounting it, with no generator in the type path and the API name set in code, at the cost
of two hand-written lines per part. Jens chose the generated manifest instead, as TanStack Router
and AdonisJS do: nothing needs registering by hand.

## Decision

1. **One definition per file.** A file exports one value, named after the file, plus the types its
   signature names; private helpers serve only that export; exports come last; importing has no
   effect. Barrels, `export *`, namespace imports, exported imports and default exports are
   forbidden. Exceptions: assembly and role files, the explicit entry files of library packages,
   `keelwerk.config.ts`, generated files, migrations, tests and scripts.
2. **Layouts.** A project has `keelwerk.config.ts`, `apps/<id>/` (`modules.ts`, `app.ts`),
   `modules/<id>/`, `scripts/` and `docs/`. Every module is a package with one layout wherever it
   lives: `src/base.ts`, the generated `src/module.generated.ts`, a directory per part kind,
   `policies/<target>/<rule>.ts` for rules (one rule per file, decision 60b),
   `contributions/to-<target>/`, `conditional/when-<module>/`, `migrations/` and `test/`. Every app
   built on keelwerk has a repository of its own and depends only on the published packages
   (decision 48c).
3. **Names.** Files and directories are kebab-case, derived from the export by `kebab()` (section
   16.4.1; decision 58a). Assembly and role files take their export's name from their directory;
   schedules and fills are named after their target and add the kind to the export; a rule is named
   after itself in the directory of its target, so its file name is the last segment of its id
   (`policies/credential/self.ts` of `auth` is `auth.credential.self`), and a rule over several
   actions or a selector sits in `policies/` under its own name; error codes are the export in snake
   case; contribution and condition directories carry the migration track names.
4. **Assembly by a generated manifest** (decision 59b). `base.ts` holds the module base,
   `defineModuleBase({ ... })`, written by hand: identity, dependencies, configuration, extension
   points, entities, streams, flags and the data of contributions and conditional parts. Parts are
   written with the part functions over the base (`defineCommand(base, entity, { ... })`,
   `defineQuery(base, { ... })`, `defineRule(base, target, { ... })`, `defineReaction(base, ...)`,
   `defineService(base, ...)`, and `within(base, declaration)` inside contributions and conditional
   parts), one literal per file. `keelwerk generate`, and the dev server on every file change,
   writes `module.generated.ts`: one literal, `defineModule(base, { ... })`, that mounts every part
   under keys that are ids, derived from the directory conventions (decision 3b still holds: it is a
   literal, only written by a tool). An action's reference comes from its file name and its
   directory (the entity or the module mount), a rule's id likewise; moving a file changes the
   reference, and `keelwerk surface diff` reports it as breaking. The generator reads names and
   paths and imports nothing; it writes import aliases for clashing names. `generate --check` fails
   CI on drift. Parts invoke their own module's actions by value and call their own `lib/`
   functions, not their own services. Transport and listener modules declared with sugar that holds
   their role file (`defineListenerModule`, gap G1) keep a hand-written `src/module.ts`.
5. **Contributions and conditional parts** are directories: `contribution.ts` or `condition.ts`
   declares the target or condition and its data for the base, and the behaviour sits beside it,
   mounted by the generated manifest under the declaration's key; fragments that share a (target,
   `when`) identity merge.
6. **Enforcement.** The Biome preset gains those rules and three GritQL plugins (`one-export`,
   `no-import-effects`, `wiring-only-assembly`); CI runs knip and `keelwerk generate --check`;
   `keelwerk doctor` gains a layout pass, also run in CI and by `keelwerk dev`, which reports a
   stale manifest, a file the conventions cannot place, and a declaration `base.ts` does not list.
7. **Scaffolding.** `keelwerk new <kind> <reference>` writes one part where its reference puts it
   and never edits a source: the generated manifest mounts it. For what only a hand-written file
   holds (a declaration in `base.ts`, an app-level part in `app.ts`, a module in an app's
   `modules.ts`) it prints the import and the entry to add. `new` is a framework command and
   reserves no module id (decision 16b, ADR 0013).

## Consequences

- A module reads from its tree; every rule, action reference and migration track maps to one file
  or directory, and the manifest shows the whole module as one literal.
- A part costs one file and no registration; a forgotten mount cannot happen, and a stale manifest
  fails CI.
- A generator sits in the type path: the manifest is committed TypeScript, rewritten by the dev
  server within the cycle of the change and checked for drift, so the editor, `tsc` and CI see the
  same types; a new part is outside the types only until the generator has run. Parts depend on the
  base, and the module literal yields the same module type as the module written in one file.
- Moving or renaming a part file changes its reference, which for an action is an API change that
  `surface diff` reports as breaking; renaming a rule file renames the rule, which a
  `policies.disable` entry then no longer finds, a compose error.
- One rule per file makes rule files many and small; the rules over one target are the files of one
  directory, merged as a set, so their order and split change nothing, and `keelwerk explain`
  names the file of every matched rule.
- The file-to-export check runs in the layout pass, not the editor, until Biome's JavaScript plugins
  are stable in a pinned release.
- Sections 4.1, 4.4, 7.6, 8.1, 13.1, 13.6 to 13.12, 16.9.8 and 23 change: the generated literal
  mounts parts, rules are keyed by target and file, reactions, schedules and version changes are
  keyed by file name, own actions are invoked by value, and scaffolds create files only.
- The preset carries three more plugins to maintain across Biome upgrades, and the core carries the
  generator and its conventions.
