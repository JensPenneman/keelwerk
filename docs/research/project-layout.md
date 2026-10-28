> Note (2026-10-28): the project was renamed from pennestack to **keelwerk** on 2026-10-28; this
> research note keeps the old name as written at the time.

# Research: project layout and the single-purpose rule

Date: 2026-10-24. Author: the layout designer, one of three designers of brief addendum 3. Question:
item 4 of the addendum, single-purpose files and a directory structure enforced by tooling.
Method: 6 web searches and 5 page fetches (the caps of 8 and 6 were not reached), versions checked
with `npm view` on 2026-10-24, and the configuration schemas of Biome 2.5.15 and 2.6.3 read from
their npm packages. Statements marked "not re-checked" come from the projects' documentation as
known before this round.

## 1. File-based and convention-based frameworks

| Framework (version) | Where parts live | How they are registered | Types | Lesson |
|---|---|---|---|---|
| Next.js 16.4.3, app router | folders are URL segments; reserved files `page`, `layout`, `route`; `_folder` is private; `(group)` organises without a segment | the file system: a route is public only once `page` or `route` exists, so other files colocate safely | generated route types (not re-checked) | a path that mirrors an identity helps; private folders and groups exist because the file system is the router |
| Nuxt 4.6.2, Nitro 2.13.5 | `server/api/*.ts` handlers, helpers in `server/utils/` | discovery and auto-imports | declarations generated into `.nuxt/` (not re-checked) | auto-imports hide dependencies and need a generator for types |
| SvelteKit 3.1.0 | `+page.server.ts`, `+server.ts` | the file system | generated `./$types` (not re-checked for 3.x) | as above |
| React Router 8.5.0, framework mode | `app/routes.ts` lists routes by file path; `flatRoutes()` adds the file convention | explicit configuration | `react-router typegen` executes the configuration and writes `.react-router/types/**/+types/*.d.ts`; CI runs it before `tsc` | an explicit list still needs a generator when it names files by path instead of importing values |
| TanStack Router, router-plugin 1.168.48 | `src/routes/` | generated `routeTree.gen.ts`, committed; the generator also rewrites the path literal in each `createFileRoute` | exact, through generated imports | generated assembly works, at the price of watcher friction (issues 3624 and 4627) and a tool that edits sources |
| Medusa 2.22.1 | `src/modules/<name>/` (definition in its `index.ts`), `api/`, `workflows/`, `subscribers/`, `jobs/`, `links/`, `scripts/`, `admin/`; kebab-case files | directory scanning; a subscriber default-exports its handler and a `config` | at runtime | kind directories for backend parts, kebab-case names |
| Payload 3.92.0 | collection configuration objects | imported explicitly into `payload.config.ts` | generated `payload-types.ts` (not re-checked) | explicit lists of definition values |
| NestJS 12.2.0 | feature modules: `users.module.ts`, `users.service.ts`, `dto/` | decorators and a container | runtime metadata | schematics insert declarations into module files (not re-checked) |
| AdonisJS 7.6.0 | `app/controllers/users_controller.ts`; routes in `start/routes.ts` | explicit routes with lazy imports through Node subpath imports (`#controllers/*`) | the current documentation adds generated barrels in `.adonisjs/server` (controllers, policies, events, listeners) of lazy `import()` entries, written by the dev server, committed, optional | v6 chose snake_case "without relying on what is exported"; a generated manifest of explicit imports |
| Encore.ts, encore.dev 1.58.8 | a directory with `encore.service.ts` is a service; `export const x = api(...)` anywhere inside it | static analysis by Encore's own parser | from source | discovery needs an own compiler front end |
| Rails (Zeitwerk), Phoenix | one constant per file, snake_case file for a CamelCase constant, enforced by the loader; Phoenix contexts as domain boundaries | autoloading | none | a reversible name mapping enforced by the toolchain (not re-checked) |
| Angular style guide, documentation v22 | "Separate words within a file name with hyphens"; a component `UserProfile` lives in `user-profile.ts`; "Prefer focusing source files on a single concept"; tests beside the code | none | none | kebab-case derived from the identifier; one concept per file |
| Feature-Sliced Design, Steiger 0.8.0 | layers, slices and segments; a slice's public API is its `index.ts` | none | none | barrels as boundaries, which this design forbids inside packages (not re-checked) |

