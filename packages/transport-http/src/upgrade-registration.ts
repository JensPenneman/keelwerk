import type { WebSocketHandler } from '@keelwerk/core';

/** What a transport registered through `TransportHost.upgrade` (16.3.3). */
export interface UpgradeRegistration {
  readonly app: string;
  readonly transport: string;
  readonly path: string;
  readonly protocols: readonly string[];
  readonly handler: WebSocketHandler;
}
