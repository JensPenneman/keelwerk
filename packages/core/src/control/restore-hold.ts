/**
 * Tenants with an erasure left to run at the start (a completed erasure after an epoch bump, a
 * record the control ledger lost and the sinks gave back, or one still pending): not served until
 * the tenant has no unfinished erasure, that is until each has a completion at the current epoch.
 * Nothing of a held tenant runs: no request, no action job, no effect job, no deadline job (the
 * jobs are given back and tried again after a second). Every process that starts before the
 * completion derives the same set from the control ledger.
 */
export interface RestoreHold {
  held(): ReadonlySet<string>;
  /**
   * Throws core.unavailable while held; re-reads `ledger.unfinished({ tenantIds: [id] })` at most
   * once a second of the runtime clock (one read in flight per tenant) and lifts the tenant when no
   * unfinished erasure is left.
   */
  check(tenantId: string): Promise<void>;
}
