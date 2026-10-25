# 24. Project layout: one definition per file, a package per module, explicit assembly over a module base

Date: 2026-10-24

## Status

Proposed. The file naming convention (item 3), explicit assembly (item 4), one policy file per
target (item 3) and scaffold edits (item 7) are decision points 58 to 61 for Jens (architecture.md
section 26.1); an alternative would change that item before acceptance.

## Context

Brief addendum 3, item 4, asks that every file has a single purpose, in a structure designed for
this framework rather than copied from file-based frameworks, and enforced by its tooling.

Constraints: a module is object literals, never a builder chain (Jens's decision 3b of
2026-10-24; [architecture.md](../architecture.md) section 4.1); definitions are values with
inferred types and no generator in the type path (principles 1 and 10); module packages compile
before any app exists (section 3.4). A part in its own file cannot import the module it belongs
to, because the module imports the part.

Facts checked on 2026-10-24 ([research/project-layout.md](../research/project-layout.md)):

- Biome 2.5.15, the pinned version, has `useFilenamingConvention` (with a case `export`),
  `noBarrelFile`, `noReExportAll`, `noNamespaceImport`, `noExportedImports`, `useExportsLast` and
  `noExcessiveLinesPerFile`, and scopes GritQL plugins with `includes`; GritQL cannot read the file
  path. Biome 2.6.0 (2026-10-21) adds JavaScript plugins that can, as a developer preview.
- React Router needs a type generator because its route list names files by path; TanStack Router
  and AdonisJS generate committed manifests of imports; Medusa, Nitro and Encore.ts discover parts.
- knip 6.43.0 reports unused files and exports.

## Decision

1. **One definition per file.** A file exports one value, named after the file, plus the types its
   signature names; private helpers serve only that export; exports come last; importing has no
   effect. Barrels, `export *`, namespace imports, exported imports and default exports are
   forbidden. Exceptions: assembly and role files, the explicit entry files of library packages,
   `pennestack.config.ts`, generated files, migrations, tests and scripts.
2. **Layouts.** A project has `pennestack.config.ts`, `apps/<id>/` (`modules.ts`, `app.ts`),
   `modules/<id>/`, `scripts/` and `docs/`. Every module is a package with one layout wherever it
   lives: `src/base.ts`, `src/module.ts`, a directory per part kind, `contributions/to-<target>/`,
   `conditional/when-<module>/`, `migrations/` and `test/`.
3. **Names.** Files and directories are kebab-case, derived from the export by `kebab()` (section
   16.4.1). Assembly and role files take their export's name from their directory; policies,
   schedules and fills are named after their target and add the kind to the export; error codes
   are the export in snake case; contribution and condition directories carry the migration track
   names.
4. **Assembly.** Explicit, never discovered. `base.ts` holds the module base,
   `defineModuleBase({ ... })`: identity, dependencies, configuration, extension points, entities,
   streams, flags and the data of contributions and conditional parts. Parts are written with the
   part functions over the base (`defineCommand(base, entity, { ... })`, `defineQuery(base, { ...
   })`, `definePolicy(base, target, [...])`, `defineReaction(base, ...)`, `defineService(base,
   ...)`, and `within(base, declaration)` inside contributions and conditional parts), one literal
   per file; `module.ts` is one literal, `defineModule(base, { ... })`, that mounts every part under
   keys that are ids. Parts invoke their own module's actions by value and call their own `lib/`
   functions, not their own services.
5. **Contributions and conditional parts** are directories: `contribution.ts` or `condition.ts`
   declares the target or condition and its data for the base, and the behaviour sits beside it,
   mounted in `module.ts` under the declaration's key; fragments that share a (target, `when`)
   identity merge.
6. **Enforcement.** The Biome preset gains those rules and three GritQL plugins (`one-export`,
   `no-import-effects`, `wiring-only-assembly`); CI runs knip; `pennestack doctor` gains a layout
   pass, also run in CI and by `pennestack dev`.
7. **Scaffolding.** `pennestack new <kind> <reference>` writes one part and inserts its import and
   mount into one assembly file, refusing files it does not recognise; `new` becomes a reserved
   command name.

## Consequences

- A module reads from its tree and its `module.ts`; every rule set, action reference and migration
  track maps to one file or directory.
- A part costs a file and two lines, which the scaffold writes; knip and the layout pass report a
  forgotten mount.
- Types stay exact without a generator: parts depend on the base, and the module literal yields
  the same module type as the module written in one file.
- Moving a file never changes an API reference; renaming an export does, visibly in review and the
  surface diff.
- The file-to-export check runs in the layout pass, not the editor, until Biome's JavaScript plugins
  are stable in a pinned release.
- Sections 4.1, 7.6 and 16.9.8 change: the module literal mounts parts, reactions, schedules and
  version changes are keyed, own actions are invoked by value, scaffolds edit assembly files.
- The preset carries three more plugins to maintain across Biome upgrades.
