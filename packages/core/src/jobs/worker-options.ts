/** The options of `JobQueue.work` (section 9.5.1). */
export interface WorkerOptions {
  readonly slots: number;
  readonly capabilitySets: readonly string[];
  /** The worker's build revision: it takes jobs enqueued at or below it (section 19.2). */
  readonly revision: number;
  /**
   * Read before each take (S-121): true when a pause holds deployment-wide or for scopeId; absent:
   * never paused.
   */
  readonly isPaused?: (queue: string, scopeId: string) => Promise<boolean>;
}
