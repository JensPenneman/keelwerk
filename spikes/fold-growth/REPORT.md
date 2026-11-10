# The 3-module fold: where the 19 percent went

## Question

`defineApp` over 3 modules grew from 12,467 to 14,875 type instantiations (+19.3 %) between
`dcc5057` and `6e88cc4`; the 25-module case grew from 51,678 to 54,284 (+5.04 %, its baseline was
never moved). Which commit and which type, and can it be cut?

## Method

`measure-fold-growth.sh` unpacks `packages/core` of each commit with `git archive` into a scratch
directory outside the repository (never `git worktree add`), runs the worktree's current
`compose-app.bench.ts` against it with the worktree's TypeScript 6.0.3 and `@ark/attest`, and reads
the two `Result` lines. Only `packages/core` comes from the commit; the module literals of the
benchmark have not changed since `dcc5057`, and the baselines in the file are ignored. Instantiation
counts are deterministic. The last row, `c8ad21a`, is `main` at the start of this work.

## Bisect table (variant `as-is`)

| commit  | date       | subject                                                      | 3 modules | 25 modules | step 3 | step 25 |
| ------- | ---------- | ------------------------------------------------------------ | --------- | ---------- | ------ | ------- |
| dcc5057 | 2026-11-04 | feat(type-budgets): gate the type budgets in ci              | 12467     | 51678      |        |         |
| 7588e61 | 2026-11-04 | fix(core): refuse any string target on a conditional source  | 12467     | 51678      | 0      | 0       |
| d2c21b1 | 2026-11-04 | feat(core): derive the api surface and render the app's gene | 12479     | 51690      | 12     | 12      |
| cfc1c00 | 2026-11-04 | feat(core): add the command write path and receipts          | 13322     | 52533      | 843    | 843     |
| ae4102c | 2026-11-04 | feat(core): perform kernel effects, run inline reactions and | 14163     | 53374      | 841    | 841     |
| 9497f7d | 2026-11-05 | feat(core): add the control store, the lifecycle phases and  | 14163     | 53374      | 0      | 0       |
| 64167e3 | 2026-11-05 | feat(core): serve the generated entity actions with state to | 14350     | 53759      | 187    | 385     |
| e2c79a4 | 2026-11-05 | feat(core): operator tokens, me, capabilities and tenant ent | 14527     | 53936      | 177    | 177     |
| 17c6474 | 2026-11-05 | feat(transport): slice 3, the transports against the kernel  | 14738     | 54147      | 211    | 211     |
| b738fd5 | 2026-11-05 | fix(core): shape command output under the caller's read plan | 14738     | 54147      | 0      | 0       |
| 0b39370 | 2026-11-05 | feat(cli): the CLI against a running deployment              | 14875     | 54284      | 137    | 137     |
| 6e88cc4 | 2026-11-05 | ci: the nine steps and the M1 exit gate                      | 14875     | 54284      | 0      | 0       |
| c8ad21a | 2026-11-10 | docs: record the decisions of 2026-11-10 and align the m2 sc | 14875     | 54284      | 0      | 0       |

The growth is not spread evenly: `cfc1c00` (+843) and `ae4102c` (+841) carry 1,684 of 2,408 steps
in the 3-module case. The same step appears in the 25-module case, so it is a fixed cost per app,
not per module. `64167e3` is the exception (+187 and +385): its generated entity actions scale with
the number of entities.

## Attribution table (variants at `c8ad21a`)

| variant                      | 3 modules | 25 modules |
| ---------------------------- | --------- | ---------- |
| as-is                        | 14,875    | 54,284     |
| no-conflicting-fields        | 11,662    | 47,045     |
| no-dangling-refs             | 10,017    | 44,036     |
| no-field-checks (both)       | 5,943     | 34,682     |
| no-field-checks at `dcc5057` | 5,591     | 34,198     |

With both field checks removed the growth since `dcc5057` is 352 instead of 2,408: the two checks
carry 2,056 of the 2,408.

## Residual table (variant `cut`, the same commits)

| commit  | date       | subject                                                      | 3 modules | 25 modules | step 3 | step 25 |
| ------- | ---------- | ------------------------------------------------------------ | --------- | ---------- | ------ | ------- |
| dcc5057 | 2026-11-04 | feat(type-budgets): gate the type budgets in ci              | 9013      | 45518      |        |         |
| 7588e61 | 2026-11-04 | fix(core): refuse any string target on a conditional source  | 9013      | 45518      | 0      | 0       |
| d2c21b1 | 2026-11-04 | feat(core): derive the api surface and render the app's gene | 9025      | 45530      | 12     | 12      |
| cfc1c00 | 2026-11-04 | feat(core): add the command write path and receipts          | 9025      | 45530      | 0      | 0       |
| ae4102c | 2026-11-04 | feat(core): perform kernel effects, run inline reactions and | 9025      | 45530      | 0      | 0       |
| 9497f7d | 2026-11-05 | feat(core): add the control store, the lifecycle phases and  | 9025      | 45530      | 0      | 0       |
| 64167e3 | 2026-11-05 | feat(core): serve the generated entity actions with state to | 9248      | 45951      | 223    | 421     |
| e2c79a4 | 2026-11-05 | feat(core): operator tokens, me, capabilities and tenant ent | 9355      | 46058      | 107    | 107     |
| 17c6474 | 2026-11-05 | feat(transport): slice 3, the transports against the kernel  | 9355      | 46058      | 0      | 0       |
| b738fd5 | 2026-11-05 | fix(core): shape command output under the caller's read plan | 9355      | 46058      | 0      | 0       |
| 0b39370 | 2026-11-05 | feat(cli): the CLI against a running deployment              | 9492      | 46195      | 137    | 137     |
| 6e88cc4 | 2026-11-05 | ci: the nine steps and the M1 exit gate                      | 9492      | 46195      | 0      | 0       |
| c8ad21a | 2026-11-10 | docs: record the decisions of 2026-11-10 and align the m2 sc | 9492      | 46195      | 0      | 0       |

