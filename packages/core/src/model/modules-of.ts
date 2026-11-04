import type { AnyModule } from './any-module.ts';

/** The modules of an app value (core first). */
export type ModulesOf<P> = P extends { readonly modules: infer Ms extends readonly AnyModule[] }
  ? Ms
  : never;
