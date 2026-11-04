/** The parameters of one fair take (sections 9.5.3 and 14.3.9). */
export interface TakeRequest {
  readonly queue: string;
  readonly worker: string;
  readonly capabilitySets: readonly string[];
  /** `$batch`: jobs wanted, shared over the lanes picked. */
  readonly batch: number;
  /** `$lanes`: how many lanes one take may lock; section 9.5.3 does not say how it is chosen. */
  readonly lanes: number;
  readonly maxRevision: number;
  readonly leaseMs: number;
}
