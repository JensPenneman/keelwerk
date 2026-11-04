import type { AnyModule } from './any-module.ts';

/** The named type of a module value: the identity; extending it in an interface gives emit a name (section 13.11). */
export type ModuleType<T extends AnyModule> = T;
