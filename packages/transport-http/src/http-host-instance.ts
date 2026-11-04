import type { TransportHost } from '@keelwerk/core';
import type { HttpHostListening } from './http-host-listening.ts';

/** The running host: the transports' `TransportHost` plus its own lifecycle. */
export interface HttpHostInstance extends TransportHost {
  /** Opens the configured TCP listener and the operator socket. */
  listen(): Promise<HttpHostListening>;
  /** Stops accepting, drains in-flight requests until the deadline, then closes what is left. */
  stop(deadlineMs: number): Promise<void>;
}
