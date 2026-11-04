# @keelwerk/biome-config

The Biome preset of keelwerk projects (architecture section 13.9). Extend it from `biome.json`:

```json
{ "extends": ["@keelwerk/biome-config/biome"] }
```

It enables the layout, determinism and import-boundary rules that Biome ships natively, with
Biome's formatter defaults except single quotes, two spaces and 100 columns.

## GritQL plugins

Eleven plugins ship in `plugins/`, one `.grit` file each, and the preset lists them with `includes`
scopes, because GritQL cannot read the file path. Each message says what to do instead.

- `no-selection-augmentation`: `declare module '@keelwerk/...'` and `declare global` in module and app packages.
- `named-module-types`: an exported `defineModuleBase`, `defineModule` or `defineApp` value without a named type, in `base.ts`, `app.ts` and tests.
- `no-null-in-conditions`: a literal `null` as a comparison value in a rule's `where` or `check`.
- `as-system-reason`: `system()` without a reason or with an empty string.
- `pure-parts`: clocks, randomness, timers, `fetch`, `crypto` and a bare `yield` of a request in module and app sources outside `src/executors/`.
- `no-module-state`: top-level `let` and `var`, and calls or assignments that mutate a top-level binding, in module and app sources.
- `no-await-in-parts`: `async`, `await` and `for await` in module and app sources outside `src/executors/`.
- `error-code-format`: a `defineError` code that is not `<module>.<snake_case>`.
- `one-export`: a second exported value (`const`, `let`, `function`, `class`) in a source file; types are free, assembly files, generated files, library entries and tests are exempt.
- `no-import-effects`: top-level expression statements, `await` and bare imports in source files, outside tests, scripts and tool configuration.
- `wiring-only-assembly`: a function or arrow function in `base.ts`, `app.ts` or `modules.ts`.

Biome 2.5.15 resolves a plugin path from the directory of the configuration that extends the preset,
so the preset names them through `node_modules/@keelwerk/biome-config/plugins/`: the project lists
`@keelwerk/biome-config` as a dependency of the package that holds its `biome.json`.

The preset also configures Biome's own rules for the package-kind boundaries: `noNodejsModules`
and `noRestrictedImports` in module packages (allowed under `src/executors/`), `noProcessEnv`,
`noProcessGlobal` and `noGlobalAssign` everywhere except `keelwerk.config.ts`.

## Fixtures and tests

`plugins/fixtures/<rule>/` is a small project per plugin, with a `biome.json` that extends the
preset, files laid out under the paths the `includes` scopes expect, and files that must pass next
to files that must be flagged. A trailing `// expect: <rule>[, <rule>]` comment states the
diagnostic of its line (`plugin/<name>` for a plugin, Biome's category otherwise). `pnpm vitest run
--project biome-config` runs the pinned Biome binary with `--reporter=json` on every fixture and
compares the diagnostics of every file with those comments; a file without comments must have none.
The fixtures `process-globals` and `node-imports` cover the preset overrides. Fixtures are inputs,
not code: the root `biome.json`, `knip.json` and the TypeScript projects leave them out.

A project changes where a plugin applies by listing it again in its own `plugins` with the complete
`includes` it wants: in Biome 2.5.15 a repeated entry replaces the preset's `includes` for that
plugin (it is not added to them), and it does so for the whole project, also when the entry sits in
an `overrides` block, so an override cannot scope a plugin to some paths. The other plugins of the
preset are untouched. The repository's root `biome.json` does this to add `spikes/**` to
`named-module-types` and to leave the script entry of the write-path spike out of
`no-import-effects`; the fixture `plugin-redeclare` pins this behaviour.
