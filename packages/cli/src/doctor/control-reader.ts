import type { AnchorSinkStatus } from '@keelwerk/core';
import type { HookFailureFact, ProcessFact, QueueFact, WorkFact } from './deployment-facts.ts';

/**
 * What doctor asks of a running deployment's control store. Every member is optional: a reader
 * answers what it can reach, and doctor treats the rest as unknown.
 */
export interface ControlReader {
  reachable(): Promise<{ readonly reachable: boolean; readonly detail: string }>;
  processes(): Promise<readonly ProcessFact[]>;
  hookFailures(): Promise<readonly HookFailureFact[]>;
  /** Decimal head positions of the scopes that exist; a scope the reader cannot resolve is left out. */
  heads?(scopeIds: ReadonlySet<string>): Promise<ReadonlyMap<string, string>>;
  /** Queued and running jobs per queue name. */
  queueDepths?(): Promise<ReadonlyMap<string, Pick<QueueFact, 'queued' | 'running'>>>;
  work?(): Promise<WorkFact>;
  /** Per ledger sink: the appends it refused and the last failure of the anchor writer. */
  anchorSinks?(): readonly AnchorSinkStatus[];
}
