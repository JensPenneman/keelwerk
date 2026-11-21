import type { PostgresUrls } from './postgres-urls.ts';

/**
 * What the parent hands a child process (as one JSON argument): the deployment to join and what to
 * do there. `work` joins with workers on one queue and runs until its input ends; `calls` joins
 * without workers, waits for the line `go`, makes `calls` synchronous `bench.record` calls spread
 * over the tenants, says `done` and ends when its input ends.
 */
export interface ChildConfig {
  readonly urls: PostgresUrls;
  /** The reaction app and its dispatcher, or the plain app. */
  readonly reactions: boolean;
  readonly backendId: string;
  readonly tenants: Readonly<Record<string, string>>;
  readonly mode:
    | { readonly kind: 'work'; readonly queue: string; readonly slots: number }
    | { readonly kind: 'calls'; readonly calls: number };
}
