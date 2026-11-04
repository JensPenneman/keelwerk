import type { Connection } from './connection.ts';

/** What handlers see of the request as `ctx.request`; credentials never appear here (sections 7.6 and 16.4.10). */
export interface RequestInfo {
  readonly transport: string;
  readonly connection?: Connection;
  readonly requestId: string;
  readonly userAgent?: string;
}