Angular also says "Avoid creating subdirectories based on the type of code", and screaming
architecture (Robert C. Martin, 2011) and hexagonal architecture (Alistair Cockburn, 2005) ask the
top level to name the domain. pennestack's top level is the module, named by its domain; kind
directories appear only inside a module, where each kind is one mount point of the builder chain.
Angular's warning targets application-wide `components/` and `services/` directories, which this
layout never has. An entity-first inner layout (`credential/entity.ts`, `credential/policy.ts`,
`credential/revoke.ts`) was considered and rejected: it repeats role names in every directory and
mixes kinds in one directory.

## 2. Assembly: explicit imports or a generated manifest

| Option | Prior art | Types | Costs |
|---|---|---|---|
| explicit imports in an assembly file | tRPC routers, Payload's configuration, Hono's `app.route` | exact, because values are imported | two lines per part; a forgotten mount, which knip reports as an unused file |
| a generated manifest of explicit imports | TanStack Router, AdonisJS barrels | exact | a watcher or generate step in the type path; stale until regenerated; a file's path becomes its identity |
| runtime discovery | Medusa, Nitro, Vite's `import.meta.glob` | lost: a glob yields a record with one type for every file | contradicts principle 1 (definitions are values, no reflection) |
| static analysis | Encore.ts | exact through the parser | an own compiler front end |

A part must be typed before its module exists. tRPC solves the same problem with
`initTRPC.create()` in its own file: procedure files import the resulting `t`, and a root router
assembles them (not re-checked). Hono's sub-apps share a declared `Env` type. The module base is
that idea with an inferred context. A type-only import of the module type from its parts would
compile, and Biome would not flag it (`noImportCycles` ignores `import type` by default, per the
2.5.15 schema), but every part's type would then depend on every other part, and adding one part
would re-check all of them.

The generated manifest would let a file move rename an action. In pennestack an action reference
is a public contract that the surface diff and API versions guard (section 13.8 and the versioning
section), so the name belongs in code, where review sees it. React Router's case shows that a
generator becomes necessary only when the assembly names files instead of importing values;
importing values keeps the compiler as the only judge (principle 10).

Recommendation: explicit assembly in `module.ts` over a base in `base.ts`, with scaffolds that
insert the import and the mount.

## 3. Naming

- Biome's `useFilenamingConvention` (style, since 1.5.0; `match` since 2.0.0) accepts
  `camelCase`, `kebab-case`, `PascalCase`, `snake_case` and `export`. By default a name must be
  "either in camelCase, kebab-case, snake_case, or equal to the name of one export in the file";
  `strictCase` and `requireAscii` default to true; a file name is a name followed by extensions,
  each checked (`my-filename.test.js`).
- Identifier-cased names (`changePassword.ts`) therefore get their link to the export checked in
  the editor by Biome 2.5.15, with `filenameCases: ["export"]`. Kebab-case names need a check that knows
  both the path and the export, which GritQL cannot express.
- For kebab-case: Angular and Medusa use it, as NestJS's generators do (not re-checked);
  pennestack's module ids are kebab-case, and its CLI routes and REST paths already come from the
  `kebab()` function of section 16.4.1; git on the default case-insensitive file systems of macOS
  and Windows does not see a case-only rename, and two names that differ only in case cannot
  coexist there.
- AdonisJS 6 chose snake_case independent of exports; Rails derives file names from constants;
  Payload's examples use PascalCase files (not re-checked).

Recommendation: kebab-case, derived from the export by `kebab()`, with the link checked by the
layout pass until a Biome JavaScript plugin can check it in the editor.

## 4. Enforcement tools

