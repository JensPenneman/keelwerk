import type { SeededScope } from './seeded-scope.ts';

/** One writer connection: its scope, the targets it cycles through and the entities its decisions load. */
export interface WriterAssignment {
  readonly scope: SeededScope;
  readonly targets: readonly string[];
  readonly loads: readonly string[];
  /** The scope's own lane, when each command enqueues an effect job. */
  readonly enqueueLane?: string | undefined;
}
