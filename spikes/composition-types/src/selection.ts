import type { AnyModule } from './any-module.ts';
import type { ContractsIn, ModuleIdsIn } from './base-members.ts';
import type { Core } from './core-module.ts';
import type { ContractLevel } from './define-contract.ts';

/** The author's tuple with the implicit core module first. */
export type WithCore<Ms extends readonly AnyModule[]> = readonly [Core, ...Ms];

/** The module ids of a selection. */
export type Ids<Ms extends readonly AnyModule[]> = Ms[number]['id'];

/** One module of a selection, by id: a lookup over the union, never a walk over the tuple. */
export type ById<Ms extends readonly AnyModule[], I> = Extract<Ms[number], { readonly id: I }>;

/** Contracts provided by selected modules. */
export type ProvidedContracts<Ms extends readonly AnyModule[]> = Ms[number] extends infer M
  ? M extends { readonly provides: infer L }
    ? ContractsIn<L, ContractLevel>
    : never
  : never;

/** True when every module in `W` is selected and every app-level contract in `W` is provided. */
export type Satisfied<Ms extends readonly AnyModule[], W> = [W] extends [readonly unknown[]]
  ? [
      Exclude<ModuleIdsIn<W>, Ids<Ms>> | Exclude<ContractsIn<W, 'app'>, ProvidedContracts<Ms>>,
    ] extends [never]
    ? true
    : false
  : true;

/** Every contribution of the selection, tagged with its contributor. */
export type AllContributions<Ms extends readonly AnyModule[]> = Ms[number] extends infer M
  ? M extends { readonly id: infer From extends string; readonly contributes: readonly (infer C)[] }
    ? C extends unknown
      ? C & { readonly from: From }
      : never
    : never
  : never;

/** Contributions whose target is selected and whose `when` list is satisfied. */
export type ActiveContributions<Ms extends readonly AnyModule[]> =
  AllContributions<Ms> extends infer C
    ? C extends { readonly to: { readonly id: infer T extends string } }
      ? T extends Ids<Ms>
        ? Satisfied<Ms, C extends { readonly when: infer W } ? W : never> extends true
          ? C
          : never
        : never
      : never
    : never;

/** The conditional parts of module `M` whose `when` list is satisfied. */
export type ActiveConditionals<Ms extends readonly AnyModule[], M> = M extends {
  readonly conditional: readonly (infer Cd)[];
}
  ? Cd extends { readonly when: infer W }
    ? Satisfied<Ms, W> extends true
      ? Cd
      : never
    : never
  : never;
