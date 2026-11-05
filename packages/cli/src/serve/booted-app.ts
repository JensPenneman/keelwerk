import type { Runtime } from '@keelwerk/core';

/** A process that has started: the runtime, where it listens, and the one way to stop it. */
export interface BootedApp {
  readonly runtime: Runtime;
  readonly port: number | undefined;
  readonly operatorSocket: string | undefined;
  /** Stops accepting, drains until `deadlineMs`, closes the data layer. */
  stop(deadlineMs: number): Promise<void>;
}
