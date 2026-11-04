import type { NamespaceRef } from './namespace-ref.ts';

/** Wake-ups, never data: something may have been committed in these scopes (section 15.2.5). */
export interface ChangeFeedSource {
  readonly level: 'poll' | 'notify' | 'stream';
  wake(
    namespaces: readonly NamespaceRef[],
    signal: AbortSignal,
  ): AsyncIterable<{ readonly namespace: string; readonly scopeIds: readonly string[] }>;
}
