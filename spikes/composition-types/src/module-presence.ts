import type { ContractsIn, ListOf } from './base-members.ts';

type IdsOf<U> = U extends { readonly id: infer I extends string } ? I : never;
type ModulesIn<L> = L extends readonly (infer D)[]
  ? Extract<D, { readonly kind: 'module' }>
  : never;

/** Modules typed as present in a part: hard requirements and the `when` modules `W`. */
export type PresentModules<B, W> = ModulesIn<ListOf<B, 'requires'>> | ModulesIn<W>;

/** Ids of the present modules. */
export type PresentIds<B, W> = IdsOf<PresentModules<B, W>>;

/** Modules listed as `optional` and not present through `W`: reached through the Maybe accessor. */
export type OptionalModules<B, W> =
  ModulesIn<ListOf<B, 'optional'>> extends infer O
    ? O extends { readonly id: PresentIds<B, W> }
      ? never
      : O
    : never;

/** Ids of the optional modules. */
export type OptionalIds<B, W> = IdsOf<OptionalModules<B, W>>;

/** One module of a union of modules, by id. */
export type ModuleById<U, I> = Extract<U, { readonly id: I }>;

/** App-level contracts typed as present: required, or in `W`. */
export type PresentContracts<B, W> =
  | ContractsIn<ListOf<B, 'requires'>, 'app'>
  | ContractsIn<W, 'app'>;

/** App-level contracts listed as `optional` and not present through `W`. */
export type OptionalContracts<B, W> = Exclude<
  ContractsIn<ListOf<B, 'optional'>, 'app'>,
  PresentContracts<B, W>
>;
