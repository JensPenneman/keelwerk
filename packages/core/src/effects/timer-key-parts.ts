/** A stored timer key taken apart (`splitTimerKey`), as `keelwerk jobs` shows it. */
export interface TimerKeyParts {
  /**
   * The id of the module that set the timer; `core.deadline` for the kernel's deadline timers, a
   * name no module id can take (5.1).
   */
  readonly module: string;
  /** The key as the module wrote it; it may hold colons. */
  readonly key: string;
}
