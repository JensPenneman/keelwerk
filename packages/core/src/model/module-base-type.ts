import type { AnyModuleBase } from './any-module-base.ts';

/** The named type of a module base: the identity; extending it in an interface gives emit a name. */
export type ModuleBaseType<T extends AnyModuleBase> = T;
