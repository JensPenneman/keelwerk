import type { Connected } from './connected.ts';
import type { Migrated } from './migrate-phase.ts';
import type { RuntimeOptions } from './runtime-options.ts';

/** What `start` runs on: the connect and migrate phases' results and the runtime options. */
export interface StartPhaseInput {
  readonly connected: Connected;
  readonly migrated: Migrated;
  readonly options: RuntimeOptions;
}
