import type { NamespaceRef, Position } from '@keelwerk/core';

/** What `pollChangeFeed` needs from the adapter. */
export interface PollChangeFeedOptions {
  /** The scopes of the namespace whose head moved past `since`, at most `limit` of them (`EventStore.movedScopes`). */
  moved(
    namespace: NamespaceRef,
    since: ReadonlyMap<string, Position>,
    limit: number,
  ): Promise<readonly { readonly scopeId: string; readonly head: Position }[]>;
  /** Resolves after `ms`, or at once when the signal aborts. */
  sleep(ms: number, signal: AbortSignal): Promise<void>;
  /** Milliseconds between two polls; default 1000 (14.3.7). */
  readonly intervalMs?: number;
  /** Scopes asked per query; default 1000. */
  readonly pageSize?: number;
  /** A poll that failed; the next round tries again, so nothing is lost but time. */
  readonly onError?: (namespace: NamespaceRef, error: unknown) => void;
}
