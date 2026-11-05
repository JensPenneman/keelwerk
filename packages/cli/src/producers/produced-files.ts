import type { ProducerFile } from './producer-file.ts';

/** What a producer implies for the workspace: the files, and the lines it has about them. */
export interface ProducedFiles {
  readonly files: readonly ProducerFile[];
  readonly notes: readonly string[];
  readonly failures: readonly string[];
}
