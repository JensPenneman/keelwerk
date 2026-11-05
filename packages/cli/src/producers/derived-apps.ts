import type { AppDerivation } from './app-derivation.ts';

/** The apps of a workspace: those that derive, and the failures of those that do not. */
export interface DerivedApps {
  readonly apps: readonly AppDerivation[];
  readonly failures: readonly string[];
  readonly notes: readonly string[];
}
