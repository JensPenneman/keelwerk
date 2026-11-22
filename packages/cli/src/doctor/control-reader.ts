import type { ScopeMark } from '@keelwerk/core';
import type { HookFailureFact, ProcessFact } from './deployment-facts.ts';

/** What doctor asks of a running deployment's control store: the rows of the facts it reads through a reader. */
export interface ControlReader {
  reachable(): Promise<{ readonly reachable: boolean; readonly detail: string }>;
  processes(): Promise<readonly ProcessFact[]>;
  hookFailures(): Promise<readonly HookFailureFact[]>;
  /** The marks whose epoch is above 0: scopes a detected restore moved to a new epoch (14.7.6). */
  bumpedMarks(): Promise<readonly ScopeMark[]>;
  /** The tenants with an erasure left to run, which every process that starts now holds (14.7.6). */
  heldTenants(): Promise<readonly string[]>;
}
