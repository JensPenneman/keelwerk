/** An unwrapped data key, held only in the bounded per-process cache (section 14.7.4). */
export interface DataKey {
  readonly id: string;
  /** 32 bytes for AES-256-GCM. */
  readonly material: Uint8Array;
}
