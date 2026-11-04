import type { RuntimeModule } from './runtime-module.ts';

/** The modules of an app by id and the app-level contracts they provide (section 5.2). */
export interface AppSelection {
  /** In the author's order, the implicit core first. */
  readonly modules: readonly RuntimeModule[];
  /** The first module of each id. */
  readonly byId: ReadonlyMap<string, RuntimeModule>;
  readonly provided: ReadonlySet<string>;
}
