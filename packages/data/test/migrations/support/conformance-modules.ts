import type { TrackModule } from '../../../src/index.ts';

/** The modules of the conformance app in tuple order, with their dependencies. */
export const conformanceModules: readonly TrackModule[] = [
  { id: 'core', requires: [], optional: [] },
  { id: 'library', requires: [], optional: [] },
  { id: 'loans', requires: [], optional: ['library'] },
];
