import type { RetentionRunQuery } from '../storage/retention-run-store.ts';
import type { RetentionRun } from './retention-run.ts';

/** `ControlStore.retention`: each call in its own deployment-scope unit of the control namespace. */
export interface ControlRetention {
  /** Records one run, in a writing unit. */
  record(run: RetentionRun): Promise<void>;
  /** The scope's runs, newest first, in a read-only unit. */
  list(query: RetentionRunQuery): Promise<readonly RetentionRun[]>;
}
