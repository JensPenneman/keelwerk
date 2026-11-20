import type { NamespaceRef } from './namespace-ref.ts';

/**
 * A wake-up for the workers of one namespace (9.5.6): a commit made jobs takeable in these queues.
 * Without `queues` the reader cannot name them and every queue of the namespace is swept.
 */
export interface JobWake {
  readonly namespace: string;
  readonly queues?: readonly string[];
}

/** Wake-ups, never data: something may have been committed in these scopes (section 15.2.5). */
export interface ChangeFeedSource {
  readonly level: 'poll' | 'notify' | 'stream';
  wake(
    namespaces: readonly NamespaceRef[],
    signal: AbortSignal,
  ): AsyncIterable<{ readonly namespace: string; readonly scopeIds: readonly string[] }>;
  /**
   * Wake-ups for the workers, never data (9.5.6): the queues in which a commit made a job takeable,
   * in its namespace. The first wake-up of each namespace names no queues (the reader cannot know what
   * committed before it listened, and a reader that reconnects cannot know what it missed), and any
   * wake-up that cannot name its queues names none. A feed that only polls yields nothing: the
   * workers' own poll is the net under every wake-up.
   */
  jobs(namespaces: readonly NamespaceRef[], signal: AbortSignal): AsyncIterable<JobWake>;
}
