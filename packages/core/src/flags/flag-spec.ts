import type { ModuleEntry } from '../registry/module-entry.ts';

/** A flag as providers read it: the registry flag entry with its key and a typed default (S-159). */
export type FlagSpec<T = unknown> = Omit<ModuleEntry['flags'][string], 'default'> & {
  /** `<module id>.<flag>`. */
  readonly key: string;
  readonly default: T;
};
