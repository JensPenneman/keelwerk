import type { HandEdit } from './hand-edit.ts';
import type { ScaffoldFile } from './scaffold-file.ts';

/** The files a scaffold creates and the edits it leaves to the author. */
export interface ScaffoldPlan {
  readonly files: readonly ScaffoldFile[];
  readonly handEdits: readonly HandEdit[];
}
