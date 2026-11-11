/** Waits of a carrier on the runtime's clock (F-22). */
export interface LiveTimers {
  /**
   * Resolves `true` once the clock has reached `at`, and `false` when `signal` aborts (also when it
   * is aborted already). It never rejects.
   */
  sleepUntil(at: Temporal.Instant, signal: AbortSignal): Promise<boolean>;
}