| Tool (version) | What it can check | Fit |
|---|---|---|
| Biome 2.5.15, pinned; 2.6.3 current | in style: `useFilenamingConvention`, `useNamingConvention` (`strictCase`), `useExportsLast`, `noExportedImports`, `noDefaultExport`, `noRestrictedImports` (`paths`, gitignore-style `patterns`), `noExcessiveLinesPerFile` (`maxLines`, `skipBlankLines`); in performance: `noBarrelFile`, `noReExportAll`, `noNamespaceImport`; in suspicious: `noImportCycles` (`ignoreTypes`); in correctness: `noPrivateImports`, `noUnresolvedImports` | the only linter (section 13.2) |
| Biome GritQL plugins | syntax patterns per file with `register_diagnostic`; each plugin scoped with `includes` in 2.5.15; no file path, no semantic model, no cross-file analysis | rules about one file |
| Biome JavaScript plugins, 2.6.0 (2026-10-21) | rules in JavaScript or TypeScript, a developer preview whose context includes `ctx.filePath` | the later home of the name checks |
| knip 6.43.0 | unused files, exports, types and dependencies; duplicate exports | forgotten mounts and leftovers |
| dependency-cruiser 18.7.0 | path-based dependency rules, cycles, orphans | capable, but a second rule language beside Biome |
| eslint-plugin-boundaries 7.3.0, Sheriff 0.20.0, `@nx/eslint-plugin` 24.0.1 | boundaries between tagged or path-matched elements | ESLint-based, and pennestack has no ESLint; Sheriff uses barrels as module APIs |
| Steiger 0.8.0 | Feature-Sliced Design layouts | specific to that method |

The rule names, groups and options above were read from the 2.5.15 configuration schema, so the
preset needs no Biome upgrade.

## 5. Scaffolding

- Nx 24.0.1 generators edit sources through the virtual file tree of `@nx/devkit` 24.0.1, with dry
  runs (not re-checked).
- Plop 4.0.5 renders templates with `add`, `modify` and `append` actions.
- Hygen 6.2.11 injects template output into files; its last release dates from 2022-09-07.
- Angular and NestJS schematics insert declarations into module files, and TanStack's generator
  rewrites route literals: precedents for tools that edit sources narrowly.

Recommendation: the CLI owns its scaffolds, without a template engine dependency, and edits only
assembly files, refusing anything it does not recognise.

## 6. Summary of recommendations

1. One exported definition per file, named after it; private helpers allowed; no barrels,
   `export *`, namespace imports, exported imports, default exports or effects at import time,
   with listed exceptions.
2. A package per module, the same shape inside a project and when published; kind directories
   inside a module; contribution and condition directories named like the migration tracks.
3. Kebab-case names derived by `kebab()` (decision point).
4. Explicit assembly: `base.ts` for declarations, `module.ts` for behaviour, parts typed through
   `parts(base)` (decision point).
5. Enforcement through Biome 2.5.15 rules, three GritQL plugins scoped with `includes`, knip and the
   layout pass of `pennestack doctor`.
6. Scaffolds with `pennestack new <kind> <reference>`.

## Sources

- Next.js, project structure: https://nextjs.org/docs/app/getting-started/project-structure
- React Router, routing: https://reactrouter.com/start/framework/routing; type safety:
  https://reactrouter.com/explanation/type-safety; route module type safety:
  https://reactrouter.com/how-to/route-module-type-safety
- TanStack Router, FAQ: https://tanstack.com/router/latest/docs/faq; file-based routing API:
  https://tanstack.com/router/latest/docs/api/file-based-routing; issues:
  https://github.com/TanStack/router/issues/3624, https://github.com/TanStack/router/issues/4627
- Medusa: https://docs.medusajs.com/learn/installation, https://docs.medusajs.com/learn/fundamentals/modules,
  https://github.com/medusajs/medusa/blob/develop/AGENTS.md
- Encore.ts, services: https://encore.dev/docs/ts/primitives/services
- AdonisJS: https://adonisjs.com/blog/what-to-expect-of-adonisjs-6,
  https://v6-docs.adonisjs.com/guides/getting-started/folder-structure,
  https://docs.adonisjs.com/guides/concepts/barrel-files
- Angular style guide: https://angular.dev/style-guide
- Biome: https://biomejs.dev/linter/plugins/, https://biomejs.dev/linter/rules/use-filenaming-convention/,
  https://biomejs.dev/blog/biome-v2-6/; configuration schemas of `@biomejs/biome` 2.5.15 and 2.6.3
  (npm packages)
- npm registry (`npm view`, 2026-10-24): versions of every package named above
