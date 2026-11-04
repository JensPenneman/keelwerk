/** Counts in-flight requests so `stop` can drain them (section 16.3.6). */
export interface Lifecycle {
  readonly stopping: boolean;
  /** Registers a request; false when the host no longer accepts work. */
  enter(): boolean;
  leave(): void;
  /** Marks the host as stopping and resolves when no request is in flight or the deadline passed. */
  drain(deadlineMs: number): Promise<void>;
}
