import type { ApiSurface } from '@keelwerk/core';
import type { RetryPolicy } from './retry-policy.ts';

/** Where and as whom a remote client talks. */
export interface RemoteConnection {
  /** Without a trailing slash. */
  readonly origin: string;
  readonly apiVersion: string;
  readonly token?: string;
  readonly backend?: string;
  readonly tenant?: string;
  readonly deviceId?: string;
  readonly send: typeof fetch;
  readonly retry: RetryPolicy;
  /** The committed surface artefact, which saves the request. */
  readonly committed?: ApiSurface;
}
