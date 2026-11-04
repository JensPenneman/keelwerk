import type { AppActionTree } from '@keelwerk/core';

type EntityLeaf<T, M, E, N> = M extends keyof T
  ? T[M] extends { readonly entities: infer Es }
    ? E extends keyof Es
      ? N extends keyof Es[E]
        ? Es[E][N]
        : never
      : never
    : never
  : never;

type ModuleLeaf<T, M, N> = M extends keyof T
  ? T[M] extends { readonly actions: infer As }
    ? N extends keyof As
      ? As[N]
      : never
    : never
  : never;

/** The leaf of the app's action tree an action reference names: kind, input, output, errors, events, execution. */
export type LeafAt<App, R> = R extends `${infer M}.${infer E}.${infer N}`
  ? EntityLeaf<AppActionTree<App>, M, E, N>
  : R extends `${infer M}.${infer N}`
    ? ModuleLeaf<AppActionTree<App>, M, N>
    : never;
