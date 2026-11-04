# Composition-types spike (M0): the type model of the DSL, proved before any core code exists

Scope: architecture section 4.7 (the fourteen composition cases and the named checks), section 26.2 items 1 to 4 and 8 to 11, decisions 3b, 31a and 32b, and acceptance against `docs/api-sketch.ts`. The package `@keelwerk/spike-composition-types` holds the type model and a minimal runtime of every DSL function the sketch imports, compiled with `isolatedDeclarations` on, four fixture modules (accounts, teams, auth, hooks) written one part per file, a manifest generator (`scripts/generate-fixture-manifests.ts`), 49 type tests, sketch stand-ins with acceptance assertions, and synthetic workspaces in the pnpm layout with a measurement script (`scripts/measure.ts`).

## Verdicts

- All fourteen cases of section 4.7 hold. Every named check is asserted twice: as the exact `AppChecks` type and as a failing `defineApp` call (`src/**/composition.test-d.ts`).
- Decision 3b holds: entities, bases and parts compile with no module value and no app in scope; the generated manifest has the same type as the one-file module (`toEqualTypeOf` on the whole module).
- Decision 31a: keep the property form of `Check`. It names the check and the literal; the rest-parameter form only says "Expected 2 arguments, but got 1."
- Decision 32b: keep the `Maybe` accessor for optional modules. It composes with `yield*` and `ctx.all` and costs the same as `| undefined` (+514 against +609 instantiations over a 219,196 baseline at 30 call sites), but its error message prints the whole loads type; it needs a short named type.
- `docs/api-sketch.ts` compiles against the spike except for two branded-id errors (lines 362 and 475), both listed under the specification findings.
- The pnpm-layout build (`tsc -b`, per-package `node_modules` symlinks, project references) is clean at 3, 12, 25 and 40 modules with no TS7056, TS2742, TS4023 or TS2883.
- Type-check budgets: see the measurements and the proposed CI budgets below.

## Specification findings

1. 8.5 / `api-sketch.ts:362`: `PrincipalRef.credentialId` is a plain string and branded ids reject it. Logout needs a typed session reference (for example `ctx.principal.ref?.sessionAs('auth.session')` or a `sessionId` on `UserPrincipal`), or must load the session first.
2. 4.2 / 8.5 / `api-sketch.ts:475`: declare `asSubject(...): SubjectId`; `field.subject()` is the opaque `SubjectId`.
3. 8.1 and the 4.7 names table: `Readable<R>` cannot be computed from a row type, because maskability is a field flag the row has lost. Implemented as `Readable<App, 'module.entity'>`; module-local views compute the readable row from the fields.
4. 5.2: `defineContract<LiveQueries>('live', 'app')` loses the literal name and level (no partial type-argument inference). Use `defineContract('live', 'app')` without the interface argument (`ctx.live` is computed from the module), or a curried form.
5. 5.5: `extensionPoint<T>({ mode })` cannot carry the mode in its type for the same reason; every point reads as `readonly T[]`. If `'single'` must read as `T`, use `extensionPoint.single<T>()`, `.set<T>()` and `.ordered<T>()`.
6. 7.9.5: the continuation option `then` makes the options object a thenable, and the preset's `noThenProperty` rule rejects it. Rename it (for example `continueWith`). The fixture carries a `biome-ignore` until then.
7. 4.7 module checks: `refsOutsideRequirements` and `contributedFieldsNeedDefault` move to `defineModuleBase` (the data lives in the base). New named checks: `contributionsOutsideDependencies` and `unknownConditionTargets` (base), `unknownContributionTargets` also at `defineContribution` (the 5.3 compile error), `executorsWithoutEffect` (`defineModule`), `unknownConditionFields` (`defineRule`).
8. 8.3 / 13.10: TypeScript does not excess-check object literals returned from callbacks, so `where: () => ({ owner: 'x' })` passed a plain condition type. Rules must infer the returned condition and check its keys by name (`unknownConditionFields`; shallow plus `or`/`and`/`not`, relation sub-conditions not deep).
9. 4.7, a new rule for the core: a defaulted, inferred type parameter of a DSL call nested inside another const-generic call is inferred from the outer constraint. An inline `defineContribution` inside `defineModuleBase` got `when: readonly Dependency[]` and was silently inactive. `defineContribution` and `defineCondition` now take the whole literal as one type parameter, and `defineEntity` uses `NoInfer` on its defaulted parameters. No DSL function that may be nested may infer a defaulted literal parameter.
10. 13.11: TypeScript 7.0.2 reports the portability error as TS2883 (not TS2742 or TS4023); CI must also fail on TS2883. The package entry must export every type that can appear in a part or module type (about 120 names here).
11. 13.11: a type alias in a declared return type is emitted as the alias with its raw arguments, which copied the entity and input shapes into every part (21 KB per module). Writing part return types out as `ActionPart<...>` with computed types brings a module to 12.3 KB.
12. 13.11: "a few kilobytes per module" holds for `module.generated.d.ts` (2.9 KB synthetic, up to 5.6 KB for auth), not for the package (12.3 KB): `base.d.ts` repeats each entity's type. Proposal: a named entity type (the `ModuleType` pattern for entities), and budgets of 6 KB per manifest and 16 KB per package.
13. 13.3: the core module needs a hand-written type (`CoreBase`, `Core`), because the core compiles with `isolatedDeclarations` and the named-type pattern fails there with TS9010.
14. 4.4 / 8.1: a rule's custom action names cannot be checked at `defineRule` (the module literal does not exist yet). Needs a `defineModule` check of mounted rules against their target's actions, and of the policy key against the rule target.
15. 7.6 (silent): the spike types `ctx.write` and dependency rows with the fields from the module's contributions that are active in the part (`when` lists honoured). The specification should say so.
16. 23.3 (silent): type-only files. Here each exports a main type plus the types its definition names. The preset warns on `{}` 67 times in this code (`noBannedTypes`); the type model needs the empty object type, so the preset could relax this rule for core type modules.

