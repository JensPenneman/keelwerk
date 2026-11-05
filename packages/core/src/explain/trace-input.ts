import type { DataAdapter } from '../storage/data-adapter.ts';
import type { NamespaceRef } from '../storage/namespace-ref.ts';
import type { Scope } from '../storage/scope.ts';

/** What `traceCommand` reads. */
export interface TraceInput {
  readonly adapter: DataAdapter;
  readonly namespace: NamespaceRef;
  readonly scope: Scope;
  /** A command id, an event id or an effect id. */
  readonly id: string;
}
