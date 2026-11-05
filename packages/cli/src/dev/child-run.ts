import type { HostExit } from '../context/cli-host.ts';

/** How a child that was waited for ended. */
export interface ChildRun {
  /** `'timeout'` when the limit passed and the child was killed. */
  readonly exit: HostExit | 'timeout';
  readonly stdout: string;
  readonly stderr: string;
}
