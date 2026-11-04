import type { AnyModule } from './any-module.ts';
import type { ById } from './selection.ts';

type BaseGenerated<D> = D extends { readonly history: 'external' }
  ? 'get' | 'query'
  : D extends { readonly history: 'projection' }
    ? 'get' | 'query' | 'changes' | 'queryChanges'
    : 'get' | 'query' | 'changes' | 'queryChanges' | SetOperations;
type OptInGenerated<D> = D extends { readonly generated: { readonly history: true } }
  ? 'history'
  : never;
type SwitchedOff<D> = D extends { readonly generated: infer G }
  ? { [K in keyof G]: G[K] extends false ? (K extends 'set' ? SetOperations : K) : never }[keyof G]
  : never;
type Generators<Ms extends readonly AnyModule[]> = Ms[number] extends infer M
  ? M extends { readonly generates: readonly (infer G)[] }
    ? G
    : never
  : never;

/** The definition of entity `E` of module `I` in a selection. */
type EntityDef<Ms extends readonly AnyModule[], I extends string, E extends string> =
  ById<Ms, I> extends { readonly entities: { readonly [K in E]: infer D } } ? D : never;

/** The generated actions that write: `set` switches them off together. */
export type SetOperations = 'set' | 'create' | 'update' | 'archive' | 'restore';

/**
 * The generated action names of an entity (section 6.7): by history mode, minus what `generated`
 * switches off, plus `history` when opted in and the templates the selected modules fill.
 */
export type GeneratedActionNames<
  Ms extends readonly AnyModule[],
  I extends string,
  E extends string,
> =
  EntityDef<Ms, I, E> extends infer D
    ? Exclude<
        | BaseGenerated<D>
        | OptInGenerated<D>
        | (D extends { readonly history: 'external' } ? never : Generators<Ms>),
        SwitchedOff<D>
      >
    : never;
