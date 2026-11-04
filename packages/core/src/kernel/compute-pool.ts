/** The kernel worker pool for computations that must stay off the event loop (section 7.9.3). */
export interface ComputePool {
  argon2idHash(password: string, salt: Uint8Array): Promise<string>;
  argon2idVerify(verifier: string, password: string): Promise<boolean>;
  /** Stops the workers after the running jobs finish. */
  close(): Promise<void>;
}