## Cause

The plan's hypothesis (operator tokens and control create in the `Core` action tree) is refuted:
`e2c79a4` is +177 and `0b39370` is +137. `cfc1c00` gave `core.commandReceipt` 12 fields in
`CoreBase` and `ae4102c` gave `core.effect` 12 fields. The type that pays for them is `AppChecks`
(`packages/core/src/model/app-checks.ts`), through `ConflictingFields<WithCore<Ms>>` and
`DanglingRefs<WithCore<Ms>>`: both computed the merged fields of every entity of every selected
module, the core included, at about 70 instantiations per field, once per app (architecture 13.11,
the fold budget per app).

## The cut

`ConflictingFields` now walks the keys of the added sources only (active conditional parts and
contributions): a conflict needs two sources and one object defines a key once, so every conflicting
key is a key of an added source. `DanglingRefs` walks `RefCheckedFields`: for the core module only
the fields other modules add, for every other module all fields. Every app selects the core and the
core's own references name core entities, so those are not walked. The result is the same for every
input: the `AppChecks` members, names and messages are unchanged and every existing type test passes
unchanged. Two tests were added in `app-checks.test-d.ts`: own versus an active conditional part
(passes on the old and the new type), and a valid selection of accounts, teams and auth has no app
checks. Both checks still fire across modules (case 6, the conditional test, the existing
`danglingReferences` test) and stay quiet over the core.

| measure                             | before                                | after                                    |
| ----------------------------------- | ------------------------------------- | ---------------------------------------- |
| bench, 3 modules                    | 14,875 (baseline when the work began) | 9,492 (-36.2 %; -23.9 % against 12,467)  |
| bench, 25 modules                   | 54,284 (baseline 51,678)              | 46,195 (-14.9 %; -10.6 % against 51,678) |
| synthetic 25 modules, fold          | 213,255                               | 196,693                                  |
| synthetic 25 modules, whole program | 1,309,843                             | 1,293,289                                |
| synthetic 40 modules, fold          | 357,960                               | 330,148                                  |
| synthetic 40 modules, whole program | 2,033,668                             | 2,005,864                                |
| app portal                          | 56,830 (recorded)                     | 45,708                                   |
| app conformance                     | 298,233 (recorded)                    | 288,261                                  |

Declaration sizes did not change (the cut is in type-level helpers that no module package
declares). Both bench baselines are set to the measured values (`pnpm bench:types`, Delta 0.00 %);
`scripts/type-budgets/budgets.json` is unchanged because its limits only gain headroom; the lead may
lower the recorded portal and conformance figures (45,708 and 288,261) and the synthetic limits.

## Not cut

`Check<Exclude<keyof X & string, CommandRefsOf<WithCore<Ms>, A>>, 'unknownExecutionOverrides'>`
walks the whole action tree even when no execution override is given. A `[keyof X & string] extends
[never]` guard takes the cut benchmark to 5,135 and 26,768 (architect's probe, not built). It stays
out because the benchmark would then stop measuring the core action tree that M2's core action groups
grow, and real apps compute the tree anyway. Follow-up for the lead.

## The form later core additions take

- A core entity field is a member of the `CoreBase` interface only and costs nothing in the app
  checks after the cut (`cfc1c00` and `ae4102c` are 0 in the residual table).
- A core action is one member of `CoreLiteral`, typed with a named `ActionPart` alias of
  `core-type.ts` (`CoreQuery`, `TenantCommand`, and a new alias per new shape), with input and
  output as named interfaces, never an inline mapped or conditional type.
- Each core action costs a fixed amount per app through `CommandRefsOf<WithCore<Ms>, A>` and the
  action tree. The residual table gives the figures: operator tokens, `me` and capabilities
  (`e2c79a4`) +107 and the control create (`0b39370`) +137 instantiations in the 3-module case. The
  generated entity actions of `64167e3` scale with entities (+223 at 3 modules, +421 at 25).

## Rerun

```
bash spikes/fold-growth/measure-fold-growth.sh
bash spikes/fold-growth/measure-fold-growth.sh --variant no-field-checks dcc5057 HEAD
bash spikes/fold-growth/measure-fold-growth.sh --variant cut
```
