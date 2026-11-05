import type { ArtefactRun } from './artefact-run.ts';
import type { EnvironmentFacts } from './environment-facts.ts';

/** The machine-facing inputs of the environment and project checks, injected so tests need no tools installed. */
export interface ProjectChecksInput {
  readonly root: string;
  readonly environment: EnvironmentFacts;
  readonly runScript: (script: string, args: readonly string[]) => Promise<ArtefactRun>;
}
