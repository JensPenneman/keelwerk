import type { TypeCheckerStatus } from './type-checker-status.ts';

/** What the status line shows. */
export interface DevStatus {
  readonly types: TypeCheckerStatus;
  readonly app: 'starting' | 'running' | 'failed' | 'stopped';
  readonly port: number | undefined;
  readonly socket: string | undefined;
  /** The last restart, in milliseconds. */
  readonly restartMs: number | undefined;
}
