/** A stored timer key taken apart (`splitTimerKey`), as `keelwerk jobs` shows it. */
export interface TimerKeyParts {
  /**
   * The id of the module that set the timer; `core` for the kernel's own (an effect's deadline).
   */
  readonly module: string;
  /** The key as the module wrote it; it may hold colons. */
  readonly key: string;
}