## Measurements

Synthetic module: two entities of four fields, two entity actions, one module action, a contribution (field and entity action), a conditional part (field and action), requiring its two predecessors. Instantiation counts exclude the empty workspace with only the core (whole program 50,039, app 12,125). Check times are noisy because other work ran on the machine; instantiation counts are deterministic.

| Modules | Fold: app over module d.ts | Listing (13.11) | Whole program, parts in files | One file per module |
| --- | --- | --- | --- | --- |
| 3 | 24,332 (0.02 s) | 20,279 | 252,727 (0.15 s) | 198,369 |
| 12 | 133,727 (0.09 s) | 72,543 | 654,194 (0.34 s) | 635,394 |
| 25 | 391,842 (0.25 s) | 195,783 | 1,334,636 (0.74 s) | 1,315,213 |
| 40 | 836,667 (0.41 s) | 408,543 | 2,267,554 (1.23 s) | 2,249,090 |

- The fold is about twice the listing; the growth exponent from 25 to 40 modules is about 1.6.
- Typing parts against their bases costs about 36,000 instantiations per module (whole program minus fold), linear in the module count. Parts in files cost 0.8 % more than one file per module at 40 modules.
- Proposed CI budgets (about 15 % headroom): fold 450,000 at 25 modules and 960,000 at 40; whole program 1,550,000 at 25 and 2,600,000 at 40. The per-statement limit of 5,000,000 is far away.
- Declaration emit in the pnpm layout: 12,317 B per synthetic module in 11 files (`module.generated.d.ts` 2,880 B, `base.d.ts` 4,078 B, entities 865 and 1,323 B, parts 355 to 539 B), the same at depth 3 and depth 40. Before writing return types out it was 21,335 B, and 16,139 B for m01.
- Fixture d.ts: accounts 9,717 B (manifest 3,249 B, base 2,228 B), auth 21,350 B (manifest 5,556 B, base 6,145 B, 21 files), hooks 7,215 B, teams 1,094 B.
- `isolatedDeclarations` on a synthetic module package (m03): 41 errors (TS9010, TS9013, TS9016, TS9017). The core spike package compiles with it on.
- `--generateTrace` of the 40-module whole program, checker time summed over four checker threads: part files 1.49 s, bases 0.45 s, manifests 0.41 s, app 0.71 s, core 0.16 s.
- Fixture d.ts emit shows only TS2878 (the `outDir` override), no portability errors.

## Not built or not checked

- Not built: `defineSchedule`, `defineTopic`, `defineProcess`, `defineFlag` and flag requests per module, typed `ctx.ask` by reference, `OfflineEvents` for offline commands, `prepare` restricted to execution `'sync'`, `outcomeOf(effect, extra)`, subscriptions on entity instances, runtime repetition of the composition checks.
- Not checked: a mounted rule's custom action names against the actions mounted on its target, and the policy key against the rule target (rules are typed against the base before the module literal exists). Typed as strings.

## Verification

- `pnpm tsc -b`: exit 0.
- `pnpm vitest run --project spike-composition-types`: 5 files, 49 tests passed, no type errors. A deliberately wrong assertion was caught and reverted.
- `pnpm biome ci` on the spike and the edited root configuration: 0 errors, 67 warnings (`noBannedTypes` on `{}`), 6 infos.
- `pnpm knip`: exit 0.
- `tsc -p tsconfig.sketch.json` (acceptance): 2 errors, both branded ids (`api-sketch.ts:362`, `:475`).

## Rerun

- `pnpm --filter @keelwerk/spike-composition-types manifests` regenerates the fixture manifests.
- `pnpm --filter @keelwerk/spike-composition-types sketch` type-checks `docs/api-sketch.ts` against the spike.
- `pnpm --filter @keelwerk/spike-composition-types measure <out-dir>` builds the synthetic workspaces and measures them.
