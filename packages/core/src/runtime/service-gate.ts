/**
 * The gate a process closes when it must stop serving (14.7.6): a restore was detected under it.
 * The invoker refuses with `core.unavailable` from then on, the process row is no longer `ready`
 * and `Runtime.outOfService` settles, so the host ends the process and its supervisor restarts it,
 * which runs the restore check at boot. A gate closes once.
 */
export interface ServiceGate {
  readonly closed: boolean;
  /**
   * Closes the gate; the reason is what `whenClosed` settles with. A second call changes nothing.
   * With `evidence: 'pending'` the process may not leave yet: `outOfService` waits for `recorded`.
   */
  close(reason: string, options?: { readonly evidence?: 'pending' }): void;
  /**
   * The evidence of the reason is recorded: `outOfService` may settle. A second call changes
   * nothing.
   */
  recorded(): void;
  /** Settles, never rejects, when the gate closes. */
  readonly whenClosed: Promise<string>;
  /**
   * Settles, never rejects, when the gate is closed and its evidence is recorded: what
   * `Runtime.outOfService` answers, since a host that leaves earlier would lose the evidence.
   */
  readonly outOfService: Promise<string>;
  /**
   * Aborts when the gate closes. Unlike a reaction on `whenClosed`, a listener on it can be
   * removed, so a short-lived subscription leaves nothing behind in a process that never closes.
   */
  readonly signal: AbortSignal;
}
